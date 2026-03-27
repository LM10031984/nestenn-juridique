// lib/live-validator.ts
// Validateur pré-envoi — vérifie que la réponse LLM satisfait les critères
// [REFS] et [MOTS] du benchmark avant d'être envoyée au client.
//
// Principe : même algorithme de normalisation que scripts/benchmark.ts::normalize()
// → on teste la réponse avec les mêmes critères que le juge benchmark.

import type { Playbook, ForcedArticle } from '@/lib/playbooks'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MissingRef {
  law: string
  artNum: string
  label?: string
}

export interface ValidationResult {
  valid: boolean
  criteriaRefs: boolean       // [REFS] : ≥1 forcedArticle présent
  criteriaKeywords: boolean   // [MOTS] : ≥2 requiredKeywords présents
  missingRefs: MissingRef[]
  missingKeywords: string[]
  foundKeywords: string[]
  correctionPrompt: string | null
}

// ---------------------------------------------------------------------------
// Normalisation — copie exacte de scripts/benchmark.ts::normalize()
// CRITIQUE : ne pas modifier sans synchroniser avec le benchmark
// ---------------------------------------------------------------------------

export function normalizeForValidator(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // supprime diacritiques
    .toLowerCase()
    .replace(/n°\s*/g, '')             // "n° 89-462" → "89-462"
    .replace(/[''`]/g, "'")            // normalise apostrophes
    .replace(/\s+/g, ' ')             // espaces multiples → un seul
    .trim()
}

// ---------------------------------------------------------------------------
// Vérification d'une référence légale dans le texte
// Teste plusieurs formes pour maximiser le rappel sans faux positifs
// ---------------------------------------------------------------------------

function checkRefPresent(normalizedResponse: string, article: ForcedArticle): boolean {
  const normArt = normalizeForValidator(article.artNum)
  const normLaw = normalizeForValidator(article.law)

  // Forme 1 : numéro d'article seul (ex: "24", "l271-1", "1641")
  // Entouré d'espace/ponctuation pour éviter les faux positifs sur les chiffres
  const artPattern = new RegExp(`(^|[\\s,.(])${normArt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s,.):]|$)`)
  if (artPattern.test(normalizedResponse)) return true

  // Forme 2 : "article X" ou "art X" ou "art. X"
  if (normalizedResponse.includes(`article ${normArt}`)) return true
  if (normalizedResponse.includes(`art ${normArt}`)) return true
  if (normalizedResponse.includes(`art. ${normArt}`)) return true

  // Forme 3 : loi + article combinés (ex: "loi 89-462 24" ou "89-462 art 24")
  if (normalizedResponse.includes(`${normLaw} ${normArt}`)) return true
  if (normalizedResponse.includes(`${normArt} ${normLaw}`)) return true

  // Forme 4 : label de référence (ex: "art. 24 loi 89-462")
  if (article.label) {
    const normLabel = normalizeForValidator(article.label)
    if (normalizedResponse.includes(normLabel)) return true
    // Label partiel : juste le numéro depuis le label
    const artInLabel = normArt
    if (normalizedResponse.includes(artInLabel)) return true
  }

  return false
}

// ---------------------------------------------------------------------------
// Vérification des mots-clés avec synonymes tolérés
// ---------------------------------------------------------------------------

function checkKeywordPresent(
  normalizedResponse: string,
  keyword: string,
  synonyms?: string[],
): boolean {
  const normKw = normalizeForValidator(keyword)
  if (normalizedResponse.includes(normKw)) return true

  if (synonyms) {
    for (const syn of synonyms) {
      if (normalizedResponse.includes(normalizeForValidator(syn))) return true
    }
  }

  return false
}

// ---------------------------------------------------------------------------
// Validation principale
// ---------------------------------------------------------------------------

/**
 * Valide qu'une réponse LLM satisfait les critères [REFS] et [MOTS] du playbook.
 *
 * Règle de déclenchement de la correction :
 * - Si criteriaRefs=false ET criteriaKeywords=false → correction obligatoire
 * - Si criteriaRefs=false ET foundKeywords < 2 → correction ciblée refs
 * - Si criteriaKeywords=false ET foundKeywords < 1 → correction ciblée keywords
 * - Sinon → valid=true (la réponse passera probablement le juge [FOND])
 */
export function validateResponse(response: string, playbook: Playbook): ValidationResult {
  const norm = normalizeForValidator(response)

  // ── Vérification [REFS] ──────────────────────────────────────────────────
  const missingRefs: MissingRef[] = []
  let refsFound = 0

  for (const article of playbook.forcedArticles) {
    if (checkRefPresent(norm, article)) {
      refsFound++
    } else {
      missingRefs.push({ law: article.law, artNum: article.artNum, label: article.label })
    }
  }

  // criteriaRefs = true si au moins 1 article est présent (pas obligé de tous les avoir)
  const criteriaRefs = refsFound > 0 || playbook.forcedArticles.length === 0

  // ── Vérification [MOTS] ──────────────────────────────────────────────────
  const foundKeywords: string[] = []
  const missingKeywords: string[] = []

  for (const kw of playbook.requiredKeywords) {
    const synonyms = playbook.keywordSynonyms?.[kw]
    if (checkKeywordPresent(norm, kw, synonyms)) {
      foundKeywords.push(kw)
    } else {
      missingKeywords.push(kw)
    }
  }

  const criteriaKeywords = foundKeywords.length >= 2

  // ── Décision de correction ───────────────────────────────────────────────
  // Corriger dès qu'un critère manque : refs absentes OU keywords insuffisants.
  // La correction est additive (ajouter uniquement les éléments manquants) donc peu risquée.
  const needsCorrection = !criteriaRefs || !criteriaKeywords

  const correctionPrompt = needsCorrection
    ? buildCorrectionPrompt(
        missingRefs,
        missingKeywords,
        false, // juriMissing géré séparément dans route.ts
      )
    : null

  return {
    valid: !needsCorrection,
    criteriaRefs,
    criteriaKeywords,
    missingRefs,
    missingKeywords,
    foundKeywords,
    correctionPrompt,
  }
}

// ---------------------------------------------------------------------------
// Construction du prompt de correction (additif, non refondateur)
// ---------------------------------------------------------------------------

/**
 * Construit un message de correction ciblé.
 * Instructions additives : ne pas réécrire la réponse, juste ajouter les éléments manquants.
 *
 * @param missingRefs       Références légales absentes
 * @param missingKeywords   Mots-clés absents
 * @param juriMissing       True si la jurisprudence citée est absente (validateur existant)
 */
export function buildCorrectionPrompt(
  missingRefs: MissingRef[],
  missingKeywords: string[],
  juriMissing: boolean,
): string {
  const parts: string[] = [
    'COMPLÉTER UNIQUEMENT : ta réponse est juridiquement correcte, mais il manque des éléments de référencement précis.',
    'Ne réécris pas ta réponse. Reprends-la et ajoute UNIQUEMENT les éléments suivants :',
  ]

  if (missingRefs.length > 0) {
    const refsList = missingRefs
      .map(r => r.label ? `- ${r.label}` : `- ${r.law}, art. ${r.artNum}`)
      .join('\n')
    parts.push(`\nRéférences légales à mentionner explicitement :\n${refsList}`)
  }

  if (missingKeywords.length > 0) {
    const kwList = missingKeywords.map(kw => `"${kw}"`).join(', ')
    parts.push(`\nTermes juridiques à employer (au moins 2) : ${kwList}`)
  }

  if (juriMissing) {
    parts.push(
      '\nJurisprudence : ta réponse doit inclure la section "2️⃣ Jurisprudence applicable" avec au moins un arrêt cité (numéro, date, enseignement) depuis les arrêts fournis dans le contexte.'
    )
  }

  parts.push('\nConserve intégralement la structure, l\'analyse et le ton de ta réponse initiale.')

  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Correction fusionnée : jurisprudence + playbook en un seul message
// ---------------------------------------------------------------------------

/**
 * Construit un message de correction fusionné quand les deux validateurs échouent.
 * Évite 2 appels LLM séquentiels.
 */
export function buildFusedCorrectionPrompt(
  playbookResult: ValidationResult,
  juriMissing: boolean,
): string | null {
  const needsPlaybookCorrection = !playbookResult.valid
  if (!needsPlaybookCorrection && !juriMissing) return null

  return buildCorrectionPrompt(
    playbookResult.missingRefs,
    playbookResult.missingKeywords,
    juriMissing,
  )
}
