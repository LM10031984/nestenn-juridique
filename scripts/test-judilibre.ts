// scripts/test-judilibre.ts
// Diagnostic: test Judilibre search + /decision text extraction
// Usage: npx dotenv-cli -e .env.local -- npx tsx scripts/test-judilibre.ts

const TOKEN_URL = 'https://oauth.piste.gouv.fr/api/oauth/token'
const JUDILIBRE_URL = 'https://api.piste.gouv.fr/cassation/judilibre/v1.0'

async function main() {
  // Auth
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.PISTE_CLIENT_ID!,
      client_secret: process.env.PISTE_CLIENT_SECRET!,
      scope: 'openid',
    }),
  })
  const { access_token } = await tokenRes.json() as { access_token: string }
  console.log('Token OK\n')

  // Search CC
  const params = new URLSearchParams({
    query: 'bail habitation loyer',
    page_size: '5',
    page_number: '1',
    operator: 'or',
    sort: 'scorepub',
    resolve_references: 'false',
  })
  params.append('publication', 'b')
  params.append('publication', 'r')
  params.append('field', 'summary')
  params.append('field', 'motivations')
  params.append('type', 'arret')
  params.append('chamber', 'civ3')

  const searchRes = await fetch(`${JUDILIBRE_URL}/search?${params}`, {
    headers: { Authorization: `Bearer ${access_token}` },
  })
  const searchData = await searchRes.json() as any
  console.log('Search results:', searchData.results?.length ?? 0)
  console.log('Total:', searchData.total ?? '?')

  for (const r of (searchData.results ?? []).slice(0, 3)) {
    console.log(`\n--- ${r.number} (${r.decision_date}) ID=${r.id} ---`)
    const hlMotiv = (r.highlights?.motivations ?? []).join(' ').replace(/<\/?em>/g, '')
    console.log('Highlight motivations:', hlMotiv.length, 'chars')
    if (hlMotiv.length > 0) console.log('  Preview:', hlMotiv.slice(0, 150))

    // Fetch decision
    const decRes = await fetch(`${JUDILIBRE_URL}/decision?id=${r.id}&resolve_references=true`, {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    if (!decRes.ok) {
      console.log('Decision fetch FAILED:', decRes.status)
      continue
    }
    const dec = await decRes.json() as any
    console.log('Top-level keys:', Object.keys(dec).join(', '))

    // Check zones
    const zones = dec.zones ?? {}
    const zoneKeys = Object.keys(zones)
    console.log('Zones:', zoneKeys.length > 0 ? zoneKeys.join(', ') : 'EMPTY')
    for (const [k, v] of Object.entries(zones)) {
      const arr = Array.isArray(v) ? v : [v]
      const totalLen = arr.reduce((sum: number, e: any) => {
        if (typeof e === 'string') return sum + e.length
        return sum + (e?.texte ?? e?.text ?? '').length
      }, 0)
      console.log(`  ${k}: ${arr.length} entries, ${totalLen} chars`)
    }

    // Fallbacks
    if (dec.titlesAndSummaries) {
      const ts = dec.titlesAndSummaries
      console.log('titlesAndSummaries keys:', Object.keys(ts).join(', '))
      const intro = ts.introduction ?? ''
      const decision = ts.decision ?? ''
      console.log('  intro:', intro.length, 'chars | decision:', decision.length, 'chars')
    }

    // Direct text fields
    for (const field of ['texte_integral', 'text', 'content', 'motivations']) {
      if (dec[field]) console.log(`${field}:`, typeof dec[field] === 'string' ? dec[field].length + ' chars' : typeof dec[field])
    }
  }
}

main().catch(console.error)
