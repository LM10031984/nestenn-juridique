// app/api/chat/route.ts
// Pipeline principal : filtre hors-sujet → contexte DILA → GPT-4o → stream SSE

import { NextRequest } from 'next/server'
import { openRouterChat, openRouterStream, MODELS, type OpenRouterMessage } from '@/lib/openrouter'
import { fetchLegalContext } from '@/lib/legifrance'
import { fetchJurisprudence } from '@/lib/judilibre'
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
  "- Les **transactions immobilières** (compromis, promesse de vente, frais de notaire)\n" +
  "- L'**urbanisme** et la **fiscalité immobilière**\n\n" +
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
Sont dans le périmètre : droit immobilier français (baux, copropriété, loi Hoguet, mandats, diagnostics immobiliers obligatoires (amiante, plomb, DPE, termites, électricité, gaz, ERP, assainissement), urbanisme, permis de construire, PLU, loi ZAN, ALUR, ELAN, transactions, SCI, syndics, notaire, viager, démembrement).
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

  // ── Étape 2 : Récupération parallèle DILA + Judilibre ───────────────────
  const [dilaContext, juriContext] = await Promise.all([
    fetchLegalContext(trimmedMessage, openRouterChat),
    fetchJurisprudence(trimmedMessage),
  ])

  console.info(
    `[chat] Contexte — DILA available=${dilaContext.available} texts=${dilaContext.texts.length} | Judilibre available=${juriContext.available} decisions=${juriContext.decisions.length}`
  )

  // ── DEBUG TEMPORAIRE ────────────────────────────────────────────────────
  console.log('=== CONTEXTE LÉGIFRANCE ===')
  console.log(dilaContext.texts.length > 0 ? JSON.stringify(dilaContext.texts.map(t => ({ id: t.textId, title: t.title, contentLength: t.content?.length })), null, 2) : 'VIDE')
  console.log('=== CONTEXTE JUDILIBRE ===')
  console.log(juriContext?.text || 'VIDE')
  console.log('=== SYSTEM PROMPT FINAL ===')
  const systemPromptContent = getSystemPrompt(dilaContext, juriContext?.text)
  console.log(systemPromptContent.slice(0, 3000) + (systemPromptContent.length > 3000 ? '\n[...tronqué]' : ''))
  console.log('=== FIN CONTEXTE ===')
  // ── FIN DEBUG ───────────────────────────────────────────────────────────

  const history = sanitizeHistory(conversationHistory)

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemPromptContent },
    ...history,
    { role: 'user', content: trimmedMessage },
  ]

  // ── Étape 4 : Streaming GPT-4o via OpenRouter ───────────────────────────
  try {
    const llmStream = await openRouterStream(messages, model ?? MODELS.MAIN, maxTokens ?? 2000)

    return new Response(llmStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-DILA-Available': dilaContext.available ? 'true' : 'false',
        'X-Judilibre-Available': juriContext.available && juriContext.decisions.length > 0 ? 'true' : 'false',
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
