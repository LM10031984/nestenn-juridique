// scripts/debug-legifrance-search.ts
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/debug-legifrance-search.ts

const TOKEN_URL = 'https://oauth.piste.gouv.fr/api/oauth/token'
const API_BASE  = process.env.PISTE_API_URL ?? 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app'

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
  return d.access_token
}

async function post(label: string, token: string, body: object) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`📤 ${label}`)
  const res = await fetch(`${API_BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (res.ok) {
    const d = await res.json() as { totalResultNumber?: number; results?: any[] }
    const first = d.results?.[0]
    const artNum = first?.sections?.[0]?.extracts?.[0]?.num ?? '?'
    console.log(`✅ HTTP ${res.status} — total=${d.totalResultNumber ?? '?'} premier_art=${artNum}`)
  } else {
    const txt = await res.text()
    console.log(`❌ HTTP ${res.status} — ${txt.slice(0, 300)}`)
  }
}

async function main() {
  const token = await getToken()
  console.log('Token OK')

  // Test 1 : NUM_ARTICLE seul sans filtre (référence)
  await post('1. NUM_ARTICLE=24 seul (sans TEXT_ID)', token, {
    fond: 'CODE_DATE',
    recherche: {
      champs: [{ typeChamp: 'NUM_ARTICLE', criteres: [{ typeRecherche: 'EXACTE', valeur: '24', operateur: 'ET' }], operateur: 'ET' }],
      pageNumber: 1, pageSize: 1, sort: 'PERTINENCE', typePagination: 'DEFAUT', operateur: 'ET', fromAdvancedRecherche: false,
    },
  })

  // Test 2 : filtres TEXT_ID format { facette, valeur }
  await post('2. filtres=[{ facette:"TEXT_ID", valeur:"LEGITEXT000006069108" }]', token, {
    fond: 'CODE_DATE',
    recherche: {
      champs: [{ typeChamp: 'NUM_ARTICLE', criteres: [{ typeRecherche: 'EXACTE', valeur: '24', operateur: 'ET' }], operateur: 'ET' }],
      filtres: [{ facette: 'TEXT_ID', valeur: 'LEGITEXT000006069108' }],
      pageNumber: 1, pageSize: 1, sort: 'PERTINENCE', typePagination: 'DEFAUT', operateur: 'ET', fromAdvancedRecherche: false,
    },
  })

  // Test 3 : filtres TEXT_ID format { typeRecherche, valeur }
  await post('3. filtres=[{ typeRecherche:"TEXT_ID", valeur:"LEGITEXT..." }]', token, {
    fond: 'CODE_DATE',
    recherche: {
      champs: [{ typeChamp: 'NUM_ARTICLE', criteres: [{ typeRecherche: 'EXACTE', valeur: '24', operateur: 'ET' }], operateur: 'ET' }],
      filtres: [{ typeRecherche: 'TEXT_ID', valeur: 'LEGITEXT000006069108' }],
      pageNumber: 1, pageSize: 1, sort: 'PERTINENCE', typePagination: 'DEFAUT', operateur: 'ET', fromAdvancedRecherche: false,
    },
  })

  // Test 4 : champ TEXT_ID dans champs[] plutôt que filtres
  await post('4. champs=[NUM_ARTICLE + TEXT_ID en criteres]', token, {
    fond: 'CODE_DATE',
    recherche: {
      champs: [
        { typeChamp: 'NUM_ARTICLE', criteres: [{ typeRecherche: 'EXACTE', valeur: '24', operateur: 'ET' }], operateur: 'ET' },
        { typeChamp: 'TEXT_ID', criteres: [{ typeRecherche: 'EXACTE', valeur: 'LEGITEXT000006069108', operateur: 'ET' }], operateur: 'ET' },
      ],
      pageNumber: 1, pageSize: 1, sort: 'PERTINENCE', typePagination: 'DEFAUT', operateur: 'ET', fromAdvancedRecherche: false,
    },
  })

  // Test 5 : champ ALL avec "art. 24 bail 89-462"
  await post('5. typeChamp=ALL "article 24 loi 89-462"', token, {
    fond: 'CODE_DATE',
    recherche: {
      champs: [{ typeChamp: 'ALL', criteres: [{ typeRecherche: 'UN_DES_MOTS', valeur: 'article 24 bail habitation 89-462', operateur: 'ET' }], operateur: 'ET' }],
      pageNumber: 1, pageSize: 1, sort: 'PERTINENCE', typePagination: 'DEFAUT', operateur: 'ET', fromAdvancedRecherche: false,
    },
  })

  // Test 6 : consult/legi/getTextContent pour la loi 89-462
  console.log(`\n${'─'.repeat(60)}`)
  console.log('📤 6. POST /consult/legi/getTextContent pour loi 89-462')
  const r6 = await fetch(`${API_BASE}/consult/legi/getTextContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ textId: 'LEGITEXT000006069108', date: new Date().toISOString().split('T')[0] }),
  })
  console.log(`HTTP ${r6.status}`, r6.ok ? '— OK' : await r6.text().then(t => t.slice(0, 200)))
}

main()
