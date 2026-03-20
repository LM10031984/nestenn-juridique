// scripts/check-apis.ts
// Diagnostic des APIs PISTE (Légifrance + Judilibre)
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/check-apis.ts

const TIMEOUT_MS = 8000
const API_BASE = process.env.PISTE_API_URL ?? 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app'
const TOKEN_URL = process.env.PISTE_TOKEN_URL ?? 'https://oauth.piste.gouv.fr/api/oauth/token'
const JUDILIBRE_BASE = process.env.JUDILIBRE_API_URL ?? 'https://api.piste.gouv.fr/cassation/judilibre/v1.0'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout (${ms}ms)`)), ms)
    ),
  ])
}

function ok(label: string, ms: number, excerpt: string) {
  console.log(`✅ ${label} — ${ms}ms`)
  console.log(`   └─ ${excerpt.slice(0, 120).replace(/\s+/g, ' ')}`)
}

function fail(label: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  console.log(`❌ ${label}`)
  console.log(`   └─ ${msg}`)
}

// ---------------------------------------------------------------------------
// 1. Token OAuth2
// ---------------------------------------------------------------------------

async function getToken(): Promise<string> {
  const clientId = process.env.PISTE_CLIENT_ID
  const clientSecret = process.env.PISTE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('PISTE_CLIENT_ID ou PISTE_CLIENT_SECRET manquant dans .env.local')
  }

  const t0 = Date.now()
  const res = await withTimeout(
    fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'openid',
      }).toString(),
    }),
    TIMEOUT_MS
  )

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} — ${txt.slice(0, 100)}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }
  ok('OAuth2 PISTE (token)', Date.now() - t0, `expires_in=${data.expires_in}s — token length=${data.access_token.length}`)
  return data.access_token
}

// ---------------------------------------------------------------------------
// 2. Légifrance — recherche CODE_DATE
// ---------------------------------------------------------------------------

async function testLegifrance(token: string) {
  const t0 = Date.now()
  const res = await withTimeout(
    fetch(`${API_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        recherche: {
          champs: [{
            typeChamp: 'ALL',
            criteres: [{ typeRecherche: 'UN_DES_MOTS', valeur: 'bail habitation', operateur: 'ET' }],
            operateur: 'ET',
          }],
          pageNumber: 1, pageSize: 3,
          sort: 'PERTINENCE', typePagination: 'DEFAUT',
          operateur: 'ET', fromAdvancedRecherche: false,
        },
        fond: 'CODE_DATE',
      }),
    }),
    TIMEOUT_MS
  )

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  const data = await res.json() as { results?: any[]; totalResultNumber?: number }
  const count = data.totalResultNumber ?? data.results?.length ?? 0
  const first = data.results?.[0]
  const codeName = first?.titles?.[0]?.title ?? first?.title ?? '(aucun)'
  const artTitle = first?.sections?.[0]?.extracts?.[0]?.num ?? ''
  const excerpt = artTitle ? `${codeName} — art. ${artTitle}` : codeName

  ok(`Légifrance /search "bail habitation" (${count} résultats)`, Date.now() - t0, excerpt)
}

// ---------------------------------------------------------------------------
// 3. Légifrance — consult/legi/getTextContent (loi 89-462)
// ---------------------------------------------------------------------------

async function testLegifranceText(token: string) {
  const t0 = Date.now()
  const res = await withTimeout(
    fetch(`${API_BASE}/consult/lawDecree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ textId: '89-462', date: new Date().toISOString().split('T')[0] }),
    }),
    TIMEOUT_MS
  )

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  const data = await res.json() as any
  const text = data?.text ?? data?.legalDocument ?? data?.result ?? data ?? {}
  const title = text.title ?? text.titre ?? JSON.stringify(text).slice(0, 60)

  ok(`Légifrance /consult/lawDecree textId=89-462`, Date.now() - t0, title)
}

async function testLegifranceGetArticle(token: string) {
  const t0 = Date.now()
  // Article 595 du Code civil (LEGIARTI connu)
  const res = await withTimeout(
    fetch(`${API_BASE}/consult/getArticle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: '595' }),
    }),
    TIMEOUT_MS
  )

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  const data = await res.json() as any
  const article = data?.article ?? data
  const content = article?.texte ?? article?.content ?? JSON.stringify(article).slice(0, 80)

  ok(`Légifrance /consult/getArticle id=595`, Date.now() - t0, content)
}

// ---------------------------------------------------------------------------
// 4. Judilibre — recherche
// ---------------------------------------------------------------------------

async function testJudilibre(token: string) {
  const t0 = Date.now()
  const url = new URL(`${JUDILIBRE_BASE}/search`)
  url.searchParams.set('query', 'agent immobilier devoir conseil')
  url.searchParams.set('page_size', '3')

  const res = await withTimeout(
    fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }),
    TIMEOUT_MS
  )

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  const data = await res.json() as { results?: any[]; total?: number }
  const count = data.total ?? data.results?.length ?? 0
  const first = data.results?.[0]
  const excerpt = first
    ? `${first.chamber ?? ''} ${first.decision_date ?? ''} — ${(first.summary ?? first.text ?? '').slice(0, 80)}`
    : '(aucun résultat)'

  ok(`Judilibre /search "agent immobilier devoir conseil" (${count} résultats)`, Date.now() - t0, excerpt)
}

// ---------------------------------------------------------------------------
// 5. Judilibre — taxonomy (GET)
// ---------------------------------------------------------------------------

async function testJudiLibreTaxonomy(
  token: string,
  id: string,
  contextValue?: string
) {
  const label = contextValue
    ? `Judilibre /taxonomy?id=${id}&context_value=${contextValue}`
    : `Judilibre /taxonomy?id=${id}`
  const t0 = Date.now()
  const url = new URL(`${JUDILIBRE_BASE}/taxonomy`)
  url.searchParams.set('id', id)
  if (contextValue) url.searchParams.set('context_value', contextValue)

  const res = await withTimeout(
    fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }),
    TIMEOUT_MS
  )

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} — ${(await res.text().catch(() => '')).slice(0, 120)}`)
  }

  const data = await res.json() as unknown
  const ms = Date.now() - t0

  // Normalise la réponse en tableau clé/valeur
  let entries: Array<{ key: string; val: string }> = []
  if (Array.isArray(data)) {
    entries = data.map((e: any) => ({
      key: e?.id ?? e?.key ?? e?.value ?? JSON.stringify(e).slice(0, 40),
      val: e?.label ?? e?.text ?? e?.name ?? '',
    }))
  } else if (data && typeof data === 'object') {
    // Peut être { result: [...] } ou { key: label, ... }
    const raw = data as Record<string, any>
    const inner = raw.result ?? raw.results ?? raw.data ?? null
    if (Array.isArray(inner)) {
      entries = inner.map((e: any) => ({
        key: e?.id ?? e?.key ?? e?.value ?? JSON.stringify(e).slice(0, 40),
        val: e?.label ?? e?.text ?? e?.name ?? '',
      }))
    } else if (raw.result && typeof raw.result === 'object' && !Array.isArray(raw.result)) {
      // { id, context_value, result: { key: label } }
      entries = Object.entries(raw.result as Record<string, string>).map(([k, v]) => ({
        key: k,
        val: typeof v === 'string' ? v : JSON.stringify(v),
      }))
    } else {
      // Objet plat { key: label }
      entries = Object.entries(raw).map(([k, v]) => ({
        key: k,
        val: typeof v === 'string' ? v : JSON.stringify(v).slice(0, 80),
      }))
    }
  }

  console.log(`✅ ${label} — ${ms}ms — ${entries.length} entrée(s)`)
  for (const { key, val } of entries) {
    console.log(`   • ${key}${val ? ' → ' + val : ''}`)
  }
  if (entries.length === 0) {
    console.log(`   └─ (réponse brute) ${JSON.stringify(data).slice(0, 300)}`)
  }
}

// ---------------------------------------------------------------------------
// 6. Légifrance — POST /suggest (réponse brute + champs SuggestValue)
// ---------------------------------------------------------------------------

const SUGGEST_QUERIES = [
  'locataire impayé commandement de payer',
  'copropriété assemblée générale contestation',
  'agent immobilier devoir de conseil',
]

async function testLegifranceSuggest(token: string) {
  for (const searchText of SUGGEST_QUERIES) {
    console.log('\n' + '─'.repeat(70))
    console.log(`📤 POST /suggest  { searchText: "${searchText}" }`)
    console.log('─'.repeat(70))

    const t0 = Date.now()
    let res: Response
    try {
      res = await withTimeout(
        fetch(`${API_BASE}/suggest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ searchText }),
        }),
        TIMEOUT_MS
      )
    } catch (err) {
      fail(`/suggest "${searchText}"`, err)
      continue
    }

    console.log(`HTTP ${res.status} ${res.statusText}  (${Date.now() - t0}ms)`)

    const raw = await res.text()
    let data: any
    try {
      data = JSON.parse(raw)
    } catch {
      console.log('⚠️  Réponse non-JSON :', raw.slice(0, 300))
      continue
    }

    // Réponse brute complète
    console.log('\n📦 Réponse brute complète :')
    console.log(JSON.stringify(data, null, 2))

    // Extraction des SuggestValue
    const items: any[] = data?.results ?? data?.suggestions ?? data?.values ?? []
    if (items.length === 0) {
      console.log(`\n⚠️  Aucun item — clés racine : ${Object.keys(data).join(', ')}`)
    } else {
      console.log(`\n📋 ${items.length} SuggestValue(s)`)
      for (const [i, item] of items.entries()) {
        console.log(`\n  [${i}]`)
        console.log(`    id        : ${item.id ?? '—'}`)
        console.log(`    idTexte   : ${item.idTexte ?? '—'}`)
        console.log(`    origin    : ${item.origin ?? item.source ?? '—'}`)
        console.log(`    nature    : ${item.nature ?? item.type ?? '—'}`)
        console.log(`    label     : ${item.label ?? item.title ?? item.text ?? '—'}`)
        const known = new Set(['id', 'idTexte', 'origin', 'source', 'nature', 'type', 'label', 'title', 'text'])
        const extra = Object.entries(item).filter(([k]) => !known.has(k))
        if (extra.length > 0) {
          console.log(`    +extra    : ${extra.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`)
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Légifrance — POST /search CODE_ETAT art. 24 (LEGITEXT000006069108)
// ---------------------------------------------------------------------------

async function testLegifranceSearchArticle24(token: string) {
  console.log('\n' + '─'.repeat(70))
  console.log('📤 POST /search  CODE_ETAT — art. 24 — LEGITEXT000006069108')
  console.log('─'.repeat(70))

  const t0 = Date.now()
  const body = {
    fond: 'CODE_ETAT',
    recherche: {
      champs: [{
        typeChamp: 'NUM_ARTICLE',
        criteres: [{ typeRecherche: 'EXACTE', valeur: '24', operateur: 'ET' }],
        operateur: 'ET',
      }],
      filtres: [
        { facette: 'ETAT_JURIDIQUE', valeurs: ['VIGUEUR'] },
        { facette: 'TEXT_ID', valeurs: ['LEGITEXT000006069108'] },
      ],
      operateur: 'ET',
      pageSize: 1,
      pageNumber: 1,
      sort: 'PERTINENCE',
      typePagination: 'DEFAUT',
    },
  }

  console.log('📦 Body envoyé :', JSON.stringify(body, null, 2))

  let res: Response
  try {
    res = await withTimeout(
      fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
      TIMEOUT_MS
    )
  } catch (err) {
    fail('/search CODE_ETAT art.24', err)
    return
  }

  console.log(`\nHTTP ${res.status} ${res.statusText}  (${Date.now() - t0}ms)`)

  const raw = await res.text()
  let data: any
  try {
    data = JSON.parse(raw)
  } catch {
    console.log('⚠️  Réponse non-JSON :', raw.slice(0, 400))
    return
  }

  // Infos générales
  console.log(`\ntotalResultNumber : ${data?.totalResultNumber ?? '—'}`)
  console.log(`results.length    : ${data?.results?.length ?? 0}`)

  const result0 = data?.results?.[0]
  if (!result0) {
    console.log('\n⚠️  Aucun résultat — réponse brute :')
    console.log(JSON.stringify(data, null, 2).slice(0, 800))
    return
  }

  // Titre du texte
  const title = result0?.titles?.[0]?.title ?? result0?.title ?? '(sans titre)'
  console.log(`\ntitle             : ${title}`)

  // sections[0].extracts[0].values[]
  const section0 = result0?.sections?.[0]
  const extract0 = section0?.extracts?.[0]
  const values: string[] = extract0?.values ?? []

  console.log(`\nsections[0].extracts[0].num    : ${extract0?.num ?? '—'}`)
  console.log(`sections[0].extracts[0].title  : ${extract0?.title ?? '—'}`)
  console.log(`sections[0].extracts[0].values : ${values.length} élément(s)`)

  for (const [i, v] of values.entries()) {
    const len = v.length
    const debut = v.slice(0, 200)
    const fin = len > 200 ? v.slice(-200) : ''
    console.log(`\n  values[${i}] — longueur totale : ${len} caractères`)
    console.log(`  DÉBUT  : ${debut}`)
    if (fin) {
      console.log(`  …`)
      console.log(`  FIN    : ${fin}`)
    }
    if (len < 300) {
      console.log(`  → Probablement un EXTRAIT (< 300 car.)`)
    } else if (len < 2000) {
      console.log(`  → Extrait moyen (~${len} car.) — peut être tronqué`)
    } else {
      console.log(`  → Texte long (${len} car.) — probablement complet`)
    }
  }

  if (values.length === 0) {
    console.log('\n⚠️  values[] vide — structure complète du result[0] :')
    console.log(JSON.stringify(result0, null, 2).slice(0, 1200))
  }
}

// ---------------------------------------------------------------------------
// 8b. TEST /suggest — termes courts : numéros de loi et thèmes clés
// ---------------------------------------------------------------------------

const SUGGEST_QUERIES_COURTS = [
  '89-462',
  'loi bail habitation',
  'copropriété 65-557',
]

async function testLegifranceSuggestCourt(token: string) {
  console.log('\n' + '═'.repeat(70))
  console.log('🧪 TEST /suggest — termes courts (numéros de loi + thèmes)')
  console.log('═'.repeat(70))

  for (const searchText of SUGGEST_QUERIES_COURTS) {
    console.log('\n' + '─'.repeat(60))
    console.log(`📤 POST /suggest  { searchText: "${searchText}" }`)
    console.log('─'.repeat(60))

    const t0 = Date.now()
    let res: Response
    try {
      res = await withTimeout(
        fetch(`${API_BASE}/suggest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ searchText }),
        }),
        TIMEOUT_MS
      )
    } catch (err) {
      fail(`/suggest "${searchText}"`, err)
      continue
    }

    console.log(`HTTP ${res.status} ${res.statusText}  (${Date.now() - t0}ms)`)
    const raw = await res.text()
    let data: any
    try { data = JSON.parse(raw) } catch { console.log('⚠️  Non-JSON :', raw.slice(0, 300)); continue }

    const total = data?.totalResultNumber ?? data?.total ?? '—'
    console.log(`\ntotalResultNumber : ${total}`)

    const items: any[] = data?.results ?? data?.suggestions ?? data?.values ?? []
    console.log(`items retournés   : ${items.length}`)

    if (items.length === 0) {
      console.log(`\n⚠️  Aucun item — clés racine : ${Object.keys(data ?? {}).join(', ')}`)
      console.log('Réponse brute :', JSON.stringify(data, null, 2).slice(0, 400))
      continue
    }

    const top3 = items.slice(0, 3)
    console.log(`\nTop ${top3.length} SuggestValue :`)
    for (const [i, item] of top3.entries()) {
      console.log(`\n  [${i}]`)
      console.log(`    id        : ${item.id ?? '—'}`)
      console.log(`    idTexte   : ${item.idTexte ?? '—'}`)
      console.log(`    origin    : ${item.origin ?? item.source ?? '—'}`)
      console.log(`    nature    : ${item.nature ?? item.type ?? '—'}`)
      console.log(`    label     : ${item.label ?? item.title ?? item.text ?? '—'}`)
    }
  }
}

// ---------------------------------------------------------------------------
// 8. TEST 1 — Légifrance /search CODE_ETAT art.24 + contexte "commandement payer bail habitation"
// ---------------------------------------------------------------------------

async function testLegifranceArt24AvecContexte(token: string) {
  console.log('\n' + '═'.repeat(70))
  console.log('🧪 TEST 1 — POST /search CODE_ETAT — art.24 + TEXTE commandement payer')
  console.log('═'.repeat(70))

  const body = {
    fond: 'CODE_ETAT',
    recherche: {
      champs: [
        {
          typeChamp: 'NUM_ARTICLE',
          criteres: [{ typeRecherche: 'EXACTE', valeur: '24', operateur: 'ET' }],
          operateur: 'ET',
        },
        {
          typeChamp: 'TEXTE',
          criteres: [{ typeRecherche: 'TOUS_LES_MOTS_DANS_UN_CHAMP', valeur: 'commandement payer bail habitation', proximite: 3, operateur: 'ET' }],
          operateur: 'ET',
        },
      ],
      filtres: [
        { facette: 'ETAT_JURIDIQUE', valeurs: ['VIGUEUR'] },
        { facette: 'TEXT_ID', valeurs: ['LEGITEXT000006069108'] },
      ],
      operateur: 'ET',
      pageSize: 1,
      pageNumber: 1,
      sort: 'PERTINENCE',
      typePagination: 'DEFAUT',
    },
  }

  console.log('\n📦 Body :', JSON.stringify(body, null, 2))

  const t0 = Date.now()
  let res: Response
  try {
    res = await withTimeout(
      fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
      TIMEOUT_MS
    )
  } catch (err) {
    fail('TEST 1 /search CODE_ETAT art.24+contexte', err)
    return
  }

  console.log(`\nHTTP ${res.status} ${res.statusText}  (${Date.now() - t0}ms)`)
  const raw = await res.text()
  let data: any
  try { data = JSON.parse(raw) } catch { console.log('⚠️  Non-JSON :', raw.slice(0, 400)); return }

  console.log(`\ntotalResultNumber : ${data?.totalResultNumber ?? '—'}`)
  console.log(`results.length    : ${data?.results?.length ?? 0}`)

  const result0 = data?.results?.[0]
  if (!result0) {
    console.log('\n⚠️  Aucun résultat — réponse brute :')
    console.log(JSON.stringify(data, null, 2).slice(0, 800))
    return
  }

  const title = result0?.titles?.[0]?.title ?? result0?.title ?? '(sans titre)'
  console.log(`\ntitle             : ${title}`)

  const extract0 = result0?.sections?.[0]?.extracts?.[0]
  const values: string[] = extract0?.values ?? []
  console.log(`\nsections[0].extracts[0].num    : ${extract0?.num ?? '—'}`)
  console.log(`sections[0].extracts[0].title  : ${extract0?.title ?? '—'}`)
  console.log(`sections[0].extracts[0].id     : ${extract0?.id ?? '—'}`)
  console.log(`sections[0].extracts[0].values : ${values.length} élément(s)`)

  for (const [i, v] of values.entries()) {
    const len = v.length
    console.log(`\n  values[${i}] — longueur totale : ${len} caractères`)
    console.log(`  DÉBUT  : ${v.slice(0, 300)}`)
    if (len > 300) {
      console.log(`  …`)
      console.log(`  FIN    : ${v.slice(-300)}`)
    }
  }

  if (values.length === 0) {
    console.log('\n⚠️  values[] vide — structure complète result[0] :')
    console.log(JSON.stringify(result0, null, 2).slice(0, 1500))
  }
}

// ---------------------------------------------------------------------------
// 9. TEST 2 — Judilibre /search puis /decision avec zones + visa + highlights
// ---------------------------------------------------------------------------

async function testJudilibreDecisionZones(token: string) {
  console.log('\n' + '═'.repeat(70))
  console.log('🧪 TEST 2 — Judilibre /search puis /decision avec zones')
  console.log('═'.repeat(70))

  // Étape 1 : /search pour récupérer le premier ID
  const searchUrl = new URL(`${JUDILIBRE_BASE}/search`)
  searchUrl.searchParams.set('query', 'commandement payer clause résolutoire bail')
  searchUrl.searchParams.set('chamber', 'civ3')
  searchUrl.searchParams.set('page_size', '1')

  console.log('\n📤 GET /search :', searchUrl.toString())
  const t0 = Date.now()
  let searchRes: Response
  try {
    searchRes = await withTimeout(
      fetch(searchUrl.toString(), {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      }),
      TIMEOUT_MS
    )
  } catch (err) {
    fail('TEST 2 /search Judilibre', err)
    return
  }

  console.log(`HTTP ${searchRes.status} ${searchRes.statusText}  (${Date.now() - t0}ms)`)
  const searchRaw = await searchRes.text()
  let searchData: any
  try { searchData = JSON.parse(searchRaw) } catch { console.log('⚠️  Non-JSON :', searchRaw.slice(0, 300)); return }

  const results = searchData?.results ?? []
  console.log(`\ntotal résultats   : ${searchData?.total ?? '—'}`)
  console.log(`results.length    : ${results.length}`)

  const firstId: string | undefined = results[0]?.id
  if (!firstId) {
    console.log('\n⚠️  Aucun résultat — réponse brute :')
    console.log(JSON.stringify(searchData, null, 2).slice(0, 800))
    return
  }

  console.log(`\nPremier ID trouvé : ${firstId}`)
  console.log(`  jurisdiction  : ${results[0]?.jurisdiction ?? '—'}`)
  console.log(`  chamber       : ${results[0]?.chamber ?? '—'}`)
  console.log(`  decision_date : ${results[0]?.decision_date ?? '—'}`)
  console.log(`  number        : ${results[0]?.number ?? '—'}`)

  // Étape 2 : /decision
  const decisionUrl = new URL(`${JUDILIBRE_BASE}/decision`)
  decisionUrl.searchParams.set('id', firstId)
  decisionUrl.searchParams.set('resolve_references', 'true')

  console.log('\n📤 GET /decision :', decisionUrl.toString())
  const t1 = Date.now()
  let decRes: Response
  try {
    decRes = await withTimeout(
      fetch(decisionUrl.toString(), {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      }),
      TIMEOUT_MS
    )
  } catch (err) {
    fail('TEST 2 /decision Judilibre', err)
    return
  }

  console.log(`HTTP ${decRes.status} ${decRes.statusText}  (${Date.now() - t1}ms)`)
  const decRaw = await decRes.text()
  let dec: any
  try { dec = JSON.parse(decRaw) } catch { console.log('⚠️  Non-JSON :', decRaw.slice(0, 400)); return }

  // zones.motivations[0]
  const motiv0 = dec?.zones?.motivations?.[0]
  console.log('\n── zones.motivations[0] ──')
  if (motiv0) {
    console.log(`  start : ${motiv0.start}`)
    console.log(`  end   : ${motiv0.end}`)
    const fullText: string = dec?.text ?? ''
    const slice = fullText.slice(motiv0.start, motiv0.end)
    console.log(`  longueur du segment : ${slice.length} caractères`)
    console.log(`\n  DÉBUT (500 car.) :\n  ${slice.slice(0, 500)}`)
  } else {
    console.log('  ⚠️  zones.motivations absent ou vide')
    console.log(`  Clés zones disponibles : ${Object.keys(dec?.zones ?? {}).join(', ') || '(aucune)'}`)
  }

  // visa[0]
  const visa0 = dec?.visa?.[0]
  console.log('\n── visa[0] ──')
  if (visa0) {
    console.log(`  id    : ${visa0?.id ?? '—'}`)
    console.log(`  url   : ${visa0?.url ?? '—'}`)
    console.log(`  title : ${visa0?.title ?? '—'}`)
    // Autres champs
    const known = new Set(['id', 'url', 'title'])
    const extra = Object.entries(visa0).filter(([k]) => !known.has(k))
    if (extra.length) console.log(`  +extra: ${extra.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`)
  } else {
    console.log('  ⚠️  visa absent ou vide')
  }
  console.log(`  visa.length total : ${dec?.visa?.length ?? 0}`)

  // highlights
  console.log('\n── highlights ──')
  const hl = dec?.highlights
  if (hl && Object.keys(hl).length > 0) {
    console.log(JSON.stringify(hl, null, 2).slice(0, 800))
  } else {
    console.log('  (aucun highlight)')
  }

  // Clés racine disponibles
  console.log('\n── Clés racine de la décision ──')
  console.log('  ' + Object.keys(dec).join(', '))
}

// ---------------------------------------------------------------------------
// 10. Pipeline complet : Judilibre search → decision → suggest → lawDecree
// ---------------------------------------------------------------------------

async function testPipelineComplet(token: string) {
  console.log('\n' + '═'.repeat(70))
  console.log('🧪 PIPELINE COMPLET — Judilibre → decision → suggest → lawDecree')
  console.log('═'.repeat(70))

  // ── Étape 1 : GET /search Judilibre ────────────────────────────────────
  console.log('\n── ÉTAPE 1 : GET /search Judilibre ──')
  const searchUrl = new URL(`${JUDILIBRE_BASE}/search`)
  searchUrl.searchParams.set('query', 'commandement payer clause résolutoire')
  searchUrl.searchParams.set('theme', 'bail d\'habitation')
  searchUrl.searchParams.append('chamber', 'civ3')
  searchUrl.searchParams.append('publication', 'b')
  searchUrl.searchParams.append('publication', 'r')
  searchUrl.searchParams.set('operator', 'and')
  searchUrl.searchParams.set('page_size', '3')
  searchUrl.searchParams.set('resolve_references', 'true')

  console.log('URL :', searchUrl.toString())
  const t0 = Date.now()
  let searchData: any
  try {
    const res = await withTimeout(
      fetch(searchUrl.toString(), {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      }),
      TIMEOUT_MS
    )
    console.log(`HTTP ${res.status} ${res.statusText}  (${Date.now() - t0}ms)`)
    const raw = await res.text()
    try { searchData = JSON.parse(raw) } catch { console.log('⚠️  Non-JSON :', raw.slice(0, 300)); return }
  } catch (err) {
    fail('ÉTAPE 1 /search Judilibre', err); return
  }

  const results: any[] = searchData?.results ?? []
  console.log(`\ntotal  : ${searchData?.total ?? '—'}`)
  console.log(`retour : ${results.length} résultat(s)`)
  if (results.length === 0) {
    console.log('⚠️  Aucun résultat — réponse brute :', JSON.stringify(searchData, null, 2).slice(0, 600))
    return
  }
  for (const [i, r] of results.entries()) {
    console.log(`  [${i}] ${r.number ?? '—'}  ${r.decision_date ?? '—'}  ${r.chamber ?? '—'}  solution=${r.solution ?? '—'}`)
  }

  // ── Étape 2 : GET /decision ────────────────────────────────────────────
  console.log('\n── ÉTAPE 2 : GET /decision ──')
  const firstId: string = results[0]?.id
  if (!firstId) { console.log('⚠️  Pas d\'ID sur le premier résultat'); return }

  const decUrl = new URL(`${JUDILIBRE_BASE}/decision`)
  decUrl.searchParams.set('id', firstId)
  decUrl.searchParams.set('resolve_references', 'true')

  console.log('URL :', decUrl.toString())
  const t1 = Date.now()
  let dec: any
  try {
    const res = await withTimeout(
      fetch(decUrl.toString(), {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      }),
      TIMEOUT_MS
    )
    console.log(`HTTP ${res.status} ${res.statusText}  (${Date.now() - t1}ms)`)
    const raw = await res.text()
    try { dec = JSON.parse(raw) } catch { console.log('⚠️  Non-JSON :', raw.slice(0, 300)); return }
  } catch (err) {
    fail('ÉTAPE 2 /decision', err); return
  }

  console.log(`\nnumber        : ${dec?.number ?? '—'}`)
  console.log(`decision_date : ${dec?.decision_date ?? '—'}`)
  console.log(`solution      : ${dec?.solution ?? '—'}`)
  console.log(`themes        : ${JSON.stringify(dec?.themes ?? [])}`)

  const motiv0 = dec?.zones?.motivations?.[0]
  console.log('\nzones.motivations[0] :')
  if (motiv0) {
    console.log(`  start=${motiv0.start}  end=${motiv0.end}`)
    const segment: string = (dec?.text ?? '').slice(motiv0.start, motiv0.end)
    console.log(`  longueur segment : ${segment.length} car.`)
    console.log(`\n  500 premiers caractères :`)
    console.log(`  ${segment.slice(0, 500)}`)
  } else {
    console.log(`  ⚠️  Absent — zones dispo : ${Object.keys(dec?.zones ?? {}).join(', ')}`)
  }

  const visas: any[] = dec?.visa ?? []
  console.log(`\nvisa[] (${visas.length} entrée(s)) :`)
  for (const [i, v] of visas.entries()) {
    console.log(`  [${i}] title : ${v?.title ?? '—'}`)
    if (v?.id) console.log(`       id    : ${v.id}`)
    if (v?.url) console.log(`       url   : ${v.url}`)
  }

  if (visas.length === 0) { console.log('⚠️  Aucun visa'); return }

  // ── Étape 3 : extraction numéro de loi → POST /suggest ────────────────
  console.log('\n── ÉTAPE 3 : extraction numéro + POST /suggest ──')
  const firstVisaTitle: string = visas[0]?.title ?? ''
  console.log(`Premier visa title : "${firstVisaTitle}"`)

  // Regex : capture "XX-XXX" ou "XXX-XXXX" (numéro de loi/décret)
  const match = firstVisaTitle.match(/\b(\d{2,4}-\d{3,4})\b/)
  const lawNumber = match?.[1] ?? null
  console.log(`Numéro extrait (regex \\d{2,4}-\\d{3,4}) : ${lawNumber ?? '(aucun)'}`)

  if (!lawNumber) {
    console.log('⚠️  Impossible d\'extraire un numéro de loi — arrêt du pipeline')
    return
  }

  const t2 = Date.now()
  let suggestData: any
  try {
    const res = await withTimeout(
      fetch(`${API_BASE}/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ searchText: lawNumber }),
      }),
      TIMEOUT_MS
    )
    console.log(`\nPOST /suggest { searchText: "${lawNumber}" }`)
    console.log(`HTTP ${res.status} ${res.statusText}  (${Date.now() - t2}ms)`)
    const raw = await res.text()
    try { suggestData = JSON.parse(raw) } catch { console.log('⚠️  Non-JSON :', raw.slice(0, 300)); return }
  } catch (err) {
    fail('ÉTAPE 3 /suggest', err); return
  }

  const suggestItems: any[] = suggestData?.results ?? []
  console.log(`items retournés : ${suggestItems.length}`)
  for (const [i, item] of suggestItems.slice(0, 3).entries()) {
    console.log(`  [${i}] id=${item.id ?? '—'}  nature=${item.nature ?? '—'}  label=${(item.label ?? '').slice(0, 80)}`)
  }

  const suggestId: string | null = suggestItems[0]?.id ?? null
  console.log(`\nID retenu pour /consult : ${suggestId ?? '(aucun)'}`)
  if (!suggestId) { console.log('⚠️  Pas d\'ID — arrêt'); return }

  // ── Étape 4 : POST /consult/lawDecree ─────────────────────────────────
  console.log('\n── ÉTAPE 4 : POST /consult/lawDecree ──')
  const today = new Date().toISOString().split('T')[0]

  const t3 = Date.now()
  let lawData: any
  try {
    const res = await withTimeout(
      fetch(`${API_BASE}/consult/lawDecree`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ textId: suggestId, date: today }),
      }),
      TIMEOUT_MS
    )
    console.log(`POST /consult/lawDecree { textId: "${suggestId}", date: "${today}" }`)
    console.log(`HTTP ${res.status} ${res.statusText}  (${Date.now() - t3}ms)`)
    const raw = await res.text()
    try { lawData = JSON.parse(raw) } catch { console.log('⚠️  Non-JSON :', raw.slice(0, 400)); return }
  } catch (err) {
    fail('ÉTAPE 4 /consult/lawDecree', err); return
  }

  // Normalise : cherche les articles récursivement
  function collectArticles(node: any, depth = 0): any[] {
    if (!node || typeof node !== 'object' || depth > 6) return []
    if (Array.isArray(node)) return node.flatMap((n) => collectArticles(n, depth))
    if (node.num !== undefined && (node.texte !== undefined || node.content !== undefined || node.etat !== undefined)) return [node]
    return Object.values(node).flatMap((v) => collectArticles(v, depth + 1))
  }

  // Tentatives directes puis fallback récursif
  const directArticles: any[] = Array.isArray(lawData?.articles)
    ? lawData.articles
    : lawData?.article
    ? [lawData.article]
    : []
  const fromSections: any[] = Array.isArray(lawData?.sections)
    ? lawData.sections.flatMap((s: any) => (Array.isArray(s?.articles) ? s.articles : []))
    : []

  const articles: any[] = (
    fromSections.length > 0 ? fromSections :
    directArticles.length > 0 ? directArticles :
    collectArticles(lawData)
  ).filter(Boolean)

  console.log(`\nStructure racine : ${Object.keys(lawData ?? {}).join(', ')}`)
  console.log(`Articles trouvés (total) : ${articles.length}`)

  const enVigueur = articles.filter((a: any) =>
    (a.etat ?? a.etatJuridique ?? a.etat_juridique ?? '').toUpperCase().includes('VIGUEUR')
  )
  console.log(`Articles VIGUEUR : ${enVigueur.length}`)
  if (enVigueur.length > 0) {
    console.log(`nums : ${enVigueur.map((a: any) => a.num ?? a.numero ?? '?').join(', ')}`)
  }

  // Article num='24'
  const art24 = articles.find((a: any) => String(a.num ?? a.numero ?? '').trim() === '24')
  console.log(`\nArticle num='24' :`)
  if (art24) {
    const rawContent: string = art24.texte ?? art24.content ?? art24.texteHtml ?? JSON.stringify(art24)
    // Strip HTML basique
    const stripped = rawContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    console.log(`  etat   : ${art24.etat ?? art24.etatJuridique ?? '—'}`)
    console.log(`  texte (300 car., HTML strippé) :`)
    console.log(`  ${stripped.slice(0, 300)}`)
  } else {
    console.log('  ⚠️  Non trouvé — nums disponibles :')
    console.log(`  ${articles.slice(0, 20).map((a: any) => a.num ?? a.numero ?? '?').join(', ')}`)
    console.log('\n  Réponse brute (1200 car.) :')
    console.log(JSON.stringify(lawData, null, 2).slice(0, 1200))
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🔍 Diagnostic APIs PISTE — Nestenn Juridique')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // Token
  let token: string
  try {
    token = await getToken()
  } catch (err) {
    fail('OAuth2 PISTE (token)', err)
    console.log('\n⛔ Impossible de continuer sans token.')
    process.exit(1)
  }

  console.log()

  // Légifrance search
  try {
    await testLegifrance(token)
  } catch (err) {
    fail('Légifrance /search "bail habitation"', err)
  }

  // Légifrance lawDecree
  try {
    await testLegifranceText(token)
  } catch (err) {
    fail('Légifrance /consult/lawDecree textId=89-462', err)
  }

  // Légifrance getArticle
  try {
    await testLegifranceGetArticle(token)
  } catch (err) {
    fail('Légifrance /consult/getArticle id=595', err)
  }

  // Judilibre
  try {
    await testJudilibre(token)
  } catch (err) {
    fail('Judilibre /search "agent immobilier devoir conseil"', err)
  }

  console.log()

  // Judilibre taxonomy — thèmes
  try {
    await testJudiLibreTaxonomy(token, 'theme')
  } catch (err) {
    fail('Judilibre /taxonomy?id=theme', err)
  }

  // Judilibre taxonomy — chambres CC
  try {
    await testJudiLibreTaxonomy(token, 'chamber', 'cc')
  } catch (err) {
    fail('Judilibre /taxonomy?id=chamber&context_value=cc', err)
  }

  // Judilibre taxonomy — niveaux de publication CC
  try {
    await testJudiLibreTaxonomy(token, 'publication', 'cc')
  } catch (err) {
    fail('Judilibre /taxonomy?id=publication&context_value=cc', err)
  }

  // /suggest (3 requêtes — réponse brute complète)
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🔍 Tests POST /suggest — réponse brute')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  try {
    await testLegifranceSuggest(token)
  } catch (err) {
    fail('Légifrance /suggest', err)
  }

  // /search CODE_ETAT art. 24 — profondeur du contenu
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🔍 Test POST /search CODE_ETAT — art. 24 (loi 89-462)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  try {
    await testLegifranceSearchArticle24(token)
  } catch (err) {
    fail('Légifrance /search CODE_ETAT art.24', err)
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  // TEST /suggest termes courts
  try {
    await testLegifranceSuggestCourt(token)
  } catch (err) {
    fail('TEST /suggest termes courts', err)
  }

  // TEST 1 — /search CODE_ETAT art.24 + contexte commandement payer
  try {
    await testLegifranceArt24AvecContexte(token)
  } catch (err) {
    fail('TEST 1 Légifrance /search CODE_ETAT art.24+contexte', err)
  }

  // TEST 2 — Judilibre /decision avec zones + visa + highlights
  try {
    await testJudilibreDecisionZones(token)
  } catch (err) {
    fail('TEST 2 Judilibre /decision zones', err)
  }

  // Pipeline complet
  try {
    await testPipelineComplet(token)
  } catch (err) {
    fail('Pipeline complet', err)
  }

  // TEST A — Judilibre /taxonomy?id=field
  try {
    await testJudilibreField(token)
  } catch (err) {
    fail('TEST A Judilibre /taxonomy?id=field', err)
  }

  // TEST B — Légifrance /search LODA_ETAT typeChamp VISA
  try {
    await testLegifranceLodaVisa(token)
  } catch (err) {
    fail('TEST B Légifrance /search LODA_ETAT VISA', err)
  }

  // TEST C — Légifrance /search LODA_ETAT NUM_ARTICLE 24
  try {
    await testLegifranceLodaNumArticle(token)
  } catch (err) {
    fail('TEST C Légifrance /search LODA_ETAT NUM_ARTICLE', err)
  }

  // TEST D — Judilibre /search field=visa + particularInterest
  try {
    await testJudilibreFieldVisa(token)
  } catch (err) {
    fail('TEST D Judilibre /search field=visa particularInterest', err)
  }

  // TEST E — /decision 22-19.117 (2023) visa[] complet + getArticle
  try {
    await testJudilibreDecision2023(token)
  } catch (err) {
    fail('TEST E /decision 2023 visa[] complet', err)
  }

  // TEST F — /decision avec query= → text_highlight
  try {
    await testJudilibreDecisionHighlight(token)
  } catch (err) {
    fail('TEST F /decision + query highlight', err)
  }

  // TEST G — Judilibre /search field=visa sans particularInterest
  try {
    await testJudilibreSearchVisa(token)
  } catch (err) {
    fail('TEST G /search field=visa 89-462 art.24', err)
  }

  // TEST H — /consult/getArticleWithIdAndNum JORFTEXT + num=24
  try {
    await testLegifranceGetArticleWithIdAndNum(token)
  } catch (err) {
    fail('TEST H /consult/getArticleWithIdAndNum', err)
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

// ---------------------------------------------------------------------------
// TEST A — GET /taxonomy?id=field — tous les champs de recherche Judilibre
// ---------------------------------------------------------------------------

async function testJudilibreField(token: string) {
  console.log('\n' + '═'.repeat(70))
  console.log('🧪 TEST A — GET /taxonomy?id=field (champs de recherche Judilibre)')
  console.log('═'.repeat(70))

  const url = new URL(`${JUDILIBRE_BASE}/taxonomy`)
  url.searchParams.set('id', 'field')
  console.log('URL :', url.toString())

  const t0 = Date.now()
  const res = await withTimeout(
    fetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }),
    TIMEOUT_MS
  )
  console.log(`HTTP ${res.status} ${res.statusText}  (${Date.now() - t0}ms)`)

  const raw = await res.text()
  let data: any
  try { data = JSON.parse(raw) } catch { console.log('⚠️  Non-JSON :', raw.slice(0, 300)); return }

  console.log('\n📦 Réponse brute complète :')
  console.log(JSON.stringify(data, null, 2))
}

// ---------------------------------------------------------------------------
// TEST B — POST /search Légifrance LODA_ETAT typeChamp VISA "89-462"
// ---------------------------------------------------------------------------

async function testLegifranceLodaVisa(token: string) {
  console.log('\n' + '═'.repeat(70))
  console.log('🧪 TEST B — POST /search LODA_ETAT — typeChamp VISA "89-462"')
  console.log('═'.repeat(70))

  const body = {
    fond: 'LODA_ETAT',
    recherche: {
      champs: [{
        typeChamp: 'VISA',
        criteres: [{ typeRecherche: 'EXACTE', valeur: '89-462', operateur: 'ET' }],
        operateur: 'ET',
      }],
      operateur: 'ET',
      pageSize: 3,
      pageNumber: 1,
      sort: 'PERTINENCE',
      typePagination: 'DEFAUT',
    },
  }

  console.log('📦 Body :', JSON.stringify(body, null, 2))
  const t0 = Date.now()
  const res = await withTimeout(
    fetch(`${API_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
    TIMEOUT_MS
  )
  console.log(`\nHTTP ${res.status} ${res.statusText}  (${Date.now() - t0}ms)`)

  const raw = await res.text()
  let data: any
  try { data = JSON.parse(raw) } catch { console.log('⚠️  Non-JSON :', raw.slice(0, 400)); return }

  console.log('\n📦 Réponse brute complète :')
  console.log(JSON.stringify(data, null, 2))
}

// ---------------------------------------------------------------------------
// TEST C — POST /search Légifrance LODA_ETAT NUM_ARTICLE "24"
// ---------------------------------------------------------------------------

async function testLegifranceLodaNumArticle(token: string) {
  console.log('\n' + '═'.repeat(70))
  console.log('🧪 TEST C — POST /search LODA_ETAT — NUM_ARTICLE "24"')
  console.log('═'.repeat(70))

  const body = {
    fond: 'LODA_ETAT',
    recherche: {
      champs: [{
        typeChamp: 'NUM_ARTICLE',
        criteres: [{ typeRecherche: 'EXACTE', valeur: '24', operateur: 'ET' }],
        operateur: 'ET',
      }],
      operateur: 'ET',
      pageSize: 3,
      pageNumber: 1,
      sort: 'PERTINENCE',
      typePagination: 'DEFAUT',
    },
  }

  console.log('📦 Body :', JSON.stringify(body, null, 2))
  const t0 = Date.now()
  const res = await withTimeout(
    fetch(`${API_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
    TIMEOUT_MS
  )
  console.log(`\nHTTP ${res.status} ${res.statusText}  (${Date.now() - t0}ms)`)

  const raw = await res.text()
  let data: any
  try { data = JSON.parse(raw) } catch { console.log('⚠️  Non-JSON :', raw.slice(0, 400)); return }

  console.log('\n📦 Réponse brute complète :')
  console.log(JSON.stringify(data, null, 2))
}

// ---------------------------------------------------------------------------
// TEST D — GET /search Judilibre field=visa + particularInterest=true
// ---------------------------------------------------------------------------

async function testJudilibreFieldVisa(token: string) {
  console.log('\n' + '═'.repeat(70))
  console.log('🧪 TEST D — GET /search Judilibre field=visa + particularInterest=true')
  console.log('═'.repeat(70))

  const url = new URL(`${JUDILIBRE_BASE}/search`)
  url.searchParams.set('query', 'clause résolutoire bail impayé')
  url.searchParams.append('field', 'visa')
  url.searchParams.set('particularInterest', 'true')
  url.searchParams.append('chamber', 'civ3')
  url.searchParams.append('publication', 'b')
  url.searchParams.set('page_size', '3')

  console.log('URL :', url.toString())
  const t0 = Date.now()
  const res = await withTimeout(
    fetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }),
    TIMEOUT_MS
  )
  console.log(`HTTP ${res.status} ${res.statusText}  (${Date.now() - t0}ms)`)

  const raw = await res.text()
  let data: any
  try { data = JSON.parse(raw) } catch { console.log('⚠️  Non-JSON :', raw.slice(0, 400)); return }

  console.log('\n📦 Réponse brute complète :')
  console.log(JSON.stringify(data, null, 2))
}

// ---------------------------------------------------------------------------
// TEST F — /decision 22-19.117 avec query= → text_highlight
// ---------------------------------------------------------------------------

async function testJudilibreDecisionHighlight(token: string) {
  console.log('\n' + '═'.repeat(70))
  console.log('🧪 TEST F — /decision 22-19.117 avec query= → text_highlight')
  console.log('═'.repeat(70))

  // ID connu de 22-19.117 (découvert en TEST E)
  const decId = '65278d2e625e6e83183e338f'
  const url = new URL(`${JUDILIBRE_BASE}/decision`)
  url.searchParams.set('id', decId)
  url.searchParams.set('query', 'commandement payer clause résolutoire')
  url.searchParams.set('resolve_references', 'true')

  console.log('URL :', url.toString())
  const t0 = Date.now()
  const res = await withTimeout(
    fetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }),
    TIMEOUT_MS
  )
  console.log(`HTTP ${res.status} ${res.statusText}  (${Date.now() - t0}ms)`)
  const dec: any = await res.json()

  // Clés racine
  console.log(`\nClés racine : ${Object.keys(dec).join(', ')}`)

  // text_highlight / highlights / highlight
  const hlKeys = Object.keys(dec).filter(k => k.toLowerCase().includes('highlight'))
  console.log(`Clés highlight détectées : ${hlKeys.join(', ') || '(aucune)'}`)
  for (const k of hlKeys) {
    console.log(`\n── ${k} ──`)
    console.log(JSON.stringify(dec[k], null, 2).slice(0, 1000))
  }

  // zones — affiche le texte de chaque zone
  console.log(`\n── zones ──`)
  const zones = dec?.zones ?? {}
  const fullText: string = dec?.text ?? ''
  console.log(`Texte total : ${fullText.length} caractères`)
  for (const [zone, segs] of Object.entries(zones)) {
    const arr = Array.isArray(segs) ? segs : [segs]
    console.log(`\n  ${zone} (${arr.length} segment(s)) :`)
    for (const [i, seg] of (arr as any[]).entries()) {
      const slice = fullText.slice(seg.start, seg.end)
      console.log(`    [${i}] start=${seg.start} end=${seg.end} len=${slice.length}`)
      console.log(`    → ${slice.slice(0, 300)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// TEST G — Judilibre /search field=visa sans particularInterest — 89-462 art.24
// ---------------------------------------------------------------------------

async function testJudilibreSearchVisa(token: string) {
  console.log('\n' + '═'.repeat(70))
  console.log("🧪 TEST G — /search field=visa '89-462 article 24' sans particularInterest")
  console.log('═'.repeat(70))

  const url = new URL(`${JUDILIBRE_BASE}/search`)
  url.searchParams.set('query', '89-462 article 24')
  url.searchParams.append('field', 'visa')
  url.searchParams.append('chamber', 'civ3')
  url.searchParams.append('publication', 'b')
  url.searchParams.append('publication', 'r')
  url.searchParams.set('date_start', '2018-01-01')
  url.searchParams.set('page_size', '3')

  console.log('URL :', url.toString())
  const t0 = Date.now()
  const res = await withTimeout(
    fetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }),
    TIMEOUT_MS
  )
  console.log(`HTTP ${res.status} ${res.statusText}  (${Date.now() - t0}ms)`)
  const data: any = await res.json()

  console.log(`\ntotal  : ${data?.total ?? '—'}`)
  console.log(`retour : ${data?.results?.length ?? 0} résultat(s)`)

  for (const [i, r] of (data?.results ?? []).entries()) {
    console.log(`\n  [${i}] ${r.number}  ${r.decision_date}  ${r.chamber}`)
    console.log(`    solution : ${r.solution ?? '—'}`)
    console.log(`    themes   : ${JSON.stringify(r.themes ?? []).slice(0, 120)}`)
    console.log(`    summary  : ${(r.summary ?? '').slice(0, 200)}`)
    if (r.highlights) {
      console.log(`    highlights.visa : ${JSON.stringify(r.highlights?.visa ?? r.highlights).slice(0, 200)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// TEST H — /consult/getArticleWithIdAndNum { id: JORFTEXT, num: '24' }
// ---------------------------------------------------------------------------

async function testLegifranceGetArticleWithIdAndNum(token: string) {
  console.log('\n' + '═'.repeat(70))
  console.log('🧪 TEST H — POST /consult/getArticleWithIdAndNum JORFTEXT + num=24')
  console.log('═'.repeat(70))

  const body = { id: 'JORFTEXT000000509310', num: '24' }
  console.log('📦 Body :', JSON.stringify(body))

  const t0 = Date.now()
  const res = await withTimeout(
    fetch(`${API_BASE}/consult/getArticleWithIdAndNum`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
    TIMEOUT_MS
  )
  console.log(`\nHTTP ${res.status} ${res.statusText}  (${Date.now() - t0}ms)`)

  const raw = await res.text()
  let data: any
  try { data = JSON.parse(raw) } catch { console.log('⚠️  Non-JSON :', raw.slice(0, 400)); return }

  console.log('\n📦 Réponse brute complète :')
  console.log(JSON.stringify(data, null, 2).slice(0, 3000))

  // Extraction article
  const art = data?.article ?? data?.articles?.[0] ?? data
  const etat: string = art?.etat ?? art?.etatJuridique ?? '—'
  const num: string = art?.num ?? art?.numero ?? '—'
  const texte: string = art?.texte ?? art?.content ?? art?.texteHtml ?? ''
  const stripped = texte.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  console.log(`\netat    : ${etat}`)
  console.log(`num     : ${num}`)
  console.log(`longueur texte (brut) : ${texte.length} car.`)
  console.log(`\n300 premiers chars (HTML strippé) :`)
  console.log(stripped.slice(0, 300) || '(vide)')
}

// ---------------------------------------------------------------------------
// TEST E — /decision arrêt 22-19.117 (2023-10-12) — visa[] exhaustif
// ---------------------------------------------------------------------------

async function testJudilibreDecision2023(token: string) {
  console.log('\n' + '═'.repeat(70))
  console.log('🧪 TEST E — /decision 22-19.117 (2023-10-12) — visa[] complet')
  console.log('═'.repeat(70))

  // Étape 1 : récupère les 3 résultats pour prendre results[2]
  const searchUrl = new URL(`${JUDILIBRE_BASE}/search`)
  searchUrl.searchParams.set('query', 'commandement payer clause résolutoire')
  searchUrl.searchParams.set('theme', "bail d'habitation")
  searchUrl.searchParams.append('chamber', 'civ3')
  searchUrl.searchParams.append('publication', 'b')
  searchUrl.searchParams.append('publication', 'r')
  searchUrl.searchParams.set('operator', 'and')
  searchUrl.searchParams.set('page_size', '3')

  console.log('\n📤 GET /search (récupération ID de 22-19.117)...')
  const t0 = Date.now()
  const sRes = await withTimeout(
    fetch(searchUrl.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }),
    TIMEOUT_MS
  )
  console.log(`HTTP ${sRes.status}  (${Date.now() - t0}ms)`)
  const sData = await sRes.json() as any
  const results: any[] = sData?.results ?? []
  console.log(`résultats : ${results.map((r: any) => `${r.number} ${r.decision_date}`).join(' | ')}`)

  const target = results.find((r: any) => r.number === '22-19.117') ?? results[2]
  if (!target) { console.log('⚠️  Décision 22-19.117 introuvable'); return }

  const decId: string = target.id
  console.log(`\nID cible : ${decId}  (${target.number} — ${target.decision_date})`)

  // Étape 2 : /decision avec resolve_references=true
  const decUrl = new URL(`${JUDILIBRE_BASE}/decision`)
  decUrl.searchParams.set('id', decId)
  decUrl.searchParams.set('resolve_references', 'true')

  console.log(`\n📤 GET /decision?id=${decId}&resolve_references=true`)
  const t1 = Date.now()
  const dRes = await withTimeout(
    fetch(decUrl.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }),
    TIMEOUT_MS
  )
  console.log(`HTTP ${dRes.status} ${dRes.statusText}  (${Date.now() - t1}ms)`)
  const dec: any = await dRes.json()

  // Métadonnées
  console.log(`\nnumber        : ${dec?.number}`)
  console.log(`decision_date : ${dec?.decision_date}`)
  console.log(`solution      : ${dec?.solution}`)
  console.log(`ecli          : ${dec?.ecli ?? '—'}`)
  console.log(`themes        : ${JSON.stringify(dec?.themes ?? [])}`)

  // visa[] — TOUS les champs
  const visas: any[] = dec?.visa ?? []
  console.log(`\n── visa[] — ${visas.length} entrée(s) ──`)
  if (visas.length === 0) {
    console.log('⚠️  Aucun visa')
  } else {
    for (const [i, v] of visas.entries()) {
      console.log(`\n  [${i}] ─────────────────────────────────────────`)
      console.log(JSON.stringify(v, null, 4))
    }
  }

  // zones disponibles
  console.log(`\n── zones disponibles : ${Object.keys(dec?.zones ?? {}).join(', ') || '(aucune)'} ──`)
  for (const [zone, entries] of Object.entries(dec?.zones ?? {})) {
    const arr = Array.isArray(entries) ? entries : [entries]
    console.log(`  ${zone} : ${arr.length} segment(s) — ex: ${JSON.stringify(arr[0])}`)
  }

  // Test /consult/getArticle sur chaque visa.id trouvé
  const visaIds = visas.map((v: any) => v?.id).filter((id: any) => typeof id === 'string' && id.startsWith('LEGIARTI'))
  console.log(`\n── visa.id LEGIARTI trouvés : ${visaIds.length} ──`)
  if (visaIds.length === 0) {
    console.log('  (aucun LEGIARTI — /consult/getArticle ne peut pas être chaîné directement)')
  } else {
    for (const artId of visaIds) {
      console.log(`\n  📤 POST /consult/getArticle { id: "${artId}" }`)
      const t2 = Date.now()
      const aRes = await withTimeout(
        fetch(`${API_BASE}/consult/getArticle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: artId }),
        }),
        TIMEOUT_MS
      )
      console.log(`  HTTP ${aRes.status}  (${Date.now() - t2}ms)`)
      const aData: any = await aRes.json()
      const art = aData?.article ?? aData
      console.log(`  num   : ${art?.num ?? art?.numero ?? '—'}`)
      console.log(`  etat  : ${art?.etat ?? art?.etatJuridique ?? '—'}`)
      const texte: string = art?.texte ?? art?.content ?? ''
      const stripped = texte.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      console.log(`  texte : ${stripped.slice(0, 200) || JSON.stringify(art).slice(0, 200)}`)
    }
  }
}

main()
