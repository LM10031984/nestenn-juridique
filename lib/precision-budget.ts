// lib/precision-budget.ts
// Calcule le "precision budget" du pipeline : niveau de précision normative
// autorisé selon la qualité réelle du grounding disponible pour cette requête.
//
// Principe : le moteur ne parle avec précision que quand il a le droit de le faire,
// c'est-à-dire quand les sources taggées couvrent réellement ce qu'il affirme.
//
// Budget → comportement :
//   high   → délais, montants et procédures précises autorisés si taggés
//   medium → prudence sur sanctions et automatismes non taggés
//   low    → interdiction de tout chiffre, délai ou sanction précis non taggé

export type PrecisionBudget = 'high' | 'medium' | 'low'

export interface PrecisionBudgetInput {
  /** Niveau de précaution du domaine issu de domain-policies */
  safetyLevel?: 'critical' | 'high' | 'medium'
  /** Nombre d'articles live effectivement résolus (après resolveLiveArticles) */
  liveArticlesResolved: number
  /** true si la résolution live a totalement échoué sur un domaine critical */
  liveArticleResolutionFailed: boolean
  /** Nombre d'articles finals taggés [A1][A2]… dans taggedArticles */
  taggedArticles: number
  /** Nombre total d'arrêts disponibles (liveJuri + filteredPgJuri) */
  juriSupport: number
  /** true si aucun chunk article du corpus n'est disponible */
  noArticleGrounding: boolean
  /** true si topicMatch?.answerNote est défini (guidance métier disponible) */
  hasTopicNote: boolean
  /** Nombre de candidats tentés pour le live sync (0 = pas tenté) */
  candidatesCount: number
}

export interface PrecisionBudgetResult {
  budget: PrecisionBudget
  /** Raisons ayant influencé la décision — pour le log [precision-budget] */
  reasons: string[]
}

/**
 * Calcule le precision budget à partir des signaux de grounding disponibles.
 *
 * Règles de décision (par priorité décroissante) :
 *  1. Hard low : aucun grounding + pas de topicNote OU live sync failed
 *  2. Domaine non-critical : high si bon live sync, medium sinon, low si grounding nul
 *  3. Domaine critical : max = medium. Medium si grounding solide ou topicNote,
 *     low dans tous les autres cas
 */
export function computePrecisionBudget(input: PrecisionBudgetInput): PrecisionBudgetResult {
  const {
    safetyLevel,
    liveArticlesResolved,
    liveArticleResolutionFailed,
    taggedArticles,
    juriSupport,
    noArticleGrounding,
    hasTopicNote,
    candidatesCount,
  } = input

  const reasons: string[] = []

  // ── Signaux positifs ────────────────────────────────────────────────────────
  const solidLiveSync  = liveArticlesResolved >= 2
  const partialLiveSync = liveArticlesResolved === 1
  const goodTagging    = taggedArticles >= 2
  const hasJuri        = juriSupport > 0
  const isCritical     = safetyLevel === 'critical'

  if (isCritical)                                              reasons.push('critical_domain')
  if (solidLiveSync)                                           reasons.push('solid_live_sync')
  if (partialLiveSync)                                         reasons.push('partial_live_sync')
  if (goodTagging)                                             reasons.push('good_tagging')
  if (hasJuri)                                                 reasons.push('juri_support')
  if (hasTopicNote)                                            reasons.push('topic_note')
  if (noArticleGrounding)                                      reasons.push('no_article_grounding')
  if (liveArticleResolutionFailed)                             reasons.push('live_sync_failed')
  if (candidatesCount > 0 && liveArticlesResolved === 0 && !liveArticleResolutionFailed) {
    reasons.push('candidates_no_result')
  }

  // ── Hard low ────────────────────────────────────────────────────────────────
  if (noArticleGrounding && !hasTopicNote) {
    return { budget: 'low', reasons }
  }
  if (liveArticleResolutionFailed) {
    return { budget: 'low', reasons }
  }

  // ── Domaines non-critical (medium / high) ───────────────────────────────────
  if (!isCritical) {
    if (solidLiveSync && goodTagging)              return { budget: 'high', reasons }
    if (solidLiveSync)                             return { budget: 'high', reasons }
    if (partialLiveSync && hasJuri)                return { budget: 'high', reasons }
    if (taggedArticles >= 1 || hasJuri || hasTopicNote) return { budget: 'medium', reasons }
    return { budget: 'low', reasons }
  }

  // ── Domaines critical : plafond = medium ────────────────────────────────────
  if (solidLiveSync && goodTagging)                return { budget: 'medium', reasons }
  if (hasTopicNote && (taggedArticles >= 1 || hasJuri)) return { budget: 'medium', reasons }
  // Candidats tentés mais aucun résultat → low (même sans liveArticleResolutionFailed explicite)
  if (candidatesCount > 0 && liveArticlesResolved === 0) return { budget: 'low', reasons }
  if (taggedArticles === 0 && !hasTopicNote)        return { budget: 'low', reasons }

  return { budget: 'low', reasons }
}

// Mapping budget → SoftenLevel (utilisé dans high-risk-claims, Passe 3.7)
export const BUDGET_TO_SOFTEN_LEVEL = {
  low:    'critical',
  medium: 'high',
  high:   'medium',
} as const
