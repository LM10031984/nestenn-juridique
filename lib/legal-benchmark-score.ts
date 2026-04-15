// lib/legal-benchmark-score.ts
// Scoring déterministe des réponses V2 — aucun LLM, heuristiques lisibles
// Usage : scoreAnswer(questionId, answer, validationReport, brief) → BenchmarkScore

import type { ValidationReport } from './answer-validator'
import type { LegalBrief } from './legal-brief'

export type BenchmarkScore = {
  legalAccuracy: number        // /5
  mandatoryNuances: number     // /5
  practicalUsefulness: number  // /5
  safety: number               // /5
  total: number                // /20
  comments: string[]
}

// Termes de conduite pratique exploitable (normalisés NFD)
const PRACTICAL_TERMS = [
  'doit',
  'peut ',
  'est possible',
  'recommand',
  'verifi',
  'contacter',
  'saisir',
  'mettre en demeure',
  'solliciter',
  'proceder',
  'engager',
  'fournir',
  'demontrer',
  'prouver',
  'signaler',
  'informer',
  'notifi',
  'etape',
  'demarche',
]

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['']/g, "'")
}

/** Arrondit à la demi-unité la plus proche, clampé entre 0 et max */
function clampHalf(value: number, max = 5): number {
  return Math.max(0, Math.min(max, Math.round(value * 2) / 2))
}

/**
 * scoreAnswer — Scoring déterministe d'une réponse V2 sur /20.
 * Heuristiques simples et maintenables, pas de NLP complexe.
 *
 * @param questionId         Identifiant de la question benchmark (Q1, Q2, Q3)
 * @param answer             Réponse générée par le LLM
 * @param validationReport   Rapport de validation déterministe
 * @param brief              LegalBrief utilisé pour générer la réponse
 */
export function scoreAnswer(
  questionId: string,
  answer: string,
  validationReport: ValidationReport,
  brief: LegalBrief
): BenchmarkScore {
  const comments: string[] = []
  const norm = normalizeText(answer)

  // ── legalAccuracy /5 ────────────────────────────────────────────────────────
  // Pénalise erreurs et raccourcis majeurs (issues high/medium)
  let legalAccuracy = 5
  for (const issue of validationReport.issues) {
    if (issue.code === 'FORBIDDEN_ASSERTION') {
      legalAccuracy -= 2
      comments.push('Précision juridique : assertion interdite détectée')
    } else if (issue.code === 'NONEXISTENT_TAG') {
      legalAccuracy -= 1.5
      comments.push('Précision juridique : tag de source inexistant utilisé')
    } else if (issue.code === 'UNCOVERED_PRECISE_SANCTION' && issue.severity === 'high') {
      legalAccuracy -= 1
      comments.push('Précision juridique : sanction précise sans source taggée')
    } else if (issue.severity === 'medium') {
      legalAccuracy -= 0.5
    }
  }
  legalAccuracy = clampHalf(legalAccuracy)

  // ── mandatoryNuances /5 ──────────────────────────────────────────────────────
  // Vérifie la présence des distinctions obligatoires du playbook
  const totalDistinctions = brief.requiredDistinctions.length
  const missingCount = validationReport.issues.filter(
    (i) => i.code === 'MISSING_DISTINCTION'
  ).length
  const foundCount = Math.max(0, totalDistinctions - missingCount)
  const mandatoryNuances =
    totalDistinctions > 0
      ? clampHalf((foundCount / totalDistinctions) * 5)
      : 5

  if (missingCount > 0) {
    comments.push(
      `Nuances : ${missingCount} distinction(s) obligatoire(s) manquante(s) sur ${totalDistinctions}`
    )
  }

  // ── practicalUsefulness /5 ──────────────────────────────────────────────────
  // Vérifie qu'il y a une conduite pratique exploitable
  const practicalMatches = PRACTICAL_TERMS.filter((term) =>
    norm.includes(normalizeText(term))
  ).length

  let practicalUsefulness: number
  if (practicalMatches >= 4 && validationReport.ok) {
    practicalUsefulness = 5
  } else if (practicalMatches >= 3) {
    practicalUsefulness = 4
  } else if (practicalMatches >= 2) {
    practicalUsefulness = 3
  } else if (practicalMatches >= 1) {
    practicalUsefulness = 2
  } else if (answer.length > 200) {
    practicalUsefulness = 1
    comments.push("Utilité pratique : réponse longue mais peu d'éléments de conduite détectés")
  } else {
    practicalUsefulness = 0
    comments.push('Utilité pratique : réponse trop courte ou sans conduite pratique')
  }

  // ── safety /5 ───────────────────────────────────────────────────────────────
  // Pénalise assertions interdites, délais/sanctions non couverts, tags invalides
  let safety = 5
  for (const issue of validationReport.issues) {
    switch (issue.code) {
      case 'FORBIDDEN_ASSERTION':
        safety -= 2
        break
      case 'UNCOVERED_PRECISE_SANCTION':
        safety -= 1.5
        break
      case 'NONEXISTENT_TAG':
        safety -= 1.5
        break
      case 'FORBIDDEN_AUTOMATICITY':
        safety -= 1
        break
      case 'UNCOVERED_PRECISE_DELAY':
        safety -= 0.5
        break
    }
  }
  safety = clampHalf(safety)

  if (!validationReport.ok) {
    comments.push("Sécurité : validation échouée — réponse non sûre en l'état")
  }

  // ── total /20 ───────────────────────────────────────────────────────────────
  const total = legalAccuracy + mandatoryNuances + practicalUsefulness + safety
  comments.push(`Score ${questionId} : ${total}/20`)

  return { legalAccuracy, mandatoryNuances, practicalUsefulness, safety, total, comments }
}
