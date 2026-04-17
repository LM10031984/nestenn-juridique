// lib/response-validator.ts
// Validation mécanique des réponses — niveau 1 (gratuit, instantané)
// Vérifie que le LLM a utilisé les sources fournies.

import type { LegiTextResult } from '@/lib/legifrance'
import type { NormalizedCase } from '@/lib/judilibre'

export interface QualityCheck {
  score: number
  flags: string[]
  pass: boolean
}

export function validateResponseQuality(
  response: string,
  dilaTexts: LegiTextResult[],
  juriCases: NormalizedCase[],
  expectedLexicon?: string[],
): QualityCheck {
  const flags: string[] = []
  let score = 100
  const lower = response.toLowerCase()

  // 1. Sources Légifrance citées ?
  if (dilaTexts.length > 0) {
    const citesAnyArticle = dilaTexts.some(t => {
      const artMatch = t.title?.match(/art(?:icle)?\.?\s*(\S+)/i)
      return artMatch && lower.includes(artMatch[1].toLowerCase())
    })
    if (!citesAnyArticle) {
      flags.push('LEGI_NON_CITEE')
      score -= 30
    }
  }

  // 2. Jurisprudence citée ?
  if (juriCases.length > 0) {
    const citesAnyCase = /cass\.|cour d'appel|cour de cassation|n° \d{2}[-\/]/.test(lower)
    if (!citesAnyCase) {
      flags.push('JURI_NON_CITEE')
      score -= 25
    }
  }

  // 3. Lexique attendu présent ?
  if (expectedLexicon?.length) {
    const found = expectedLexicon.filter(term => lower.includes(term.toLowerCase()))
    const ratio = found.length / expectedLexicon.length
    if (ratio < 0.3) {
      flags.push('LEXIQUE_FAIBLE')
      score -= 20
    }
  }

  // 4. Disclaimer présent ?
  if (!/informations? générales|titre informatif|vérifiez les textes|conseil juridique/i.test(response)) {
    flags.push('DISCLAIMER_ABSENT')
    score -= 10
  }

  // 5. Longueur raisonnable ?
  const wordCount = response.split(/\s+/).length
  if (wordCount < 50) { flags.push('TROP_COURT'); score -= 15 }
  if (wordCount > 800) { flags.push('TROP_LONG'); score -= 20 }

  return {
    score: Math.max(0, score),
    flags,
    pass: score >= 60,
  }
}

/**
 * Juge LLM async — évalue la qualité juridique de la réponse (fire-and-forget).
 * Coût : ~0.0003€/question (GPT-4o-mini).
 */
export async function judgeResponseAsync(
  question: string,
  response: string,
  availableSources: string,
  openRouterChatFn: (messages: any[], model: string, maxTokens: number) => Promise<string>,
  filterModel: string,
): Promise<{ score: number; issues: string[] }> {
  const prompt = `Évalue cette réponse juridique. JSON uniquement.

Question : ${question}
Sources disponibles : ${availableSources}
Réponse : ${response.slice(0, 1500)}

5 critères, 20 points chacun :
1. GROUNDING — cite les articles/arrêts des sources fournies ?
2. EXACTITUDE — références correctes (bonne loi, bon numéro) ?
3. COMPLÉTUDE — tous les aspects traités ?
4. ACTIONNABLE — recommandation concrète ?
5. NUANCE — distingue les cas incertains ?

{"score": 0-100, "issues": ["problème 1"]}`

  try {
    const result = await openRouterChatFn(
      [{ role: 'user', content: prompt }],
      filterModel,
      200,
    )
    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    return JSON.parse(cleaned)
  } catch {
    return { score: -1, issues: ['JUDGE_ERROR'] }
  }
}

/**
 * Construit le prompt de correction quand la validation échoue.
 */
export function buildCorrectionPrompt(quality: QualityCheck, sourceNames: string[]): string {
  const issues: string[] = []

  if (quality.flags.includes('LEGI_NON_CITEE')) {
    issues.push(`Tu n'as pas cité les articles de loi fournis (${sourceNames.filter(s => !s.startsWith('Cass') && !s.startsWith('CA')).join(', ')}). Intègre-les dans ta réponse.`)
  }
  if (quality.flags.includes('JURI_NON_CITEE')) {
    issues.push(`Tu n'as pas cité la jurisprudence fournie (${sourceNames.filter(s => s.startsWith('Cass') || s.startsWith('CA')).join(', ')}). Intègre au moins un arrêt pertinent.`)
  }
  if (quality.flags.includes('DISCLAIMER_ABSENT')) {
    issues.push('Ajoute un disclaimer en fin de réponse.')
  }

  return `CORRECTION REQUISE — Problèmes détectés : ${quality.flags.join(', ')}.\n${issues.join('\n')}\nRéécris ta réponse complète en corrigeant ces points.`
}
