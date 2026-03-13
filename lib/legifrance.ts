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
              typeChamp: 'TITLE',
              criteres: [
                {
                  typeRecherche: 'TOUS_LES_MOTS_EXACTES',
                  valeur: query,
                },
              ],
            },
          ],
          pageNumber: 1,
          pageSize: 5,
          sort: 'PERTINENCE',
          typePagination: 'DEFAUT',
        },
        fond: 'LEGI',
      }),
    })

    if (!response.ok) {
      console.error(`[legifrance] searchLegiTexts — erreur HTTP ${response.status} pour query="${query}"`)
      return []
    }

    const data = await response.json()
    const results: any[] = data?.results ?? data?.hits ?? []

    return results.slice(0, 5).map((item: any) => {
      const textId = item.id ?? item.textId ?? item.cid ?? ''
      return {
        textId,
        title: item.title ?? item.titre ?? '',
        content: item.extract ?? item.content ?? item.texte ?? '',
        dateVersion: item.dateVersion ?? item.dateDebut ?? '',
        url: textId ? `https://www.legifrance.gouv.fr/loda/id/${textId}` : 'https://www.legifrance.gouv.fr',
      }
    })
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

    const texts: LegiTextResult[] = []

    // Récupération directe par textId (max 3)
    const textIdsToFetch = entities.textIds.slice(0, 3)
    for (const textId of textIdsToFetch) {
      const result = await fetchLegiText(textId, token)
      if (result) {
        texts.push(result)
      }
    }

    // Si aucun texte trouvé via textId, recherche par topics
    if (texts.length === 0 && entities.topics.length > 0) {
      const topicQuery = entities.topics.slice(0, 2).join(' ')
      const searchResults = await searchLegiTexts(topicQuery, token)
      texts.push(...searchResults)
    }

    // Fallback : recherche directe sur la question si toujours rien
    if (texts.length === 0) {
      const directResults = await searchLegiTexts(userQuery.slice(0, 100), token)
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
