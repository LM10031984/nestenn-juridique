// app/api/chat/route.ts
// Pipeline Augmenté v4 — le LLM est enrichi par pgvector, pas contraint par lui
// Filtre hors-sujet → embedding + pgvector → prompt augmenté → streaming direct

export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { openRouterStreamWithFallback, openRouterChat, MODELS, type OpenRouterMessage } from '@/lib/openrouter'
import { DEFAULT_MODEL_ID, isAllowedModel, getModelById } from '@/lib/model-config'
import { getApiUser } from '@/lib/auth'
import { fetchRelevantSources } from '@/lib/sources'
import type { JuriCase } from '@/lib/sources'
import { embedQuestion } from '@/lib/embedding'
import { detectDomains, detectDomain } from '@/lib/domain-detector'
import { correctTypos } from '@/lib/typo-corrector'
import { fetchJudilibreLive } from '@/lib/judilibre'
import { detectTopic } from '@/lib/topic-detector'
import { autoIndexMissingArticles, autoIndexMissingJurisprudence, classifyArticleDomain } from '@/lib/auto-indexer'
import { resolveLiveArticles, resolvedArticlesToChunks } from '@/lib/legifrance-resolver'
import { computePrecisionBudget, BUDGET_TO_SOFTEN_LEVEL } from '@/lib/precision-budget'
import { lookupLegitext } from '@/lib/legifrance'
import { detectTopicArticles, getShortlistByDomain } from '@/lib/topic-articles'
import {
  sanitizeJuriNumbers,
  buildTaggedLiveCases,
  buildTaggedArticles,
  validateUsedCaseTags,
  validateUsedArticleTags,
  stripUnauthorizedCaseNumbers,
  injectRealCaseCitations,
  injectRealArticleCitations,
  stripUnauthorizedArticleCitations,
  optionallyDowngradeUnsupportedNormativeClaims,
  detectNormativeDensity,
  NORMATIVE_DENSITY_HIGH,
} from '@/lib/post-treatment'
import type { PromptContext } from '@/lib/model-config'
import { FORCE_JURISPRUDENCE_DOMAINS } from '@/lib/system-prompt'
import { getDomainPolicy } from '@/lib/domain-policies'
import { detectHighRiskClaims, softenHighRiskClaims } from '@/lib/high-risk-claims'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { FEATURES } from '@/lib/config'
import { detectLegalPlaybook } from '@/lib/legal-playbooks'
import { runLegalBriefOrchestrator } from '@/lib/pipeline/legal-brief-orchestrator'
import { scoreAnswer } from '@/lib/legal-benchmark-score'
import { shouldUseLegalV2, isV2EnabledPlaybook } from '@/lib/legal-v2-rollout'
import { getDomainPackPolicy, logDomainPackEvent } from '@/lib/domain-pack-rollout'
import { getDomainPack } from '@/lib/domain-packs'
import type { DomainPack } from '@/lib/domain-packs'
import { runDomainPackOrchestrator } from '@/lib/pipeline/domain-pack-orchestrator'

// ── Whitelist dynamique (cache 5 min) ──

let cachedKeywords: string[] = []
let keywordCacheTime = 0

async function getWhitelistKeywords(): Promise<string[]> {
  if (Date.now() - keywordCacheTime < 5 * 60 * 1000 && cachedKeywords.length > 0) {
    return cachedKeywords
  }
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('filter_keywords').select('keyword')
    if (data?.length) {
      cachedKeywords = data.map((d: { keyword: string }) => d.keyword)
      keywordCacheTime = Date.now()
    }
  } catch { /* garder cache précédent si erreur DB */ }
  return cachedKeywords.length > 0 ? cachedKeywords : IMMO_KEYWORDS
}

// ── Rate limiting (in-memory, reset toutes les minutes) ──

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 })
    return true
  }
  entry.count++
  return entry.count <= 20
}

// ── Filtre anti-prompt-injection ──

function detectPromptInjection(message: string): boolean {
  const lower = message.toLowerCase()
  const INJECTION_PATTERNS = [
    'ignore tes instructions', 'ignore les instructions', 'ignore your instructions',
    'oublie tes instructions', 'oublie les instructions',
    'tu es maintenant', 'you are now',
    'new instructions', 'nouvelles instructions',
    'system prompt', 'agis comme', 'act as',
    'jailbreak', 'dan mode', 'developer mode',
    'ignore previous', 'ignore précédent',
    'réponds sans restriction', 'pas de filtre', 'désactive tes',
  ]
  return INJECTION_PATTERNS.some(p => lower.includes(p))
}

// ── Constantes ──

const MAX_MESSAGE_LENGTH = 2000
const MAX_HISTORY_TURNS = 10

const REFUSAL_MESSAGE =
  "Je suis spécialisé en droit immobilier français. Je ne peux pas répondre à cette question.\n\n" +
  "Je suis là pour vous aider sur :\n" +
  "- La **loi Hoguet** et les agents immobiliers\n" +
  "- Les **baux d'habitation** (location vide, meublée, mobilité)\n" +
  "- La **copropriété** (charges, assemblée générale, syndic)\n" +
  "- Les **diagnostics immobiliers** (DPE, amiante, plomb…)\n" +
  "- Les **transactions immobilières** (compromis, promesse de vente, conditions suspensives)\n" +
  "- L'**urbanisme** et la **fiscalité immobilière** (SCI, plus-value, Pinel)\n\n" +
  "N'hésitez pas à me poser une question dans ces domaines."

const FILTER_SYSTEM = `Tu es un filtre. Réponds OUI ou NON.
OUI si la question touche au droit immobilier français : bail, loyer, sous-location,
copropriété, vente, mandat, diagnostics, urbanisme, fiscalité immo, expulsion,
charges, travaux, dépôt de garantie, etc.
NON uniquement si clairement hors sujet (recette de cuisine, sport, etc.). En cas de doute → OUI.`

// ── Types ──

interface ChatRequestBody {
  message: string
  conversationHistory?: Array<{ role: string; content: string }>
  sessionId?: string
  messageId?: string   // UUID Supabase du message user, pour le logging analytics
  conversationId?: string // UUID Supabase de la conversation
  model?: string       // Modèle LLM demandé (super_admin uniquement)
}

// ── Pipeline principal ──

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!checkRateLimit(ip)) {
    return Response.json({ error: 'Trop de requêtes, réessayez dans une minute' }, { status: 429 })
  }

  const body = await req.json() as ChatRequestBody
  const trimmedMessage = (body.message ?? '').trim().slice(0, MAX_MESSAGE_LENGTH)
  const { messageId, conversationId } = body

  // Sélection du modèle — fallback silencieux sur le défaut si invalide
  const requestedModel = body.model as string | undefined
  const selectedModel = (requestedModel && isAllowedModel(requestedModel))
    ? requestedModel
    : DEFAULT_MODEL_ID

  // Défense en profondeur : vérifier les droits côté serveur si modèle non-défaut
  // Exception : benchmark local identifié par X-Benchmark-Secret (dev uniquement)
  const benchmarkSecret = process.env.BENCHMARK_SECRET
  const isBenchmarkRequest = benchmarkSecret
    && req.headers.get('x-benchmark-secret') === benchmarkSecret
    && process.env.NODE_ENV !== 'production'

  if (!isBenchmarkRequest && selectedModel !== DEFAULT_MODEL_ID) {
    const authResult = await getApiUser()
    if ('error' in authResult) return authResult.error
    if (!authResult.user.can_switch_model) {
      return Response.json({ error: 'Changement de modèle non autorisé' }, { status: 403 })
    }
  }

  if (!trimmedMessage) {
    return Response.json({ error: 'Message vide' }, { status: 400 })
  }

  if (detectPromptInjection(trimmedMessage)) {
    return Response.json({ error: 'Message non autorisé' }, { status: 400 })
  }

  // ── Étape 1 : Filtre hors-sujet (GPT-4o-mini, ~500ms) ──
  // Correction typos uniquement pour la détection — le LLM reçoit le message original
  const correctedMessage = correctTypos(trimmedMessage)

  const isRelevant = await checkRelevance(correctedMessage)
  if (!isRelevant) {
    return streamTextResponse(REFUSAL_MESSAGE)
  }

  // ── Étape 1b : Routing V2 (legal-brief-orchestrator) ────────────────────────
  // V2 actif  → tryV2Route retourne une Response SSE ou null (fallback V1).
  // Shadow    → V2 tourne en arrière-plan via waitUntil(), V1 répond toujours.
  // Sinon     → pipeline V1 complet ci-dessous.
  if (FEATURES.V2_LEGAL_BRIEF_ENABLED) {
    const v2Response = await tryV2Route(trimmedMessage)
    if (v2Response) return v2Response
  } else if (FEATURES.V2_SHADOW_ENABLED) {
    const playbook = detectLegalPlaybook(trimmedMessage)
    if (playbook && isV2EnabledPlaybook(playbook.id)) {
      waitUntil(runV2Shadow(trimmedMessage))
    }
  }

  // ── Étape 2 : Sources en parallèle (~200ms pgvector + ~1-2s Judilibre) ──
  // - Détection domaine : keyword matching, 0ms
  // - Embedding + Judilibre live : en parallèle
  // - pgvector : après embedding

  const domains = detectDomains(correctedMessage)
  const primaryDomain = domains[0] ?? null
  // DomainMatch complet (avec judilibreTheme + judilibreChamber) pour la tentative ciblée
  const domainMatch = detectDomain(correctedMessage)

  // Judilibre TOUJOURS appelé — avantage compétitif vs ChatGPT/Claude sans accès live
  const [embedding, liveJuriCases] = await Promise.all([
    embedQuestion(trimmedMessage),
    fetchJudilibreLive(trimmedMessage, domainMatch).then(cases =>
      cases.map((c): JuriCase => ({
        court: c.court,
        date: c.date,
        number: c.number,
        holding: c.holding,
        url: c.url,
      }))
    ).catch(() => [] as JuriCase[]),
  ])

  const { chunks, juriCases: pgJuriCases } = await fetchRelevantSources(
    embedding,
    domains.length > 0 ? domains : null,
    8,    // max résultats
    0.30, // threshold minimum
  )

  console.info(
    `[judilibre-live] ${liveJuriCases.length} arrêts : `
    + liveJuriCases.map(c => `${c.court} ${c.date} n°${c.number}`).join(' | ')
  )

  // Indexer les arrêts Judilibre live manquants dans pgvector (fire-and-forget)
  if (liveJuriCases.length > 0) {
    const supabaseAdminForIndex = createAdminClient()
    waitUntil(
      (async () => {
        for (const juri of liveJuriCases) {
          try {
            const { count } = await supabaseAdminForIndex
              .from('jurisprudence')
              .select('*', { count: 'exact', head: true })
              .ilike('number', `%${juri.number}%`)
            if (count && count > 0) continue

            // Résumer le holding si trop long
            let holding = juri.holding ?? ''
            if (holding.length > 100) {
              try {
                const summary = await openRouterChat(
                  [{ role: 'user', content: `Résume en 1-2 phrases le principe juridique de cet arrêt. Donne uniquement le principe retenu. Ne commence PAS par "L'arrêt n°..." ou "Cet arrêt...". Commence directement par le principe.\n\nTexte : ${holding.slice(0, 2000)}\n\nRésumé :` }],
                  MODELS.FILTER,
                  150
                )
                if (summary?.trim().length > 20) holding = summary.trim()
              } catch { /* non-bloquant */ }
            }

            const emb = await embedQuestion(holding.slice(0, 500))
            if (!emb?.length) continue

            await supabaseAdminForIndex.from('jurisprudence').insert({
              source_id: juri.number,
              court:     juri.court === 'cass' ? 'cc' : 'ca',
              number:    juri.number,
              date:      juri.date || null,
              holding,
              domain:    await classifyArticleDomain(holding),
              url:       juri.url ?? null,
              embedding: emb,
            })
            console.info(`[auto-indexer-live] ✅ Arrêt indexé : ${juri.court} n° ${juri.number}`)
          } catch (err) {
            console.error(`[auto-indexer-live] Erreur ${juri.number}:`, err)
          }
        }
      })()
    )
  }
  console.info(
    `[pgvector-juri] ${pgJuriCases.length} arrêts : `
    + pgJuriCases.map(c => `${c.court} ${c.date} n°${c.number}`).join(' | ')
  )

  // Mode fusionné : live en premier (récents + vérifiés), pgvector en complément
  // Déduplication : exclure les arrêts pgvector déjà présents dans le live (même numéro)
  const liveNumbers = new Set(liveJuriCases.map(c => c.number).filter(Boolean))
  const filteredPgJuriCases = pgJuriCases.filter(c => !liveNumbers.has(c.number))

  const responseMode: 'sourced' | 'free' = chunks.length >= 2 ? 'sourced' : 'free'

  console.info(
    `[pipeline] domains=${domains.join(',') || '—'} `
    + `chunks=${chunks.length} `
    + `judilibre=${liveJuriCases.length} live | pgvector=${filteredPgJuriCases.length}/${pgJuriCases.length} (après dédup) `
    + `best=${chunks[0]?.similarity?.toFixed(3) ?? '—'}`
  )

  // Analytics — waitUntil garantit l'exécution sur Vercel après l'envoi de la réponse
  if (messageId) {
    const topic = detectTopic(trimmedMessage)
    waitUntil(
      saveMessageMetadata(messageId, conversationId ?? null, {
        domain: primaryDomain,
        topic,
        sourcesCount: chunks.length,
        responseMode,
      }).catch(() => {})
    )

    // Classification sous-domaine IA — admin client pour bypasser RLS/cookies hors contexte
    const supabaseAdmin = createAdminClient()
    waitUntil(
      classifySubDomain(trimmedMessage)
        .then(subDomain => {
          if (subDomain) {
            return supabaseAdmin.from('messages').update({ sub_domain: subDomain }).eq('id', messageId)
          }
        })
        .catch(err => console.error('[classify] erreur:', err))
    )

    // Auto-enrichissement whitelist — ajouter des mots-clés si aucun domaine détecté
    if (!primaryDomain) {
      waitUntil(autoEnrichWhitelist(correctedMessage))
    }
  }

  // ── Étape 3 : Assemblage du prompt augmenté ──

  // Construire les tags fermés avant le prompt — le LLM ne voit que des [J1][A1]
  const taggedLiveCases = buildTaggedLiveCases(liveJuriCases)
  const pgTaggedArticles = buildTaggedArticles(chunks)

  // ── Consolidation live (legiPart → getArticle) ───────────────────────────────
  // La shortlist métier est TOUJOURS prioritaire sur pgvector quand PISTE est configuré.
  // Bug corrigé : l'ancienne condition excluait baux_habitation/copropriété si pgvector
  // avait trouvé des articles — la shortlist n'était alors jamais injectée.
  let liveChunks: ReturnType<typeof resolvedArticlesToChunks> = []
  let topicMatch: ReturnType<typeof detectTopicArticles> = null
  let liveArticleResolutionFailed = false
  let liveArticlesResolved = 0
  let candidatesCount = 0

  if (!!process.env.PISTE_CLIENT_ID) {
    const msgTopicMatch = detectTopicArticles(correctedMessage)
    const domainTopicMatch = msgTopicMatch === null && primaryDomain
      ? getShortlistByDomain(primaryDomain)
      : null
    topicMatch = msgTopicMatch ?? domainTopicMatch
    const topicMatchSource = msgTopicMatch ? 'message-triggers'
      : domainTopicMatch ? `domain-shortlist(${primaryDomain})`
      : 'none'
    console.info(`[article-debug] topicMatch=${topicMatch?.id ?? 'none'} source=${topicMatchSource} pgTaggedArticles=${pgTaggedArticles.length}`)

    // Log trio canonique RGPD pour faciliter le diagnostic shortlist
    if (topicMatch?.id === 'rgpd_agence_prospection') {
      const trioPivots = topicMatch.forcedArticles
        .map(fa => fa.displayShortLabel ?? fa.label ?? `${fa.law} Art.${fa.artNum}`)
        .join(' | ')
      console.info(`[article-debug] rgpd canonical trio = ${trioPivots}`)
    }

    if (topicMatch && topicMatch.forcedArticles.length > 0) {
      // Convertir ForcedArticle[] → candidats { textId, articleNum, lawName }
      // Quand displayShortLabel est défini, l'utiliser comme lawName pour le rendu métier.
      const candidates = topicMatch.forcedArticles.flatMap(fa => {
        const textId = lookupLegitext(fa.law)
        if (!textId) {
          console.warn(`[article-debug] lookupLegitext manquant: law="${fa.law}" artNum="${fa.artNum}"`)
          return []
        }
        const lawName = fa.displayShortLabel
          ? `${fa.displayShortLabel} — ${fa.displayLawLabel ?? fa.law}`
          : (fa.label ?? fa.law)
        return [{ textId, articleNum: fa.artNum, lawName }]
      })

      console.info(
        `[article-debug] candidates=${candidates.length}`
        + (candidates.length > 0
          ? ` — ${candidates.map(c => `${c.articleNum}(${c.textId})`).join(', ')}`
          : ' — aucun candidat résolvable')
      )

      if (candidates.length > 0) {
        candidatesCount = candidates.length
        const resolved = await resolveLiveArticles(candidates).catch(() => [])
        liveArticlesResolved = resolved.length
        liveChunks = resolvedArticlesToChunks(resolved)
        console.info(`[article-debug] resolved=${resolved.length} → liveChunks=${liveChunks.length}`)

        // Détection échec total sur domaine critique — activer le mode fallback prudent
        if (resolved.length === 0) {
          const domainPolicy = primaryDomain ? getDomainPolicy(primaryDomain) : null
          if (domainPolicy?.safetyLevel === 'critical') {
            liveArticleResolutionFailed = true
            console.warn(
              `[legifrance-sync] critical-sync-failed domain=${primaryDomain}`
              + ` candidates=${candidates.map(c => c.articleNum).join(',')}`
            )
            console.warn('[legifrance-sync] fallback-critical-mode activé')
          }
        }
      }
    }
  }

  // En mode fallback-critical (live sync échoué sur domaine critique), on réduit
  // les chunks pgvector aux 3 premiers pour éviter que des articles périphériques
  // peu pertinents ne prennent le dessus sur la shortlist métier.
  const MAX_FALLBACK_CRITICAL_CHUNKS = 3
  const activeChunks = liveArticleResolutionFailed
    ? chunks.slice(0, MAX_FALLBACK_CRITICAL_CHUNKS)
    : chunks

  if (liveArticleResolutionFailed) {
    console.warn('[pipeline] reduced-normativity-because-live-sync-failed')
  }

  // Les articles live sont injectés en tête (priorité maximale sur pgvector)
  const allChunks = liveChunks.length > 0 ? [...liveChunks, ...activeChunks] : activeChunks
  // Quand des articles live sont résolus, SEULS ces articles reçoivent un tag [A1][A2]…
  // Les chunks pgvector restent dans allChunks (contexte LLM) mais sans tag assigné.
  // Cela empêche les articles périphériques pgvector (ex : L161-2 Code env.) d'obtenir
  // un identifiant fermé et d'être cités via [A3][A4] dans la réponse finale.
  const taggedArticles = liveChunks.length > 0
    ? buildTaggedArticles(liveChunks)
    : buildTaggedArticles(activeChunks)

  console.info(
    `[article-debug] taggedArticles=${taggedArticles.length}`
    + (taggedArticles.length > 0
      ? ` tagged=[${taggedArticles.map(a => `${a.tag}:${a.title.slice(0, 35)}`).join(' | ')}]`
      : ' → aucun article éligible au tag')
  )

  // Signal pré-génération : aucun article du corpus disponible pour cette question
  const noArticleGrounding = allChunks.length === 0

  const domainSafetyLevel = primaryDomain ? getDomainPolicy(primaryDomain)?.safetyLevel : undefined
  const { budget: precisionBudget, reasons: budgetReasons } = computePrecisionBudget({
    safetyLevel: domainSafetyLevel,
    liveArticlesResolved,
    liveArticleResolutionFailed,
    taggedArticles: taggedArticles.length,
    juriSupport: liveJuriCases.length + filteredPgJuriCases.length,
    noArticleGrounding,
    hasTopicNote: !!topicMatch?.answerNote,
    candidatesCount,
  })
  console.info(`[precision-budget] domain=${primaryDomain ?? 'none'} budget=${precisionBudget} reasons=${budgetReasons.join(',')}`)

  const promptContext: PromptContext = {
    taggedLiveCases,
    taggedArticles,
    strictConcise: liveJuriCases.length <= 1 && filteredPgJuriCases.length === 0,
    domains,
    topicNote: topicMatch?.answerNote,
    liveArticleResolutionFailed,
    precisionBudget,
  }

  if (promptContext.strictConcise) {
    console.info('[pipeline] mode strict-concise activé (sources jurisprudentielles limitées)')
  }

  const modelConfig = getModelById(selectedModel)
  const systemPrompt = modelConfig.buildSystemPrompt(allChunks, filteredPgJuriCases, liveJuriCases, promptContext)
  const history = sanitizeHistory(body.conversationHistory)

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: trimmedMessage },
  ]

  console.info(`[pipeline] prompt=${systemPrompt.length} chars`)

  // ── Étape 4 : Génération en streaming direct ──

  try {
    const llmStream = await openRouterStreamWithFallback(messages, modelConfig.maxTokens, selectedModel, modelConfig.temperature)

    // Buffer la réponse complète → sanitiser les numéros d'arrêts non vérifiés → re-émettre
    const chunksFound = chunks.length
    const reader = llmStream.getReader()
    const decoder = new TextDecoder()
    const rawChunks: string[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      rawChunks.push(decoder.decode(value, { stream: true }))
    }

    const rawSSE = rawChunks.join('')
    const responseText = rawSSE
      .split('\n')
      .filter(line => line.startsWith('data: ') && !line.includes('[DONE]'))
      .map(line => {
        try { return JSON.parse(line.slice(6)).choices?.[0]?.delta?.content ?? '' }
        catch { return '' }
      })
      .join('')

    // ── Pipeline tags fermés ──────────────────────────────────────────────────
    // Architecture : le LLM cite [J1][A1] → le backend injecte les vraies références.
    // Aucun numéro d'arrêt ne peut provenir du LLM dans la réponse finale.

    const allowedCaseTags = taggedLiveCases.map(c => c.tag)
    const allowedArticleTags = taggedArticles.map(a => a.tag)

    // Passe 1 — supprimer tout numéro libre (hallucination : le LLM ne devrait pas en écrire)
    const { cleaned: noFreeCaseNumbers, removed: removedFreeCaseNumbers } =
      stripUnauthorizedCaseNumbers(responseText)

    // Passe 2 — valider les tags utilisés
    const validCaseTags = validateUsedCaseTags(noFreeCaseNumbers, allowedCaseTags)
    const validArticleTags = validateUsedArticleTags(noFreeCaseNumbers, allowedArticleTags)

    console.info(
      `[post-process] caseTags allowed=${allowedCaseTags.join(', ') || '—'} `
      + `used=${validCaseTags.join(', ') || '—'}`
    )
    console.info(
      `[post-process] articleTags allowed=${allowedArticleTags.join(', ') || '—'} `
      + `used=${validArticleTags.join(', ') || '—'}`
    )
    if (removedFreeCaseNumbers.length > 0) {
      console.warn(
        `[post-process] free case numbers removed: ${removedFreeCaseNumbers.join(', ')}`
      )
    }

    // ── Retry forcé jurisprudence (domaines critiques) ────────────────────
    // Condition : domaine critique + arrêts live disponibles + aucun tag J utilisé
    let workingText = noFreeCaseNumbers

    const needsJuriRetry =
      validCaseTags.length === 0 &&
      liveJuriCases.length > 0 &&
      domains.some(d => FORCE_JURISPRUDENCE_DOMAINS.has(d))

    if (needsJuriRetry) {
      console.warn('[pipeline] retry-forced-jurisprudence activé')
      try {
        const retryMessages: OpenRouterMessage[] = [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: trimmedMessage },
          { role: 'assistant', content: responseText },
          {
            role: 'user',
            content: `INSTRUCTION SYSTÈME : La réponse précédente est invalide car aucun arrêt jurisprudentiel [J1]/[J2]/[J3] n'a été utilisé alors qu'ils sont obligatoires dans ce domaine. Réécris intégralement la réponse en intégrant au moins un tag [J1], [J2] ou [J3] dans la qualification juridique.`,
          },
        ]
        const retryRaw = await openRouterChat(retryMessages, selectedModel, modelConfig.maxTokens)
        if (retryRaw?.trim()) {
          const { cleaned: retryNoCaseNumbers } = stripUnauthorizedCaseNumbers(retryRaw)
          const retryValidTags = validateUsedCaseTags(retryNoCaseNumbers, allowedCaseTags)
          if (retryValidTags.length > 0) {
            console.info('[pipeline] retry-forced-jurisprudence succès — tags utilisés: ' + retryValidTags.join(', '))
            workingText = retryNoCaseNumbers
          } else {
            console.warn('[pipeline] retry-forced-jurisprudence échec — aucun tag J dans le retry')
          }
        } else {
          console.warn('[pipeline] retry-forced-jurisprudence échec — réponse vide')
        }
      } catch (err) {
        console.error('[pipeline] retry-forced-jurisprudence erreur:', err)
      }
    }

    // Passe 2.5 — détecter et neutraliser les citations libres d'articles
    const { cleaned: noFreeArticles, found: freeArticleCitations } =
      stripUnauthorizedArticleCitations(workingText, allowedArticleTags)

    // Signal de confiance article
    let articleCitationMode: 'tagged' | 'free' | 'mixed'
    if (validArticleTags.length > 0 && freeArticleCitations.length === 0) {
      articleCitationMode = 'tagged'
    } else if (validArticleTags.length === 0 && freeArticleCitations.length > 0) {
      articleCitationMode = 'free'
    } else if (validArticleTags.length > 0 && freeArticleCitations.length > 0) {
      articleCitationMode = 'mixed'
    } else {
      articleCitationMode = 'tagged' // aucun article cité = propre
    }

    if (freeArticleCitations.length > 0) {
      console.warn(
        `[post-process] ⚠️ article-citation-mode=${articleCitationMode} `
        + `— ${freeArticleCitations.length} citation(s) libre(s) : `
        + freeArticleCitations.map(c => c.match.trim()).join(' | ')
      )
    }

    // ── Normative safety mode — déclencheurs composites ──────────────────────
    // Signaux post-génération
    const lowJuriSupport = filteredPgJuriCases.length === 0 && liveJuriCases.length <= 1
    const lowGrounding = noArticleGrounding || lowJuriSupport
    const normativeDensity = detectNormativeDensity(noFreeArticles)
    const highNormativeDensity = normativeDensity.score >= NORMATIVE_DENSITY_HIGH

    // Accumulation des raisons (décrivent l'état, indépendamment les unes des autres)
    const safetyReasons: string[] = []
    if (noArticleGrounding)           safetyReasons.push('no_article_grounding')
    if (freeArticleCitations.length > 0) safetyReasons.push('free_article_citations')
    if (lowJuriSupport)               safetyReasons.push('low_jurisprudence_support')
    if (highNormativeDensity)         safetyReasons.push('high_normative_density')

    // Activation : l'une des trois conditions suffit
    const normativeSafetyMode =
      noArticleGrounding ||
      (lowJuriSupport && freeArticleCitations.length > 0) ||
      (lowGrounding && highNormativeDensity)

    if (normativeSafetyMode) {
      console.warn(`[pipeline] 🔒 normative-safety-mode activé: reasons=${safetyReasons.join(',')}`)
    }

    // Passe 3 — injecter les vraies citations jurisprudentielles et articles
    let finalText = noFreeArticles
    finalText = injectRealCaseCitations(finalText, taggedLiveCases)
    finalText = injectRealArticleCitations(finalText, taggedArticles)

    // Passe 3.5 — downgrade normatif si sources insuffisantes
    if (normativeSafetyMode) {
      finalText = optionallyDowngradeUnsupportedNormativeClaims(finalText)
    }

    // Passe 3.7 — diagnostic high-risk-claims + softening piloté par precisionBudget
    const highRiskClaims = detectHighRiskClaims(finalText)
    if (highRiskClaims.length > 0) {
      const claimTypes = [...new Set(highRiskClaims.map(c => c.type))]
      console.info(`[high-risk-claims] detected=${highRiskClaims.length} types=[${claimTypes.join(', ')}]`)
    }
    const effectiveSoftenLevel = BUDGET_TO_SOFTEN_LEVEL[precisionBudget]
    if (effectiveSoftenLevel !== 'medium' && highRiskClaims.length > 0) {
      finalText = softenHighRiskClaims(finalText, { safetyLevel: effectiveSoftenLevel })
      console.info(`[high-risk-claims] soften applied budget=${precisionBudget} level=${effectiveSoftenLevel}`)
    }

    // Passe 4 — filet final : tout numéro résiduel post-injection → [arrêt non vérifié]
    const validCases = [...liveJuriCases, ...filteredPgJuriCases]
    const { sanitized: sanitizedText, removed } = sanitizeJuriNumbers(finalText, validCases)
    if (removed.length > 0) {
      console.warn(`[sanitize] ${removed.length} numéro(s) résiduel(s) non vérifié(s) : ${removed.join(', ')}`)
    }

    // Auto-index en background (fire-and-forget)
    waitUntil(Promise.all([
      autoIndexMissingArticles(responseText, chunksFound),
      autoIndexMissingJurisprudence(liveJuriCases),
    ]).catch(err => console.error('[auto-indexer]', err)))

    // Re-émettre comme SSE (réponse complète en un seul event)
    const sanitizedSSE = `data: ${JSON.stringify({ choices: [{ delta: { content: sanitizedText }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`

    return new Response(sanitizedSSE, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Sources-Count': String(chunks.length),
        'X-Juri-Count': String(liveJuriCases.length + filteredPgJuriCases.length),
        'X-Domain': primaryDomain ?? '',
        'X-Response-Mode': responseMode,
        'X-Model-Used': selectedModel,
        'X-Sanitized': String(removed.length),
        'X-Article-Citation-Mode': articleCitationMode,
      },
    })
  } catch (err) {
    console.error('[pipeline] Erreur LLM :', err)
    return Response.json(
      { error: 'Erreur lors du traitement. Réessayez.' },
      { status: 500 },
    )
  }
}

// ── V2 routing — tryV2Route ──────────────────────────────────────────────────
// Tente de répondre via le moteur V2 (legal-brief-orchestrator).
// Retourne une Response SSE si toutes les conditions de rollout sont remplies,
// null sinon (fallback V1 automatique).
//
// Conditions de rollout (shouldUseLegalV2) :
//   1. Feature flag global activé
//   2. Playbook détecté ET dans la whitelist V2
//   3. Orchestrateur status=ok
//   4. Validation finale ok (aucune issue medium/high)
//   5. Aucune erreur AUTHORITY_SCOPE_MISMATCH
//   6. Pas de retry ayant échoué la validation

async function tryV2Route(message: string): Promise<Response | null> {
  // Détection playbook — déterministe, 0ms, pas de réseau
  const playbook = detectLegalPlaybook(message)

  // Pré-vérification whitelist avant d'appeler l'orchestrateur (évite un LLM call inutile)
  if (!playbook || !isV2EnabledPlaybook(playbook.id)) {
    // ── Domain pack path — baux_habitation sans playbook whitelisté ──────────
    // Détecter le domaine et la politique domain pack pour cette question.
    const domainMatch = detectDomain(message)
    const domain = domainMatch?.name ?? null
    // On passe playbookId=null car la condition d'entrée ici est "pas de playbook whitelisté"
    const packPolicy = getDomainPackPolicy(domain, null)

    if (packPolicy === 'active') {
      return tryDomainPackRoute(message, domain!)
    }

    if (packPolicy === 'shadow') {
      const pack = getDomainPack(domain!)
      if (pack) waitUntil(runDomainPackShadow(message, pack))
    }

    console.info(`[v2-router] no_match reason=${playbook ? 'playbook_not_whitelisted' : 'no_playbook_match'} playbook=${playbook?.id ?? 'none'} domain=${domain ?? 'none'} packPolicy=${packPolicy} — fallback V1`)
    return null
  }

  console.info(`[v2-router] playbook_match=${playbook.id} — running orchestrator`)
  const t0 = Date.now()

  try {
    const result = await runLegalBriefOrchestrator(message)
    const durationMs = Date.now() - t0

    const orchestratorOk = result.status === 'ok'
    const vr = orchestratorOk ? result.validationReportFinal : { ok: false, issues: [] }
    const hasAuthorityScopeMismatch = vr.issues.some((i) => i.code === 'AUTHORITY_SCOPE_MISMATCH')
    const retried = orchestratorOk ? result.retried : false

    const decision = shouldUseLegalV2({
      featureEnabled: FEATURES.V2_LEGAL_BRIEF_ENABLED,
      playbookId: orchestratorOk ? result.playbookId : playbook.id,
      orchestratorOk,
      validationOk: vr.ok,
      hasAuthorityScopeMismatch,
      retried,
    })

    // Log structuré systématique
    console.info(
      `[v2-router] playbook=${playbook.id} `
      + `engine=${decision.useV2 ? 'v2' : 'v1'} `
      + `reason=${decision.reason} `
      + `validation=${vr.ok ? 'ok' : 'fail'} `
      + `issues=${vr.issues.length} `
      + `scope_mismatch=${hasAuthorityScopeMismatch} `
      + `retried=${retried} `
      + `duration=${durationMs}ms`
    )

    if (!decision.useV2) {
      console.warn(`[v2-router] fallback_v1 reason=${decision.reason} playbook=${playbook.id}`)
      return null
    }

    // À ce stade result.status === 'ok' est garanti par orchestratorOk
    if (result.status !== 'ok') return null

    // Score interne (déterministe, 0 LLM)
    const score = scoreAnswer(result.playbookId, result.finalAnswer, vr, result.legalBrief)
    console.info(
      `[v2] score_interne=${score.total}/20 `
      + `accuracy=${score.legalAccuracy} nuances=${score.mandatoryNuances} `
      + `practical=${score.practicalUsefulness} safety=${score.safety}`
    )

    // Retour SSE — format identique à V1 pour compatibilité client
    const sse = `data: ${JSON.stringify({
      choices: [{ delta: { content: result.finalAnswer }, finish_reason: 'stop' }],
    })}\n\ndata: [DONE]\n\n`

    return new Response(sse, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        // Headers de routage (lisibles côté client / proxy / logs)
        'X-Legal-Engine': 'v2',
        'X-Legal-Playbook': result.playbookId,
        'X-Legal-Fallback-Reason': '',
        'X-Legal-Retried': String(result.retried),
        // Headers V2 détaillés (backward compat + debug staging)
        'X-V2-Budget': result.precisionBudget,
        'X-V2-Validation': vr.ok ? 'ok' : 'fail',
        'X-V2-Score': String(score.total),
      },
    })
  } catch (err) {
    console.error('[v2-router] erreur orchestrateur — fallback V1:', err)
    return null
  }
}

// ── Shadow mode — runV2Shadow ─────────────────────────────────────────────────
// Exécute V2 en arrière-plan via waitUntil() quand ENABLE_V2_SHADOW=true.
// La réponse V1 est déjà renvoyée ; ce bloc logge le score V2 pour comparaison.
// Ne jamais awaiter directement — doit être passé à waitUntil().

async function runV2Shadow(message: string): Promise<void> {
  try {
    const result = await runLegalBriefOrchestrator(message)
    if (result.status !== 'ok') {
      console.info(`[v2-shadow] no_match`)
      return
    }
    const vr = result.validationReportFinal
    const hasAuthorityScopeMismatch = vr.issues.some((i) => i.code === 'AUTHORITY_SCOPE_MISMATCH')
    const score = scoreAnswer(result.playbookId, result.finalAnswer, vr, result.legalBrief)
    console.info(
      `[v2-shadow] playbook=${result.playbookId} `
      + `validation=${vr.ok ? 'ok' : 'fail'} `
      + `issues=${vr.issues.length} `
      + `scope_mismatch=${hasAuthorityScopeMismatch} `
      + `retried=${result.retried} `
      + `score=${score.total}/20`
    )
  } catch (err) {
    console.error('[v2-shadow] erreur:', err)
  }
}

// ── Domain Pack — tryDomainPackRoute ────────────────────────────────────────
// Tente de répondre via le domain pack (mode actif).
// Retourne une Response SSE si validation ok, null sinon (fallback V1).

async function tryDomainPackRoute(message: string, domain: string): Promise<Response | null> {
  const pack = getDomainPack(domain)
  if (!pack) return null

  const t0 = Date.now()
  try {
    const result = await runDomainPackOrchestrator(message, pack)

    if (result.status === 'error') {
      logDomainPackEvent({ domain, playbookMatched: false, fallbackRuleId: null, mode: 'active', validationOk: false, usedV2Pack: false, fallbackReason: result.reason })
      console.warn(`[domain-pack] active mode error — fallback V1: ${result.reason}`)
      return null
    }

    const vr = result.validationReportFinal
    const hasAuthorityScopeMismatch = vr.issues.some((i) => i.code === 'AUTHORITY_SCOPE_MISMATCH')

    logDomainPackEvent({
      domain,
      playbookMatched: false,
      fallbackRuleId: result.fallbackRuleId,
      mode: 'active',
      validationOk: vr.ok,
      usedV2Pack: vr.ok && !hasAuthorityScopeMismatch,
      fallbackReason: !vr.ok ? 'validation_failed' : hasAuthorityScopeMismatch ? 'authority_scope_mismatch' : null,
    })

    if (!vr.ok || hasAuthorityScopeMismatch) {
      console.warn(`[domain-pack] validation fail — fallback V1 validationOk=${vr.ok} scopeMismatch=${hasAuthorityScopeMismatch}`)
      return null
    }

    const sse = `data: ${JSON.stringify({
      choices: [{ delta: { content: result.finalAnswer }, finish_reason: 'stop' }],
    })}\n\ndata: [DONE]\n\n`

    console.info(`[domain-pack] active response sent duration=${Date.now() - t0}ms budget=${result.precisionBudget} retried=${result.retried}`)

    return new Response(sse, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Legal-Engine': 'v2-domain-pack',
        'X-Legal-Domain-Pack': domain,
        'X-Legal-Fallback-Rule': result.fallbackRuleId ?? '',
        'X-V2-Budget': result.precisionBudget,
        'X-V2-Validation': vr.ok ? 'ok' : 'fail',
        'X-Legal-Retried': String(result.retried),
      },
    })
  } catch (err) {
    console.error('[domain-pack] tryDomainPackRoute error — fallback V1:', err)
    return null
  }
}

// ── Domain Pack — runDomainPackShadow ────────────────────────────────────────
// Exécute le domain pack en arrière-plan (shadow mode).
// La réponse V1 est déjà renvoyée. Logge les métriques sans exposer à l'utilisateur.
// Ne jamais awaiter directement — passer à waitUntil().

async function runDomainPackShadow(message: string, pack: DomainPack): Promise<void> {
  try {
    const result = await runDomainPackOrchestrator(message, pack)

    if (result.status === 'error') {
      console.info(`[domain-pack-shadow] error: ${result.reason}`)
      return
    }

    const vr = result.validationReportFinal
    const hasAuthorityScopeMismatch = vr.issues.some((i) => i.code === 'AUTHORITY_SCOPE_MISMATCH')

    logDomainPackEvent({
      domain: pack.domain,
      playbookMatched: false,
      fallbackRuleId: result.fallbackRuleId,
      mode: 'shadow',
      validationOk: vr.ok,
      usedV2Pack: false, // shadow : jamais exposé à l'utilisateur
      fallbackReason: !vr.ok ? 'validation_failed' : hasAuthorityScopeMismatch ? 'authority_scope_mismatch' : null,
    })

    console.info(
      `[domain-pack-shadow] pack=${pack.id} `
      + `fallbackRule=${result.fallbackRuleId ?? 'none'} `
      + `validation=${vr.ok ? 'ok' : 'fail'} `
      + `issues=${vr.issues.length} `
      + `scopeMismatch=${hasAuthorityScopeMismatch} `
      + `retried=${result.retried} `
      + `duration=${result.durationMs}ms budget=${result.precisionBudget}`
    )
  } catch (err) {
    console.error('[domain-pack-shadow] error:', err)
  }
}

// ── Whitelist keywords — pass immédiat, 0ms, 0 coût ──
// Couvre tous les domaines du droit immobilier français.
// Si un keyword matche → OUI sans appel LLM.
// Si aucun keyword → fallback GPT-4o-mini pour les cas ambigus.

const IMMO_KEYWORDS = [
  // Bail / location
  'bail', 'loyer', 'locataire', 'bailleur', 'location', 'sous-louer', 'sous-location',
  'congé', 'expulsion', 'dépôt de garantie', 'depot de garantie', 'préavis', 'preavis',
  'trêve hivernale', 'treve hivernale', 'clause résolutoire', 'irl', 'quittance',
  'état des lieux', 'etat des lieux', 'logement', 'appartement', 'propriétaire',
  'louer', 'locatif', 'résiliation', 'renouvellement du bail',
  // Copropriété
  'copropriété', 'copropriete', 'syndic', 'assemblée générale', 'assemblee generale',
  'charges de copropriété', 'tantièmes', 'tantiemes', 'parties communes',
  'règlement de copropriété', 'syndicat des copropriétaires', 'lot de copropriété',
  // Agent immobilier / mandat
  'agent immobilier', 'mandat', 'honoraires', 'hoguet', 'carte t', 'commission',
  'agence immobilière', 'agence immobiliere', 'négociateur', 'negociateur',
  'devoir de conseil', 'compromis', 'promesse de vente',
  // Vente / transactions
  'vente', 'acheteur', 'vendeur', 'notaire', 'frais de notaire', 'avant-contrat',
  'vice caché', 'vice cache', 'rétractation', 'retractation', 'condition suspensive',
  'acte authentique', 'sru', 'plus-value', 'droits de mutation', 'préemption', 'preemption',
  // Diagnostics
  'diagnostic', 'dpe', 'amiante', 'plomb', 'termites', 'erp', 'carrez',
  'audit énergétique', 'audit energetique', 'passoire thermique', 'classe énergétique',
  // Urbanisme / construction
  'urbanisme', 'permis de construire', 'plu', 'zan', 'certificat d\'urbanisme',
  'vefa', 'décennale', 'decennale', 'malfaçon', 'travaux', 'construction',
  // Fiscalité immo
  'sci', 'ifi', 'pinel', 'denormandie', 'déficit foncier', 'deficit foncier',
  'lmnp', 'revenus fonciers', 'taxe foncière', 'taxe fonciere',
  // Autres
  'viager', 'usufruit', 'démembrement', 'demembrement', 'nue-propriété',
  'bail commercial', 'fonds de commerce', 'crédit immobilier', 'credit immobilier',
  'immobilier', 'immeuble', 'bien immobilier', 'terrain',
  // Successions / protection / famille (Fix 3)
  'tutelle', 'curatelle', 'indivision', 'succession', 'donation', 'héritage',
  'héritier', 'héritiers', 'partage', 'mandat de protection future',
  'divorce', 'liquidation communauté', 'séparation de biens', 'bien propre', 'bien commun',
  'donation-partage', 'pacte de famille', 'indivision successorale',
  // Bail — situations spéciales
  'squat', 'squatteur', 'occupation illicite', 'colocation', 'caution solidaire',
  'garantie visale', 'gli', 'assurance loyers impayés', 'insalubrité',
  'logement indigne', 'habitat indigne', 'meublé tourisme',
  // Diagnostics complémentaires
  'mérule', 'radon', 'diagnostiqueur', 'dpe erroné', 'dpe opposable', 'classe g', 'classe f',
  // Urbanisme complémentaire
  'déclaration préalable', 'lotissement', 'zone inondable', 'ppri', 'monument historique',
  // Litiges immobiliers
  'assignation', 'référé', 'mise en demeure', 'commissaire de justice',
  'prescription', 'forclusion', 'expertise judiciaire', 'astreinte', 'saisie immobilière',
]

function matchesKeyword(text: string, keyword: string): boolean {
  if (text.includes(keyword)) return true
  if (keyword.length >= 5) {
    const stem = keyword.slice(0, Math.min(keyword.length - 1, 6))
    if (text.includes(stem)) return true
  }
  return false
}

async function isImmoKeywordMatch(message: string): Promise<boolean> {
  const lower = message.toLowerCase()
  const keywords = await getWhitelistKeywords()
  return keywords.some(kw => matchesKeyword(lower, kw))
}

// ── Helpers ──

async function checkRelevance(message: string): Promise<boolean> {
  // Pré-filtre keyword : ~0ms (cache 5min), 0 coût, couvre ~95% des questions légitimes
  if (await isImmoKeywordMatch(message)) return true

  // Fallback LLM pour les cas ambigus sans keyword évident
  try {
    const result = await openRouterChat(
      [
        { role: 'system', content: FILTER_SYSTEM },
        { role: 'user', content: message },
      ],
      MODELS.FILTER,
      5,
    )
    return result.trim().toUpperCase().startsWith('OUI')
  } catch {
    return true // fail-open : en cas d'erreur, laisser passer
  }
}

async function autoEnrichWhitelist(message: string): Promise<void> {
  const AUTO_STOP = new Set([
    // Mots grammaticaux
    'dans', 'avec', 'pour', 'quel', 'quoi', 'comment', 'quelle', 'quels',
    'peut', 'doit', 'faut', 'sont', 'être', 'avoir', 'faire', 'cette',
    'leur', 'leurs', 'mais', 'donc', 'aussi', 'plus', 'bien', 'tout',
    'tous', 'même', 'aucun', 'quand', 'sans', 'sous', 'encore', 'entre',
    'après', 'avant', 'elle', 'elles', 'nous', 'vous', 'mon', 'son',
    'merci', 'bonjour', 'possible', 'savoir', 'vraiment', 'quelqu',
    // Mots trop génériques pour le droit immo
    'client', 'question', 'maison', 'époque', 'acheté', 'achat', 'années',
    'année', 'temps', 'moment', 'chose', 'chose', 'point', 'suite',
    'parti', 'partie', 'selon', 'votre', 'notre', 'celui', 'celle',
    'cela', 'celui', 'objet', 'alors', 'avait', 'avons', 'serait',
    'aurait', 'devra', 'devra', 'pourra', 'ainsi', 'comme', 'depuis',
    'passe', 'passer', 'faire', 'faire', 'mieux', 'moins', 'quant',
  ])

  const significantWords = message
    .toLowerCase()
    .replace(/[^\w\sàâäéèêëîïôùûüç-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 7 && !AUTO_STOP.has(w))
    .slice(0, 3)

  const admin = createAdminClient()
  for (const kw of significantWords) {
    try {
      await admin
        .from('filter_keywords')
        .upsert(
          { keyword: kw, domain: null, added_by: 'auto' },
          { onConflict: 'keyword' }
        )
      console.info(`[auto-whitelist] Ajouté : "${kw}"`)
    } catch { /* silencieux */ }
  }
}

function sanitizeHistory(raw: unknown): OpenRouterMessage[] {
  if (!Array.isArray(raw)) return []
  return (raw as Array<{ role?: string; content?: string }>)
    .filter(t => t?.role && t?.content && ['user', 'assistant'].includes(t.role))
    .slice(-MAX_HISTORY_TURNS * 2)
    .map(t => ({ role: t.role as 'user' | 'assistant', content: t.content as string }))
}

// ── Analytics ──

async function saveMessageMetadata(
  messageId: string,
  conversationId: string | null,
  meta: { domain: string | null; topic: string | null; sourcesCount: number; responseMode: 'sourced' | 'free' },
) {
  try {
    const supabase = createClient()
    // Update du message user
    await supabase
      .from('messages')
      .update({
        domain: meta.domain,
        topic: meta.topic,
        sources_count: meta.sourcesCount,
        response_mode: meta.responseMode,
      })
      .eq('id', messageId)

    // Propager le domaine sur la conversation (uniquement si pas déjà set)
    if (conversationId && meta.domain) {
      await supabase
        .from('conversations')
        .update({ domain: meta.domain })
        .eq('id', conversationId)
        .is('domain', null)
    }
  } catch { /* silencieux — ne bloque jamais la réponse */ }
}

// ── Sub-domain classification ──

async function classifySubDomain(question: string): Promise<string | null> {
  const prompt = `Tu classifies les questions d'agents immobiliers en thèmes précis.
Choisis UN thème dans la liste ci-dessous. Si aucun ne correspond, crée un nouveau thème en 2-3 mots.

THÈMES EXISTANTS (utilise ces formulations exactes quand c'est pertinent) :
- Commission et honoraires (tout ce qui concerne le paiement, le refus, le partage de commission)
- Mandat exclusif (durée, résiliation, dénonciation, période irrévocable)
- Mandat simple (conditions, concurrent, commission)
- Compromis et promesse (signature, rétractation, caducité, clause pénale)
- Conditions suspensives (prêt, permis, délai, défaillance)
- Vices cachés (découverte, recours, délai, exonération)
- Tutelle et capacité (majeur protégé, curatelle, autorisation juge)
- Préemption (DPU, prix, juge, commune)
- Clause de substitution (cessionnaire, SCI)
- Dépôt de garantie (restitution, retenue, vétusté, dégradation)
- Loyers impayés (commandement, clause résolutoire, procédure)
- Expulsion locataire (trêve hivernale, huissier, délai)
- Congé bailleur (vente, reprise, motif, préavis)
- Congé locataire (préavis, zone tendue)
- Révision loyer (IRL, augmentation, encadrement)
- Sous-location (autorisation, interdiction)
- Décès locataire (transfert bail, héritiers)
- Bail meublé (durée, résiliation, inventaire)
- Bail mobilité (conditions, durée)
- Diagnostics obligatoires (DPE, amiante, plomb, DDT)
- DPE validité (périodes, opposable, classe F/G)
- Copropriété AG (convocation, majorité, contestation)
- Syndic contrat (révocation, mise en concurrence, honoraires)
- Charges copropriété (répartition, impayés, récupérables)
- Travaux copropriété (vote, urgence, parties communes)
- Permis de construire (délai, instruction, recours)
- Frais de notaire (montant, décomposition)
- Plus-value immobilière (calcul, exonération, RP)
- Responsabilité agent (devoir conseil, information, faute)
- Double mandat (conflit intérêts, vendeur et acheteur)
- Assignation et procédure (délai, tribunal, référé)
- Servitude (passage, vue, mitoyenneté)
- Viager (rente, résolution, décès)
- Usufruit (location, travaux, nu-propriétaire)
- Bail commercial (renouvellement, éviction, révision loyer)
- Indivision (vente, partage, accord)
- SCI (fiscalité, gestion, associés)

Question : "${question}"

Réponds avec UNIQUEMENT le thème, rien d'autre.`

  try {
    const result = await openRouterChat(
      [{ role: 'user', content: prompt }],
      MODELS.FILTER,
      30,
    )
    return result.trim().slice(0, 60)
  } catch {
    return null
  }
}

function streamTextResponse(text: string): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({
          choices: [{ delta: { content: text }, finish_reason: null }],
        })}\n\n`)
      )
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}
