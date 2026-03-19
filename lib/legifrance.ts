// lib/legifrance.ts
// Intégration API DILA (Légifrance) via OAuth2 — Nestenn Juridique

// ---------------------------------------------------------------------------
// 1. Cache token OAuth2 en mémoire serveur (singleton module-level)
// ---------------------------------------------------------------------------

let tokenCache: { token: string; expiresAt: number } | null = null

export async function getAccessToken(): Promise<string> {
  const clientId = process.env.PISTE_CLIENT_ID
  const clientSecret = process.env.PISTE_CLIENT_SECRET
  const tokenUrl = process.env.PISTE_TOKEN_URL ?? 'https://oauth.piste.gouv.fr/api/oauth/token'

  if (!clientId || !clientSecret) {
    throw new Error(
      'Variables d\'environnement manquantes : PISTE_CLIENT_ID et/ou PISTE_CLIENT_SECRET'
    )
  }

  const now = Date.now()
  const marginMs = 60 * 1000 // 60 secondes de marge

  if (tokenCache && now < tokenCache.expiresAt - marginMs) {
    return tokenCache.token
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'openid',
  })

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Échec OAuth2 PISTE (${response.status}): ${text}`)
  }

  const data = (await response.json()) as { access_token: string; expires_in: number }

  tokenCache = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  }

  return tokenCache.token
}

// ---------------------------------------------------------------------------
// 2. Extraction d'entités juridiques via LLM
// ---------------------------------------------------------------------------

export interface LegalEntities {
  textIds: string[]     // ex: ["65-557", "2014-366"]
  articleRefs: string[] // ex: ["article 14", "article L145-1"]
  topics: string[]      // ex: ["copropriété", "bail commercial"]
}

const EXTRACTION_PROMPT = `Tu es un assistant juridique spécialisé en droit français.
Analyse la question suivante et extrais les entités juridiques pertinentes.
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, avec exactement ces clés :
- "textIds" : tableau de numéros de loi ou décret (ex: "65-557", "2014-366") — vide si aucun
- "articleRefs" : tableau de références d'articles (ex: "article 14", "article L145-1") — vide si aucun
- "topics" : tableau de thèmes juridiques en français (ex: "copropriété", "bail commercial") — 1 à 3 thèmes maximum

Table de référence — utilise ces articles directement si la question porte sur ces sujets :
- démembrement, usufruit, nue-propriété, usufruitier → textIds: [], articleRefs: ["article 595", "article 596", "article 597"] (Code civil)
- amiante, diagnostic amiante → articleRefs: ["article R1334-20", "article R1334-21"] (Code santé publique)
- DPE, performance énergétique → articleRefs: ["article L126-26", "article L126-28"] (Code construction)
- viager, rente viagère, bouquet → articleRefs: ["article 1968", "article 1976", "article 1983"] (Code civil)
- condition suspensive, prêt immobilier, délai de prêt → textIds: ["79-596"], articleRefs: ["article L313-41"] (Code consommation)
- copropriété, syndic, AG → textIds: ["65-557", "67-223"]
- bail d'habitation, location, locataire → textIds: ["89-462"]
- loi Hoguet, agent immobilier, mandat, carte T → textIds: ["70-9", "72-678"]
- ALUR, encadrement loyers → textIds: ["2014-366"]
- ELAN, bail mobilité → textIds: ["2018-1021"]
- ZAN, zéro artificialisation nette, artificialisation des sols → textIds: ["2021-1104"], articleRefs: ["article 191", "article 192"] (loi Climat et Résilience)
- décret ZAN, objectifs artificialisation 2031 → textIds: ["2023-372"]
- VEFA, vente future achèvement → articleRefs: ["article L261-1", "article L261-10"] (CCH)
- SCI, cession de parts → articleRefs: ["article 726"] (CGI), articleRefs: ["article 150 UB"] (CGI)

Question : `

export async function extractLegalEntities(
  userQuery: string,
  openRouterChat: (messages: any[], model: string, maxTokens: number) => Promise<string>
): Promise<LegalEntities> {
  const fallback: LegalEntities = { textIds: [], articleRefs: [], topics: [] }

  try {
    const raw = await openRouterChat(
      [{ role: 'user', content: EXTRACTION_PROMPT + userQuery }],
      'openai/gpt-4o-mini',
      256
    )

    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '')
    const parsed = JSON.parse(cleaned) as Partial<LegalEntities>

    return {
      textIds: Array.isArray(parsed.textIds) ? parsed.textIds : [],
      articleRefs: Array.isArray(parsed.articleRefs) ? parsed.articleRefs : [],
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
    }
  } catch (err) {
    console.error('[legifrance] extractLegalEntities — parsing échoué :', err)
    return fallback
  }
}

// ---------------------------------------------------------------------------
// 3. Récupération texte LEGI (textes consolidés)
// ---------------------------------------------------------------------------

export interface LegiTextResult {
  textId: string
  title: string
  content: string
  dateVersion: string
  url: string
}

export async function fetchLegiText(
  textId: string,
  token: string
): Promise<LegiTextResult | null> {
  const apiUrl = process.env.PISTE_API_URL ?? 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app'
  const endpoint = `${apiUrl}/consult/legi/getTextContent`

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        textId,
        date: new Date().toISOString().split('T')[0],
      }),
    })

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      console.error(`[legifrance] fetchLegiText — erreur HTTP ${response.status} pour textId="${textId}"`)
      return null
    }

    const data = await response.json()

    // La structure exacte dépend de l'API DILA ; on tente les chemins courants
    const text = data?.text ?? data?.result ?? data ?? {}

    return {
      textId,
      title: text.title ?? text.titre ?? '',
      content: text.content ?? text.texte ?? text.articles?.map((a: any) => a.content ?? a.texte ?? '').join('\n\n') ?? '',
      dateVersion: text.dateVersion ?? text.dateDebut ?? '',
      url: `https://www.legifrance.gouv.fr/loda/id/${textId}`,
    }
  } catch (err) {
    console.error(`[legifrance] fetchLegiText — exception pour textId="${textId}" :`, err)
    return null
  }
}

// ---------------------------------------------------------------------------
// 4. Recherche LEGI par mots-clés
// ---------------------------------------------------------------------------

export async function fetchLegiArticles(
  articleRefs: string[],
  token: string
): Promise<LegiTextResult[]> {
  const apiUrl = process.env.PISTE_API_URL ?? 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app'
  const endpoint = `${apiUrl}/search`
  const results: LegiTextResult[] = []

  for (const ref of articleRefs.slice(0, 5)) {
    const match = ref.match(/article\s+(\S+)/i)
    if (!match) continue
    const artNum = match[1]

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          recherche: {
            champs: [{ typeChamp: 'NUM_ARTICLE', criteres: [{ typeRecherche: 'EXACTE', valeur: artNum, operateur: 'ET' }], operateur: 'ET' }],
            pageNumber: 1, pageSize: 1,
            sort: 'PERTINENCE', typePagination: 'DEFAUT',
            operateur: 'ET', fromAdvancedRecherche: false,
          },
          fond: 'CODE_DATE',
        }),
      })

      if (!response.ok) {
        console.error(`[legifrance] fetchLegiArticles — HTTP ${response.status} pour "${ref}"`)
        continue
      }

      const data = await response.json()
      const result = data?.results?.[0]
      if (!result) continue

      const extract = result.sections?.[0]?.extracts?.[0]
      if (!extract) continue

      const codeName = result.titles?.[0]?.title ?? ''
      const content = (extract.values ?? []).join(' ')
      if (!content) continue

      results.push({
        textId: extract.id ?? '',
        title: `${codeName} — Article ${artNum}`,
        content,
        dateVersion: extract.dateVersion ?? '',
        url: `https://www.legifrance.gouv.fr/codes/article_lc/${extract.id}`,
      })
    } catch (err) {
      console.error(`[legifrance] fetchLegiArticles — exception pour "${ref}" :`, err)
    }
  }

  return results
}

export async function searchLegiTexts(
  query: string,
  token: string
): Promise<LegiTextResult[]> {
  const apiUrl = process.env.PISTE_API_URL ?? 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app'
  const endpoint = `${apiUrl}/search`

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        recherche: {
          champs: [
            {
              typeChamp: 'ALL',
              criteres: [
                {
                  typeRecherche: 'UN_DES_MOTS',
                  valeur: query,
                  operateur: 'ET',
                },
              ],
              operateur: 'ET',
            },
          ],
          pageNumber: 1,
          pageSize: 5,
          sort: 'PERTINENCE',
          typePagination: 'DEFAUT',
          operateur: 'ET',
          fromAdvancedRecherche: false,
        },
        fond: 'CODE_DATE',
      }),
    })

    if (!response.ok) {
      console.error(`[legifrance] searchLegiTexts — erreur HTTP ${response.status} pour query="${query}"`)
      return []
    }

    const data = await response.json()
    const rawResults: any[] = data?.results ?? data?.hits ?? []
    const mapped: LegiTextResult[] = []

    for (const item of rawResults.slice(0, 5)) {
      const codeName = item.titles?.[0]?.title ?? item.title ?? item.titre ?? ''
      const extracts: any[] = item.sections?.flatMap((s: any) => s.extracts ?? []) ?? []
      if (extracts.length > 0) {
        // Structure CODE_DATE : articles dans sections.extracts
        for (const ext of extracts.slice(0, 2)) {
          const content = (ext.values ?? []).join(' ')
          if (!content) continue
          mapped.push({
            textId: ext.id ?? '',
            title: `${codeName} — Article ${ext.num ?? ext.title ?? ''}`,
            content,
            dateVersion: ext.dateVersion ?? '',
            url: ext.id ? `https://www.legifrance.gouv.fr/codes/article_lc/${ext.id}` : 'https://www.legifrance.gouv.fr',
          })
        }
      } else {
        // Structure LEGI classique
        const textId = item.id ?? item.textId ?? item.cid ?? ''
        mapped.push({
          textId,
          title: codeName,
          content: item.extract ?? item.content ?? item.texte ?? '',
          dateVersion: item.dateVersion ?? item.dateDebut ?? '',
          url: textId ? `https://www.legifrance.gouv.fr/loda/id/${textId}` : 'https://www.legifrance.gouv.fr',
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
// 5. Pipeline principal fetchLegalContext
// ---------------------------------------------------------------------------

export interface DilaContext {
  texts: LegiTextResult[]
  available: boolean
  fallbackMessage?: string
}

export async function fetchLegalContext(
  userQuery: string,
  openRouterChat: (messages: any[], model: string, maxTokens: number) => Promise<string>
): Promise<DilaContext> {
  if (!process.env.PISTE_CLIENT_ID || !process.env.PISTE_CLIENT_SECRET) {
    return {
      texts: [],
      available: false,
      fallbackMessage:
        'Les variables d\'environnement PISTE_CLIENT_ID et PISTE_CLIENT_SECRET ne sont pas configurées.',
    }
  }

  try {
    const token = await getAccessToken()
    const entities = await extractLegalEntities(userQuery, openRouterChat)

    console.log('[legifrance] extractLegalEntities =>', JSON.stringify(entities))

    const texts: LegiTextResult[] = []

    // Récupération directe par textId (max 3)
    const textIdsToFetch = entities.textIds.slice(0, 3)
    console.log('[legifrance] textIds à fetcher =>', textIdsToFetch)
    for (const textId of textIdsToFetch) {
      const result = await fetchLegiText(textId, token)
      console.log(`[legifrance] fetchLegiText(${textId}) =>`, result ? `OK title="${result.title}" contentLen=${result.content?.length}` : 'NULL')
      if (result) {
        texts.push(result)
      }
    }

    // Récupération directe par articleRef (articles de code — ex: art. 595 Code civil)
    if (texts.length === 0 && entities.articleRefs.length > 0) {
      console.log('[legifrance] articleRefs à fetcher =>', entities.articleRefs)
      const articleTexts = await fetchLegiArticles(entities.articleRefs, token)
      console.log('[legifrance] fetchLegiArticles résultats =>', articleTexts.length)
      texts.push(...articleTexts)
    }

    // Si aucun texte trouvé via textId/articleRef, recherche par topics
    if (texts.length === 0 && entities.topics.length > 0) {
      const topicQuery = entities.topics.slice(0, 2).join(' ')
      console.log('[legifrance] fallback recherche topics =>', topicQuery)
      const searchResults = await searchLegiTexts(topicQuery, token)
      console.log('[legifrance] searchLegiTexts résultats =>', searchResults.length)
      texts.push(...searchResults)
    }

    // Fallback : recherche directe sur la question si toujours rien
    if (texts.length === 0) {
      console.log('[legifrance] fallback recherche question brute')
      const safeQuery = [...userQuery].slice(0, 100).join('')
      const directResults = await searchLegiTexts(safeQuery, token)
      console.log('[legifrance] searchLegiTexts (brute) résultats =>', directResults.length)
      texts.push(...directResults)
    }

    return {
      texts,
      available: true,
    }
  } catch (err) {
    console.error('[legifrance] fetchLegalContext — API DILA indisponible :', err)
    return {
      texts: [],
      available: false,
      fallbackMessage:
        'Le service Légifrance est temporairement indisponible. La réponse est basée sur les connaissances générales du modèle.',
    }
  }
}
