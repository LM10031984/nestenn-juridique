// lib/legal-gold-score.ts
// Scoring gold-aware — compare réponse aux critères gold
// Applicable à V1 ET V2 (aucune dépendance au LegalBrief ou ValidationReport)

import type { GoldBenchmarkCase } from './legal-gold-cases'

export type GoldScore = {
  mustIncludeScore: number   // /5 — concepts obligatoires présents
  mustAvoidScore: number     // /5 — pénalité si formulations interdites
  authorityScore: number     // /5 — références légales pivots (concept-level, équitable V1/V2)
  practicalScore: number     // /5 — conduite pratique exploitable
  total: number              // /20
  comments: string[]
}

export type WinnerVerdict = 'V2' | 'V1' | 'TIE' | 'V2_NO_MATCH'

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['']/g, "'")
}

function clampHalf(value: number, max = 5): number {
  return Math.max(0, Math.min(max, Math.round(value * 2) / 2))
}

function containsKeywords(normText: string, phrase: string): boolean {
  const words = normalizeText(phrase).split(/\s+/).filter((w) => w.length > 3)
  if (words.length === 0) return false
  return words.every((w) => normText.includes(w))
}

function countMatches(normText: string, items: string[]): number {
  return items.filter((item) => containsKeywords(normText, item)).length
}

export function scoreAgainstGold(answer: string, gold: GoldBenchmarkCase): GoldScore {
  const norm = normalizeText(answer)
  const comments: string[] = []

  // mustIncludeScore /5
  const includeTotal = gold.mustInclude.length
  const includeFound = countMatches(norm, gold.mustInclude)
  const mustIncludeScore = includeTotal > 0 ? clampHalf((includeFound / includeTotal) * 5) : 5
  if (includeFound < includeTotal) {
    const missing = gold.mustInclude.filter((i) => !containsKeywords(norm, i))
    comments.push(`Concepts manquants (${includeTotal - includeFound}/${includeTotal}) : ${missing.slice(0, 3).join(', ')}`)
  }

  // mustAvoidScore /5 — pénalité -2 par formulation interdite
  const avoidFound = countMatches(norm, gold.mustAvoid)
  const mustAvoidScore = clampHalf(5 - avoidFound * 2)
  if (avoidFound > 0) {
    const found = gold.mustAvoid.filter((a) => containsKeywords(norm, a))
    comments.push(`Formulation(s) interdite(s) : ${found.slice(0, 2).join(' | ')}`)
  }

  // authorityScore /5 — concept-level, équitable V1 (citations) et V2 (tags)
  const authTotal = gold.keyAuthorities.length
  const authFound = countMatches(norm, gold.keyAuthorities)
  const authorityScore = authTotal > 0 ? clampHalf((authFound / authTotal) * 5) : 5
  if (authFound < authTotal) {
    const missing = gold.keyAuthorities.filter((a) => !containsKeywords(norm, a))
    comments.push(`Autorités conceptuelles manquantes : ${missing.join(', ')}`)
  }

  // practicalScore /5
  const practTotal = gold.practicalExpectation.length
  const practFound = countMatches(norm, gold.practicalExpectation)
  const practicalScore = practTotal > 0 ? clampHalf((practFound / practTotal) * 5) : 5
  if (practFound < practTotal) {
    const missing = gold.practicalExpectation.filter((p) => !containsKeywords(norm, p))
    comments.push(`Conduites pratiques manquantes : ${missing.slice(0, 2).join(', ')}`)
  }

  const total = mustIncludeScore + mustAvoidScore + authorityScore + practicalScore
  return { mustIncludeScore, mustAvoidScore, authorityScore, practicalScore, total, comments }
}

export function determineWinner(
  v1Total: number,
  v2Total: number,
  v2Matched: boolean
): WinnerVerdict {
  if (!v2Matched) return 'V2_NO_MATCH'
  if (v2Total > v1Total) return 'V2'
  if (v1Total > v2Total) return 'V1'
  return 'TIE'
}
