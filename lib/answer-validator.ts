// lib/answer-validator.ts
// Validateur déterministe post-génération — sans LLM
// Vérifie que la réponse respecte le LegalBrief :
//   - absence d'assertions interdites
//   - présence des distinctions requises
//   - cohérence avec le precision budget
//   - pas de chiffres précis sans couverture taggée (budget low)
//   - pas de références à des tags inexistants

import type { LegalBrief } from './legal-brief'
import { AUTHORITY_SCOPE_CONSTRAINTS } from './authority-cards'

export type ValidationIssue = {
  severity: 'low' | 'medium' | 'high'
  code: string
  message: string
}

export type ValidationReport = {
  ok: boolean
  issues: ValidationIssue[]
}

// ─────────────────────────────────────────────────────────────────────────────
// validateAnswerAgainstBrief — point d'entrée principal
// ─────────────────────────────────────────────────────────────────────────────

export function validateAnswerAgainstBrief(
  answer: string,
  brief: LegalBrief
): ValidationReport {
  const issues: ValidationIssue[] = []
  const normalizedAnswer = answer.toLowerCase()

  // 1. Assertions interdites
  issues.push(...checkForbiddenAssertions(normalizedAnswer, brief.forbiddenAssertions))

  // 2. Distinctions obligatoires manquantes
  issues.push(...checkRequiredDistinctions(normalizedAnswer, brief.requiredDistinctions, brief.archetype))

  // 3. Délais précis non couverts si budget low
  if (brief.precisionBudget === 'low') {
    issues.push(...checkUncoveredPreciseDelays(answer, brief))
    issues.push(...checkUncoveredPreciseSanctions(answer, brief))
  }

  // 4. Automaticité interdite
  issues.push(...checkForbiddenAutomaticity(normalizedAnswer, brief.forbiddenAssertions))

  // 5. Tags inexistants dans le brief
  issues.push(...checkNonExistentTags(answer, brief))

  // 6. Autorités citées hors de leur portée connue
  issues.push(...checkAuthorityScopeMismatch(answer, brief))

  const ok = !issues.some((i) => i.severity === 'high' || i.severity === 'medium')

  return { ok, issues }
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 1 : Assertions interdites
// ─────────────────────────────────────────────────────────────────────────────

function checkForbiddenAssertions(
  normalizedAnswer: string,
  forbiddenAssertions: string[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  for (const assertion of forbiddenAssertions) {
    const normalizedAssertion = assertion.toLowerCase()

    // Vérification par fragments discriminants (les assertions peuvent être paraphrasées)
    const fragments = buildAssertionFragments(normalizedAssertion)
    for (const fragment of fragments) {
      if (normalizedAnswer.includes(fragment)) {
        issues.push({
          severity: 'high',
          code: 'FORBIDDEN_ASSERTION',
          message: `Assertion interdite détectée : "${assertion}" (fragment : "${fragment}")`,
        })
        break // une seule issue par assertion interdite
      }
    }
  }

  return issues
}

/**
 * Découpe une assertion interdite en fragments discriminants.
 * Permet de détecter des paraphrases partielles.
 */
function buildAssertionFragments(assertion: string): string[] {
  const fragments: string[] = [assertion]

  // Extraire des sous-expressions de 4+ mots consécutifs comme fragments
  const words = assertion.split(/\s+/).filter((w) => w.length > 2)
  if (words.length >= 4) {
    // Fenêtres de 4 mots glissantes
    for (let i = 0; i <= words.length - 4; i++) {
      const fragment = words.slice(i, i + 4).join(' ')
      if (!fragments.includes(fragment)) fragments.push(fragment)
    }
  }

  return fragments
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 2 : Distinctions obligatoires
// ─────────────────────────────────────────────────────────────────────────────

const DISTINCTION_KEYWORDS: Record<string, string[]> = {
  // vente_offre_contre_signee
  'offre seule vs offre contresignée vs compromis ou promesse synallagmatique': [
    'compromis', 'promesse', 'avant-contrat', 'offre', 'contresignée', 'contresigné',
  ],
  'théorie de la formation du contrat vs réalité pratique du contentieux': [
    'en pratique', 'contentieux', 'formation', 'théoriquement', 'en théorie', 'juge',
  ],
  "conditions suspensives (prêt/financement) et leur impact sur l'engagement": [
    'condition suspensive', 'prêt', 'crédit', 'financement', 'caducité', 'non obtention',
  ],
  "délai de rétractation de 10 jours de l'acquéreur non professionnel en matière d'habitation (L271-1 CCH)": [
    '10 jours', 'rétractation', 'l271-1', 'l.271-1', 'acquéreur non professionnel',
  ],
  "exécution forcée théoriquement possible mais non automatique en pratique": [
    'exécution forcée', 'automatique', 'en pratique', 'non automatique',
  ],
  // gestion_locative_depot_garantie
  "fragilité probatoire liée à l'incomplétude vs impossibilité absolue de toute preuve": [
    'fragilise', 'fragilité', 'probatoire', 'preuve', 'impossible',
  ],
  "rôle du bailleur (décision) vs rôle de l'agence mandataire (conseil et exécution)": [
    'bailleur', 'agence', 'mandataire', 'propriétaire',
  ],
  "délais de restitution du dépôt (art. 22 loi 89-462) vs justification des retenues": [
    'restitution', 'délai', '1 mois', '2 mois', 'retenue', 'justification',
  ],
  // environnement_immo_spanc
  "dénonciation du voisin vs déclenchement formel d'un contrôle SPANC : deux choses distinctes": [
    'dénonciation', 'contrôle', 'spanc', 'voisin', 'plainte',
  ],
  "non-conformité simple vs danger sanitaire ou environnemental avéré : conséquences différentes": [
    'non-conformité', 'danger', 'sanitaire', 'environnemental', 'risque',
  ],
}

function checkRequiredDistinctions(
  normalizedAnswer: string,
  requiredDistinctions: string[],
  archetype: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  for (const distinction of requiredDistinctions) {
    const keywords = DISTINCTION_KEYWORDS[distinction] || extractKeywordsFromDistinction(distinction)
    const covered = keywords.some((kw) => normalizedAnswer.includes(kw.toLowerCase()))

    if (!covered) {
      issues.push({
        severity: 'medium',
        code: 'MISSING_DISTINCTION',
        message: `Distinction requise non abordée : "${distinction}"`,
      })
    }
  }

  return issues
}

function extractKeywordsFromDistinction(distinction: string): string[] {
  // Fallback : extraire les mots substantiels (>4 chars) de la distinction
  return distinction
    .split(/[\s,.:;()\-/]+/)
    .filter((w) => w.length > 4)
    .map((w) => w.toLowerCase())
    .slice(0, 5)
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 3 : Délais précis non couverts (budget low)
// ─────────────────────────────────────────────────────────────────────────────

// Patterns de délais précis en français
const PRECISE_DELAY_PATTERNS = [
  /\b\d+\s*jours?\b/gi,
  /\b\d+\s*mois\b/gi,
  /\b\d+\s*semaines?\b/gi,
  /\b\d+\s*ans?\b/gi,
]

// Tags couvrant les délais légaux connus
const DELAY_COVERING_TAGS = ['[A1]', '[A2]', '[A3]', '[A4]', '[A5]', '[J1]', '[J2]', '[J3]']

function checkUncoveredPreciseDelays(answer: string, brief: LegalBrief): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (brief.precisionBudget !== 'low') return issues

  const allowedDelays = extractAllowedDelaysFromCards(brief)

  for (const pattern of PRECISE_DELAY_PATTERNS) {
    const matches = answer.match(pattern) || []
    for (const match of matches) {
      const hasCoveringTag = DELAY_COVERING_TAGS.some((tag) => {
        const idx = answer.indexOf(match)
        const surroundingContext = answer.slice(Math.max(0, idx - 100), idx + match.length + 100)
        return surroundingContext.includes(tag)
      })

      const isAllowed = allowedDelays.some((d) =>
        match.toLowerCase().replace(/\s+/g, ' ').includes(d.toLowerCase())
      )

      if (!hasCoveringTag && !isAllowed) {
        issues.push({
          severity: 'medium',
          code: 'UNCOVERED_PRECISE_DELAY',
          message: `Délai précis "${match}" sans tag de couverture [Ax]/[Jx] — budget low interdit ce type d'assertion.`,
        })
      }
    }
  }

  return issues
}

function extractAllowedDelaysFromCards(brief: LegalBrief): string[] {
  // Les délais présents dans les cartes d'autorité sont autorisés
  const allowed: string[] = []
  for (const card of brief.authorityCards) {
    const delayMatches = card.rule.match(/\b\d+\s*(jours?|mois|semaines?|ans?)\b/gi) || []
    allowed.push(...delayMatches)
    const scopeMatches = card.scope.match(/\b\d+\s*(jours?|mois|semaines?|ans?)\b/gi) || []
    allowed.push(...scopeMatches)
  }
  return allowed
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 4 : Sanctions précises non couvertes (budget low)
// ─────────────────────────────────────────────────────────────────────────────

const PRECISE_SANCTION_PATTERNS = [
  /\b\d+[\s\u00A0]*(€|euros?|EUR)\b/gi,
  /\b(amende|pénalité|sanction)\s+de\s+\d+/gi,
  /\b\d+\s*%\s+(du|de)\s+(loyer|dépôt|montant|prix)/gi,
]

function checkUncoveredPreciseSanctions(answer: string, brief: LegalBrief): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (brief.precisionBudget !== 'low') return issues

  for (const pattern of PRECISE_SANCTION_PATTERNS) {
    const matches = answer.match(pattern) || []
    for (const match of matches) {
      const hasCoveringTag = DELAY_COVERING_TAGS.some((tag) => {
        const idx = answer.indexOf(match)
        const surroundingContext = answer.slice(Math.max(0, idx - 100), idx + match.length + 100)
        return surroundingContext.includes(tag)
      })

      if (!hasCoveringTag) {
        issues.push({
          severity: 'high',
          code: 'UNCOVERED_PRECISE_SANCTION',
          message: `Montant/sanction précis "${match}" sans tag de couverture [Ax]/[Jx] — budget low interdit ce type d'assertion.`,
        })
      }
    }
  }

  return issues
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 5 : Automaticité interdite (cross-check assertions + patterns)
// ─────────────────────────────────────────────────────────────────────────────

const AUTOMATICITY_PATTERNS = [
  /automatiquement\s+(sanctionné|condamné|obligé|tenu|annulé|résolu|contraint)/i,
  /entraîne\s+automatiquement/i,
  /oblige\s+automatiquement/i,
  /conduit\s+automatiquement/i,
  /est\s+forcément\s+tenu/i,
  /sera\s+forcément/i,
  /doit\s+obligatoirement\s+et\s+immédiatement/i,
]

function checkForbiddenAutomaticity(
  normalizedAnswer: string,
  forbiddenAssertions: string[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  // Patterns génériques d'automaticité
  for (const pattern of AUTOMATICITY_PATTERNS) {
    const match = normalizedAnswer.match(pattern)
    if (match) {
      // Vérifier si ce pattern est couvert par une forbidden assertion déjà reportée
      const alreadyReported = forbiddenAssertions.some((fa) =>
        normalizedAnswer.includes(fa.toLowerCase().substring(0, 20))
      )
      if (!alreadyReported) {
        issues.push({
          severity: 'medium',
          code: 'FORBIDDEN_AUTOMATICITY',
          message: `Expression d'automaticité potentiellement interdite détectée : "${match[0]}"`,
        })
      }
    }
  }

  return issues
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 6 : Tags inexistants dans le brief
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Check 6 : Autorité citée hors de sa portée connue
// ─────────────────────────────────────────────────────────────────────────────

function checkAuthorityScopeMismatch(
  answer: string,
  brief: LegalBrief
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const answerLower = answer.toLowerCase()

  // Articles légitimement dans le brief (exclure du check)
  const legitimateArticleNums = new Set(
    brief.authorityCards
      .filter((c) => c.articleNum !== undefined)
      .map((c) => c.articleNum!.toLowerCase())
  )

  for (const [artNum, constraint] of Object.entries(AUTHORITY_SCOPE_CONSTRAINTS)) {
    const artNumLower = artNum.toLowerCase()

    // Si l'article est légitimement dans le brief → pas de check scope
    if (legitimateArticleNums.has(artNumLower)) continue

    // Chercher la première occurrence du numéro d'article dans la réponse
    const idx = answerLower.indexOf(artNumLower)
    if (idx === -1) continue

    // Contexte de ±300 caractères autour de la citation
    const ctx = answerLower.slice(Math.max(0, idx - 300), idx + artNumLower.length + 300)

    // Vérifier si un mot-clé de contexte interdit est présent dans ce périmètre
    const forbiddenFound = constraint.forbiddenContextKeywords.find((kw) =>
      ctx.includes(kw.toLowerCase())
    )

    if (forbiddenFound) {
      issues.push({
        severity: 'high',
        code: 'AUTHORITY_SCOPE_MISMATCH',
        message: `Article ${artNum} cité dans un contexte incompatible ("${forbiddenFound}") : ${constraint.reason}`,
      })
    }
  }

  return issues
}

function checkNonExistentTags(answer: string, brief: LegalBrief): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  const existingTags = new Set(brief.authorityCards.map((c) => c.tag))

  // Trouver tous les tags [Ax] et [Jx] utilisés dans la réponse
  const usedTagsInAnswer = answer.match(/\[(A|J)\d+\]/g) || []

  for (const tag of usedTagsInAnswer) {
    // Extraire le tag sans crochets
    const tagId = tag.slice(1, -1) // "A1", "J2", etc.
    if (!existingTags.has(tagId)) {
      issues.push({
        severity: 'high',
        code: 'NONEXISTENT_TAG',
        message: `Tag ${tag} utilisé dans la réponse mais absent du brief (authorityCards disponibles : ${[...existingTags].join(', ') || 'aucune'}).`,
      })
    }
  }

  return issues
}
