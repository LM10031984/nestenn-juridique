// scripts/debug-legifrance.ts
// Test direct de l'endpoint getArticleWithIdAndNum sur l'API PISTE
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/debug-legifrance.ts

const TOKEN_URL = process.env.PISTE_TOKEN_URL ?? 'https://oauth.piste.gouv.fr/api/oauth/token'
const API_BASE  = process.env.PISTE_API_URL   ?? 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app'

// ---------------------------------------------------------------------------
// 1. Token OAuth2 (client_credentials)
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
// 2. Test getArticleWithIdAndNum
// ---------------------------------------------------------------------------

async function testGetArticleWithIdAndNum(
  token: string,
  textId: string,
  articleNum: string,
): Promise<void> {
  const label = `${textId} / art. ${articleNum}`
  console.log(`\n── ${label} ──`)

  const res = await fetch(`${API_BASE}/consult/getArticleWithIdAndNum`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ textId, articleNum }),
  })

  console.log(`status : ${res.status}`)

  const raw = await res.text()

  if (!res.ok) {
    console.log('body brut :', raw)
    return
  }

  let data: any
  try {
    data = JSON.parse(raw)
  } catch {
    console.log('body brut (non-JSON) :', raw.slice(0, 500))
    return
  }

  // L'API peut retourner l'article sous différentes clés selon la version
  const article = data?.article ?? data

  console.log('article.id        :', article?.id       ?? '(absent)')
  console.log('article.num       :', article?.num      ?? '(absent)')
  console.log('article.etat      :', article?.etat     ?? '(absent)')
  console.log('article.dateDebut :', article?.dateDebut ?? '(absent)')
  console.log('article.dateFin   :', article?.dateFin   ?? '(absent)')
  console.log('texte présent     :', !!article?.texte)
  console.log('texteHtml présent :', !!article?.texteHtml)

  const preview = (article?.texte ?? article?.texteHtml ?? '').slice(0, 500)
  if (preview) {
    console.log('preview :\n', preview)
  } else {
    console.log('(aucun contenu texte)')
  }
}

// ---------------------------------------------------------------------------
// 3. Main
// ---------------------------------------------------------------------------

async function main() {
  const token = await getToken()

  const cases = [
    { textId: 'LEGITEXT000006072665', articleNum: 'L.1331-1' },
    { textId: 'LEGITEXT000006072665', articleNum: 'L.1331-8' },
  ]

  for (const { textId, articleNum } of cases) {
    await testGetArticleWithIdAndNum(token, textId, articleNum)
  }
}

main().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
