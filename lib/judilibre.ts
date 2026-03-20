// lib/judilibre.ts
// Client PISTE — API JUDILIBRE (Cour de cassation)
// Pipeline : détection thème → /search filtres officiels → /decision (top 2) → zones + visa

const isSandbox = process.env.PISTE_ENV === 'sandbox'
const TOKEN_URL = isSandbox
  ? 'https://sandbox-oauth.piste.gouv.fr/api/oauth/token'
  : 'https://oauth.piste.gouv.fr/api/oauth/token'
const API_URL = isSandbox
  ? 'https://sandbox-api.piste.gouv.fr/cassation/judilibre/v1.0'
  : 'https://api.piste.gouv.fr/cassation/judilibre/v1.0'

// ---------------------------------------------------------------------------
// Fetch avec timeout AbortController (5s par défaut)
// ---------------------------------------------------------------------------

function fetchWithTimeout(url: string | URL, init: RequestInit = {}, ms = 5000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

// ---------------------------------------------------------------------------
// Token OAuth2 (cache module-level)
// ---------------------------------------------------------------------------

let cachedToken: string | null = null
let tokenExpiry = 0

async function getJudilibreToken(): Promise<string | null> {
  const { PISTE_CLIENT_ID, PISTE_CLIENT_SECRET } = process.env
  if (!PISTE_CLIENT_ID || !PISTE_CLIENT_SECRET) return null
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken

  try {
    const res = await fetchWithTimeout(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: PISTE_CLIENT_ID,
        client_secret: PISTE_CLIENT_SECRET,
        scope: 'openid',
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as { access_token: string; expires_in: number }
    cachedToken = data.access_token
    tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
    return cachedToken
  } catch (err) {
    console.error('[judilibre] getToken — erreur :', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface VisaRef {
  law: string    // ex: '89-462'
  artNum: string // ex: '24'
}

export interface JudilibreContext {
  available: boolean
  text: string
  decisions: any[]
  visaRefs: VisaRef[]
}

// ---------------------------------------------------------------------------
// Détection de thème + sub-queries affinées
// ---------------------------------------------------------------------------

interface ThemeEntry {
  triggers: string[]
  theme: string
  chamber: string
}

const THEME_MAP: ThemeEntry[] = [
  {
    triggers: ['bail', 'loyer', 'locataire', 'location', 'congé', 'dépôt', 'impayé',
               'commandement', 'expulsion', 'trêve', 'clause résolutoire'],
    theme: "bail d'habitation",
    chamber: 'civ3',
  },
  {
    triggers: ['copropriété', 'syndic', 'assemblée générale', 'charges', 'tantièmes'],
    theme: 'copropriété',
    chamber: 'civ3',
  },
  {
    triggers: ['agent immobilier', 'mandat', 'honoraires', 'hoguet', 'devoir de conseil'],
    theme: 'agent immobilier',
    chamber: 'civ1',
  },
  {
    triggers: ['vente', 'compromis', 'promesse', 'vices cachés', 'condition suspensive',
               'acheteur', 'vendeur'],
    theme: 'vente immobilière',
    chamber: 'civ3',
  },
  {
    triggers: ['urbanisme', 'permis', 'plu', 'zan', 'préemption'],
    theme: 'urbanisme',
    chamber: 'civ3',
  },
  {
    triggers: ['construction', 'vefa', 'décennale', 'biennale'],
    theme: 'construction immobilière',
    chamber: 'civ3',
  },
  {
    triggers: ['bail commercial', 'fonds de commerce'],
    theme: 'bail commercial',
    chamber: 'comm',
  },
  {
    triggers: ['usufruit', 'démembrement', 'nue-propriété', 'viager', 'rente'],
    theme: 'vente immobilière',
    chamber: 'civ3',
  },
]

interface DetectedTheme {
  theme: string
  chamber: string
  query?: string
  noDateFilter?: boolean
  publications?: string[]
}

function detectTheme(question: string): DetectedTheme | null {
  if (question.trim().split(/\s+/).length < 8) return null
  const lower = question.toLowerCase()

  // Sub-queries affinées — agent immobilier (prioritaire, arrêts de référence dès 1997)
  if (lower.includes('agent immobilier') || lower.includes('devoir de conseil') || lower.includes('responsabilité agent') || lower.includes('conseil agent')) {
    return { theme: 'agent immobilier', chamber: 'civ1', query: 'agent immobilier obligation information conseil responsabilité', noDateFilter: true, publications: ['b', 'r', 'l'] }
  }

  // Sub-queries affinées — vente immobilière (prioritaires sur le match générique)
  if (lower.includes('vices cachés') || lower.includes('vice caché') || lower.includes('défaut caché')) {
    return { theme: 'vente immobilière', chamber: 'civ3', query: 'vices cachés garantie immeuble acheteur' }
  }
  if (lower.includes('condition suspensive') || lower.includes('refus de prêt') || lower.includes('obtention du prêt')) {
    return { theme: 'vente immobilière', chamber: 'civ3', query: 'condition suspensive prêt immobilier refus' }
  }
  if (lower.includes('rétractation') || lower.includes('délai de réflexion')) {
    return { theme: 'vente immobilière', chamber: 'civ3', query: 'droit rétractation acquéreur vente immobilière délai' }
  }
  if ((lower.includes('promesse') || lower.includes('compromis')) && !lower.includes('bail')) {
    return { theme: 'vente immobilière', chamber: 'civ3', query: 'promesse vente compromis caducité inexécution' }
  }

  // Match général sur THEME_MAP
  for (const entry of THEME_MAP) {
    if (entry.triggers.some(t => lower.includes(t))) {
      return { theme: entry.theme, chamber: entry.chamber }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// parseVisaRefs : visa[].title → VisaRef[]
// ---------------------------------------------------------------------------

function parseVisaRefs(visaList: Array<{ title?: string }>): VisaRef[] {
  const refs: VisaRef[] = []
  for (const visa of visaList) {
    const title = visa.title ?? ''
    const lawMatch = title.match(/(\d{2,4}-\d{3,4})/)
    const artMatch = title.match(/art(?:icle)?\s*\.?\s*(\d+[\w-]*)/i)
    if (lawMatch && artMatch) {
      refs.push({ law: lawMatch[1], artNum: artMatch[1] })
    }
  }
  return refs
}

// ---------------------------------------------------------------------------
// extractZoneText : découpe le texte brut via les offsets de zones
// ---------------------------------------------------------------------------

function extractZoneText(detail: any, zoneName: string, maxChars: number): string {
  const segments: Array<{ start: number; end: number }> | undefined = detail?.zones?.[zoneName]
  if (!Array.isArray(segments) || segments.length === 0) return ''
  const fullText: string = detail?.text ?? ''
  const combined = segments.map(seg => fullText.slice(seg.start, seg.end)).join('\n')
  return combined.slice(0, maxChars)
}

// ---------------------------------------------------------------------------
// Étape 1 — /search
// ---------------------------------------------------------------------------

async function searchDecisions(
  token: string,
  query: string,
  theme: string,
  chamber: string,
  withFilters: boolean,
  publications?: string[],
  noDateFilter?: boolean,
): Promise<Array<{ id: string }>> {
  const url = new URL(`${API_URL}/search`)
  url.searchParams.set('query', query)
  url.searchParams.set('theme', theme)
  url.searchParams.set('chamber', chamber)
  if (withFilters) {
    const pubs = publications ?? ['b', 'r']
    for (const p of pubs) url.searchParams.append('publication', p)
    if (!noDateFilter) url.searchParams.set('date_start', '2018-01-01')
  }
  url.searchParams.set('operator', 'and')
  url.searchParams.set('page_size', '3')
  url.searchParams.set('resolve_references', 'true')

  const res = await fetchWithTimeout(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  }).catch((err: unknown) => {
    console.error(`[judilibre] /search timeout/erreur :`, err)
    return null
  })
  if (!res || !res.ok) {
    if (res) console.error(`[judilibre] /search HTTP ${res.status}`)
    return []
  }

  const data = await res.json() as { results?: Array<{ id: string }>; total?: number }
  const pubsLabel = withFilters ? ` publication=${(publications ?? ['b', 'r']).join(',')}${noDateFilter ? '' : ' date>=2018'}` : ' (sans filtres)'
  console.info(
    `[judilibre] theme='${theme}' chamber=${chamber}${pubsLabel} → ${data?.total ?? 0} résultats`
  )
  return data.results ?? []
}

// ---------------------------------------------------------------------------
// Étape 2 — /decision?id=xxx&resolve_references=true
// ---------------------------------------------------------------------------

async function fetchDecisionDetail(token: string, id: string, query?: string): Promise<any | null> {
  const url = new URL(`${API_URL}/decision`)
  url.searchParams.set('id', id)
  url.searchParams.set('resolve_references', 'true')
  if (query) {
    url.searchParams.set('query', query)
    url.searchParams.set('operator', 'and')
  }

  const res = await fetchWithTimeout(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  }).catch((err: unknown) => {
    console.error(`[judilibre] /decision timeout/erreur pour id=${id} :`, err)
    return null
  })
  if (!res || !res.ok) {
    if (res) console.error(`[judilibre] /decision HTTP ${res.status} pour id=${id}`)
    return null
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Extraction des passages text_highlight (décisions pré-2018 sans zones)
// ---------------------------------------------------------------------------

function extractHighlights(detail: any): string {
  const hl = detail?.text_highlight
  if (!hl) return ''

  // text_highlight peut être un objet {text:[...]}, un tableau ou une string
  const raw: string[] = []
  if (typeof hl === 'string') raw.push(hl)
  else if (Array.isArray(hl)) raw.push(...hl)
  else if (hl.text) raw.push(...(Array.isArray(hl.text) ? hl.text : [String(hl.text)]))

  const segments: string[] = []
  for (const s of raw) {
    const matches = [...String(s).matchAll(/<em>([\s\S]*?)<\/em>/g)]
    for (const m of matches) {
      const seg = m[1].slice(0, 200).trim()
      if (seg) segments.push(seg)
      if (segments.length >= 3) break
    }
    if (segments.length >= 3) break
  }

  if (segments.length > 0) {
    console.info(`[judilibre] text_highlight → ${segments.length} segments extraits`)
  }
  return segments.join(' … ')
}

// ---------------------------------------------------------------------------
// Formatage d'une décision pour injection dans le prompt
// ---------------------------------------------------------------------------

function formatDecision(detail: any): string {
  const header = [
    detail.number   ? `Arrêt n° ${detail.number}` : null,
    detail.decision_date ? detail.decision_date.slice(0, 10) : null,
    'Cour de cassation',
    detail.solution ?? null,
  ].filter(Boolean).join(' · ')

  const themes = (detail.themes ?? []).slice(0, 3).join(', ')
  const themesLine = themes ? `Matières : ${themes}` : null

  const motivations = extractZoneText(detail, 'motivations', 600)
  const dispositif  = extractZoneText(detail, 'dispositif',  200)

  // Fallback text_highlight pour décisions pré-2018 sans zones, sinon summary
  const body = motivations
    || extractHighlights(detail)
    || (detail.summary ? `Sommaire : ${detail.summary}` : '')

  const visaTitles: string[] = (detail.visa ?? [])
    .map((v: any) => v?.title ?? '')
    .filter(Boolean)
  const visaLine = visaTitles.length ? `Textes appliqués : ${visaTitles.join(' ; ')}` : null

  return [header, themesLine, body, dispositif || null, visaLine]
    .filter(Boolean)
    .join('\n')
}

// ---------------------------------------------------------------------------
// Point d'entrée public
// ---------------------------------------------------------------------------

export async function fetchJurisprudence(question: string): Promise<JudilibreContext> {
  const token = await getJudilibreToken()
  if (!token) return { available: false, text: '', decisions: [], visaRefs: [] }

  const detected = detectTheme(question)
  if (!detected) {
    console.info('[judilibre] Aucun thème détecté — pas de jurisprudence')
    return { available: true, text: '', decisions: [], visaRefs: [] }
  }

  const { theme, chamber, query: refinedQuery, noDateFilter, publications } = detected
  const searchQuery = refinedQuery ?? question

  try {
    // Recherche avec filtres stricts, retry sans filtres si 0 résultat
    let hits = await searchDecisions(token, searchQuery, theme, chamber, true, publications, noDateFilter)
    if (hits.length === 0) {
      hits = await searchDecisions(token, searchQuery, theme, chamber, false)
    }
    if (hits.length === 0) {
      return { available: true, text: '', decisions: [], visaRefs: [] }
    }

    // Détail des 2 meilleurs résultats en parallèle (query active text_highlight)
    const top2 = hits.slice(0, 2)
    const details = (
      await Promise.all(top2.map(h => fetchDecisionDetail(token, h.id, searchQuery)))
    ).filter(Boolean)

    const allVisaRefs: VisaRef[] = []
    const formattedBlocks: string[] = []

    for (const detail of details) {
      const visaRefs = parseVisaRefs(detail.visa ?? [])
      const motivationsLen = extractZoneText(detail, 'motivations', 9999).length

      console.info(
        `[judilibre] décision n°${detail.number ?? '?'} ${detail.decision_date?.slice(0, 10) ?? '?'} ${detail.solution ?? '?'} zones=[motivations ${motivationsLen} chars] visa=[${visaRefs.map(v => `${v.law}/art.${v.artNum}`).join(', ') || '—'}]`
      )

      allVisaRefs.push(...visaRefs)
      formattedBlocks.push(formatDecision(detail))
    }

    const text = `Jurisprudence pertinente (source : JUDILIBRE / Cour de cassation) :\n\n${formattedBlocks.join('\n\n---\n\n')}`

    return {
      available: true,
      text,
      decisions: details,
      visaRefs: allVisaRefs,
    }
  } catch (err) {
    console.error('[judilibre] fetchJurisprudence — exception :', err)
    return { available: false, text: '', decisions: [], visaRefs: [] }
  }
}
