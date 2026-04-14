// scripts/debug-legifrance-search.ts
// Test : /search puis /consult/getArticle pour des articles du Code de la santé publique
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/debug-legifrance-search.ts

const TOKEN_URL = process.env.PISTE_TOKEN_URL ?? 'https://oauth.piste.gouv.fr/api/oauth/token'
const API_BASE  = process.env.PISTE_API_URL   ?? 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app'

// LEGITEXT du Code de la santé publique
const CSP_LEGITEXT = 'LEGITEXT000006072665'

// ---------------------------------------------------------------------------
// 1. Token OAuth2
// ---------------------------------------------------------------------------

async function getToken(): Promise<string> {
  const clientId     = process.env.PISTE_CLIENT_ID
  const clientSecret = process.env.PISTE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Variables manquantes : PISTE_CLIENT_ID et/ou PISTE_CLIENT_SECRET')
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
      scope:         'openid',
    }).toString(),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Échec OAuth2 (${res.status}): ${body}`)
  }

  const data = await res.json() as { access_token: string }
  console.log('[token] OK')
  return data.access_token
}

// ---------------------------------------------------------------------------
// 2. /search NUM_ARTICLE filtré sur le CSP
// ---------------------------------------------------------------------------

interface SearchHit {
  id?: string
  cid?: string
  num?: string
  title?: string
  extract?: string
  sections?: Array<{ extracts?: Array<{ id?: string; num?: string; values?: string[] }> }>
}

async function searchArticle(token: string, articleNum: string): Promise<void> {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`SEARCH  "${articleNum}"  dans Code de la santé publique`)

  const body = {
    fond: 'CODE_DATE',
    recherche: {
      champs: [
        {
          typeChamp: 'NUM_ARTICLE',
          criteres: [{ typeRecherche: 'EXACTE', valeur: articleNum, operateur: 'ET' }],
          operateur: 'ET',
        },
      ],
      filtres: [{ facette: 'TEXT_ID', valeur: CSP_LEGITEXT }],
      pageNumber: 1,
      pageSize: 5,
      sort: 'PERTINENCE',
      typePagination: 'DEFAUT',
      operateur: 'ET',
      fromAdvancedRecherche: false,
    },
  }

  const res = await fetch(`${API_BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

  console.log(`status : ${res.status}`)

  const raw = await res.text()
  if (!res.ok) {
    console.log('body brut :', raw.slice(0, 500))
    return
  }

  let data: any
  try { data = JSON.parse(raw) } catch {
    console.log('body brut (non-JSON) :', raw.slice(0, 500))
    return
  }

  const total: number = data?.totalResultNumber ?? 0
  const results: SearchHit[] = data?.results ?? []
  console.log(`résultats : ${total} (affichés : ${results.length})`)

  // Collecter les ids depuis les extracts imbriqués
  const foundIds: string[] = []

  for (const hit of results) {
    const hitId   = hit.id ?? hit.cid ?? ''
    const hitNum  = hit.num ?? hit.title ?? ''
    const extract = hit.extract ?? ''

    // Extracts dans sections[]
    const extracts = hit.sections?.flatMap(s => s.extracts ?? []) ?? []

    if (extracts.length > 0) {
      for (const ext of extracts) {
        const extId  = ext.id ?? ''
        const extNum = ext.num ?? ''
        const extVal = (ext.values ?? []).join(' ').slice(0, 120)
        console.log(`  extract id=${extId}  num=${extNum}`)
        if (extVal) console.log(`    "${extVal}"`)
        if (extId) foundIds.push(extId)
      }
    } else {
      console.log(`  hit id=${hitId}  num=${hitNum}`)
      if (extract) console.log(`    "${extract.slice(0, 120)}"`)
      if (hitId) foundIds.push(hitId)
    }
  }

  if (foundIds.length === 0) {
    console.log('  (aucun id exploitable)')
    return
  }

  // Appel getArticle sur le premier id trouvé
  await fetchArticle(token, foundIds[0])
}

// ---------------------------------------------------------------------------
// 3. /consult/getArticle
// ---------------------------------------------------------------------------

async function fetchArticle(token: string, id: string): Promise<void> {
  console.log(`\n  → getArticle(${id})`)

  const res = await fetch(`${API_BASE}/consult/getArticle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ id }),
  })

  console.log(`  status : ${res.status}`)

  const raw = await res.text()
  if (!res.ok) {
    console.log('  body brut :', raw.slice(0, 500))
    return
  }

  let data: any
  try { data = JSON.parse(raw) } catch {
    console.log('  body brut (non-JSON) :', raw.slice(0, 500))
    return
  }

  const article = data?.article ?? data

  console.log(`  article.id   : ${article?.id        ?? '(absent)'}`)
  console.log(`  article.num  : ${article?.num        ?? '(absent)'}`)
  console.log(`  article.etat : ${article?.etat       ?? '(absent)'}`)

  const texte = (article?.texte ?? article?.texteHtml ?? '').slice(0, 500)
  if (texte) {
    console.log(`  texte preview :\n    ${texte.replace(/\n/g, '\n    ')}`)
  } else {
    console.log('  texte : (absent)')
  }
}

// ---------------------------------------------------------------------------
// 4. Main
// ---------------------------------------------------------------------------

async function main() {
  const token = await getToken()

  const queries = ['L.1331-8', 'L1331-8', 'L.1331-6', 'L.1331-1']

  for (const q of queries) {
    await searchArticle(token, q)
  }
}

main().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
