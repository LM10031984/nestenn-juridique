// app/api/chat/route.ts
// Pipeline principal : filtre hors-sujet → contexte DILA → GPT-4o → stream SSE

import { NextRequest } from 'next/server'
import { openRouterChat, openRouterStream, MODELS, type OpenRouterMessage } from '@/lib/openrouter'
import { fetchLegalContext, type DilaContext } from '@/lib/legifrance'
import { fetchJurisprudence, type VisaRef, type RequiredFact } from '@/lib/judilibre'
import { getSystemPrompt } from '@/lib/system-prompt'
import { searchLegalContext, searchCuratedCases, type PgVectorContext } from '@/lib/pgvector'
import { detectPlaybook } from '@/lib/playbooks'
import { detectTopicArticles } from '@/lib/topic-articles'
import { extractArticleRefs } from '@/lib/extract-refs'
import { reformulateQuery } from '@/lib/query-reformulator'
import { qualifyQuestion, formatQualificationResponse } from '@/lib/qualification'
import { validateResponseQuality, buildCorrectionPrompt, judgeResponseAsync } from '@/lib/response-validator'
import { extractRelevantContext } from '@/lib/context-extractor'
import { validateResponse, buildFusedCorrectionPrompt } from '@/lib/live-validator'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const MAX_MESSAGE_LENGTH = 2000
const MAX_HISTORY_TURNS = 10 // nb de tours (user+assistant) conservés pour le contexte

const REFUSAL_MESSAGE =
  "Je suis spécialisé en droit immobilier français. Je ne peux pas répondre à cette question.\n\n" +
  "Je suis là pour vous aider sur :\n" +
  "- La **loi Hoguet** et les agents immobiliers\n" +
  "- Les **baux d'habitation** (location vide, meublée, mobilité)\n" +
  "- La **copropriété** (charges, assemblée générale, syndic)\n" +
  "- Les **diagnostics immobiliers** (DPE, amiante, plomb…)\n" +
  "- La **loi ALUR** et la **loi ELAN**\n" +
  "- Les **transactions immobilières** (compromis, promesse de vente, **conditions suspensives**, frais de notaire, viager)\n" +
  "- L'**urbanisme** et la **fiscalité immobilière** (**SCI**, viager, démembrement)\n\n" +
  "N'hésitez pas à me poser une question dans ces domaines."

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConversationTurn {
  role: string
  content: string
}

interface ChatRequestBody {
  message: string
  conversationHistory?: ConversationTurn[]
  sessionId?: string
  model?: string
  maxTokens?: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Construit une Response SSE à partir d'un message texte statique.
 * Utilisé pour les refus et les erreurs renvoyées en streaming.
 */
/**
 * Simule le streaming SSE en émettant le texte par groupes de mots.
 * Utilisé quand la réponse est pré-calculée (validation jurisprudence).
 */
function simulateStreamResponse(text: string, headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder()
  const words = text.split(' ')
  const CHUNK_SIZE = 4   // mots par événement SSE
  const DELAY_MS  = 12  // ms entre chaque chunk

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let i = 0; i < words.length; i += CHUNK_SIZE) {
        const chunk = words.slice(i, i + CHUNK_SIZE).join(' ') + (i + CHUNK_SIZE < words.length ? ' ' : '')
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk }, finish_reason: null }] })}\n\n`)
        )
        await new Promise(r => setTimeout(r, DELAY_MS))
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...headers,
    },
  })
}

function staticSseResponse(text: string, headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Envoie le texte en un seul chunk SSE puis clôture
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...headers,
    },
  })
}

/**
 * Détecte si la question est théorique/académique plutôt qu'un cas de dossier réel.
 * Une question théorique ne doit pas déclencher la qualification des faits.
 */
function isTheoreticalQuestion(message: string): boolean {
  const lower = message.toLowerCase()
  // Marqueurs de question théorique (règle générale, pas un cas vécu)
  const theoreticalMarkers = [
    'est-il valide', 'est-elle valide', 'est-il possible', 'est-il légal',
    'comment fonctionne', 'comment se calcule', 'quelle est la règle',
    'quelle est la différence', 'qu\'est-ce que', 'quelles sont les conditions',
    'quelles sont les obligations', 'depuis la loi', 'selon la loi',
    'est-ce que la loi', 'que dit la loi', 'que prévoit', 'quel est le délai',
    'quels sont les délais', 'quelles sont les mentions', 'comment calculer',
    'est-ce obligatoire', 'est-il obligatoire', 'dois-je', 'faut-il',
    'citez-moi', 'donnez-moi', 'expliquez', 'quelle jurisprudence',
    'peut-il invoquer', 'peut-elle invoquer', 'peut-on invoquer',
    'perd-il automatiquement', 'perd-elle automatiquement',
    'est-il automatiquement', 'est-elle automatiquement',
    'quel délai s\'applique', 'quel est le délai applicable',
    // Questions théoriques sur la responsabilité et la jurisprudence (évite le piège de clarification)
    'est-il responsable', 'est-elle responsable',
    'quelle est la responsabilité', 'quelle est la responsabilite',
    'dans quel délai', 'dans quel delai',
    'selon la jurisprudence', 'jusqu\'où s\'étend', 'jusqu\'ou s\'etend',
    'se rétracter', 'se retracter',
  ]
  // Marqueurs de cas réel (première personne, situation vécue)
  const realCaseMarkers = [
    'mon client', 'mon acheteur', 'mon vendeur', 'mon locataire', 'mon bailleur',
    'j\'ai reçu', 'j\'ai signé', 'nous avons signé', 'il conteste', 'elle conteste',
    'ils refusent', 'il refuse', 'elle refuse', 'on m\'a envoyé', 'j\'ai un problème',
    'ma commission', 'mes honoraires', 'mon mandat', 'ma situation',
  ]
  const hasRealCase = realCaseMarkers.some(m => lower.includes(m))
  const hasTheoretical = theoreticalMarkers.some(m => lower.includes(m))
  // Théorique si marqueur théorique présent ET pas de marqueur de cas réel
  return hasTheoretical && !hasRealCase
}

/**
 * Détecte les faits requis absents du contexte conversationnel.
 * Retourne les labels des faits manquants ([] = tous présents).
 */
function checkMissingFacts(
  message: string,
  history: ConversationTurn[] | undefined,
  requiredFacts: RequiredFact[],
): RequiredFact[] {
  if (requiredFacts.length === 0) return []

  // Texte de recherche : message courant + 4 derniers tours de l'historique
  const historyText = (history ?? [])
    .slice(-4)
    .map(t => t.content)
    .join(' ')
  const searchText = (message + ' ' + historyText).toLowerCase()

  return requiredFacts.filter(
    fact => !fact.keywords.some(kw => searchText.includes(kw.toLowerCase()))
  )
}

/**
 * Construit le message de qualification des faits manquants.
 */
function buildQualificationResponse(missingFacts: RequiredFact[]): string {
  const questions = missingFacts.map((f, i) => `${i + 1}. ${f.label}`).join('\n')
  return `Pour vous donner un avis précis sur ce point, j'ai besoin de quelques informations supplémentaires :\n\n${questions}\n\nDès que vous me les communiquez, je pourrai vous dire si votre position est solide ou fragile, et quelle démarche adopter.`
}

/**
 * Sanitise et valide l'historique de conversation fourni par le client.
 * Retient au plus MAX_HISTORY_TURNS tours et ne garde que les rôles user/assistant.
 */
function sanitizeHistory(raw: ConversationTurn[] | undefined): OpenRouterMessage[] {
  if (!Array.isArray(raw) || raw.length === 0) return []

  return raw
    .filter(
      (turn) =>
        turn &&
        typeof turn.role === 'string' &&
        typeof turn.content === 'string' &&
        (turn.role === 'user' || turn.role === 'assistant')
    )
    .slice(-MAX_HISTORY_TURNS * 2) // *2 car chaque tour = 1 user + 1 assistant
    .map((turn) => ({
      role: turn.role as 'user' | 'assistant',
      content: turn.content,
    }))
}

// ---------------------------------------------------------------------------
// Filtre hors-périmètre (gpt-4o-mini — rapide et peu coûteux)
// ---------------------------------------------------------------------------

const FILTER_SYSTEM = `Tu es un classificateur. Réponds UNIQUEMENT avec {"relevant":true} ou {"relevant":false}.
Sont dans le périmètre : droit immobilier français, notamment :
- baux d'habitation (loyer, locataire, bailleur, expulsion, congé, dépôt de garantie, clause résolutoire, commandement de payer)
- copropriété (syndic, syndicat, assemblée générale, charges, règlement de copropriété)
- transactions immobilières (compromis, promesse de vente, conditions suspensives, délai de prêt, obtention de financement, refus de prêt, prêt immobilier, droit de rétractation, vices cachés, notaire, VEFA, vente en état futur d'achèvement, garantie décennale, garantie biennale, garantie de parfait achèvement, constructeur, maîtrise d'ouvrage)
- agent immobilier (loi Hoguet, mandat, commission, honoraires, devoir de conseil, négociateur salarié, carte professionnelle T)
- diagnostics immobiliers obligatoires (DPE, amiante, plomb, termites, électricité, gaz, ERP, assainissement, DPE collectif, audit énergétique)
- fiscalité immobilière (plus-value immobilière, IFI, revenus fonciers, dispositif Denormandie, Pinel, LMNP, LMP, déficit foncier, régime fiscal location meublée)
- lutte anti-blanchiment immobilier (LCB-FT, TRACFIN, obligations déclaration agents immobiliers, vigilance client)
- urbanisme (permis de construire, PLU, loi ZAN, préemption, ALUR, ELAN)
- SCI, viager, rente viagère, démembrement, usufruit, nue-propriété
- servitudes, mitoyenneté, troubles de voisinage
Hors périmètre : cuisine, médecine, droit du travail (hors immobilier), politique, informatique générale.
En cas de doute, réponds {"relevant":true}.`

// Mots-clés qui garantissent la pertinence — bypass le filtre LLM pour éviter les faux négatifs.
// GPT-4o-mini peut classer "diagnostic amiante + construit en 1998" comme hors-périmètre.
const IN_SCOPE_KEYWORDS = [
  'amiante', 'diagnostic', 'dpe', 'plomb', 'crep', 'termites', 'carrez', 'ddt',
  'bail', 'loyer', 'locataire', 'bailleur', 'location', 'congé', 'expulsion',
  'copropriété', 'copropriete', 'syndic', 'assemblée générale', 'charges',
  'mandat', 'hoguet', 'commission', 'honoraires', 'carte t', 'carte professionnelle',
  'compromis', 'promesse de vente', 'rétractation', 'retractation', 'notaire',
  'vefa', 'garantie décennale', 'garantie decennale', 'vices cachés', 'vices caches',
  'plus-value', 'plus value', 'ifi', 'lmnp', 'sci', 'viager', 'usufruit', 'démembrement',
  'tracfin', 'blanchiment', 'permis de construire', 'plu', 'droit de préemption',
  'dépôt de garantie', 'depot de garantie', 'état des lieux', 'etat des lieux',
  'loi 89-462', 'loi alur', 'loi elan', 'loi hoguet', 'loi climat',
]

async function isRelevantQuestion(message: string): Promise<boolean> {
  const lower = message.toLowerCase()
  // Bypass rapide : si un mot-clé en-scope est présent, pas besoin d'appeler le filtre LLM
  if (IN_SCOPE_KEYWORDS.some(kw => lower.includes(kw))) return true

  try {
    const result = await openRouterChat(
      [
        { role: 'system', content: FILTER_SYSTEM },
        { role: 'user', content: message.slice(0, 500) },
      ],
      MODELS.FILTER,
      20
    )
    const parsed = JSON.parse(result.trim()) as { relevant: boolean }
    return parsed.relevant !== false
  } catch {
    return true // fail-open : en cas d'erreur, on laisse passer
  }
}

// ---------------------------------------------------------------------------
// POST /api/chat
// ---------------------------------------------------------------------------

// Timeout global du pipeline (benchmark timeout côté client = 60s → on rend la main avant)
const PIPELINE_TIMEOUT_MS = 90_000

export async function POST(req: NextRequest): Promise<Response> {
  // ── Timeout global : évite que la route pende indéfiniment et tue le serveur dev ──
  const timeoutResponse = new Promise<Response>((resolve) =>
    setTimeout(
      () => resolve(new Response(JSON.stringify({ error: 'Pipeline timeout (55s)' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })),
      PIPELINE_TIMEOUT_MS
    )
  )

  try {
    return await Promise.race([handlePost(req), timeoutResponse])
  } catch (err) {
    console.error('[chat] Erreur non catchée dans le pipeline :', err)
    return new Response(JSON.stringify({ error: 'Erreur interne du serveur.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

async function handlePost(req: NextRequest): Promise<Response> {
  // ── Validation de base ──────────────────────────────────────────────────

  let body: ChatRequestBody
  try {
    body = (await req.json()) as ChatRequestBody
  } catch {
    return new Response(JSON.stringify({ error: 'Corps de la requête invalide (JSON attendu).' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { message, conversationHistory, sessionId, model, maxTokens } = body

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'Le champ "message" est requis.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return new Response(
      JSON.stringify({
        error: `Le message dépasse la limite de ${MAX_MESSAGE_LENGTH} caractères.`,
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const trimmedMessage = message.trim()

  // ── Rate limiting basique (sera renforcé Phase 4) ───────────────────────
  // On logue l'IP pour monitoring — le vrai rate limiting viendra avec Redis/Upstash
  const forwardedFor = req.headers.get('X-Forwarded-For')
  const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : 'unknown'
  console.info(`[chat] Requête reçue — ip=${clientIp} sessionId=${sessionId ?? 'none'} msgLength=${trimmedMessage.length}`)

  // ── Étape 1 : Filtre + qualification + reformulation (en parallèle) ─────
  const isFirstMessage = !conversationHistory || conversationHistory.length === 0
  const [relevant, reformulated, qualification] = await Promise.all([
    isRelevantQuestion(trimmedMessage),
    reformulateQuery(trimmedMessage),
    isFirstMessage ? qualifyQuestion(trimmedMessage) : Promise.resolve(null),
  ])
  if (!relevant) {
    return staticSseResponse(REFUSAL_MESSAGE)
  }

  // Si la question est ambiguë, c'est le premier message, ET ce n'est PAS une question théorique → clarifier
  const isTheoretical = isTheoreticalQuestion(trimmedMessage)
  if (qualification && !qualification.canAnswerDirectly && qualification.clarificationQuestions.length > 0 && !isTheoretical) {
    console.info(`[pipeline] qualification requise — ${qualification.clarificationQuestions.length} questions`)
    return staticSseResponse(formatQualificationResponse(qualification))
  }
  if (isTheoretical) {
    console.info('[pipeline] question théorique détectée → réponse directe (pas de qualification)')
  }

  // ── Détection playbook (synchrone, 0ms) ─────────────────────────────────
  const playbook = detectPlaybook(trimmedMessage)
  if (playbook) {
    console.info(`[pipeline] playbook=${playbook.id} (${playbook.curatedCaseIds.length} curated)`)
  }

  // ── Détection topic T2AI (fallback déterministe si pas de playbook) ──────
  const topicEntry = !playbook ? detectTopicArticles(trimmedMessage) : null
  if (topicEntry) {
    console.info(`[pipeline] topic=${topicEntry.id} (${topicEntry.curatedCaseIds.length} curated)`)
  }

  // IDs curated à charger : playbook en priorité, puis T2AI en fallback
  const activeCuratedIds = playbook?.curatedCaseIds ?? topicEntry?.curatedCaseIds ?? []

  // Articles forcés connus dès l'étape 2 (synchrone) — playbook + T2AI uniquement
  // Légifrance peut démarrer avec eux sans attendre Judilibre
  const playbookForcedArticles = playbook?.forcedArticles.map(fa => ({
    law: fa.law,
    artNums: [fa.artNum],
  })) ?? []
  const topicForcedArticles = topicEntry?.forcedArticles.map(fa => ({
    law: fa.law,
    artNums: [fa.artNum],
  })) ?? []
  const regexRefs = extractArticleRefs(trimmedMessage)
  // Articles identifiés par le reformulateur LLM (plus précis que regex)
  const reformulatedRefs = reformulated?.articlesToFetch ?? []
  const earlyForcedArticles = [...playbookForcedArticles, ...topicForcedArticles, ...regexRefs, ...reformulatedRefs]

  // Query optimisée pour Judilibre : reformulation LLM > question brute
  const judilibreQuery = reformulated?.judilibreQuery ?? trimmedMessage

  // ── Étape 2 : tout en parallèle — Judilibre + curated + Légifrance ──
  // - Judilibre : question brute pour la détection de thème (keywords naturels)
  //               mais ccQuery/caQuery enrichis par le reformulateur si dispo
  // - pgvector : recherche sémantique avec la query reformulée (meilleur match)
  // - Légifrance : articles forcés (playbook + topic + reformulateur)
  const searchQuery = reformulated?.legalSummary ?? trimmedMessage
  const [juriContext, pgvectorCtx, curatedCtx, dilaContextRaw] = await Promise.all([
    fetchJurisprudence(trimmedMessage, reformulated?.judilibreQuery),  // question brute pour détection thème, reformulée pour recherche API
    searchLegalContext(searchQuery, 8),   // query reformulée = meilleur match sémantique
    activeCuratedIds.length > 0
      ? searchCuratedCases(activeCuratedIds, searchQuery)
      : Promise.resolve<PgVectorContext>({ articles: [], arretText: '' }),
    fetchLegalContext(
      trimmedMessage,
      openRouterChat,
      undefined,
      earlyForcedArticles.length > 0 ? earlyForcedArticles : undefined,
    ),
  ])

  // Merger le contexte curated en tête du pgvector (priorité absolue)
  const mergedPgvector: PgVectorContext = {
    articles: [...curatedCtx.articles, ...pgvectorCtx.articles],
    arretText: [curatedCtx.arretText, pgvectorCtx.arretText].filter(Boolean).join('\n\n===\n\n'),
  }

  // Fusion articles : curated+pgvector en premier, live en complément (dédupliqué)
  const pgvectorTitles = new Set(mergedPgvector.articles.map(a => a.title))
  const liveArticlesDeduped = dilaContextRaw.texts.filter(t => !pgvectorTitles.has(t.title))
  const dilaContext: DilaContext = {
    ...dilaContextRaw,
    available: dilaContextRaw.available || mergedPgvector.articles.length > 0,
    texts: [...mergedPgvector.articles, ...liveArticlesDeduped],
  }

  // Fusion jurisprudence : pgvector sémantique + arrêts live Judilibre (SANS curated — curated bypass extracteur)
  // NB : curatedCtx.arretText est injecté directement plus bas, sans passer par extractRelevantContext()
  const mergedJuriText = [pgvectorCtx.arretText, juriContext.text].filter(Boolean).join('\n\n===\n\n')

  // ── Articles forcés du sub-thème Judilibre (disponibles APRÈS fetchJurisprudence) ──
  // Ces articles n'étaient pas connus avant le Promise.all — les récupérer maintenant
  if (juriContext.forcedArticles?.length) {
    const juriForced = juriContext.forcedArticles
    // Fetch les articles manquants depuis Légifrance
    const missingArticles = juriForced.filter(fa =>
      !dilaContext.texts.some(t => fa.artNums.some(n => t.title?.includes(n)))
    )
    if (missingArticles.length > 0) {
      console.info(`[pipeline] +${missingArticles.length} articles forcés du sub-thème Judilibre : ${missingArticles.map(fa => `${fa.law}/${fa.artNums.join(',')}`).join('; ')}`)
      try {
        const extraContext = await fetchLegalContext(trimmedMessage, openRouterChat, undefined, missingArticles)
        if (extraContext.texts.length > 0) {
          const existingTitles = new Set(dilaContext.texts.map(t => t.title))
          const newTexts = extraContext.texts.filter(t => !existingTitles.has(t.title))
          dilaContext.texts.push(...newTexts)
          // Ajouter aux earlyForcedArticles pour le bypass extracteur
          earlyForcedArticles.push(...missingArticles)
        }
      } catch (err) {
        console.warn('[pipeline] Échec fetch articles sub-thème:', err)
      }
    }
  }

  // ── Étape 3 : Qualification des faits (cas premium + cas réel seulement) ─
  if (juriContext.isPremium && juriContext.requiredFacts.length > 0 && !isTheoreticalQuestion(trimmedMessage)) {
    const missingFacts = checkMissingFacts(trimmedMessage, conversationHistory, juriContext.requiredFacts)
    // Si 2+ faits critiques absents : demander avant de générer
    if (missingFacts.length >= 2) {
      console.info(`[pipeline] qualification requise — ${missingFacts.length} faits manquants: ${missingFacts.map(f => f.id).join(', ')}`)
      return staticSseResponse(buildQualificationResponse(missingFacts))
    }
  }

  // Mode unique — le LLM adapte la longueur selon la complexité de la question
  const mode: 'flash' | 'stratégique' = 'stratégique'

  // Fusion lexique : judilibre expectedLexicon + playbook requiredKeywords
  const mergedLexicon = [
    ...(juriContext.expectedLexicon ?? []),
    ...(playbook?.requiredKeywords ?? []),
  ].filter((v, i, arr) => arr.indexOf(v) === i) // déduplique

  // ── Option B : extraction des refs présentes dans le contexte ───────────
  // Scanne les titres des articles récupérés pour extraire les refs légales
  // → injectées explicitement dans le prompt pour forcer la citation
  const contextRefs = dilaContext.texts
    .map(t => t.title)
    .filter(Boolean)
    .flatMap(title => {
      // Extrait "Art. X" ou "Article X" depuis les titres
      const matches = title!.match(/(?:art(?:icle)?\.?\s*)([A-Z]?[0-9][-\w]*(?:-\d+)?)/gi)
      return matches ?? []
    })
    .filter((v, i, arr) => arr.indexOf(v) === i) // déduplique
    .slice(0, 8) // max 8 refs

  const contextRefsNote = contextRefs.length > 0
    ? `\n\n[RÉFÉRENCES À CITER OBLIGATOIREMENT] : ${contextRefs.join(' | ')}`
    : ''

  // answerNote du playbook ou du topic T2AI ajoutée au system prompt si présente
  const playbookNote = playbook
    ? `\n\n[CONTEXTE THÉMATIQUE] : ${playbook.answerNote}`
    : ''
  const topicNote = !playbook && topicEntry?.answerNote
    ? `\n\n[CONTEXTE THÉMATIQUE] : ${topicEntry.answerNote}`
    : ''

  // ── Étape RAG : articles forcés EN DIRECT + complémentaires via extracteur ──
  // Les articles forcés (playbook + reformulateur) sont les plus pertinents → pas d'extraction
  // Les articles complémentaires (pgvector, fallback) passent par l'extracteur pour compression
  const forcedTitles = new Set(earlyForcedArticles.flatMap(fa => fa.artNums.map(n => n)))
  // Curated articles bypass l'extracteur : identifiés par leur titre, injectés complets
  const curatedArticleTitles = new Set(curatedCtx.articles.map(a => a.title))
  const forcedTexts = dilaContext.texts.filter(t => {
    if (t.title && curatedArticleTitles.has(t.title)) return true  // curated → direct
    const artNum = t.title?.match(/art(?:icle)?\.?\s*(\S+)/i)?.[1]
    return artNum && forcedTitles.has(artNum)
  })
  const supplementaryTexts = dilaContext.texts.filter(t => !forcedTexts.includes(t))

  // Extraire uniquement les sources complémentaires (pas les forcées)
  const rawSupplementary = supplementaryTexts.map(t => {
    const url = t.url ? ` [Lien](${t.url})` : ''
    return `### ${t.title}${url}\n${t.content ?? ''}`
  }).join('\n\n')
  const rawJuriText = mergedJuriText || ''

  const extracted = await extractRelevantContext(trimmedMessage, rawSupplementary, rawJuriText)

  // Construire le contexte final : forcés (complets) + extraits (compressés)
  const finalTexts = [
    ...forcedTexts,  // Articles forcés : contenu complet avec URL
    ...(extracted.legalPassages ? [{
      textId: 'extracted-supplementary',
      title: 'Sources complémentaires',
      content: extracted.legalPassages,
      dateVersion: new Date().toISOString().slice(0, 10),
      url: '',
    }] : []),
  ]
  const finalContext: DilaContext = {
    available: true,
    texts: finalTexts as any,
  }
  // Curated bypass extracteur : injecté en tête de la jurisprudence, intact, priorité absolue
  const juriTextForPrompt = [curatedCtx.arretText, extracted.jurisprudencePassages].filter(Boolean).join('\n\n===\n\n') || undefined
  const systemPromptContent = getSystemPrompt(finalContext, juriTextForPrompt, mode, mergedLexicon.length > 0 ? mergedLexicon : undefined) + playbookNote + topicNote + contextRefsNote

  console.info(`[pipeline] ${forcedTexts.length} articles forcés (direct) + ${supplementaryTexts.length} complémentaires (extracteur)`)
  console.info(`[pipeline] Articles forcés en direct : ${forcedTexts.map(t => t.title?.slice(0, 50) ?? '?').join(' | ')}`)
  console.info(`[pipeline] Chaque article forcé — chars : ${forcedTexts.map(t => `${t.title?.match(/art[.\s]*(\S+)/i)?.[1] ?? '?'}=${(t.content?.length ?? 0)}c`).join(', ')}`)

  const juriNumbers = juriContext.cases.map((c) => c.number).join(', ') || '—'
  console.info(
    `[pipeline] mode=${mode} juri=${juriNumbers} (${juriContext.cases.length} arrêts live: ${juriContext.cases.filter(c => c.court === 'cass').length}CC/${juriContext.cases.filter(c => c.court === 'ca').length}CA) pgvector=[${pgvectorCtx.articles.length}art+${pgvectorCtx.arretText ? '?' : '0'}arr] visa=[${juriContext.visaRefs.length} refs] → legi=[${dilaContext.texts.length} articles] → prompt=[${systemPromptContent.length} chars]`
  )

  const history = sanitizeHistory(conversationHistory)

  // ── Option 1 : Rappel des sources juste avant la question (effet de récence) ──
  const allOriginalTexts = [...(mergedPgvector?.articles ?? []), ...(dilaContextRaw?.texts ?? [])]
  const articleNames = allOriginalTexts
    .filter(t => t.title)
    .map(t => t.title)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 8)
  const arretNames = juriContext.cases
    .map(c => `${c.court === 'cass' ? 'Cass.' : 'CA'} ${c.date} n° ${c.number}`)
  const reminderParts: string[] = []
  if (articleNames.length > 0) reminderParts.push(`Articles disponibles : ${articleNames.join(' | ')}`)
  if (arretNames.length > 0) reminderParts.push(`Arrêts disponibles : ${arretNames.join(' | ')}`)
  const sourceReminder = reminderParts.length > 0
    ? `[SOURCES À UTILISER DANS TA RÉPONSE]\n${reminderParts.join('\n')}\nRappel : chaque affirmation juridique doit être rattachée à l'une de ces sources. Ne réponds pas de mémoire. Cite le texte exact de l'article quand c'est possible.`
    : ''

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemPromptContent },
    ...history,
  ]
  // Injecter le rappel des sources juste avant la question (récence maximale)
  if (sourceReminder) {
    messages.push({ role: 'system', content: sourceReminder })
  }
  messages.push({ role: 'user', content: trimmedMessage })

  // ── Étape 4 : Génération (streaming direct, pas de double appel) ────────
  // L'extracteur de contexte a déjà ciblé les passages pertinents,
  // pas besoin de validation/correction qui doublait le temps de réponse.
  const hasJuri = juriContext.available && juriContext.cases.length > 0

  try {
    // Non-streaming : permet validation + injection des sources
    let responseText = await openRouterChat(messages, model ?? MODELS.MAIN, maxTokens ?? 4000)

    // ── Validation niveau 1 (mécanique, gratuit) ──
    const quality = validateResponseQuality(
      responseText,
      allOriginalTexts,
      juriContext.cases,
      mergedLexicon.length > 0 ? mergedLexicon : undefined,
    )
    console.info(`[quality] Score ${quality.score}/100 — flags: ${quality.flags.length > 0 ? quality.flags.join(', ') : 'aucun'} — pass=${quality.pass}`)

    // ── Circuit-breaker niveau 3 : régénération si score critique ──
    if (!quality.pass && (quality.flags.includes('LEGI_NON_CITEE') || quality.flags.includes('JURI_NON_CITEE'))) {
      const sourceNames = [
        ...allOriginalTexts.filter(t => t.title).map(t => t.title!),
        ...juriContext.cases.map(c => `${c.court === 'cass' ? 'Cass.' : 'CA'} ${c.date} n° ${c.number}`),
      ]
      const correction = buildCorrectionPrompt(quality, sourceNames)
      console.warn(`[quality] Régénération — ${correction.slice(0, 100)}...`)

      const correctionMessages: OpenRouterMessage[] = [
        ...messages,
        { role: 'assistant', content: responseText },
        { role: 'user', content: correction },
      ]
      responseText = await openRouterChat(correctionMessages, model ?? MODELS.MAIN, maxTokens ?? 4000)
      console.info('[quality] 2e appel — correction appliquée')
    }

    // Claude génère sa propre section "Sources consultées" — pas besoin d'injection automatique
    // On ajoute juste la proposition d'action si absente
    if (!responseText.includes('rédiger') && !responseText.includes('courrier') && !responseText.includes('préparer') && !responseText.includes('résolution')) {
      responseText += '\n\n---\nJe peux vous aider à rédiger une résolution type, un courrier ou détailler un point si nécessaire.'
    }

    // ── Juge LLM async (fire-and-forget, ne bloque pas la réponse) ──
    const sourcesSummary = allOriginalTexts.map(t => t.title).filter(Boolean).join(', ')
      + ' | ' + juriContext.cases.map(c => c.number).join(', ')
    judgeResponseAsync(trimmedMessage, responseText, sourcesSummary, openRouterChat, MODELS.FILTER)
      .then(r => console.info(`[judge] score=${r.score} issues=[${r.issues.join(', ')}]`))
      .catch(() => {})

    return simulateStreamResponse(responseText, {
      'X-DILA-Available': dilaContext.available ? 'true' : 'false',
      'X-Judilibre-Available': hasJuri ? 'true' : 'false',
    })
  } catch (err) {
    console.error('[chat] Erreur pipeline LLM :', err)
    return new Response(
      JSON.stringify({
        error:
          'Une erreur est survenue lors du traitement de votre demande. Veuillez réessayer dans quelques instants.',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
