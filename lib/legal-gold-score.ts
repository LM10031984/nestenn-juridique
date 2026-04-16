// lib/legal-gold-score.ts
// Scoring gold-aware — compare réponse aux critères gold
// Applicable à V1 ET V2 (aucune dépendance au LegalBrief ou ValidationReport)
//
// Logique d'autorité en 3 niveaux :
//   a) Autorité absente → pénalité pleine
//   b) Autorité présente sous forme abrégée/alias → pénalité réduite (0.25 pt)
//   c) Mauvaise autorité (wrongAuthorityContexts) → pénalité forte maintenue

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

// ─────────────────────────────────────────────────────────────────────────────
// Dictionnaire d'alias d'autorités
// Chaque entrée : { canonical: string, aliases: string[] }
// L'alias est cherché uniquement si le terme canonique est absent.
// Pénalité réduite (0.25 pt) pour forme différente vs pénalité pleine si absent.
// ─────────────────────────────────────────────────────────────────────────────

type AuthorityAlias = {
  canonical: string       // terme cherché dans keyAuthorities
  aliases: string[]       // formes abrégées/alternatives (cherchées dans normText)
}

const AUTHORITY_ALIASES: AuthorityAlias[] = [
  {
    canonical: 'code civil',
    aliases: ['c civ', 'civ', '1113', '1114', '1589', '1731', '1304'],
  },
  {
    canonical: 'code de la sante publique',
    aliases: ['csp', 'sante publique', 'l1331'],
  },
  {
    canonical: 'loi de 1989',
    aliases: ['89 462', 'juillet 1989', 'loi 89', '1989'],
  },
  {
    canonical: 'code de la construction',
    aliases: ['cch', 'l271'],
  },
  {
    canonical: 'code de la consommation',
    aliases: ['conso', 'l313'],
  },
  // Phase 2 — loi copropriété et décret
  {
    canonical: 'loi du 10 juillet 1965',
    aliases: ['loi 65-557', '65-557', 'juillet 1965'],
  },
  {
    canonical: 'décret 67-223',
    aliases: ['mars 1967', 'décret 1967', '67-223'],
  },
]

/**
 * findAuthorityAlias — vérifie si un keyAuthority non trouvé en forme longue
 * est présent sous forme abrégée. Retourne true si un alias matche.
 */
function findAuthorityAlias(normText: string, canonicalPhrase: string): boolean {
  const normCanonical = normalizeText(canonicalPhrase)
  for (const entry of AUTHORITY_ALIASES) {
    if (!normalizeText(entry.canonical).split(/\s+/).every((w) => w.length <= 3 || normCanonical.includes(w))) continue
    // vérifier si le canonical correspond à cette entrée
    const canonWords = normalizeText(entry.canonical).split(/\s+/).filter((w) => w.length > 3)
    const normCanoWords = normalizeText(canonicalPhrase).split(/\s+/).filter((w) => w.length > 3)
    // correspondance si au moins 1 mot significatif en commun
    const hasOverlap = canonWords.some((w) => normCanoWords.includes(w))
    if (!hasOverlap) continue
    // vérifier si un alias est présent dans normText
    return entry.aliases.some((alias) => {
      const aliasWords = normalizeText(alias).split(/\s+/).filter((w) => w.length > 1)
      return aliasWords.every((w) => normText.includes(w))
    })
  }
  return false
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
  // Logique 3 niveaux :
  //   a) Autorité trouvée en forme longue → score plein
  //   b) Autorité trouvée uniquement via alias (forme abrégée) → pénalité réduite (0.25 pt)
  //   c) Autorité absente → pénalité pleine
  const authTotal = gold.keyAuthorities.length
  const authFound = countMatches(norm, gold.keyAuthorities)
  const missing = gold.keyAuthorities.filter((a) => !containsKeywords(norm, a))

  // Vérification alias pour les autorités manquantes
  let aliasFoundCount = 0
  const trulyMissing: string[] = []
  for (const auth of missing) {
    if (findAuthorityAlias(norm, auth)) {
      aliasFoundCount++
      comments.push(`Autorité "${auth}" trouvée via forme abrégée/alias (−0.25 pt)`)
    } else {
      trulyMissing.push(auth)
    }
  }

  // Score : trouvé plein + alias avec malus 0.25 par autorité abrégée
  const rawScore = authTotal > 0
    ? ((authFound + aliasFoundCount) / authTotal) * 5 - aliasFoundCount * 0.25
    : 5
  let authorityScore = authTotal > 0 ? clampHalf(rawScore) : 5

  if (trulyMissing.length > 0) {
    comments.push(`Autorités conceptuelles manquantes : ${trulyMissing.join(', ')}`)
  }

  // wrongAuthorityContexts — pénalité si autorité mal employée
  if (gold.wrongAuthorityContexts) {
    for (const wac of gold.wrongAuthorityContexts) {
      const authNorm = normalizeText(wac.authority)
      const idx = norm.indexOf(authNorm)
      if (idx === -1) continue

      // Contexte ±250 chars autour de la citation
      const ctx = norm.slice(Math.max(0, idx - 250), idx + authNorm.length + 250)
      const contextFound = wac.contexts.some((c) => ctx.includes(normalizeText(c)))

      if (contextFound) {
        authorityScore = clampHalf(authorityScore - wac.penalty)
        comments.push(
          `Autorité mal employée : "${wac.authority}" cité en contexte incompatible (${wac.contexts.slice(0, 2).join('/')}) — portée incorrecte`
        )
      }
    }
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
