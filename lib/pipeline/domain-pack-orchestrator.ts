// lib/pipeline/domain-pack-orchestrator.ts
// Orchestrateur domain pack — pipeline V2 pour questions sans playbook matché.
// Utilise buildBriefFromDomainPack() au lieu de buildLegalBrief().
// Même modèle et même format de prompt que le pipeline V2 existant.
//
// Conditions d'appel :
//   - domaine = baux_habitation
//   - aucun playbook whitelisté matché
//   - flag BAUX_PACK_SHADOW ou BAUX_PACK_ACTIVE actif

import { detectDomain } from '../domain-detector'
import { detectLegalPlaybook } from '../legal-playbooks'
import { resolveLiveArticles, resolvedArticlesToChunks } from '../legifrance-resolver'
import { lookupLegitext } from '../legifrance'
import { fetchJudilibreLive } from '../judilibre'
import { computePrecisionBudget } from '../precision-budget'
import { buildTaggedArticles, buildTaggedLiveCases } from '../post-treatment'
import { buildBriefFromDomainPack } from '../domain-pack-builder'
import { matchFallbackRule } from '../domain-packs'
import { validateAnswerAgainstBrief } from '../answer-validator'
import { openRouterChat } from '../openrouter'
import { getDomainPolicy } from '../domain-policies'
import { expandAuthorityCitations } from '../authority-normalizer'
import {
  buildV2SystemPrompt,
  buildV2UserMessage,
  runRetryStep,
} from './legal-brief-orchestrator'

import type { DomainPack } from '../domain-packs'
import type { LegalBrief } from '../legal-brief'
import type { ValidationReport } from '../answer-validator'

// Modèle V2 — identique à l'orchestrateur playbook
const V2_MODEL = 'mistralai/mistral-large-2512'
const V2_MAX_TOKENS = 6000

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type DomainPackOrchestratorResult =
  | {
      status: 'ok'
      domainPackId: string
      /** archetypeId de la fallback rule activée, null si aucune règle matchée */
      fallbackRuleId: string | null
      precisionBudget: 'high' | 'medium' | 'low'
      legalBrief: LegalBrief
      finalAnswer: string
      validationReportFinal: ValidationReport
      retried: boolean
      durationMs: number
    }
  | { status: 'error'; reason: string; durationMs: number }

// ─────────────────────────────────────────────────────────────────────────────
// runDomainPackOrchestrator — point d'entrée
// ─────────────────────────────────────────────────────────────────────────────

export async function runDomainPackOrchestrator(
  userQuestion: string,
  domainPack: DomainPack,
): Promise<DomainPackOrchestratorResult> {
  const startTime = Date.now()

  try {
    // ── Étape 1 : Détection domaine + playbook overlay (optionnel) ─────────────
    const domainMatch = detectDomain(userQuestion)
    // Playbook overlay : si un playbook existe pour cette question, on l'utilise
    // comme enrichissement du domain pack (pas comme remplacement)
    const playbookOverlay = detectLegalPlaybook(userQuestion) ?? undefined

    // ── Étape 2 : Résolution des articles live (Légifrance) ────────────────────
    // On tente de résoudre les pivot articles du domain pack.
    // Les articles sans mapping lookupLegitext sont ignorés — le builder
    // utilisera les articles synthétiques comme fallback.
    const articleCandidates = domainPack.pivotArticles.flatMap((hint) => {
      const textId = lookupLegitext(hint.law)
      if (!textId) return []
      return [{ textId, articleNum: hint.artNum, lawName: hint.label }]
    })

    let resolvedArticles: Awaited<ReturnType<typeof resolveLiveArticles>> = []
    if (articleCandidates.length > 0) {
      try {
        resolvedArticles = await resolveLiveArticles(articleCandidates)
      } catch {
        // Non-bloquant : le builder utilise les articles synthétiques du domain pack
        console.warn('[domain-pack-orchestrator] Légifrance resolution failed — using synthetic pivot articles')
      }
    }

    const articleChunks = resolvedArticlesToChunks(resolvedArticles)

    // ── Étape 3 : Jurisprudence live (Judilibre) ───────────────────────────────
    let liveJuriCases: Awaited<ReturnType<typeof fetchJudilibreLive>> = []
    try {
      liveJuriCases = await fetchJudilibreLive(userQuestion, domainMatch ?? undefined)
    } catch {
      console.warn('[domain-pack-orchestrator] Judilibre fetch failed — proceeding without live juri')
    }

    // ── Étape 4 : Construction des tags ───────────────────────────────────────
    const taggedArticles = buildTaggedArticles(articleChunks)
    const taggedLiveCases = buildTaggedLiveCases(liveJuriCases)

    // ── Étape 5 : Precision budget ─────────────────────────────────────────────
    const domainPolicy = getDomainPolicy(domainPack.domain)
    const liveArticleResolutionFailed = resolvedArticles.length === 0 && articleCandidates.length > 0

    const { budget: precisionBudget } = computePrecisionBudget({
      safetyLevel: domainPolicy?.safetyLevel,
      liveArticlesResolved: resolvedArticles.length,
      liveArticleResolutionFailed,
      taggedArticles: taggedArticles.length,
      juriSupport: liveJuriCases.length,
      noArticleGrounding: articleChunks.length === 0,
      hasTopicNote: false,
      candidatesCount: articleCandidates.length,
    })

    // ── Étape 6 : Identification de la fallback rule active ────────────────────
    const fallbackRule = playbookOverlay ? null : matchFallbackRule(domainPack, userQuestion)
    const fallbackRuleId = fallbackRule?.archetypeId ?? null

    // ── Étape 7 : Construction du LegalBrief via domain pack ──────────────────
    const legalBrief = buildBriefFromDomainPack({
      userQuestion,
      domainPack,
      playbookOverlay,
      taggedArticles,
      taggedLiveCases,
      precisionBudget,
    })

    // ── Étape 8 : Génération de la réponse (1 seul appel LLM) ─────────────────
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
        V2_MAX_TOKENS,
      )
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      return { status: 'error', reason: `LLM call failed: ${reason}`, durationMs: Date.now() - startTime }
    }

    // ── Étape 8b : Normalisation des abréviations d'autorités ─────────────────
    answer = expandAuthorityCitations(answer)

    // ── Étape 9 : Validation initiale ──────────────────────────────────────────
    const validationReportInitial = validateAnswerAgainstBrief(answer, legalBrief)
    const initialAnswer = answer

    // ── Étape 10 : Retry unique si validation échouée ──────────────────────────
    const retryResult = await runRetryStep(
      legalBrief,
      initialAnswer,
      validationReportInitial,
      V2_MODEL,
      V2_MAX_TOKENS,
    )

    const finalAnswer = retryResult.answer
    const validationReportFinal = retryResult.validationReport
    const retried = retryResult.retried

    return {
      status: 'ok',
      domainPackId: domainPack.id,
      fallbackRuleId,
      precisionBudget,
      legalBrief,
      finalAnswer,
      validationReportFinal,
      retried,
      durationMs: Date.now() - startTime,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { status: 'error', reason, durationMs: Date.now() - startTime }
  }
}
