// app/api/chat/route.ts
// Pipeline principal : filtre hors-sujet → contexte DILA → GPT-4o → stream SSE

import { NextRequest } from 'next/server'
import { openRouterChat, openRouterStream, MODELS, type OpenRouterMessage } from '@/lib/openrouter'
import { fetchLegalContext } from '@/lib/legifrance'
import { fetchJurisprudence, type VisaRef } from '@/lib/judilibre'
import { getSystemPrompt } from '@/lib/system-prompt'

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
- agent immobilier (loi Hoguet, mandat, commission, honoraires, devoir de conseil)
- diagnostics immobiliers obligatoires (DPE, amiante, plomb, termites, électricité, gaz, ERP, assainissement)
- urbanisme (permis de construire, PLU, loi ZAN, préemption, ALUR, ELAN)
- SCI, viager, rente viagère, démembrement, usufruit, nue-propriété
- servitudes, mitoyenneté, troubles de voisinage
Hors périmètre : cuisine, médecine, droit du travail (hors immobilier), politique, informatique générale.
En cas de doute, réponds {"relevant":true}.`

async function isRelevantQuestion(message: string): Promise<boolean> {
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

export async function POST(req: NextRequest): Promise<Response> {
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

  // ── Étape 1 : Filtre hors-sujet ─────────────────────────────────────────
  const relevant = await isRelevantQuestion(trimmedMessage)
  if (!relevant) {
    return staticSseResponse(REFUSAL_MESSAGE)
  }

  // ── Étape 2 : Judilibre en premier → visaRefs → Légifrance ─────────────
  const juriContext = await fetchJurisprudence(trimmedMessage)
  const dilaContext = await fetchLegalContext(
    trimmedMessage,
    openRouterChat,
    juriContext.visaRefs.length > 0 ? juriContext.visaRefs : undefined
  )

  const systemPromptContent = getSystemPrompt(dilaContext, juriContext?.text)

  const juriNumbers = juriContext.decisions.map((d) => d.number).join(', ') || '—'
  console.info(
    `[pipeline] juri=${juriNumbers} visa=[${juriContext.visaRefs.length} refs] → legi=[${dilaContext.texts.length} articles] → prompt=[${systemPromptContent.length} chars]`
  )

  const history = sanitizeHistory(conversationHistory)

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemPromptContent },
    ...history,
    { role: 'user', content: trimmedMessage },
  ]

  // ── Étape 4 : Génération avec validation jurisprudence si nécessaire ─────
  const hasJuri = juriContext.available && juriContext.decisions.length > 0

  try {
    if (hasJuri) {
      // Quand la jurisprudence est injectée : appel non-streaming pour valider
      // la présence de la section 2️⃣ avant d'envoyer la réponse
      let responseText = await openRouterChat(messages, model ?? MODELS.MAIN, maxTokens ?? 2000)

      const hasCitation = /Cass\.|Cour d'appel|Cour de cassation|n° \d{2}[-\/]/.test(responseText)

      if (!hasCitation) {
        console.warn('[chat] Jurisprudence absente de la réponse — correction forcée (2e appel)')
        const correctionMessages: OpenRouterMessage[] = [
          ...messages,
          { role: 'assistant', content: responseText },
          {
            role: 'user',
            content:
              'CORRECTION REQUISE : ta réponse ne contient pas la section "2️⃣ Jurisprudence applicable" alors que des arrêts sont fournis dans le prompt (section JURISPRUDENCES DE RÉFÉRENCE). Réécris ta réponse complète en incluant impérativement cette section avec au moins un arrêt cité, son numéro, sa date et l\'enseignement qu\'il apporte.',
          },
        ]
        responseText = await openRouterChat(correctionMessages, model ?? MODELS.MAIN, maxTokens ?? 2000)
        console.info('[chat] 2e appel — correction jurisprudence appliquée')
      }

      return simulateStreamResponse(responseText, {
        'X-DILA-Available': dilaContext.available ? 'true' : 'false',
        'X-Judilibre-Available': 'true',
      })
    }

    // Pas de jurisprudence : streaming normal
    const llmStream = await openRouterStream(messages, model ?? MODELS.MAIN, maxTokens ?? 2000)

    return new Response(llmStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-DILA-Available': dilaContext.available ? 'true' : 'false',
        'X-Judilibre-Available': 'false',
      },
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
