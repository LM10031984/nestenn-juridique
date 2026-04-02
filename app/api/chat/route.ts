// app/api/chat/route.ts
// Pipeline Augmenté v4 — le LLM est enrichi par pgvector, pas contraint par lui
// Filtre hors-sujet → embedding + pgvector → prompt augmenté → streaming direct

export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { openRouterStreamWithFallback, openRouterChat, MODELS, type OpenRouterMessage } from '@/lib/openrouter'
import { getSystemPromptAugmented } from '@/lib/system-prompt'
import { fetchRelevantSources } from '@/lib/sources'
import type { JuriCase } from '@/lib/sources'
import { embedQuestion } from '@/lib/embedding'
import { detectDomains, detectDomain } from '@/lib/domain-detector'
import { fetchJudilibreLive } from '@/lib/judilibre'
import { detectTopic } from '@/lib/topic-detector'
import { autoIndexMissingArticles, autoIndexMissingJurisprudence } from '@/lib/auto-indexer'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
}

// ── Pipeline principal ──

export async function POST(req: NextRequest) {
  const body = await req.json() as ChatRequestBody
  const trimmedMessage = (body.message ?? '').trim().slice(0, MAX_MESSAGE_LENGTH)
  const { messageId, conversationId } = body

  if (!trimmedMessage) {
    return Response.json({ error: 'Message vide' }, { status: 400 })
  }

  // ── Étape 1 : Filtre hors-sujet (GPT-4o-mini, ~500ms) ──

  const isRelevant = await checkRelevance(trimmedMessage)
  if (!isRelevant) {
    return streamTextResponse(REFUSAL_MESSAGE)
  }

  // ── Étape 2 : Sources en parallèle (~200ms pgvector + ~1-2s Judilibre) ──
  // - Détection domaine : keyword matching, 0ms
  // - Embedding + Judilibre live : en parallèle
  // - pgvector : après embedding

  const domains = detectDomains(trimmedMessage)
  const primaryDomain = domains[0] ?? null
  // DomainMatch complet (avec judilibreTheme + judilibreChamber) pour la tentative ciblée
  const domainMatch = detectDomain(trimmedMessage)

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
      waitUntil(autoEnrichWhitelist(trimmedMessage))
    }
  }

  // ── Étape 3 : Assemblage du prompt augmenté ──

  const systemPrompt = getSystemPromptAugmented(chunks, filteredPgJuriCases, liveJuriCases)
  const history = sanitizeHistory(body.conversationHistory)

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: trimmedMessage },
  ]

  console.info(`[pipeline] prompt=${systemPrompt.length} chars`)

  // ── Étape 4 : Génération en streaming direct ──

  try {
    const llmStream = await openRouterStreamWithFallback(messages, 2000)

    // Auto-indexer : si peu de sources, on tee le stream pour capturer la réponse
    // et indexer automatiquement les articles cités mais absents de pgvector
    const chunksFound = chunks.length
    let outputStream: ReadableStream<Uint8Array>

    if (chunksFound < 3) {
      const decoder = new TextDecoder()
      const accumulated: string[] = []
      const [clientStream, captureStream] = llmStream.tee()

      // waitUntil : garantit l'exécution sur Vercel après l'envoi de la réponse
      waitUntil(
        (async () => {
          try {
            const reader = captureStream.getReader()
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              accumulated.push(decoder.decode(value, { stream: true }))
            }
            const fullText = accumulated.join('')
            await Promise.all([
              autoIndexMissingArticles(fullText, chunksFound),
              autoIndexMissingJurisprudence(fullText, chunksFound),
            ])
          } catch (err) { console.error('[auto-indexer]', err) }
        })()
      )

      outputStream = clientStream
    } else {
      outputStream = llmStream
    }

    return new Response(outputStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Sources-Count': String(chunks.length),
        'X-Juri-Count': String(liveJuriCases.length + filteredPgJuriCases.length),
        'X-Domain': primaryDomain ?? '',
        'X-Response-Mode': responseMode,
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
