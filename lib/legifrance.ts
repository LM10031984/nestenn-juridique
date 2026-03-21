// lib/legifrance.ts
// Intégration API DILA (Légifrance) via OAuth2 — Nestenn Juridique v2
// Pipeline : LEGITEXT → canonicalVersion → legiPart → getArticle | CIRC | CODE_DATE+LODA_DATE

import type { VisaRef } from './judilibre'

// ---------------------------------------------------------------------------
// 0. Fetch avec timeout AbortController
// ---------------------------------------------------------------------------

function fetchWithTimeout(url: string | URL, init: RequestInit = {}, ms = 5000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

// ---------------------------------------------------------------------------
// 1. Cache token OAuth2
// ---------------------------------------------------------------------------

let tokenCache: { token: string; expiresAt: number } | null = null

export async function getAccessToken(): Promise<string> {
  const clientId = process.env.PISTE_CLIENT_ID
  const clientSecret = process.env.PISTE_CLIENT_SECRET
  const tokenUrl = process.env.PISTE_TOKEN_URL ?? 'https://oauth.piste.gouv.fr/api/oauth/token'

  if (!clientId || !clientSecret) {
    throw new Error('Variables manquantes : PISTE_CLIENT_ID et/ou PISTE_CLIENT_SECRET')
  }

  const now = Date.now()
  if (tokenCache && now < tokenCache.expiresAt - 60_000) return tokenCache.token

  const res = await fetchWithTimeout(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'openid',
    }).toString(),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Échec OAuth2 PISTE (${res.status}): ${text}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }
  tokenCache = { token: data.access_token, expiresAt: now + data.expires_in * 1000 }
  return tokenCache.token
}

// ---------------------------------------------------------------------------
// 2. Maps textes consolidés (LEGITEXT) — corrigés + complets
// ---------------------------------------------------------------------------

// LEGITEXT : IDs consolidés LEGI — endpoints legiPart + canonicalVersion
const LEGITEXT_MAP: Record<string, string> = {
  'civil':      'LEGITEXT000006070721', // Code civil
  'code-civil': 'LEGITEXT000006070721',
  '89-462':     'LEGITEXT000006069108', // Loi baux habitation 6 juil 1989
  '65-557':     'LEGITEXT000006068256', // Loi copropriété 10 juil 1965
  '70-9':       'LEGITEXT000006068387', // Loi Hoguet 2 jan 1970
  '2014-366':   'LEGITEXT000028775733', // Loi ALUR 24 mars 2014
  '2018-1021':  'LEGITEXT000037642121', // Loi ELAN 23 nov 2018
  '2021-1104':  'LEGITEXT000043957598', // Loi Climat-Résilience 22 août 2021
  '67-223':     'LEGITEXT000006061423', // Décret copropriété 17 mars 1967
}

const API_BASE = process.env.PISTE_API_URL ?? 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app'

// ---------------------------------------------------------------------------
// 3. resolveLegitext — LEGITEXT_MAP puis fallback /search LODA_DATE
// ---------------------------------------------------------------------------

const legitextCache = new Map<string, string>()

async function resolveLegitext(law: string, token: string): Promise<string | null> {
  if (LEGITEXT_MAP[law]) return LEGITEXT_MAP[law]
  if (legitextCache.has(law)) return legitextCache.get(law)!

  // Fallback : /search LODA_DATE + typeChamp TITLE pour lois inconnues
  try {
    const res = await fetchWithTimeout(`${API_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        recherche: {
          champs: [{
            typeChamp: 'TITLE',
            criteres: [{ typeRecherche: 'EXACTE', valeur: law, operateur: 'ET' }],
            operateur: 'ET',
          }],
          pageNumber: 1, pageSize: 3,
          sort: 'PERTINENCE', typePagination: 'DEFAUT',
          operateur: 'ET', fromAdvancedRecherche: false,
        },
        fond: 'LODA_DATE',
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as any
    const hit = (data?.results ?? [])[0]
    const id: string | undefined = hit?.id ?? hit?.cid
    if (id) {
      legitextCache.set(law, id)
      return id
    }
    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 4. canonicalVersion — vérification vigueur avant legiPart (pré-vol léger)
// ---------------------------------------------------------------------------

async function isTextInForce(legitext: string, token: string, date: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/search/canonicalVersion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cidText: legitext, date }),
    }, 3000)
    if (!res.ok) return true // En cas d'erreur, on tente quand même
    const data = await res.json() as any
    // dateFin: null = en vigueur
    return data?.dateFin == null
  } catch {
    return true
  }
}

// ---------------------------------------------------------------------------
// 5. Résultat normalisé v2
// ---------------------------------------------------------------------------

export interface LegiTextResult {
  textId: string
  title: string
  content: string
  dateVersion: string
  url: string
  sectionPath?: string
  citedBy?: string[]
  lastModifs?: Array<{ date: string; title: string }>
  servicePublicLinks?: string[]
  modifiedRecently?: boolean
  opposable?: boolean
  sourceType?: 'loi' | 'code' | 'circulaire'
}

// ---------------------------------------------------------------------------
// 6. Strip HTML (conservé pour fallback search uniquement)
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// 7. Traversée récursive de l'arbre legiPart
// ---------------------------------------------------------------------------

function findArticleInTree(node: any, artNum: string): { id: string; cid: string } | null {
  for (const art of (node.articles ?? [])) {
    if ((art.etat ?? '').toUpperCase() === 'VIGUEUR' && art.num === artNum) {
      const id: string = art.id ?? art.cid ?? ''
      const cid: string = art.cid ?? art.id ?? ''
      if (id) return { id, cid }
    }
  }
  for (const section of (node.sections ?? [])) {
    const found = findArticleInTree(section, artNum)
    if (found) return found
  }
  return null
}

// ---------------------------------------------------------------------------
// 8. getArticle — endpoint principal v2 (remplace getArticleWithIdAndNum)
// ---------------------------------------------------------------------------

interface ArticleData {
  id: string
  cid?: string
  texte?: string
  fullSectionsTitre?: string
  etat?: string
  dateDebut?: string
  lienModifications?: Array<{ date?: string; titre?: string }>
  comporteLiensSP?: boolean
  multipleVersions?: boolean
}

async function fetchArticleById(legiartiId: string, token: string): Promise<ArticleData | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/consult/getArticle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: legiartiId }),
    })
    if (!res.ok) {
      console.warn(`[legifrance] getArticle ${legiartiId} → HTTP ${res.status}`)
      return null
    }
    const data = await res.json() as any
    return (data?.article ?? data) as ArticleData
  } catch (err) {
    console.error(`[legifrance] getArticle ${legiartiId} — exception :`, err)
    return null
  }
}

// ---------------------------------------------------------------------------
// 9. servicePublicLinksArticle (appelé seulement si comporteLiensSP: true)
// ---------------------------------------------------------------------------

async function fetchServicePublicLinks(articleCid: string, token: string): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/consult/servicePublicLinksArticle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ articleCid, fond: 'LODA_DATE' }),
    }, 3000)
    if (!res.ok) return []
    const data = await res.json() as any
    const liens: Record<string, string> = data?.liensSP ?? {}
    return Object.values(liens).filter(Boolean).slice(0, 3)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// 10. sameNumArticle — fallback renumérotation (ex: articles transférés ELAN)
// ---------------------------------------------------------------------------

async function resolveSameNumArticle(
  artNum: string,
  articleCid: string,
  legitext: string,
  date: string,
  token: string,
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/consult/sameNumArticle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ date, articleCid, textCid: legitext, articleNum: artNum }),
    }, 3000)
    if (!res.ok) return null
    const data = await res.json() as any
    const newTexts: any[] = data?.newTexts ?? []
    const hit = newTexts[0]
    return hit?.id ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 11. Voie principale — legiPart → getArticle (+sameNumArticle fallback)
// ---------------------------------------------------------------------------

async function fetchArticleViaLegiPart(
  legitext: string,
  artNum: string,
  law: string,
  token: string,
  todayDate: string,
): Promise<LegiTextResult | null> {
  try {
    // legiPart : structure complète du texte
    const legiPartRes = await fetchWithTimeout(`${API_BASE}/consult/legiPart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ textId: legitext, date: todayDate }),
    })
    if (!legiPartRes.ok) {
      console.warn(`[legifrance] legiPart ${law} → HTTP ${legiPartRes.status}`)
      return null
    }
    const legiData = await legiPartRes.json() as any

    // Normalise la racine de l'arbre (LODA vs CODE peuvent différer)
    const tree = legiData?.legalTexts?.[0] ?? legiData

    // Recherche de l'article dans l'arbre
    const artRef = findArticleInTree(tree, artNum)
    if (!artRef) {
      console.warn(`[legifrance] legiPart ${law}/art.${artNum} → article non trouvé dans l'arbre`)
      return null
    }

    // getArticle : contenu complet (texte brut, pas HTML)
    let artData = await fetchArticleById(artRef.id, token)

    // Fallback sameNumArticle si getArticle retourne null (renumérotation ELAN)
    if (!artData) {
      const newId = await resolveSameNumArticle(artNum, artRef.cid, legitext, todayDate, token)
      if (newId) artData = await fetchArticleById(newId, token)
    }

    if (!artData) return null

    const content = (artData.texte ?? '').slice(0, 4000)
    if (!content) return null

    // servicePublicLinks : uniquement si comporteLiensSP flag
    const servicePublicLinks = artData.comporteLiensSP && artRef.cid
      ? await fetchServicePublicLinks(artRef.cid, token)
      : []

    const lastModifs = (artData.lienModifications ?? [])
      .map((m: any) => ({ date: m.date ?? '', title: m.titre ?? '' }))
      .filter((m: any) => m.date)
      .slice(0, 2)

    const isCode = law === 'civil' || law === 'code-civil'
    const sourceType: 'loi' | 'code' = isCode ? 'code' : 'loi'

    return {
      textId: artData.id ?? artRef.id,
      title: `${isCode ? 'Code civil' : `Loi n° ${law}`} — Article ${artNum}`,
      content,
      dateVersion: artData.dateDebut ?? '',
      url: `https://www.legifrance.gouv.fr/codes/article_lc/${artData.id ?? artRef.id}`,
      ...(artData.fullSectionsTitre ? { sectionPath: artData.fullSectionsTitre } : {}),
      ...(lastModifs.length > 0 ? { lastModifs } : {}),
      ...(servicePublicLinks.length > 0 ? { servicePublicLinks } : {}),
      ...(artData.multipleVersions ? { modifiedRecently: true } : {}),
      sourceType,
    }
  } catch (err) {
    console.error(`[legifrance] fetchArticleViaLegiPart ${law}/art.${artNum} — exception :`, err)
    return null
  }
}

// ---------------------------------------------------------------------------
// 12. FALLBACK_REFS — triggers thématiques si pas de visaRefs Judilibre
// ---------------------------------------------------------------------------

interface FallbackEntry {
  triggers: string[]
  law: string
  artNums: string[]
}

const FALLBACK_REFS: FallbackEntry[] = [
  { triggers: ['impayé', 'commandement', 'clause résolutoire', 'expulsion'], law: '89-462', artNums: ['24', '24-1'] },
  { triggers: ['bail', 'location', 'locataire', 'loyer', 'congé', 'dépôt'], law: '89-462', artNums: ['6', '7', '8', '10', '15', '17', '22'] },
  { triggers: ['copropriété', 'syndic', 'assemblée générale', 'charges'],    law: '65-557', artNums: ['10', '14', '17', '18', '24', '25', '42'] },
  { triggers: ['devoir de conseil', 'responsabilité agent', 'information agent'], law: 'code-civil', artNums: ['1240', '1241'] },
  { triggers: ['mandat', 'honoraires', 'hoguet', 'agent immobilier'],        law: '70-9',   artNums: ['6', '7'] },
  { triggers: ['dpe', 'diagnostic', 'amiante', 'plomb'],                    law: '2021-1104', artNums: ['L126-26', 'L271-4'] },
  { triggers: ['trêve hivernale'],                                           law: 'civil',  artNums: ['L412-6'] },
  { triggers: ['vices cachés'],                                              law: 'civil',  artNums: ['1641', '1648'] },
  { triggers: ['usufruit', 'démembrement'],                                  law: 'civil',  artNums: ['578', '595', '596'] },
  { triggers: ['vefa', 'décennale', 'biennale'],                             law: 'civil',  artNums: ['1792', '1792-3'] },
  { triggers: ['zan', 'urbanisme', 'plu'],                                   law: '2021-1104', artNums: ['L141-8'] },
  { triggers: ['viager', 'rente viagère'],                                   law: 'civil',  artNums: ['1968', '1976', '1983'] },
  { triggers: ['condition suspensive', 'prêt immobilier'],                  law: 'code-civil', artNums: ['1304', '1304-2'] },
]

// ---------------------------------------------------------------------------
// 13. Fallback search enrichi — CODE_DATE + LODA_DATE en parallèle
// ---------------------------------------------------------------------------

export async function searchLegiTexts(query: string, token: string): Promise<LegiTextResult[]> {
  const buildBody = (fond: string) => JSON.stringify({
    recherche: {
      champs: [{
        typeChamp: 'ALL',
        criteres: [{ typeRecherche: 'UN_DES_MOTS', valeur: query, operateur: 'ET' }],
        operateur: 'ET',
      }],
      pageNumber: 1, pageSize: 4,
      sort: 'PERTINENCE', typePagination: 'DEFAUT',
      operateur: 'ET', fromAdvancedRecherche: false,
    },
    fond,
  })

  const mapResults = (rawResults: any[], sourceType: 'loi' | 'code'): LegiTextResult[] => {
    const mapped: LegiTextResult[] = []
    for (const item of rawResults.slice(0, 4)) {
      const codeName = item.titles?.[0]?.title ?? item.title ?? ''
      const extracts: any[] = item.sections?.flatMap((s: any) => s.extracts ?? []) ?? []
      if (extracts.length > 0) {
        for (const ext of extracts.slice(0, 2)) {
          const content = stripHtml((ext.values ?? []).join(' '))
          if (!content) continue
          mapped.push({
            textId: ext.id ?? '',
            title: `${codeName} — Article ${ext.num ?? ext.title ?? ''}`,
            content,
            dateVersion: ext.dateVersion ?? '',
            url: ext.id
              ? `https://www.legifrance.gouv.fr/codes/article_lc/${ext.id}`
              : 'https://www.legifrance.gouv.fr',
            sourceType,
          })
        }
      } else {
        const textId = item.id ?? item.textId ?? item.cid ?? ''
        mapped.push({
          textId,
          title: codeName,
          content: stripHtml(item.extract ?? item.content ?? item.texte ?? ''),
          dateVersion: item.dateVersion ?? item.dateDebut ?? '',
          url: textId
            ? `https://www.legifrance.gouv.fr/loda/id/${textId}`
            : 'https://www.legifrance.gouv.fr',
          sourceType,
        })
      }
    }
    return mapped
  }

  try {
    const [codeRes, lodaRes] = await Promise.allSettled([
      fetchWithTimeout(`${API_BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: buildBody('CODE_DATE'),
      }),
      fetchWithTimeout(`${API_BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: buildBody('LODA_DATE'),
      }),
    ])

    const results: LegiTextResult[] = []

    if (codeRes.status === 'fulfilled' && codeRes.value.ok) {
      const data = await codeRes.value.json() as any
      results.push(...mapResults(data?.results ?? [], 'code'))
    }
    if (lodaRes.status === 'fulfilled' && lodaRes.value.ok) {
      const data = await lodaRes.value.json() as any
      results.push(...mapResults(data?.results ?? [], 'loi'))
    }

    // Déduplique par textId
    const seen = new Set<string>()
    return results.filter(r => {
      if (!r.textId || seen.has(r.textId)) return false
      seen.add(r.textId)
      return true
    }).slice(0, 6)
  } catch (err) {
    console.error('[legifrance] searchLegiTexts — exception :', err)
    return []
  }
}

// ---------------------------------------------------------------------------
// 14. Pipeline circulaires (Voie 4)
// ---------------------------------------------------------------------------

const CIRC_TRIGGERS = ['dpe', 'encadrement loyer', 'diagnostic', 'décence', 'permis de louer']

async function fetchCirculaires(query: string, token: string): Promise<LegiTextResult[]> {
  try {
    const searchRes = await fetchWithTimeout(`${API_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        recherche: {
          champs: [{
            typeChamp: 'RESUME_CIRC',
            criteres: [{ typeRecherche: 'UN_DES_MOTS', valeur: query, operateur: 'ET' }],
            operateur: 'ET',
          }],
          pageNumber: 1, pageSize: 3,
          sort: 'PERTINENCE', typePagination: 'DEFAUT',
          operateur: 'ET', fromAdvancedRecherche: false,
        },
        fond: 'CIRC',
      }),
    })
    if (!searchRes.ok) return []

    const searchData = await searchRes.json() as any
    const circIds: string[] = (searchData?.results ?? [])
      .map((r: any) => r.id ?? r.textId ?? '')
      .filter(Boolean)
      .slice(0, 2)

    if (circIds.length === 0) return []

    const circResults = await Promise.allSettled(
      circIds.map(id =>
        fetchWithTimeout(`${API_BASE}/consult/circulaire`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id }),
        }, 3000).then(r => r.ok ? r.json() : null).catch(() => null)
      )
    )

    const texts: LegiTextResult[] = []
    for (const result of circResults) {
      if (result.status !== 'fulfilled' || !result.value) continue
      const circ = result.value
      const content = (circ?.attachment?.content ?? circ?.content ?? '').slice(0, 2000)
      if (!content) continue
      texts.push({
        textId: circ.id ?? '',
        title: circ.titre ?? circ.resume ?? 'Circulaire',
        content,
        dateVersion: circ.dateSignature ?? circ.date ?? '',
        url: circ.id
          ? `https://www.legifrance.gouv.fr/circulaire/id/${circ.id}`
          : 'https://www.legifrance.gouv.fr',
        opposable: circ.opposable === 'O',
        sourceType: 'circulaire',
      })
    }
    return texts
  } catch (err) {
    console.error('[legifrance] fetchCirculaires — exception :', err)
    return []
  }
}

// ---------------------------------------------------------------------------
// 15. DilaContext
// ---------------------------------------------------------------------------

export interface DilaContext {
  texts: LegiTextResult[]
  available: boolean
  fallbackMessage?: string
  circulaires?: LegiTextResult[]
}

// ---------------------------------------------------------------------------
// 16. Pipeline principal v2
// ---------------------------------------------------------------------------

export async function fetchLegalContext(
  userQuery: string,
  _openRouterChat?: unknown, // conservé pour compatibilité route.ts
  visaRefs?: VisaRef[],
  forcedArticles?: Array<{ law: string; artNums: string[] }>,
): Promise<DilaContext> {
  if (!process.env.PISTE_CLIENT_ID || !process.env.PISTE_CLIENT_SECRET) {
    return { texts: [], available: false, fallbackMessage: 'PISTE_CLIENT_ID / PISTE_CLIENT_SECRET manquants.' }
  }

  try {
    const token = await getAccessToken()
    const todayDate = new Date().toISOString().split('T')[0]
    const texts: LegiTextResult[] = []

    // ── Voie 1 : visaRefs Judilibre → LEGITEXT → legiPart → getArticle ────────
    if (visaRefs && visaRefs.length > 0) {
      const refsToFetch = visaRefs.slice(0, 4)

      // Résolution LEGITEXT en parallèle
      const legitexts = await Promise.all(refsToFetch.map(ref => resolveLegitext(ref.law, token)))

      // Vérification vigueur pour chaque LEGITEXT distinct (canonicalVersion)
      const uniqueLegiTexts = [...new Set(legitexts.filter(Boolean) as string[])]
      const forceChecks = await Promise.all(uniqueLegiTexts.map(lt => isTextInForce(lt, token, todayDate)))
      const inForceSet = new Set(uniqueLegiTexts.filter((_, i) => forceChecks[i]))

      // Récupération articles en parallèle (skip si texte abrogé)
      const articleResults = await Promise.all(
        refsToFetch.map((ref, i) => {
          const legitext = legitexts[i]
          if (!legitext || !inForceSet.has(legitext)) return Promise.resolve(null)
          return fetchArticleViaLegiPart(legitext, ref.artNum, ref.law, token, todayDate)
        })
      )
      texts.push(...(articleResults.filter(Boolean) as LegiTextResult[]))

      console.info(
        `[legifrance] visaRefs=[${refsToFetch.map(r => `${r.law}/art.${r.artNum}`).join(', ')}]` +
        ` → legiPart+getArticle → ${texts.length} article(s) OK`
      )
    }

    // ── Voie 1bis : forcedArticles — toujours fetchés, jamais conditionnels ────
    if (forcedArticles && forcedArticles.length > 0) {
      const existingTitles = new Set(texts.map(t => t.title))
      for (const forced of forcedArticles) {
        const legitext = await resolveLegitext(forced.law, token)
        if (!legitext || !(await isTextInForce(legitext, token, todayDate))) continue
        const results = await Promise.all(
          forced.artNums.slice(0, 4).map(artNum =>
            fetchArticleViaLegiPart(legitext, artNum, forced.law, token, todayDate)
          )
        )
        for (const r of results) {
          if (r && !existingTitles.has(r.title)) {
            texts.push(r)
            existingTitles.add(r.title)
          }
        }
      }
      console.info(
        `[legifrance] forcedArticles=[${forcedArticles.map(f => `${f.law}/${f.artNums.join(',')}`).join('; ')}] → ${texts.length} article(s) total`
      )
    }

    // ── Voie 2 : FALLBACK_REFS si visaRefs vides ou aucun article trouvé ──────
    if (texts.length === 0) {
      const lower = userQuery.toLowerCase()
      const match = FALLBACK_REFS.find(entry => entry.triggers.some(t => lower.includes(t)))

      if (match) {
        const legitext = await resolveLegitext(match.law, token)
        if (legitext && await isTextInForce(legitext, token, todayDate)) {
          const articleResults = await Promise.all(
            match.artNums.slice(0, 4).map(artNum =>
              fetchArticleViaLegiPart(legitext, artNum, match.law, token, todayDate)
            )
          )
          texts.push(...(articleResults.filter(Boolean) as LegiTextResult[]))
        }
        console.info(
          `[legifrance] FALLBACK_REFS law=${match.law} artNums=[${match.artNums.slice(0, 4).join(', ')}] → ${texts.length} article(s) OK`
        )
      }
    }

    // ── Voies 3+4 en parallèle : search enrichi + circulaires ─────────────────
    const circTrigger = CIRC_TRIGGERS.some(t => userQuery.toLowerCase().includes(t))

    const [fallbackRes, circRes] = await Promise.allSettled([
      texts.length === 0
        ? searchLegiTexts(userQuery.slice(0, 100), token)
        : Promise.resolve([] as LegiTextResult[]),
      circTrigger
        ? fetchCirculaires(userQuery.slice(0, 100), token)
        : Promise.resolve([] as LegiTextResult[]),
    ])

    if (fallbackRes.status === 'fulfilled' && fallbackRes.value.length > 0) {
      console.info(`[legifrance] searchLegiTexts → ${fallbackRes.value.length} résultat(s)`)
      texts.push(...fallbackRes.value)
    }

    const circulaires = circRes.status === 'fulfilled' ? circRes.value : []
    if (circulaires.length > 0) {
      console.info(`[legifrance] circulaires → ${circulaires.length} résultat(s)`)
    }

    return {
      texts,
      available: true,
      ...(circulaires.length > 0 ? { circulaires } : {}),
    }
  } catch (err) {
    console.error('[legifrance] fetchLegalContext — API DILA indisponible :', err)
    return { texts: [], available: false, fallbackMessage: 'Le service Légifrance est temporairement indisponible.' }
  }
}
