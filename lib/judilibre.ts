// lib/judilibre.ts
// Client PISTE — API JUDILIBRE
// Pipeline double-piste CC+CA :
//   Piste CC → /search (publication=['b','r'], theme, operator='or', field=['summary','motivations']) → /decision top-2
//   Piste CA → /search (jurisdiction='ca', operator='and', field=['summary','motivations']) → summary direct
//   Fusion : CC en priorité, CA en complément

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

export interface NormalizedCase {
  court: 'cass' | 'ca'
  date: string
  number: string
  solution?: string
  holding: string        // premier principe dégagé (1 phrase max)
  authorityRank: number  // 1 = CC publiée, 2 = CC non-publiée, 3 = CA
  formattedText: string  // bloc texte complet pour injection narrative
}

export interface JudilibreContext {
  available: boolean
  text: string
  cases: NormalizedCase[]
  decisions: any[]
  visaRefs: VisaRef[]
}

// ---------------------------------------------------------------------------
// Détection de thème + sub-queries CC/CA affinées
// ---------------------------------------------------------------------------

interface ThemeEntry {
  triggers: string[]
  theme: string    // valeur exacte taxonomie CC (validée)
  chamber: string  // chambre CC
  caQuery?: string // query CA spécifique (optionnel)
}

// NOTE: "diagnostics immobiliers" supprimé — thème invalide dans la taxonomie CC
const THEME_MAP: ThemeEntry[] = [
  {
    triggers: ['bail', 'loyer', 'locataire', 'location', 'congé', 'dépôt', 'impayé',
               'commandement', 'expulsion', 'trêve', 'clause résolutoire',
               'vétusté', 'décence', 'logement décent'],
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
  ccQuery?: string       // query CC affinée (défaut = question brute)
  caQuery?: string       // query CA affinée (défaut = question brute)
  noDateFilter?: boolean
  publications?: string[]
  dpeSignal?: boolean    // true = pas de jurisprudence CC, CA uniquement date>=2022
}

function detectTheme(question: string): DetectedTheme | null {
  // Seuil réduit 8→5 mots pour déclencher la recherche
  if (question.trim().split(/\s+/).length < 5) return null
  const lower = question.toLowerCase()

  // DPE — jurisprudence CC inexistante (trop récent), CA ciblé date>=2022
  if (
    lower.includes('dpe') || lower.includes('diagnostic performance') ||
    lower.includes('diagnostiqueur') || lower.includes('diagnostic immobilier') ||
    lower.includes('opposable')
  ) {
    return {
      theme: 'vente immobilière',
      chamber: 'civ3',
      caQuery: 'responsabilité diagnostiqueur DPE',
      dpeSignal: true,
    }
  }

  // Commission agent / honoraires contestés — sous-cas prioritaire avant le thème générique
  if (
    (lower.includes('commission') || lower.includes('honoraires')) &&
    (lower.includes('agent') || lower.includes('mandat') || lower.includes('compromis') ||
     lower.includes('conteste') || lower.includes('contester') || lower.includes('vente'))
  ) {
    return {
      theme: 'agent immobilier',
      chamber: 'civ1',
      ccQuery: 'commission agent immobilier exigibilité mandat vente réalisation définitive',
      caQuery: 'commission agent immobilier honoraires contestation mandat compromis',
      noDateFilter: true,
      publications: ['b', 'r', 'l'],
    }
  }

  // Agent immobilier — arrêts de principe dès 1997, publications étendues
  if (
    lower.includes('agent immobilier') || lower.includes('devoir de conseil') ||
    lower.includes('responsabilité agent') || lower.includes('conseil agent')
  ) {
    return {
      theme: 'agent immobilier',
      chamber: 'civ1',
      ccQuery: 'agent immobilier obligation information conseil responsabilité',
      caQuery: 'agent immobilier obligation information conseil',
      noDateFilter: true,
      publications: ['b', 'r', 'l'],
    }
  }

  // Vente — sub-queries spécialisées
  if (lower.includes('vices cachés') || lower.includes('vice caché') || lower.includes('défaut caché')) {
    return {
      theme: 'vente immobilière', chamber: 'civ3',
      ccQuery: 'vices cachés garantie immeuble acheteur',
      caQuery: 'vice caché immeuble acheteur garantie',
    }
  }
  if (lower.includes('condition suspensive') || lower.includes('refus de prêt') || lower.includes('obtention du prêt')) {
    return {
      theme: 'vente immobilière', chamber: 'civ3',
      ccQuery: 'condition suspensive prêt immobilier refus',
      caQuery: 'condition suspensive prêt immobilier',
    }
  }
  if (lower.includes('rétractation') || lower.includes('délai de réflexion')) {
    return {
      theme: 'vente immobilière', chamber: 'civ3',
      ccQuery: 'droit rétractation acquéreur vente immobilière délai',
      caQuery: 'rétractation acquéreur délai vente',
    }
  }
  if ((lower.includes('promesse') || lower.includes('compromis')) && !lower.includes('bail')) {
    return {
      theme: 'vente immobilière', chamber: 'civ3',
      ccQuery: 'promesse vente compromis caducité inexécution',
      caQuery: 'promesse vente compromis inexécution',
    }
  }

  // Bail — sub-queries spécialisées
  if (lower.includes('vétusté') || lower.includes('dégradation') || lower.includes('état des lieux')) {
    return {
      theme: "bail d'habitation", chamber: 'civ3',
      ccQuery: 'vétusté dégradation locataire bail état des lieux',
      caQuery: 'vétusté dégradation locataire',
    }
  }
  if (lower.includes('clause résolutoire') || lower.includes('commandement') || lower.includes('impayé')) {
    return {
      theme: "bail d'habitation", chamber: 'civ3',
      ccQuery: 'clause résolutoire commandement payer loyer impayé',
      caQuery: 'clause résolutoire commandement loyer impayé',
    }
  }
  if (lower.includes('expulsion') || lower.includes('trêve hivernale')) {
    return {
      theme: "bail d'habitation", chamber: 'civ3',
      ccQuery: 'expulsion locataire trêve hivernale',
      caQuery: 'expulsion locataire trêve hivernale',
    }
  }

  // Match général sur THEME_MAP
  for (const entry of THEME_MAP) {
    if (entry.triggers.some(t => lower.includes(t))) {
      return { theme: entry.theme, chamber: entry.chamber, caQuery: entry.caQuery }
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
// extractHighlights : text_highlight pour décisions pré-2018 sans zones
// ---------------------------------------------------------------------------

function extractHighlights(detail: any): string {
  const hl = detail?.text_highlight
  if (!hl) return ''

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
// Piste CC — /search avec filtres publication + theme + field=['summary','motivations']
// operator='or' (validé comme optimal pour CC multi-mots)
// ---------------------------------------------------------------------------

async function searchCC(
  token: string,
  query: string,
  theme: string,
  chamber: string,
  publications: string[],
  noDateFilter: boolean,
): Promise<any[]> {
  const url = new URL(`${API_URL}/search`)
  url.searchParams.set('query', query)
  url.searchParams.set('theme', theme)
  url.searchParams.set('chamber', chamber)
  for (const p of publications) url.searchParams.append('publication', p)
  if (!noDateFilter) url.searchParams.set('date_start', '2018-01-01')
  url.searchParams.set('operator', 'or')
  url.searchParams.append('type', 'arret')
  url.searchParams.append('field', 'summary')
  url.searchParams.append('field', 'motivations')
  url.searchParams.set('page_size', '3')
  url.searchParams.set('resolve_references', 'true')

  const res = await fetchWithTimeout(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  }).catch((err: unknown) => {
    console.error('[judilibre] CC /search timeout :', err)
    return null
  })
  if (!res || !res.ok) {
    if (res) console.error(`[judilibre] CC /search HTTP ${res.status}`)
    return []
  }
  const data = await res.json() as { results?: any[]; total?: number; relaxed?: boolean }
  console.info(
    `[judilibre] CC theme='${theme}' chamber=${chamber} pub=${publications.join(',')} → ${data?.total ?? 0} résultats${data?.relaxed ? ' (relaxed)' : ''}`
  )
  return data.results ?? []
}

// ---------------------------------------------------------------------------
// Piste CC fallback — sans filtres publication/date (si 0 résultats stricts)
// ---------------------------------------------------------------------------

async function searchCCFallback(
  token: string,
  query: string,
  theme: string,
  chamber: string,
): Promise<any[]> {
  const url = new URL(`${API_URL}/search`)
  url.searchParams.set('query', query)
  url.searchParams.set('theme', theme)
  url.searchParams.set('chamber', chamber)
  url.searchParams.set('date_start', '2010-01-01')
  url.searchParams.set('operator', 'or')
  url.searchParams.append('type', 'arret')
  url.searchParams.append('field', 'summary')
  url.searchParams.append('field', 'motivations')
  url.searchParams.set('page_size', '3')
  url.searchParams.set('resolve_references', 'true')

  const res = await fetchWithTimeout(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  }).catch((err: unknown) => {
    console.error('[judilibre] CC fallback /search timeout :', err)
    return null
  })
  if (!res || !res.ok) return []
  const data = await res.json() as { results?: any[]; total?: number }
  console.info(`[judilibre] CC fallback theme='${theme}' → ${data?.total ?? 0} résultats`)
  return data.results ?? []
}

// ---------------------------------------------------------------------------
// Piste CA — /search avec jurisdiction='ca', operator='and'
// Pas de filtre theme ni publication (nomenclature NAC différente)
// ---------------------------------------------------------------------------

async function searchCA(
  token: string,
  query: string,
  dateStart?: string,
): Promise<any[]> {
  const url = new URL(`${API_URL}/search`)
  url.searchParams.set('query', query)
  url.searchParams.set('jurisdiction', 'ca')
  url.searchParams.set('operator', 'and')
  url.searchParams.append('type', 'arret')
  url.searchParams.append('field', 'summary')
  url.searchParams.append('field', 'motivations')
  if (dateStart) url.searchParams.set('date_start', dateStart)
  url.searchParams.set('page_size', '3')

  const res = await fetchWithTimeout(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  }).catch((err: unknown) => {
    console.error('[judilibre] CA /search timeout :', err)
    return null
  })
  if (!res || !res.ok) {
    if (res) console.error(`[judilibre] CA /search HTTP ${res.status}`)
    return []
  }
  const data = await res.json() as { results?: any[]; total?: number }
  console.info(`[judilibre] CA query='${query}'${dateStart ? ` date>=${dateStart}` : ''} → ${data?.total ?? 0} résultats`)
  return data.results ?? []
}

// ---------------------------------------------------------------------------
// /decision?id=xxx — détail complet (zones, visa) pour piste CC
// ---------------------------------------------------------------------------

async function fetchDecisionDetail(token: string, id: string, query?: string): Promise<any | null> {
  const url = new URL(`${API_URL}/decision`)
  url.searchParams.set('id', id)
  url.searchParams.set('resolve_references', 'true')
  if (query) {
    url.searchParams.set('query', query)
    url.searchParams.set('operator', 'or')
  }

  const res = await fetchWithTimeout(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  }).catch((err: unknown) => {
    console.error(`[judilibre] /decision timeout pour id=${id} :`, err)
    return null
  })
  if (!res || !res.ok) {
    if (res) console.error(`[judilibre] /decision HTTP ${res.status} pour id=${id}`)
    return null
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Formatage CC — zones motivations/dispositif depuis /decision
// ---------------------------------------------------------------------------

function formatDecision(detail: any): string {
  const header = [
    detail.number ? `Arrêt n° ${detail.number}` : null,
    detail.decision_date ? detail.decision_date.slice(0, 10) : null,
    'Cour de cassation',
    detail.solution ?? null,
  ].filter(Boolean).join(' · ')

  const themes = (detail.themes ?? []).slice(0, 3).join(', ')
  const themesLine = themes ? `Matières : ${themes}` : null

  const motivations = extractZoneText(detail, 'motivations', 600)
  const dispositif  = extractZoneText(detail, 'dispositif',  200)

  // Fallback : text_highlight pour pré-2018, puis summary
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
// Formatage CA — summary + highlights depuis searchResult (pas de /decision)
// ---------------------------------------------------------------------------

function formatCAResult(result: any): string {
  const header = [
    result.number ? `Arrêt n° ${result.number}` : null,
    result.decision_date ? result.decision_date.slice(0, 10) : null,
    "Cour d'appel",
    result.solution ?? null,
  ].filter(Boolean).join(' · ')

  // Préférer les highlights (fragments pertinents surlignés par l'API)
  let body = ''
  if (result.highlights) {
    for (const zone of ['motivations', 'summary', 'expose']) {
      const arr = result.highlights[zone]
      if (Array.isArray(arr) && arr.length > 0) {
        body = arr[0].replace(/<\/?em>/g, '').slice(0, 400)
        break
      }
    }
  }
  if (!body && result.summary) {
    body = `Sommaire : ${String(result.summary).slice(0, 400)}`
  }

  return [header, body].filter(Boolean).join('\n')
}

// ---------------------------------------------------------------------------
// Builders NormalizedCase
// ---------------------------------------------------------------------------

function extractHolding(detail: any): string {
  const motivations = extractZoneText(detail, 'motivations', 500)
  if (motivations) {
    const first = motivations.split(/\.\s+/)[0]?.trim() ?? ''
    return (first.length >= 20 ? first : motivations.slice(0, 200)).replace(/\s+/g, ' ') + '.'
  }
  const hl = extractHighlights(detail)
  if (hl) return hl.slice(0, 200)
  return detail.summary ? String(detail.summary).slice(0, 200) : ''
}

function buildNormalizedCC(detail: any, publications: string[]): NormalizedCase {
  const rank = publications.includes('b') || publications.includes('r') ? 1 : 2
  return {
    court: 'cass',
    date: detail.decision_date?.slice(0, 10) ?? '?',
    number: detail.number ?? '?',
    solution: detail.solution,
    holding: extractHolding(detail),
    authorityRank: rank,
    formattedText: formatDecision(detail),
  }
}

function buildNormalizedCAFromDecision(detail: any): NormalizedCase {
  return {
    court: 'ca',
    date: detail.decision_date?.slice(0, 10) ?? '?',
    number: detail.number ?? '?',
    solution: detail.solution,
    holding: extractHolding(detail),
    authorityRank: 3,
    formattedText: formatDecision(detail),
  }
}

function buildNormalizedCAFromSearch(result: any): NormalizedCase {
  const snippet = (
    (result.highlights?.motivations?.[0] ??
     result.highlights?.summary?.[0] ??
     result.summary ?? '') as string
  ).replace(/<\/?em>/g, '').slice(0, 200)
  return {
    court: 'ca',
    date: result.decision_date?.slice(0, 10) ?? '?',
    number: result.number ?? '?',
    solution: result.solution,
    holding: snippet,
    authorityRank: 3,
    formattedText: formatCAResult(result),
  }
}

// ---------------------------------------------------------------------------
// Point d'entrée public
// ---------------------------------------------------------------------------

export async function fetchJurisprudence(question: string): Promise<JudilibreContext> {
  const token = await getJudilibreToken()
  if (!token) return { available: false, text: '', cases: [], decisions: [], visaRefs: [] }

  const detected = detectTheme(question)
  if (!detected) {
    console.info('[judilibre] Aucun thème détecté — pas de jurisprudence')
    return { available: true, text: '', cases: [], decisions: [], visaRefs: [] }
  }

  const { theme, chamber, ccQuery, caQuery, noDateFilter, publications, dpeSignal } = detected
  const ccSearchQuery = ccQuery ?? question
  const caSearchQuery = caQuery ?? question
  const pubs = publications ?? ['b', 'r']

  try {
    let ccHits: any[] = []
    let caHits: any[] = []

    if (dpeSignal) {
      // DPE : pas de recherche CC (jurisprudence inexistante avant 2025),
      // CA uniquement avec date>=2022 et query très ciblée
      caHits = await searchCA(token, caSearchQuery, '2022-01-01')
    } else {
      // Pistes CC + CA lancées en parallèle
      ;[ccHits, caHits] = await Promise.all([
        searchCC(token, ccSearchQuery, theme, chamber, pubs, noDateFilter ?? false),
        searchCA(token, caSearchQuery),
      ])

      // Fallback CC sans filtres stricts si 0 résultat
      if (ccHits.length === 0) {
        ccHits = await searchCCFallback(token, ccSearchQuery, theme, chamber)
      }
    }

    if (ccHits.length === 0 && caHits.length === 0) {
      return { available: true, text: '', cases: [], decisions: [], visaRefs: [] }
    }

    // /decision pour top 2 CC + top 1 CA en parallèle (zones complètes pour tous)
    const top2CC = ccHits.slice(0, 2)
    const top1CA = caHits.slice(0, 1)
    const caRest = caHits.slice(1, 2)

    const [ccRawDetails, caRawDetails] = await Promise.all([
      Promise.all(top2CC.map(h => fetchDecisionDetail(token, h.id, ccSearchQuery))),
      Promise.all(top1CA.map(h => fetchDecisionDetail(token, h.id, caSearchQuery))),
    ])

    const ccDetails = ccRawDetails.filter(Boolean)
    const caDetails = caRawDetails.filter(Boolean)

    // Log + extraction visaRefs
    const allVisaRefs: VisaRef[] = []
    for (const detail of ccDetails) {
      const visaRefs = parseVisaRefs(detail.visa ?? [])
      const motivationsLen = extractZoneText(detail, 'motivations', 9999).length
      console.info(
        `[judilibre] CC n°${detail.number ?? '?'} ${detail.decision_date?.slice(0, 10) ?? '?'} ${detail.solution ?? '?'} zones=[motivations ${motivationsLen} chars] visa=[${visaRefs.map((v: VisaRef) => `${v.law}/art.${v.artNum}`).join(', ') || '—'}]`
      )
      allVisaRefs.push(...visaRefs)
    }
    for (const detail of caDetails) {
      const motivationsLen = extractZoneText(detail, 'motivations', 9999).length
      console.info(
        `[judilibre] CA /decision n°${detail.number ?? '?'} ${detail.decision_date?.slice(0, 10) ?? '?'} zones=[motivations ${motivationsLen} chars]`
      )
    }

    // Construction NormalizedCase[] : CC enrichis + top CA enrichi + CA restant (searchResult)
    const normalizedCases: NormalizedCase[] = [
      ...ccDetails.map((d: any) => buildNormalizedCC(d, pubs)),
      ...caDetails.map((d: any) => buildNormalizedCAFromDecision(d)),
      ...caRest.map((r: any) => buildNormalizedCAFromSearch(r)),
    ]

    // Assemblage du texte injecté
    const textParts: string[] = []

    // Bloc machine-friendly en tête : holding structuré par arrêt
    if (normalizedCases.length > 0) {
      const holdingLines = normalizedCases.map(c => {
        const courtLabel = c.court === 'cass' ? 'Cass.' : 'CA'
        const authLabel = c.court === 'cass' ? '[CC — autorité maximale]' : '[CA — jurisprudence récente]'
        return `- ${courtLabel} ${c.date} n° ${c.number} ${authLabel} : ${c.holding}`
      })
      textParts.push(
        `ARRÊTS RETENUS — À CITER OBLIGATOIREMENT dans la section 2️⃣ en expliquant en une phrase leur apport à la réponse :\n${holdingLines.join('\n')}`
      )
    }

    if (dpeSignal) {
      textParts.push(
        "Note : La jurisprudence DPE opposable (post-juillet 2021) n'est pas encore disponible à la Cour de cassation (délai normal de traitement judiciaire). Décisions de Cours d'appel récentes :"
      )
    }

    const ccCases = normalizedCases.filter(c => c.court === 'cass')
    const caCases = normalizedCases.filter(c => c.court === 'ca')

    if (ccCases.length > 0) {
      textParts.push(
        `Jurisprudence Cour de cassation (source : JUDILIBRE) :\n\n${ccCases.map(c => c.formattedText).join('\n\n---\n\n')}`
      )
    }

    if (caCases.length > 0) {
      textParts.push(
        `Jurisprudence Cours d'appel (source : JUDILIBRE) :\n\n${caCases.map(c => c.formattedText).join('\n\n---\n\n')}`
      )
    }

    const text = textParts.join('\n\n===\n\n')

    return {
      available: true,
      text,
      cases: normalizedCases,
      decisions: [...ccDetails, ...caDetails, ...caRest],
      visaRefs: allVisaRefs,
    }
  } catch (err) {
    console.error('[judilibre] fetchJurisprudence — exception :', err)
    return { available: false, text: '', cases: [], decisions: [], visaRefs: [] }
  }
}
