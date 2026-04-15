// lib/pipeline/legal-brief-orchestrator.ts
// Orchestrateur V2 isolé — pipeline legal-brief déterministe + 1 seul appel LLM final
// Ne touche pas /api/chat. Ne fait pas de second appel LLM de correction.
// Phase 1 : 3 playbooks benchmark, Mistral Large 3 uniquement.

import { detectDomain } from '../domain-detector'
import { detectLegalPlaybook } from '../legal-playbooks'
import { resolveLiveArticles, resolvedArticlesToChunks } from '../legifrance-resolver'
import { lookupLegitext } from '../legifrance'
import { fetchJudilibreLive } from '../judilibre'
import { computePrecisionBudget } from '../precision-budget'
import { buildTaggedArticles, buildTaggedLiveCases } from '../post-treatment'
import { buildLegalBrief } from '../legal-brief'
import { validateAnswerAgainstBrief } from '../answer-validator'
import { openRouterChat } from '../openrouter'
import { getDomainPolicy } from '../domain-policies'

import type { LegalBrief } from '../legal-brief'
import type { ValidationReport } from '../answer-validator'
import type { LegalPlaybook } from '../legal-playbooks'

// Modèle V2 : Mistral Large 3 — jamais Sonnet
const V2_MODEL = 'mistralai/mistral-large-2512'
const V2_MAX_TOKENS = 6000
const V2_TEMPERATURE = 0.1

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type OrchestratorResult =
  | { status: 'no_playbook_match'; domain: string | null }
  | {
      status: 'ok'
      playbookId: string
      precisionBudget: 'high' | 'medium' | 'low'
      legalBrief: LegalBrief
      answer: string
      validationReport: ValidationReport
      debugMetadata: OrchestratorDebugMetadata
    }

export interface OrchestratorDebugMetadata {
  domain: string
  playbookId: string
  articlesResolved: number
  articlesRequested: number
  liveJuriCount: number
  taggedArticlesCount: number
  taggedCasesCount: number
  precisionBudget: 'high' | 'medium' | 'low'
  modelUsed: string
  durationMs: number
  errors: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// runLegalBriefOrchestrator — point d'entrée principal
// ─────────────────────────────────────────────────────────────────────────────

export async function runLegalBriefOrchestrator(
  userQuestion: string
): Promise<OrchestratorResult> {
  const startTime = Date.now()
  const errors: string[] = []

  // ── Étape 1 : Détection du domaine ──────────────────────────────────────────
  const domainMatch = detectDomain(userQuestion)
  const domain = domainMatch?.name ?? null

  // ── Étape 2 : Détection du playbook ─────────────────────────────────────────
  const playbook = detectLegalPlaybook(userQuestion)

  if (!playbook) {
    return { status: 'no_playbook_match', domain }
  }

  // ── Étape 3 : Résolution des articles live (Légifrance) ─────────────────────
  // Convertir les PlaybookAuthorityHint → { textId, articleNum, lawName }
  // en utilisant lookupLegitext (même logique que le pipeline existant)
  const articleCandidates = playbook.forcedArticles.flatMap((a) => {
    const textId = lookupLegitext(a.law)
    if (!textId) {
      errors.push(`lookupLegitext manquant : law="${a.law}" artNum="${a.artNum}"`)
      return []
    }
    return [{ textId, articleNum: a.artNum, lawName: a.label }]
  })

  let resolvedArticles: Awaited<ReturnType<typeof resolveLiveArticles>> = []
  try {
    if (articleCandidates.length > 0) {
      resolvedArticles = await resolveLiveArticles(articleCandidates)
    }
  } catch (err) {
    errors.push(`Légifrance resolution failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  const articleChunks = resolvedArticlesToChunks(resolvedArticles)

  // ── Étape 4 : Jurisprudence live (Judilibre) ─────────────────────────────────
  let liveJuriCases: Awaited<ReturnType<typeof fetchJudilibreLive>> = []
  try {
    liveJuriCases = await fetchJudilibreLive(userQuestion, domainMatch ?? undefined)
  } catch (err) {
    errors.push(`Judilibre fetch failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ── Étape 5 : Construction des tags ─────────────────────────────────────────
  const taggedArticles = buildTaggedArticles(articleChunks)
  const taggedLiveCases = buildTaggedLiveCases(liveJuriCases)

  // ── Étape 6 : Calcul du precision budget ─────────────────────────────────────
  const domainPolicy = domain ? getDomainPolicy(domain) : undefined
  const liveArticleResolutionFailed = resolvedArticles.length === 0 && articleCandidates.length > 0

  const precisionBudgetResult = computePrecisionBudget({
    safetyLevel: domainPolicy?.safetyLevel,
    liveArticlesResolved: resolvedArticles.length,
    liveArticleResolutionFailed,
    taggedArticles: taggedArticles.length,
    juriSupport: liveJuriCases.length,
    noArticleGrounding: articleChunks.length === 0,
    hasTopicNote: false, // V2 : pas de topic-articles en phase 1
    candidatesCount: articleCandidates.length,
  })

  const precisionBudget = precisionBudgetResult.budget

  // ── Étape 7 : Construction du LegalBrief ────────────────────────────────────
  const legalBrief = buildLegalBrief({
    userQuestion,
    domain: domain ?? playbook.domain,
    playbook,
    taggedArticles,
    taggedLiveCases,
    precisionBudget,
  })

  // ── Étape 8 : Génération de la réponse (1 seul appel LLM) ───────────────────
  const systemPrompt = buildV2SystemPrompt(legalBrief)
  const userMessage = buildV2UserMessage(userQuestion, legalBrief)

  let answer = ''
  try {
    answer = await openRouterChat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      V2_MODEL,
      V2_MAX_TOKENS
    )
  } catch (err) {
    errors.push(`LLM call failed: ${err instanceof Error ? err.message : String(err)}`)
    answer = '[Erreur : impossible de générer la réponse.]'
  }

  // ── Étape 9 : Validation déterministe ────────────────────────────────────────
  const validationReport = validateAnswerAgainstBrief(answer, legalBrief)

  // ── Métadonnées debug ─────────────────────────────────────────────────────────
  const debugMetadata: OrchestratorDebugMetadata = {
    domain: domain ?? playbook.domain,
    playbookId: playbook.id,
    articlesResolved: resolvedArticles.length,
    articlesRequested: articleCandidates.length,
    liveJuriCount: liveJuriCases.length,
    taggedArticlesCount: taggedArticles.length,
    taggedCasesCount: taggedLiveCases.length,
    precisionBudget,
    modelUsed: V2_MODEL,
    durationMs: Date.now() - startTime,
    errors,
  }

  return {
    status: 'ok',
    playbookId: playbook.id,
    precisionBudget,
    legalBrief,
    answer,
    validationReport,
    debugMetadata,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// buildV2SystemPrompt
// Prompt système construit à partir du LegalBrief — pas d'invention autorisée
// ─────────────────────────────────────────────────────────────────────────────

function buildV2SystemPrompt(brief: LegalBrief): string {
  const sections: string[] = []

  sections.push(`Tu es un assistant juridique immobilier spécialisé. Tu réponds uniquement à partir des éléments du brief juridique fourni. Tu n'inventes aucun texte, aucune sanction, aucun délai, aucune jurisprudence hors brief.`)

  // Autorités disponibles
  if (brief.authorityCards.length > 0) {
    sections.push(`\n## TEXTES ET JURISPRUDENCES DISPONIBLES`)
    for (const card of brief.authorityCards) {
      const kind = card.kind === 'article' ? 'Article' : 'Jurisprudence'
      sections.push(
        `[${card.tag}] ${kind} — ${card.source}\n` +
        `Règle : ${card.rule}\n` +
        `Portée : ${card.scope}` +
        (card.caveat ? `\nRéserve : ${card.caveat}` : '')
      )
    }
    sections.push(`\nUtilise les balises [${brief.authorityCards.map(c => c.tag).join('], [')}] pour citer ces sources dans ta réponse.`)
    sections.push(`N'utilise AUCUN autre tag de citation. N'invente aucune référence supplémentaire.`)
  } else {
    sections.push(`\n## AVERTISSEMENT : Aucune source taggée disponible. Reste en termes généraux. N'affirme aucun délai, montant ou sanction précis.`)
  }

  // Distinctions obligatoires
  sections.push(`\n## DISTINCTIONS OBLIGATOIRES À ABORDER`)
  for (const d of brief.requiredDistinctions) {
    sections.push(`- ${d}`)
  }

  // Assertions interdites
  sections.push(`\n## ASSERTIONS INTERDITES — NE PAS ÉCRIRE`)
  for (const a of brief.forbiddenAssertions) {
    sections.push(`- "${a}"`)
  }

  // Contrainte de précision
  sections.push(`\n## CONTRAINTE NORMATIVE (budget=${brief.precisionBudget})`)
  if (brief.precisionBudget === 'low') {
    sections.push(
      `- Pas de délai précis sans balise [Ax] ou [Jx] de couverture\n` +
      `- Pas de montant, seuil ou sanction précis sans balise de couverture\n` +
      `- Pas d'automatisme : utilise "peut", "est susceptible de", "en principe"\n` +
      `- Formule en termes généraux pour tout ce qui n'est pas couvert`
    )
  } else if (brief.precisionBudget === 'medium') {
    sections.push(
      `- Prudence sur les sanctions et automatismes non taggés\n` +
      `- Les délais et montants sont autorisés uniquement s'ils sont couverts par une balise [Ax] ou [Jx]`
    )
  } else {
    sections.push(
      `- Les délais et montants précis sont autorisés s'ils sont couverts par une balise [Ax] ou [Jx]`
    )
  }

  // Résultats pratiques attendus (guide pour le modèle)
  sections.push(`\n## RÉSULTAT PRATIQUE ATTENDU`)
  for (const outcome of brief.practicalOutcome) {
    sections.push(`- ${outcome}`)
  }

  // Pièces manquantes
  if (brief.missingPieces.length > 0) {
    sections.push(`\n## LIMITES CONNUES DU BRIEF`)
    for (const m of brief.missingPieces) {
      sections.push(`- ${m}`)
    }
    sections.push(`Signale ces limites dans ta réponse si elles sont pertinentes pour l'utilisateur.`)
  }

  sections.push(`\n## FORMAT DE RÉPONSE\n- Réponse en français, claire, prudente, utile terrain\n- Structurée avec des sous-parties si nécessaire\n- Pas de liste à puces excessive — préfère les paragraphes courts\n- Maximum 600 mots`)

  return sections.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// buildV2UserMessage
// Message utilisateur enrichi avec le contexte du brief
// ─────────────────────────────────────────────────────────────────────────────

function buildV2UserMessage(userQuestion: string, brief: LegalBrief): string {
  return [
    `Question : ${userQuestion}`,
    '',
    `Domaine : ${brief.domain}`,
    `Archétype : ${brief.archetype}`,
    '',
    `Réponds à cette question en respectant strictement les contraintes du brief juridique fourni dans le prompt système.`,
  ].join('\n')
}
