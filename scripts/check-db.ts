import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
)

async function main() {
  const r1 = await sb.from('legal_articles').select('*', { count: 'exact', head: true })
  const r2 = await sb.from('jurisprudence').select('*', { count: 'exact', head: true })
  const r3 = await sb.from('jurisprudence').select('*', { count: 'exact', head: true }).eq('curated', true)
  console.log(`Articles: ${r1.count} | Jurisprudence: ${r2.count} | Curated: ${r3.count}`)

  const { data: laws } = await sb.from('legal_articles').select('law_id')
  const lc: Record<string, number> = {}
  for (const r of laws ?? []) lc[r.law_id] = (lc[r.law_id] ?? 0) + 1
  console.log('\nArticles par loi:')
  for (const [l, c] of Object.entries(lc).sort((a, b) => b[1] - a[1])) console.log(`  ${l}: ${c}`)

  const { data: doms } = await sb.from('jurisprudence').select('domain')
  const dc: Record<string, number> = {}
  for (const r of doms ?? []) dc[r.domain] = (dc[r.domain] ?? 0) + 1
  console.log('\nJurisprudence par domaine:')
  for (const [d, c] of Object.entries(dc).sort((a, b) => b[1] - a[1])) console.log(`  ${d}: ${c}`)

  // Check columns available
  const { data: sample } = await sb.from('legal_articles').select('*').limit(1)
  if (sample?.[0]) {
    console.log('\nColonnes legal_articles:', Object.keys(sample[0]).join(', '))
  }
  const { data: sample2 } = await sb.from('jurisprudence').select('*').limit(1)
  if (sample2?.[0]) {
    console.log('Colonnes jurisprudence:', Object.keys(sample2[0]).join(', '))
  }
}

main().catch(console.error)
