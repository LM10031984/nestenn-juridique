// scripts/explore-judilibre-taxonomy.ts — v4 : exploration Cours d'appel
// Usage : npx tsx scripts/explore-judilibre-taxonomy.ts

const TOKEN_URL = 'https://oauth.piste.gouv.fr/api/oauth/token'
const API_URL = 'https://api.piste.gouv.fr/cassation/judilibre/v1.0'
const CLIENT_ID = '8f3b38fe-a381-442a-bcff-b8bafbbd0d35'
const CLIENT_SECRET = 'd4841e5d-b969-416c-8188-ea9c3bf514b2'

async function getToken(): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: 'openid',
    }),
  })
  if (!res.ok) throw new Error(`Token error ${res.status}`)
  const data = await res.json() as { access_token: string }
  return data.access_token
}

async function apiGet(token: string, path: string, params: Record<string, string | string[]> = {}): Promise<any> {
  const url = new URL(`${API_URL}${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach(val => url.searchParams.append(k, val))
    else url.searchParams.set(k, v)
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${await res.text()}`)
  return res.json()
}

function section(title: string) {
  console.log('\n' + '═'.repeat(70))
  console.log(`  ${title}`)
  console.log('═'.repeat(70))
}

async function searchTest(
  token: string,
  label: string,
  params: Record<string, string | string[]>,
  showDecision = false
) {
  section(label)
  try {
    const data = await apiGet(token, '/search', { ...params, page_size: '3', resolve_references: 'true' })
    console.log(`Total : ${data.total ?? 0}  |  relaxed : ${data.relaxed}  |  took : ${data.took}ms`)
    for (const r of (data.results ?? []).slice(0, 3)) {
      const chambre = typeof r.chamber === 'string' ? r.chamber : JSON.stringify(r.chamber)
      const pub = Array.isArray(r.publication) ? r.publication.join(',') : r.publication
      console.log(`\n  n°${r.number ?? '?'} | ${r.decision_date ?? '?'} | ${r.solution ?? '?'} | pub:[${pub}]`)
      console.log(`  Juridiction : ${r.jurisdiction ?? '?'}  |  Chambre : ${chambre}`)
      console.log(`  Thèmes  : ${(r.themes ?? []).join(' > ')}`)
      if (r.summary) console.log(`  Sommaire: ${r.summary.slice(0, 200)}`)
      if (r.highlights && typeof r.highlights === 'object') {
        for (const [zone, segs] of Object.entries(r.highlights) as [string, string[]][]) {
          if (segs?.length) {
            const clean = String(segs[0]).replace(/<\/?em>/g, '«').slice(0, 130)
            console.log(`  HL[${zone}]: ${clean}`)
            break
          }
        }
      }

      // Optionnel : vérifier les zones disponibles sur la 1ère décision
      if (showDecision && r === data.results[0]) {
        try {
          const detail = await apiGet(token, '/decision', {
            id: r.id,
            query: String(params.query ?? ''),
            operator: 'or',
            resolve_references: 'true',
          })
          const zoneNames = Object.keys(detail.zones ?? {})
          const zoneSizes = zoneNames.map(z => {
            const segs2: Array<{start:number;end:number}> = detail.zones[z] ?? []
            const len = segs2.reduce((a, s) => a + (s.end - s.start), 0)
            return `${z}(${len}c)`
          })
          console.log(`  Zones : [${zoneSizes.join(', ')}]`)
          if (detail.summary) console.log(`  Summary /decision : ${detail.summary.slice(0, 150)}`)
          const raps = detail.rapprochements ?? []
          if (raps.length > 0) {
            console.log(`  Rapprochements (${raps.length}) :`)
            for (const rap of raps.slice(0, 2)) {
              console.log(`    → n°${rap.number ?? '?'} | ${rap.date ?? '?'} | ${rap.title ?? ''}`)
            }
          }
        } catch (e) {
          console.log(`  [/decision] ERREUR : ${(e as Error).message}`)
        }
      }
    }
  } catch (e) {
    console.log(`  ERREUR : ${(e as Error).message}`)
  }
}

async function main() {
  console.log('Connexion PISTE...')
  const token = await getToken()
  console.log('Token OK\n')

  // ── 1. Taxonomie CA : chambres disponibles ────────────────────────────────
  section('1. Chambres Cours d\'appel (id=chamber, context=ca)')
  try {
    const chambers = await apiGet(token, '/taxonomy', { id: 'chamber', context_value: 'ca' })
    const result = chambers.result
    if (typeof result === 'object' && !Array.isArray(result)) {
      for (const [k, v] of Object.entries(result).slice(0, 20)) {
        console.log(`  "${k}"`.padEnd(25) + ` → ${v}`)
      }
      console.log(`  ... (${Object.keys(result).length} chambres au total)`)
    } else {
      console.log(JSON.stringify(result).slice(0, 500))
    }
  } catch (e) {
    console.log(`  ERREUR : ${(e as Error).message}`)
  }

  // ── 2. Stats CA : volume par thème immobilier ─────────────────────────────
  section('2. Stats CA — volume décisions immobilières (jurisdiction=ca, keys=theme)')
  try {
    const stats = await apiGet(token, '/stats', { jurisdiction: 'ca', keys: 'theme' })
    const buckets: Array<{key: {theme: string}, decisions_count: number}> =
      stats.results?.aggregated_date ?? []
    // Filtrer sur les thèmes immobiliers qui nous intéressent
    const immoKeywords = ['bail', 'immobilier', 'copropri', 'agent', 'vente', 'diagnostic', 'locat', 'urbanisme', 'construction']
    const relevant = buckets
      .filter(b => immoKeywords.some(kw => (b.key?.theme ?? '').toLowerCase().includes(kw)))
      .sort((a, b) => b.decisions_count - a.decisions_count)
      .slice(0, 20)
    console.log(`  Total décisions CA dans la base : ${stats.results?.total_decisions ?? '?'}`)
    console.log(`  Décisions CA les plus récentes : ${stats.results?.max_decision_date ?? '?'}`)
    console.log('\n  Thèmes immobiliers CA (top 20 par volume) :')
    for (const b of relevant) {
      console.log(`    ${(b.key?.theme ?? '?').padEnd(50)} : ${b.decisions_count}`)
    }
  } catch (e) {
    console.log(`  ERREUR stats CA : ${(e as Error).message}`)
  }

  // ── 3. DPE — CA récent (le vrai test) ─────────────────────────────────────
  await searchTest(token, "3. DPE — jurisdiction=ca · field=[summary,motivations] · date>=2021", {
    query: 'diagnostic performance énergétique DPE opposable responsabilité',
    jurisdiction: 'ca',
    field: ['summary', 'motivations'],
    operator: 'or',
    date_start: '2021-07-01',
    type: ['arret'],
  }, true)

  // ── 4. Vétusté — CA (est-ce plus riche qu'en CC ?) ────────────────────────
  await searchTest(token, "4. Vétusté dégradation — jurisdiction=ca · date>=2018", {
    query: 'vétusté dégradation réparations locatives locataire',
    jurisdiction: 'ca',
    field: ['summary', 'motivations'],
    operator: 'and',
    date_start: '2018-01-01',
    type: ['arret'],
  })

  // ── 5. Condition suspensive bonne foi — CA ────────────────────────────────
  await searchTest(token, "5. Condition suspensive prêt bonne foi — jurisdiction=ca · date>=2018", {
    query: 'condition suspensive prêt refus bonne foi acquéreur',
    jurisdiction: 'ca',
    field: ['summary', 'motivations'],
    operator: 'and',
    date_start: '2018-01-01',
    type: ['arret'],
  })

  // ── 6. Agent immobilier responsabilité — CA ───────────────────────────────
  await searchTest(token, "6. Agent immobilier devoir conseil — jurisdiction=ca · date>=2019", {
    query: 'agent immobilier devoir conseil information responsabilité',
    jurisdiction: 'ca',
    field: ['summary', 'motivations'],
    operator: 'and',
    date_start: '2019-01-01',
    type: ['arret'],
  })

  // ── 7. Bail impayé — CA (comparaison volume CC vs CA) ─────────────────────
  await searchTest(token, "7. Bail impayé clause résolutoire — jurisdiction=ca · date>=2020", {
    query: 'loyer impayé clause résolutoire commandement expulsion',
    jurisdiction: 'ca',
    field: ['summary', 'motivations'],
    operator: 'and',
    date_start: '2020-01-01',
    type: ['arret'],
  })

  // ── 8. Diagnostiqueur responsabilité — CA ────────────────────────────────
  await searchTest(token, "8. Responsabilité diagnostiqueur — jurisdiction=ca · date>=2019", {
    query: 'diagnostiqueur responsabilité certification diagnostic immobilier',
    jurisdiction: 'ca',
    field: ['summary', 'motivations'],
    operator: 'and',
    date_start: '2019-01-01',
    type: ['arret'],
  })

  // ── 9. Comparaison CC+CA ensemble (jurisdiction omis = CC par défaut ?) ──
  section('9. Test : jurisdiction non spécifiée — retourne CC uniquement ou CC+CA ?')
  try {
    const noJuris = await apiGet(token, '/search', {
      query: 'bail loyer impayé',
      field: ['summary'],
      operator: 'or',
      page_size: '5',
    })
    const jurisdictions = [...new Set((noJuris.results ?? []).map((r: any) => r.jurisdiction))]
    console.log(`  Total : ${noJuris.total}`)
    console.log(`  Juridictions présentes dans les résultats : ${jurisdictions.join(', ')}`)
  } catch (e) {
    console.log(`  ERREUR : ${(e as Error).message}`)
  }

  // ── 10. CC + CA combinés — DPE ────────────────────────────────────────────
  await searchTest(token, "10. DPE — jurisdiction=[cc,ca] combinés · date>=2021", {
    query: 'diagnostic performance énergétique DPE opposable',
    jurisdiction: ['cc', 'ca'],
    field: ['summary', 'motivations'],
    operator: 'or',
    date_start: '2021-07-01',
    type: ['arret'],
  })

  console.log('\n' + '═'.repeat(70))
  console.log('  Exploration CA terminée.')
  console.log('═'.repeat(70) + '\n')
}

main().catch(err => { console.error('ERREUR FATALE :', err); process.exit(1) })
