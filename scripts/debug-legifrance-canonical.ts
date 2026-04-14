// scripts/debug-legifrance-canonical.ts
// Test : /search/canonicalArticleVersion et /search/nearestVersion
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/debug-legifrance-canonical.ts

const TOKEN_URL = process.env.PISTE_TOKEN_URL ?? 'https://oauth.piste.gouv.fr/api/oauth/token'
const API_BASE  = process.env.PISTE_API_URL   ?? 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app'

const TODAY = new Date().toISOString().split('T')[0]

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
// 2. Helper générique POST → affiche résultat ou erreur
// ---------------------------------------------------------------------------

async function postEndpoint(
  token: string,
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const url = `${API_BASE}/${endpoint}`

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`POST /${endpoint}`)
  console.log('payload :', JSON.stringify(payload))

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })

  console.log(`status  : ${res.status}`)

  const raw = await res.text()

  if (!res.ok) {
    console.log('body brut :', raw.slice(0, 600))
    return
  }

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    console.log('body brut (non-JSON) :', raw.slice(0, 600))
    return
  }

  // Affiche les clés de premier niveau + valeurs courtes
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>
    console.log('clés JSON reçues :')
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) {
        console.log(`  ${k} : null`)
      } else if (typeof v === 'object') {
        const preview = JSON.stringify(v).slice(0, 200)
        console.log(`  ${k} : ${preview}${preview.length === 200 ? '…' : ''}`)
      } else {
        console.log(`  ${k} : ${v}`)
      }
    }
  } else if (Array.isArray(data)) {
    console.log(`réponse tableau (${(data as unknown[]).length} élément(s)) :`)
    for (const item of (data as unknown[]).slice(0, 3)) {
      console.log(' ', JSON.stringify(item).slice(0, 200))
    }
  } else {
    console.log('réponse :', raw.slice(0, 300))
  }
}

// ---------------------------------------------------------------------------
// 3. Main
// ---------------------------------------------------------------------------

async function main() {
  const token = await getToken()

  // ── canonicalArticleVersion ───────────────────────────────────────────────
  // Hypothèse payload : cidText (LEGITEXT) + articleNum + date (optionnel)

  await postEndpoint(token, 'search/canonicalArticleVersion', {
    cidText:    'LEGITEXT000006072665', // Code de la santé publique
    articleNum: 'L.1331-1',
    date:       TODAY,
  })

  await postEndpoint(token, 'search/canonicalArticleVersion', {
    cidText:    'LEGITEXT000006072665',
    articleNum: 'L.1331-8',
    date:       TODAY,
  })

  // Variante sans date (l'API l'accepte peut-être seule)
  await postEndpoint(token, 'search/canonicalArticleVersion', {
    cidText:    'LEGITEXT000006072665',
    articleNum: 'L.1331-8',
  })

  // ── nearestVersion ────────────────────────────────────────────────────────
  // Hypothèse payload : cidText (LEGITEXT) + date

  await postEndpoint(token, 'search/nearestVersion', {
    cidText: 'LEGITEXT000006070721', // Code civil
    date:    TODAY,
  })

  // Variante avec articleNum si le payload l'accepte
  await postEndpoint(token, 'search/nearestVersion', {
    cidText:    'LEGITEXT000006070721',
    articleNum: '1240',
    date:       TODAY,
  })
}

main().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
