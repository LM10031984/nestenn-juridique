// lib/auto-indexer.ts
// Indexation automatique des articles cités par le LLM mais absents de pgvector
// Fire-and-forget : appelé depuis route.ts après le streaming, sans bloquer la réponse

import { createClient } from '@supabase/supabase-js'
import { openRouterChat, MODELS } from '@/lib/openrouter'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PISTE_TOKEN_URL = 'https://oauth.piste.gouv.fr/api/oauth/token'
const PISTE_API_BASE  = process.env.PISTE_API_URL ?? 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app'
const NOMIC_API_URL   = 'https://api-atlas.nomic.ai/v1/embedding/text'

// ── LEGITEXT_MAP minimal pour résolution ──────────────────────────────────

const LEGITEXT_MAP: Record<string, string> = {
  '89-462': 'LEGITEXT000006069108', 'loi 89-462': 'LEGITEXT000006069108',
  '65-557': 'LEGITEXT000006068256', 'loi 65-557': 'LEGITEXT000006068256',
  '70-9':   'LEGITEXT000006068387', 'loi 70-9':   'LEGITEXT000006068387',
  '67-223': 'LEGITEXT000006061423', '72-678':     'LEGITEXT000006063791',
  'civil':  'LEGITEXT000006070721', 'code civil':  'LEGITEXT000006070721',
  'cch':    'LEGITEXT000006074096', 'construction': 'LEGITEXT000006074096',
  'cgi':    'LEGITEXT000006069577', 'fiscal':       'LEGITEXT000006069577',
  'cpc':    'LEGITEXT000006070716',
  'cpce':   'LEGITEXT000025024948',
  'consommation': 'LEGITEXT000006069565', 'code consommation': 'LEGITEXT000006069565',
  'commerce':     'LEGITEXT000005634379',
  'urbanisme':    'LEGITEXT000006074075',
  'pénal':        'LEGITEXT000006069719', 'code pénal': 'LEGITEXT000006069719',
  'santé':        'LEGITEXT000006072665', 'santé publique': 'LEGITEXT000006072665', 'csp': 'LEGITEXT000006072665',
  'travail':      'LEGITEXT000006072050', 'code travail': 'LEGITEXT000006072050',
}

// ── 1. Extraction des références d'articles ──────────────────────────────

interface ArticleRef {
  law: string
  article: string
  legitextId: string | null
}

// Table des lois connues — correspondance nom complet → LEGITEXT
const KNOWN_LAWS: Record<string, string> = {
  'code civil':                                    'LEGITEXT000006070721',
  'code de la santé publique':                     'LEGITEXT000006072665',
  "code de la construction et de l'habitation":    'LEGITEXT000006074096',
  "code de l'urbanisme":                           'LEGITEXT000006074075',
  "code de l'environnement":                       'LEGITEXT000006074220',
  'code de commerce':                              'LEGITEXT000005634379',
  'code de la consommation':                       'LEGITEXT000006069565',
  'code général des impôts':                       'LEGITEXT000006069577',
  "code des procédures civiles d'exécution":       'LEGITEXT000025024948',
  'code de procédure civile':                      'LEGITEXT000006070716',
}

// Cherche le nom de loi dans les ~100 chars AVANT la position de l'article
function findLawInText(text: string, articlePosition: number): { name: string; legitext: string } | null {
  const before = text.slice(Math.max(0, articlePosition - 150), articlePosition).toLowerCase()

  for (const [name, legitext] of Object.entries(KNOWN_LAWS)) {
    if (before.includes(name)) return { name, legitext }
  }

  // Lois par numéro : "loi n° 89-462"
  const lawNumMatch = before.match(/loi\s+n[o°]?\s*([\d]{2,4}-[\d]+)/)
  if (lawNumMatch) {
    const resolved = resolveLegitext(`loi ${lawNumMatch[1]}`)
    if (resolved) return { name: `loi ${lawNumMatch[1]}`, legitext: resolved }
  }

  return null
}

export function extractArticleReferences(text: string): ArticleRef[] {
  const refs: ArticleRef[] = []
  const seen = new Set<string>()

  // Pattern simple : capturer tous les "art. XXX" / "article XXX"
  const articlePattern = /art(?:icle)?\.?\s*([LRDA]\.?\s*\d[\d.\-]+|\d[\d.\-]*)/gi

  for (const match of text.matchAll(articlePattern)) {
    const article = match[1].trim().replace(/^([LRDA])\.\s+/, '$1.')
    if (!article) continue
    const position = match.index ?? 0

    const law = findLawInText(text, position)
    if (!law) continue

    const key = `${law.legitext}|${article}`
    if (seen.has(key)) continue
    seen.add(key)

    refs.push({ law: law.name, article, legitextId: law.legitext })
  }

  return refs
}

function resolveLegitext(hint: string): string | null {
  for (const [key, id] of Object.entries(LEGITEXT_MAP)) {
    if (hint.includes(key) || key.includes(hint)) return id
  }
  return null
}

// ── 2. Vérification existence en base ─────────────────────────────────────

async function isIndexed(legitextId: string, articleNum: string): Promise<boolean> {
  const { count } = await supabase
    .from('legal_articles')
    .select('*', { count: 'exact', head: true })
    .eq('law_id', legitextId)
    .ilike('article_num', articleNum)
  return (count ?? 0) > 0
}

// ── 3. Token PISTE OAuth ──────────────────────────────────────────────────

let _cachedToken: { token: string; expiresAt: number } | null = null

async function getPisteToken(): Promise<string | null> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt) return _cachedToken.token
  try {
    const res = await fetch(PISTE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id:     process.env.PISTE_CLIENT_ID ?? '',
        client_secret: process.env.PISTE_CLIENT_SECRET ?? '',
        scope: 'openid',
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as { access_token: string; expires_in: number }
    _cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 }
    return _cachedToken.token
  } catch {
    return null
  }
}

// ── 4. Recherche LEGIARTI via Légifrance ──────────────────────────────────

async function findLegiartiId(token: string, legitextId: string, articleNum: string): Promise<string | null> {
  try {
    const res = await fetch(`${PISTE_API_BASE}/consult/code/tableMatieres`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        textId: legitextId,
        date: new Date().toISOString().split('T')[0],
        pageSize: 200,
        searchArticle: articleNum,
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as { sections?: Array<{ articles?: Array<{ id: string; num: string }> }> }
    // Légifrance stocke parfois "L271-4" sans point après la lettre
    const noDot = articleNum.replace(/^([LRDA])\./, '$1')
    const candidates = [articleNum, articleNum.toUpperCase(), noDot, noDot.toUpperCase()]
    for (const section of data.sections ?? []) {
      const found = section.articles?.find(a => candidates.includes(a.num))
      if (found) return found.id
    }
  } catch { /* silencieux */ }
  return null
}

async function fetchArticleText(token: string, legiartiId: string): Promise<{ texte: string; url: string } | null> {
  try {
    const res = await fetch(`${PISTE_API_BASE}/consult/getArticle`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: legiartiId }),
    })
    if (!res.ok) return null
    const data = await res.json() as { article?: { texte?: string; etat?: string } }
    const texte = data.article?.texte?.replace(/<[^>]+>/g, ' ').trim() ?? ''
    if (texte.length < 20 || data.article?.etat === 'ABROGE') return null
    const url = `https://www.legifrance.gouv.fr/codes/article_lc/${legiartiId}`
    return { texte, url }
  } catch {
    return null
  }
}

// ── 5. Summarize (GPT-4o-mini, même prompt que index-legifrance) ──────────

async function summarizeArticle(articleNum: string, lawLabel: string, texte: string): Promise<{
  situation: string; principe: string; consequence: string
} | null> {
  try {
    const raw = await openRouterChat([
      {
        role: 'system',
        content: `Tu es juriste spécialisé en droit immobilier français.
Résume cet article de loi en 3 champs JSON stricts (pas de markdown) :
- situation : quand cet article s'applique (agent immobilier, acheteur, vendeur, locataire, etc.)
- principe : la règle ou obligation principale
- consequence : ce qui se passe si non-respecté ou l'effet pratique
Réponds UNIQUEMENT avec du JSON valide : {"situation":"...","principe":"...","consequence":"..."}`,
      },
      {
        role: 'user',
        content: `Article ${articleNum} — ${lawLabel}\n\n${texte.slice(0, 2000)}`,
      },
    ], MODELS.FILTER, 300)

    const parsed = JSON.parse(raw.trim())
    if (!parsed.situation || !parsed.principe) return null
    return parsed
  } catch {
    return null
  }
}

// ── 6. Embedding Nomic ────────────────────────────────────────────────────

async function embedText(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(NOMIC_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOMIC_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'nomic-embed-text-v1.5', texts: [text] }),
    })
    if (!res.ok) return null
    const data = await res.json() as { embeddings: number[][] }
    return data.embeddings?.[0] ?? null
  } catch {
    return null
  }
}

// ── 7. Auto-index jurisprudence ───────────────────────────────────────────

const JUDILIBRE_API_URL = process.env.PISTE_ENV === 'sandbox'
  ? 'https://sandbox-api.piste.gouv.fr/cassation/judilibre/v1.0'
  : 'https://api.piste.gouv.fr/cassation/judilibre/v1.0'

interface CaseRef {
  court: 'cass' | 'ca'
  number: string  // ex: "18-25.147"
}

function extractCaseReferences(text: string): CaseRef[] {
  const refs: CaseRef[] = []
  const seen = new Set<string>()

  // "Cass. civ. 3e, ... n° 18-25.147" / "Cass. com., ... n° 20-11.547"
  const cassPattern = /Cass\.\s*(?:civ\.\s*\d+e?|com\.|soc\.|crim\.|ass\.\s*plén\.)[^n°]*?n°\s*([\d]{2}-[\d]{2,5}\.[\d]{3,5})/gi
  for (const m of text.matchAll(cassPattern)) {
    const number = m[1].trim()
    if (!seen.has(number)) { seen.add(number); refs.push({ court: 'cass', number }) }
  }

  // Numéro seul : "n° 18-25.147" (hors contexte Cass. déjà capturé)
  const genericPattern = /\bn°\s*([\d]{2}-[\d]{2,5}\.[\d]{3,5})\b/gi
  for (const m of text.matchAll(genericPattern)) {
    const number = m[1].trim()
    if (!seen.has(number)) { seen.add(number); refs.push({ court: 'cass', number }) }
  }

  return refs
}

async function fetchDecisionFromJudilibre(token: string, number: string): Promise<{
  text: string; date: string; url: string; id: string
} | null> {
  try {
    // Essayer d'abord par filtre `number` (exact), puis par `query` full-text
    // Le live search utilise query= et trouve 09-10.218 — number= échoue si format non exact
    const searchAttempts: Array<[string, string]> = [
      ['number', number],                          // filtre exact "09-10.218"
      ['number', number.replace(/\./g, '-')],      // "09-10-218"
      ['query',  number],                          // full-text "09-10.218"
      ['query',  number.replace(/[-\.]/g, ' ')],   // full-text "09 10 218"
    ]

    let id: string | undefined
    for (const [param, value] of searchAttempts) {
      const url = new URL(`${JUDILIBRE_API_URL}/search`)
      url.searchParams.set(param, value)
      url.searchParams.set('page_size', '1')

      const searchRes = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      })
      if (!searchRes.ok) continue
      const searchData = await searchRes.json() as { results?: Array<{ id: string }> }
      id = searchData.results?.[0]?.id
      if (id) {
        console.info(`[auto-indexer] Judilibre hit avec ${param}=${value}`)
        break
      }
    }
    if (!id) return null

    const decUrl = new URL(`${JUDILIBRE_API_URL}/decision`)
    decUrl.searchParams.set('id', id)
    decUrl.searchParams.set('resolve_references', 'false')
    const decRes = await fetch(decUrl.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!decRes.ok) return null
    const dec = await decRes.json() as {
      id: string
      decision_date?: string
      zones?: { motivations?: Array<{ text: string }>; sommaire?: Array<{ text: string }> }
      text?: string
      summary?: string
    }

    const motivations = (dec.zones?.motivations ?? []).map(z => z.text).join('\n').trim()
    const sommaire    = (dec.zones?.sommaire ?? []).map(z => z.text).join('\n').trim()
    const fullText    = motivations || sommaire || dec.text?.slice(0, 3000) || dec.summary || ''
    if (fullText.length < 50) return null

    return {
      id: dec.id,
      text: fullText,
      date: dec.decision_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      url: `https://www.judilibre.io/#cass/judilibre/${dec.id}`,
    }
  } catch {
    return null
  }
}

async function summarizeJurisprudence(number: string, text: string): Promise<{
  situation: string; principe: string; consequence: string
} | null> {
  try {
    const raw = await openRouterChat([
      {
        role: 'system',
        content: `Tu es juriste spécialisé en droit immobilier français.
Résume cet arrêt en 3 champs JSON stricts (pas de markdown) :
- situation : les faits et le contexte procédural
- principe : la règle de droit dégagée par la juridiction
- consequence : l'effet pratique pour un agent immobilier ou praticien
Réponds UNIQUEMENT avec du JSON valide : {"situation":"...","principe":"...","consequence":"..."}`,
      },
      {
        role: 'user',
        content: `Arrêt n° ${number}\n\n${text.slice(0, 2000)}`,
      },
    ], MODELS.FILTER, 300)

    const parsed = JSON.parse(raw.trim())
    if (!parsed.situation || !parsed.principe) return null
    return parsed
  } catch {
    return null
  }
}

export async function autoIndexMissingJurisprudence(
  responseText: string,
  chunksFound: number,
): Promise<void> {

  const refs = extractCaseReferences(responseText)
  if (refs.length === 0) return

  const token = await getPisteToken()
  if (!token) {
    console.warn('[auto-indexer] Token PISTE indisponible — skip jurisprudence')
    return
  }

  for (const ref of refs) {
    try {
      const { count } = await supabase
        .from('jurisprudence')
        .select('*', { count: 'exact', head: true })
        .ilike('number', ref.number)

      if ((count ?? 0) > 0) continue

      const decision = await fetchDecisionFromJudilibre(token, ref.number)
      if (!decision) {
        console.warn(`[auto-indexer] Arrêt n° ${ref.number} introuvable sur Judilibre`)
        continue
      }

      const summary = await summarizeJurisprudence(ref.number, decision.text)
      if (!summary) continue

      const embeddingText = `${summary.situation} ${summary.principe} ${summary.consequence}`
      const embedding = await embedText(embeddingText)
      if (!embedding) continue

      const { error } = await supabase.from('jurisprudence').upsert({
        source_id:       decision.id,
        court:           ref.court === 'cass' ? 'cc' : 'ca',
        number:          ref.number,
        date:            decision.date,
        situation:       summary.situation,
        principle:       summary.principe,
        consequence:     summary.consequence,
        holding:         summary.principe,
        motivations_raw: decision.text.slice(0, 5000),
        domain:          'auto_indexed',
        sub_themes:      [],
        url:             decision.url,
        embedding,
      }, { onConflict: 'source_id' })

      if (error) {
        console.error(`[auto-indexer] Upsert juri ${ref.number}:`, error.message)
      } else {
        console.info(`[auto-indexer] ✅ Jurisprudence indexée : ${ref.court} n° ${ref.number}`)
      }
    } catch (err) {
      console.error(`[auto-indexer] Erreur juri ${ref.number}:`, err)
    }
  }
}

// ── 8. Pipeline complet auto-index ────────────────────────────────────────

export async function autoIndexMissingArticles(
  responseText: string,
  chunksFound: number,
): Promise<void> {
  console.info(`[auto-indexer] Appelé — responseText=${responseText.length} chars, chunks=${chunksFound}`)

  // Nettoyer le markdown avant l'extraction — évite de capturer **bold** ou *note* comme nom de loi
  const cleanText = responseText
    .replace(/\*\*([^*]+)\*\*/g, '$1')           // **bold** → bold
    .replace(/\*([^*]+)\*/g, '$1')               // *italic* → italic
    .replace(/__([^_]+)__/g, '$1')               // __bold__ → bold
    .replace(/#{1,3}\s/g, '')                    // ### headers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')    // [text](url) → text

  console.info(`[auto-indexer] Texte à analyser (500 premiers chars) : ${cleanText.slice(0, 500)}`)
  console.info(`[auto-indexer] Matches bruts :`, JSON.stringify(
    [...cleanText.matchAll(/art(?:icle)?\.?\s*([\w\d.\-\s]+?)(?:\s+(?:du|de la|de l')|[),;])/gi)]
      .map(m => m[0].slice(0, 60))
  ))

  const refs = extractArticleReferences(cleanText)
  console.info(`[auto-indexer] Références trouvées : ${refs.map(r => `${r.law} art. ${r.article}`).join(', ') || 'aucune'}`)

  const token = await getPisteToken()
  if (!token) {
    console.warn('[auto-indexer] Token PISTE indisponible — skip')
    return
  }

  for (const ref of refs) {
    if (!ref.legitextId) {
      console.info(`[auto-indexer] Loi inconnue pour "${ref.law}" art. ${ref.article} — skip`)
      continue
    }

    try {
      // Vérif existence
      if (await isIndexed(ref.legitextId, ref.article)) continue

      // Chercher le LEGIARTI ID
      const legiartiId = await findLegiartiId(token, ref.legitextId, ref.article)
      if (!legiartiId) {
        console.warn(`[auto-indexer] LEGIARTI introuvable : ${ref.law} art. ${ref.article}`)
        continue
      }

      // Fetch texte
      const articleData = await fetchArticleText(token, legiartiId)
      if (!articleData) continue

      // Résumé LLM
      const summary = await summarizeArticle(ref.article, ref.law, articleData.texte)
      if (!summary) continue

      // Embedding
      const embeddingText = `${summary.situation} ${summary.principe} ${summary.consequence}`
      const embedding = await embedText(embeddingText)
      if (!embedding) continue

      // Upsert
      const { error } = await supabase
        .from('legal_articles')
        .upsert({
          law_id:          ref.legitextId,
          article_num:     ref.article,
          title:           `Art. ${ref.article} — ${ref.law}`,
          content:         articleData.texte,
          content_summary: JSON.stringify(summary),
          date_version:    new Date().toISOString().split('T')[0],
          url:             articleData.url,
          domain:          'auto_indexed',
          sub_themes:      [],
          in_force:        true,
          embedding,
        }, { onConflict: 'law_id,article_num' })

      if (error) {
        console.error(`[auto-indexer] Upsert error ${ref.law} art. ${ref.article}:`, error.message)
      } else {
        console.info(`[auto-indexer] ✅ Indexé : ${ref.law} art. ${ref.article}`)
      }
    } catch (err) {
      console.error(`[auto-indexer] Erreur ${ref.law} art. ${ref.article}:`, err)
    }
  }
}
