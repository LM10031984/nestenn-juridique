// lib/auto-indexer.ts
// Indexation automatique des articles cités par le LLM mais absents de pgvector
// Fire-and-forget : appelé depuis route.ts après le streaming, sans bloquer la réponse

import { createClient } from '@supabase/supabase-js'
import { openRouterChat, MODELS } from '@/lib/openrouter'
import { FEATURES } from '@/lib/config'
import { handleUnclassifiedArticle } from '@/lib/pending-domains'

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
  'environnement':      'LEGITEXT000006074220',
  'code environnement': 'LEGITEXT000006074220',
  'code env':           'LEGITEXT000006074220',
  'env':                'LEGITEXT000006074220',
}

// ── 1. Extraction des références d'articles ──────────────────────────────

interface ArticleRef {
  law: string
  article: string
  legitextId: string | null
}

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

function findLawInText(text: string, articlePosition: number): { name: string; legitext: string } | null {
  const lower = text.toLowerCase()
  const beforeStart = Math.max(0, articlePosition - 150)
  const afterEnd = Math.min(lower.length, articlePosition + 150)
  const beforeZone = lower.slice(beforeStart, articlePosition)
  const afterZone = lower.slice(articlePosition, afterEnd)

  let best: { name: string; legitext: string } | null = null
  let bestDist = Infinity

  for (const [name, legitext] of Object.entries(KNOWN_LAWS)) {
    const bi = beforeZone.lastIndexOf(name)
    if (bi !== -1) {
      const dist = beforeZone.length - bi - name.length
      if (dist < bestDist) { bestDist = dist; best = { name, legitext } }
    }
    const ai = afterZone.indexOf(name)
    if (ai !== -1) {
      if (ai < bestDist) { bestDist = ai; best = { name, legitext } }
    }
  }

  if (best) return best

  const searchZone = beforeZone + ' ' + afterZone
  const lawNumMatch = searchZone.match(/loi\s+n[o°]?\s*([\d]{2,4}-[\d]+)/)
  if (lawNumMatch) {
    const resolved = resolveLegitext(`loi ${lawNumMatch[1]}`)
    if (resolved) return { name: `loi ${lawNumMatch[1]}`, legitext: resolved }
  }

  return null
}

export function extractArticleReferences(text: string): ArticleRef[] {
  const refs: ArticleRef[] = []
  const seen = new Set<string>()

  const articlePattern = /\bart(?:icle)?\.?\s*([LRDA]\.?\s*\d[\d.\-]+(?:\s+[A-Z]+(?:\s+[IVX]+)?(?:\s+\d+°?)?)?|\d[\d.\-]*(?:\s+[A-Z][a-z]*)?(?:\s+[A-Z]+(?:\s+[IVX]+)?(?:\s+\d+°?)?)?)/gi

  for (const match of text.matchAll(articlePattern)) {
    const article = match[1]
      .trim()
      .replace(/^([LRDA])\.\s+/, '$1.')
      .replace(/\s+(de|du|des|la|le|les|l'|et|à|au|aux)\b.*$/i, '')
      .trim()
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

// ── 4. Fetch article ──────────────────────────────────────────────────────

const CODE_NAMES: Record<string, string> = {
  'LEGITEXT000006070721': 'Code civil',
  'LEGITEXT000006074096': "Code de la construction et de l'habitation",
  'LEGITEXT000006074075': "Code de l'urbanisme",
  'LEGITEXT000006069565': 'Code de la consommation',
  'LEGITEXT000006069577': 'Code général des impôts',
  'LEGITEXT000006070716': 'Code de procédure civile',
  'LEGITEXT000025024948': "Code des procédures civiles d'exécution",
  'LEGITEXT000006074220': "Code de l'environnement",
  'LEGITEXT000005634379': 'Code de commerce',
  'LEGITEXT000006072665': 'Code de la santé publique',
}

function collectSectionArticles(node: { articles?: Array<{ id: string; num: string }>; sections?: unknown[] }, out: Array<{ id: string; num: string }> = []): Array<{ id: string; num: string }> {
  for (const art of (node?.articles ?? [])) {
    if (art.id) out.push({ id: art.id, num: art.num ?? '' })
  }
  for (const sub of (node?.sections ?? [])) collectSectionArticles(sub as typeof node, out)
  return out
}

function getArticleCandidates(articleNum: string): string[] {
  const noDot = articleNum.replace(/^([LRDA])\./, '$1')
  const base = noDot !== articleNum ? [articleNum, noDot] : [articleNum]
  const parts = noDot.split(/\s+/)
  const shorterVariants: string[] = []
  for (let i = parts.length - 1; i >= 1; i--) {
    shorterVariants.push(parts.slice(0, i).join(' '))
  }
  return [...new Set([...base, ...shorterVariants])]
}

async function findLegiartiId(token: string, legitextId: string, articleNum: string): Promise<string | null> {
  const today = new Date().toISOString().split('T')[0]
  const candidates = getArticleCandidates(articleNum)

  for (const candidate of candidates) {
    try {
      console.info(`[auto-indexer] tableMatieres : textId=${legitextId} searchArticle=${candidate}`)
      const res = await fetch(`${PISTE_API_BASE}/consult/code/tableMatieres`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ textId: legitextId, date: today, pageSize: 200, searchArticle: candidate }),
        signal: AbortSignal.timeout(12000),
      })
      if (res.ok) {
        const data = await res.json() as { sections?: unknown[] }
        const allArts = collectSectionArticles({ sections: data.sections ?? [] })
        console.info(`[auto-indexer] tableMatieres retourne ${allArts.length} articles (searchArticle=${candidate})`)
        const found = allArts.find(a => candidates.includes(a.num))
        if (found) { console.info(`[auto-indexer] LEGIARTI trouvé : ${found.id}`); return found.id }
      } else if (res.status === 400) {
        console.info(`[auto-indexer] tableMatieres HTTP 400, fallback getArticleWithIdAndNum (textId=${legitextId} articleNum=${candidate})`)
        try {
          const fallbackRes = await fetch(`${PISTE_API_BASE}/consult/getArticleWithIdAndNum`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ textId: legitextId, articleNum: candidate }),
            signal: AbortSignal.timeout(12000),
          })
          if (fallbackRes.ok) {
            const data = await fallbackRes.json() as { article?: { id?: string; etat?: string } }
            if (data.article?.id && data.article?.etat !== 'ABROGE') {
              console.info(`[auto-indexer] getArticleWithIdAndNum trouvé : ${data.article.id}`)
              return data.article.id
            }
          } else {
            console.warn(`[auto-indexer] getArticleWithIdAndNum HTTP ${fallbackRes.status}`)
          }
        } catch (e) { console.warn('[auto-indexer] getArticleWithIdAndNum erreur :', e) }
        break
      } else {
        console.warn(`[auto-indexer] tableMatieres HTTP ${res.status}`)
      }
    } catch (e) { console.warn('[auto-indexer] tableMatieres erreur :', e) }
  }

  const codeName = CODE_NAMES[legitextId]
  if (codeName) {
    for (const candidate of candidates) {
      try {
        console.info(`[auto-indexer] /search fallback : articleNum=${candidate} codeName=${codeName}`)
        const res = await fetch(`${PISTE_API_BASE}/search`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fond: 'CODE_DATE',
            recherche: {
              champs: [{ typeChamp: 'NUM_ARTICLE', criteres: [{ typeRecherche: 'EXACTE', valeur: candidate, operateur: 'ET' }], operateur: 'ET' }],
              filtres: [{ facette: 'TEXT_LEGAL_STATUS', valeur: 'VIGUEUR' }, { facette: 'NOM_CODE', valeur: codeName }],
              pageNumber: 1, pageSize: 5, operateur: 'ET', typePagination: 'DEFAUT',
            },
          }),
          signal: AbortSignal.timeout(12000),
        })
        if (res.ok) {
          const data = await res.json() as { results?: Array<{ sections?: Array<{ extracts?: Array<{ id: string }> }> }> }
          const artId = data.results?.[0]?.sections?.[0]?.extracts?.[0]?.id
          if (artId) { console.info(`[auto-indexer] /search LEGIARTI trouvé : ${artId} (candidate=${candidate})`); return artId }
          console.warn(`[auto-indexer] /search : aucun résultat (candidate=${candidate})`)
        }
      } catch (e) { console.warn('[auto-indexer] /search erreur :', e) }
    }
  }

  return null
}

async function fetchArticleFromLegifrance(
  token: string,
  legitextId: string,
  articleNum: string,
): Promise<{ texte: string; url: string } | null> {
  const legiartiId = await findLegiartiId(token, legitextId, articleNum)
  if (!legiartiId) return null

  try {
    const res = await fetch(`${PISTE_API_BASE}/consult/getArticle`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: legiartiId }),
    })
    if (!res.ok) { console.warn(`[auto-indexer] getArticle HTTP ${res.status}`); return null }
    const data = await res.json() as { article?: { texte?: string; etat?: string } }
    if (data.article?.etat === 'ABROGE') return null
    const texte = data.article?.texte?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? ''
    if (texte.length < 20) return null
    return { texte, url: `https://www.legifrance.gouv.fr/codes/article_lc/${legiartiId}` }
  } catch {
    return null
  }
}

// ── 5. Classification domaine ─────────────────────────────────────────────
// NOTE : fiscalite est conservé pour rétro-compatibilité avec les articles déjà indexés.
// Les nouveaux articles fiscaux doivent être classés dans fiscalite_investisseurs.

const VALID_DOMAINS = [
  // Domaines existants
  'baux_habitation', 'gestion_locative',
  'copropriete', 'syndic_copropriete',
  'agent_immobilier',
  'vente_immobiliere', 'diagnostics', 'construction',
  'urbanisme', 'bail_commercial', 'viager_demembrement',
  // Rétro-compat (anciens articles déjà indexés)
  'fiscalite', 'servitudes', 'litiges',
  // Nouveaux domaines V1
  'droit_social_immo', 'fiscalite_investisseurs', 'sci_patrimoine',
  // Nouveaux domaines V2
  'responsabilite_agent', 'location_touristique', 'environnement_immo',
  // Nouveaux domaines V3
  'conformite_lcb_ft', 'rgpd_agence',
]

export async function classifyArticleDomain(
  text: string,
  article?: { id: string; content: string; title: string },
): Promise<string> {
  try {
    const result = await openRouterChat([{
      role: 'user',
      content: `Classe cet article de loi dans UN seul de ces domaines. Réponds uniquement avec le domaine exact (un seul mot, pas d'explication) :
baux_habitation, gestion_locative, copropriete, syndic_copropriete, agent_immobilier, vente_immobiliere, diagnostics, construction, urbanisme, bail_commercial, viager_demembrement, droit_social_immo, fiscalite_investisseurs, sci_patrimoine, responsabilite_agent, location_touristique, environnement_immo, conformite_lcb_ft, rgpd_agence, fiscalite, servitudes, litiges

Texte : ${text.slice(0, 500)}

Domaine :`,
    }], MODELS.FILTER, 20)
    const domain = result.trim().toLowerCase().replace(/[^a-z_]/g, '')

    if (VALID_DOMAINS.includes(domain)) {
      return domain
    }

    // Domaine non reconnu → article non classifiable avec confiance suffisante
    if (FEATURES.DYNAMIC_DOMAINS && article) {
      const scores: Record<string, number> = {}
      VALID_DOMAINS.forEach(d => { scores[d] = 0 })
      void handleUnclassifiedArticle(article, { scores }).catch(err => {
        console.error('[auto-indexer] handleUnclassifiedArticle failed:', err)
      })
    }

    return 'autres'
  } catch {
    return 'autres'
  }
}

// ── 6. Summarize (GPT-4o-mini) ────────────────────────────────────────────

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

// ── 7. Embedding Nomic ────────────────────────────────────────────────────

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

// ── 8. Auto-index jurisprudence ───────────────────────────────────────────

const JUDILIBRE_API_URL = process.env.PISTE_ENV === 'sandbox'
  ? 'https://sandbox-api.piste.gouv.fr/cassation/judilibre/v1.0'
  : 'https://api.piste.gouv.fr/cassation/judilibre/v1.0'

interface CaseRef {
  court: 'cass' | 'ca'
  number: string
}

function extractCaseReferences(text: string): CaseRef[] {
  const refs: CaseRef[] = []
  const seen = new Set<string>()

  const cassPattern = /Cass\.\s*(?:civ\.\s*\d+e?|com\.|soc\.|crim\.|ass\.\s*plén\.)[^n°]*?n°\s*([\d]{2}-[\d]{2,5}\.[\d]{3,5})/gi
  for (const m of text.matchAll(cassPattern)) {
    const number = m[1].trim()
    if (!seen.has(number)) { seen.add(number); refs.push({ court: 'cass', number }) }
  }

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
    const searchAttempts: Array<[string, string]> = [
      ['number', number],
      ['number', number.replace(/\./g, '-')],
      ['query',  number],
      ['query',  number.replace(/[-\.]/g, ' ')],
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

        void supabase.from('auto_index_queue').upsert({
          source: 'jurisprudence',
          case_number: ref.number,
          court: ref.court,
          error_reason: 'Judilibre introuvable',
          next_retry_at: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
        }, { onConflict: 'source,case_number' })

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
        domain:          await classifyArticleDomain(decision.text),
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

// ── 9. Pipeline complet auto-index ────────────────────────────────────────

export async function autoIndexMissingArticles(
  responseText: string,
  chunksFound: number,
): Promise<void> {
  console.info(`[auto-indexer] Appelé — responseText=${responseText.length} chars, chunks=${chunksFound}`)

  const cleanText = responseText
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/#{1,3}\s/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  console.info(`[auto-indexer] Texte à analyser (500 premiers chars) : ${cleanText.slice(0, 500)}`)
  console.info(`[auto-indexer] Matches bruts :`, JSON.stringify(
    [...cleanText.matchAll(/\bart(?:icle)?\.?\s*([\w\d.\-\s]+?)(?:\s+(?:du|de la|de l')|[),;])/gi)]
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
      if (await isIndexed(ref.legitextId, ref.article)) continue

      const articleData = await fetchArticleFromLegifrance(token, ref.legitextId, ref.article)
      if (!articleData) {
        console.warn(`[auto-indexer] Article introuvable : ${ref.law} art. ${ref.article}`)

        void supabase.from('auto_index_queue').upsert({
          source: 'article',
          law_name: ref.law,
          legitext_id: ref.legitextId,
          article_num: ref.article,
          error_reason: 'LEGIARTI introuvable',
          next_retry_at: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
        }, { onConflict: 'source,legitext_id,article_num' })

        continue
      }

      const summary = await summarizeArticle(ref.article, ref.law, articleData.texte)
      if (!summary) continue

      const embeddingText = `${summary.situation} ${summary.principe} ${summary.consequence}`
      const embedding = await embedText(embeddingText)
      if (!embedding) continue

      const detectedDomain = await classifyArticleDomain(articleData.texte)
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
          domain:          detectedDomain,
          domains:         [detectedDomain],
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