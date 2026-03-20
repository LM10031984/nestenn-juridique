// lib/legifrance.ts
// Intégration API DILA (Légifrance) via OAuth2 — Nestenn Juridique
// Pipeline : VisaRef Judilibre → resolveJorftext → getArticleWithIdAndNum → fallback thème → fallback mots-clés

import type { VisaRef } from './judilibre'

// ---------------------------------------------------------------------------
// 0. Fetch avec timeout AbortController (5s par défaut)
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
// 2. JORFTEXT hardcodés — codes et lois connues (skip /suggest)
// ---------------------------------------------------------------------------

const JORFTEXT_HARDCODED: Record<string, string> = {
  'civil':     'JORFTEXT000000504962', // Code civil
  'code-civil': 'JORFTEXT000000504962', // Code civil (alias)
  '89-462':    'JORFTEXT000000509310', // Loi 6 juillet 1989 (baux habitation)
  '65-557':    'JORFTEXT000000880200', // Loi 10 juillet 1965 (copropriété)
  '70-9':      'JORFTEXT000000509463', // Loi Hoguet 2 janvier 1970 (agents immobiliers)
  '2014-366':  'JORFTEXT000028772238', // Loi ALUR 24 mars 2014
  '2018-1021': 'JORFTEXT000037639011', // Loi ELAN 23 novembre 2018
  '2021-1104': 'JORFTEXT000043977118', // Loi Climat et Résilience 22 août 2021
  '79-596':    'JORFTEXT000000701978', // Loi Scrivener 13 juillet 1979 (prêt immobilier)
  '67-223':    'JORFTEXT000000878350', // Décret 17 mars 1967 (copropriété)
}

const API_BASE = process.env.PISTE_API_URL ?? 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app'

// ---------------------------------------------------------------------------
// 3. Cache /suggest (law → JORFTEXT, module-level, reset au cold start)
// ---------------------------------------------------------------------------

const suggestCache = new Map<string, string>()

async function resolveJorftext(law: string, token: string): Promise<string | null> {
  // Codes/lois connus → retour immédiat, pas d'appel réseau
  if (JORFTEXT_HARDCODED[law]) {
    return JORFTEXT_HARDCODED[law]
  }

  // Cache suggest
  if (suggestCache.has(law)) return suggestCache.get(law)!

  // /suggest pour lois inconnues
  try {
    const res = await fetchWithTimeout(`${API_BASE}/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ searchText: law }),
    })
    if (!res.ok) {
      console.warn(`[legifrance] /suggest "${law}" → HTTP ${res.status}`)
      return null
    }
    const data = await res.json() as { results?: any[] }
    const items: any[] = data?.results ?? []
    // Priorité : origin=LEGI + nature=loi, sinon premier résultat
    const hit = items.find((i: any) => i?.origin === 'LEGI' && i?.nature === 'loi') ?? items[0]
    if (!hit?.id) {
      console.warn(`[legifrance] /suggest "${law}" → aucun résultat`)
      return null
    }
    suggestCache.set(law, hit.id)
    return hit.id
  } catch (err) {
    console.error(`[legifrance] /suggest "${law}" — exception :`, err)
    return null
  }
}

// ---------------------------------------------------------------------------
// 4. Résultat normalisé
// ---------------------------------------------------------------------------

export interface LegiTextResult {
  textId: string
  title: string
  content: string
  dateVersion: string
  url: string
  citedBy?: string[]
  lastModifs?: Array<{ date: string; title: string }>
}

// ---------------------------------------------------------------------------
// 5. Strip HTML
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
// 6. fetchArticle — /consult/getArticleWithIdAndNum
// ---------------------------------------------------------------------------

async function fetchArticle(
  jorftext: string,
  artNum: string,
  law: string,
  token: string,
): Promise<LegiTextResult | null> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/consult/getArticleWithIdAndNum`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: jorftext, num: artNum }),
    })
    if (!res.ok) {
      console.warn(`[legifrance] getArticleWithIdAndNum ${law}/art.${artNum} → HTTP ${res.status}`)
      return null
    }

    const data = await res.json() as any
    const art = data?.article
    if (!art) return null
    if ((art.etat ?? '').toUpperCase() !== 'VIGUEUR') {
      console.warn(`[legifrance] getArticleWithIdAndNum ${law}/art.${artNum} → etat=${art.etat} (ignoré)`)
      return null
    }

    const content = stripHtml(art.texte ?? art.content ?? '').slice(0, 4000)
    if (!content) return null

    // ── Enrichissement parallèle (timeout 3s indépendant) ──────────────────
    const articleId = art.id as string | undefined
    const articleCid = (art.cid ?? art.id) as string | undefined

    const [relLinksRaw, chronoRaw] = await Promise.allSettled([
      // A) relatedLinksArticle → liensCitePar
      articleId
        ? fetchWithTimeout(`${API_BASE}/consult/relatedLinksArticle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ articleId }),
          }, 3000)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        : Promise.resolve(null),
      // B) chrono/textCidAndElementCid → lastModifs
      articleCid
        ? fetchWithTimeout(`${API_BASE}/chrono/textCidAndElementCid`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ textCid: jorftext, elementCid: articleCid }),
          }, 3000)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        : Promise.resolve(null),
    ])

    // Extraire citedBy
    let citedBy: string[] | undefined
    if (relLinksRaw.status === 'fulfilled' && relLinksRaw.value) {
      const liens: any[] = relLinksRaw.value?.liensCitePar ?? []
      const filtered = liens
        .filter((l: any) => l?.nature === 'CODE' || l?.nature === 'LODA')
        .slice(0, 3)
        .map((l: any) => l.name as string)
        .filter(Boolean)
      if (filtered.length > 0) citedBy = filtered
      console.info(`[legifrance] relatedLinks → ${filtered.length} liensCitePar`)
    }

    // Extraire lastModifs depuis regroupements[].versions
    let lastModifs: Array<{ date: string; title: string }> | undefined
    if (chronoRaw.status === 'fulfilled' && chronoRaw.value) {
      const regroupements: any[] = chronoRaw.value?.regroupements ?? []
      const versions: Array<{ date: string; title: string }> = []
      for (const rg of regroupements) {
        for (const v of (rg?.versions ?? []) as any[]) {
          const date: string = v?.dateDebut ?? v?.date ?? ''
          const title: string = v?.titre ?? v?.title ?? ''
          if (date) versions.push({ date, title })
        }
      }
      versions.sort((a, b) => b.date.localeCompare(a.date))
      if (versions.length > 0) {
        lastModifs = versions.slice(0, 2)
        for (const m of lastModifs) {
          console.info(`[legifrance] chrono → ${m.date} ${m.title}`)
        }
      }
    }

    return {
      textId: art.id ?? jorftext,
      title: `Loi n° ${law} — Article ${artNum}`,
      content,
      dateVersion: art.dateDebut ?? '',
      url: art.id
        ? `https://www.legifrance.gouv.fr/codes/article_lc/${art.id}`
        : `https://www.legifrance.gouv.fr/loda/id/${jorftext}`,
      ...(citedBy ? { citedBy } : {}),
      ...(lastModifs ? { lastModifs } : {}),
    }
  } catch (err) {
    console.error(`[legifrance] fetchArticle ${law}/art.${artNum} — exception :`, err)
    return null
  }
}

// ---------------------------------------------------------------------------
// 7. FALLBACK_REFS — si pas de visaRefs Judilibre
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
  { triggers: ['devoir de conseil', 'responsabilité agent', 'information agent', 'conseil agent'], law: 'code-civil', artNums: ['1240', '1241'] },
  { triggers: ['mandat', 'honoraires', 'hoguet', 'agent immobilier'],        law: '70-9',   artNums: ['6', '7', '1240'] },
  { triggers: ['dpe', 'diagnostic', 'amiante', 'plomb'],                    law: '2021-1104', artNums: ['L126-26', 'L271-4'] },
  { triggers: ['condition suspensive', 'prêt'],                              law: '79-596', artNums: ['L313-41'] },
  { triggers: ['trêve hivernale'],                                           law: 'L412-6', artNums: ['L412-6'] },
  { triggers: ['vices cachés'],                                              law: 'civil',  artNums: ['1641', '1648'] },
  { triggers: ['usufruit', 'démembrement'],                                  law: 'civil',  artNums: ['578', '595', '596'] },
  { triggers: ['vefa', 'décennale', 'biennale'],                             law: 'civil',  artNums: ['1792', '1792-3'] },
  { triggers: ['zan', 'urbanisme', 'plu'],                                   law: '2021-1104', artNums: ['L141-8'] },
  { triggers: ['viager', 'rente viagère'],                                   law: 'civil',  artNums: ['1968', '1976', '1983'] },
]

// ---------------------------------------------------------------------------
// 8. Fallback mots-clés (recherche généraliste /search CODE_DATE)
// ---------------------------------------------------------------------------

export async function searchLegiTexts(query: string, token: string): Promise<LegiTextResult[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        recherche: {
          champs: [{
            typeChamp: 'ALL',
            criteres: [{ typeRecherche: 'UN_DES_MOTS', valeur: query, operateur: 'ET' }],
            operateur: 'ET',
          }],
          pageNumber: 1, pageSize: 5,
          sort: 'PERTINENCE', typePagination: 'DEFAUT',
          operateur: 'ET', fromAdvancedRecherche: false,
        },
        fond: 'CODE_DATE',
      }),
    })

    if (!res.ok) {
      console.error(`[legifrance] searchLegiTexts — HTTP ${res.status}`)
      return []
    }

    const data = await res.json()
    const rawResults: any[] = data?.results ?? []
    const mapped: LegiTextResult[] = []

    for (const item of rawResults.slice(0, 5)) {
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
        })
      }
    }

    return mapped
  } catch (err) {
    console.error('[legifrance] searchLegiTexts — exception :', err)
    return []
  }
}

// ---------------------------------------------------------------------------
// 9. DilaContext
// ---------------------------------------------------------------------------

export interface DilaContext {
  texts: LegiTextResult[]
  available: boolean
  fallbackMessage?: string
}

// ---------------------------------------------------------------------------
// 10. Pipeline principal
// ---------------------------------------------------------------------------

export async function fetchLegalContext(
  userQuery: string,
  _openRouterChat?: unknown,  // conservé pour compatibilité avec route.ts
  visaRefs?: VisaRef[],
): Promise<DilaContext> {
  if (!process.env.PISTE_CLIENT_ID || !process.env.PISTE_CLIENT_SECRET) {
    return { texts: [], available: false, fallbackMessage: 'PISTE_CLIENT_ID / PISTE_CLIENT_SECRET manquants.' }
  }

  try {
    const token = await getAccessToken()
    const texts: LegiTextResult[] = []

    // ── Voie 1 : visaRefs Judilibre → resolveJorftext → getArticleWithIdAndNum ──
    if (visaRefs && visaRefs.length > 0) {
      const refsToFetch = visaRefs.slice(0, 4)

      // Résolution des JORFTEXTs en parallèle
      const jorftextResults = await Promise.all(refsToFetch.map(ref => resolveJorftext(ref.law, token)))
      const jorftexts: string[] = jorftextResults.filter(Boolean) as string[]

      // Récupération des articles en parallèle
      const articleResults = await Promise.all(
        refsToFetch.map((ref, i) => {
          const jorftext = jorftextResults[i]
          return jorftext ? fetchArticle(jorftext, ref.artNum, ref.law, token) : null
        })
      )
      texts.push(...(articleResults.filter(Boolean) as LegiTextResult[]))

      console.info(
        `[legifrance] refs=[${refsToFetch.map(r => `${r.law}/art.${r.artNum}`).join(', ')}]` +
        ` → suggest JORFTEXT=[${jorftexts.join(', ')}]` +
        ` → getArticleWithIdAndNum → ${texts.length} article(s) OK`
      )
    }

    // ── Voie 2 : FALLBACK_REFS si visaRefs vides ou aucun article trouvé ──────
    if (texts.length === 0) {
      const lower = userQuery.toLowerCase()
      const match = FALLBACK_REFS.find(entry => entry.triggers.some(t => lower.includes(t)))

      if (match) {
        const jorftext = await resolveJorftext(match.law, token)
        if (jorftext) {
          const articleResults = await Promise.all(
            match.artNums.slice(0, 4).map(artNum => fetchArticle(jorftext, artNum, match.law, token))
          )
          texts.push(...(articleResults.filter(Boolean) as LegiTextResult[]))
        }
        console.info(
          `[legifrance] FALLBACK_REFS law=${match.law} artNums=[${match.artNums.slice(0, 4).join(', ')}] → ${texts.length} article(s) OK`
        )
      }
    }

    // ── Voie 3 : fallback mots-clés si toujours vide ─────────────────────────
    if (texts.length === 0) {
      console.info('[legifrance] fallback searchLegiTexts')
      const fallback = await searchLegiTexts(userQuery.slice(0, 100), token)
      console.info(`[legifrance] fallback searchLegiTexts → ${fallback.length} résultat(s)`)
      texts.push(...fallback)
    }

    return { texts, available: true }
  } catch (err) {
    console.error('[legifrance] fetchLegalContext — API DILA indisponible :', err)
    return { texts: [], available: false, fallbackMessage: 'Le service Légifrance est temporairement indisponible.' }
  }
}
