// scripts/debug-search.ts
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/debug-search.ts

const TOKEN_URL = 'https://oauth.piste.gouv.fr/api/oauth/token'
const API_URL = 'https://api.piste.gouv.fr/cassation/judilibre/v1.0'

async function getToken(): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.PISTE_CLIENT_ID!,
      client_secret: process.env.PISTE_CLIENT_SECRET!,
      scope: 'openid',
    }),
  })
  const d = await res.json() as { access_token: string }
  console.log('token ok')
  return d.access_token
}

async function test(label: string, params: Record<string, string | string[]>, token: string) {
  const u = new URL(`${API_URL}/search`)
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach(x => u.searchParams.append(k, x))
    else u.searchParams.set(k, v)
  }
  console.log(`\n${label}`)
  console.log('  URL:', u.toString())
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (r.ok) {
    const d = await r.json() as { results?: unknown[]; total?: number }
    console.log(`  → ${r.status} — total=${d.total ?? '?'} résultats=${d.results?.length ?? 0}`)
  } else {
    const txt = await r.text()
    console.log(`  → ${r.status} ERROR: ${txt.slice(0, 200)}`)
  }
}

async function main() {
  const token = await getToken()
  const q = 'bail habitation locataire impayé'

  await test('1. query seul', { query: q, page_size: '2' }, token)
  await test("2. + theme (bail d'habitation)", { query: q, theme: "bail d'habitation", page_size: '2' }, token)
  await test('3. + chamber=civ3', { query: q, chamber: 'civ3', page_size: '2' }, token)
  await test('4. + publication=[b,r] (multiple)', { query: q, publication: ['b', 'r'], page_size: '2' }, token)
  await test('5. + publication=b (unique)', { query: q, publication: 'b', page_size: '2' }, token)
  await test('6. + field=sommaire', { query: q, field: ['sommaire'], page_size: '2' }, token)
  await test('7. + field=titrage', { query: q, field: ['titrage'], page_size: '2' }, token)
  await test('8. + operator=and', { query: q, operator: 'and', page_size: '2' }, token)
  await test('9. + sort=score', { query: q, sort: 'score', page_size: '2' }, token)
  await test('10. combiné sans field', {
    query: q, theme: "bail d'habitation", chamber: 'civ3', publication: ['b', 'r'], sort: 'score', page_size: '3',
  }, token)
}

main()
