// scripts/check-vente-progress.ts
// Vérifie la progression de la régénération des résumés pour vente_immobiliere

import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
)

async function main() {
  const { data, error } = await sb
    .from('legal_articles')
    .select('id, article_num, content_summary, updated_at')
    .contains('domains', ['vente_immobiliere'])
    .order('updated_at', { ascending: false })

  if (error) { console.error(error); process.exit(1) }

  const total = data!.length
  let n = 0, o = 0, e = 0
  for (const a of data!) {
    if (!a.content_summary) { e++; continue }
    try {
      const s = JSON.parse(a.content_summary)
      if (s && s.situation && s.principe) n++
      else o++
    } catch { o++ }
  }
  console.log(`\n=== vente_immobiliere ===`)
  console.log(`Total articles : ${total}`)
  console.log(`Nouveau format (situation/principe/consequence) : ${n}`)
  console.log(`Ancien format ou texte brut : ${o}`)
  console.log(`Sans résumé : ${e}`)
  console.log(`Progression : ${Math.round(n/total*100)}%`)

  if (data![0]) {
    console.log(`\nDernier mis à jour : ${data![0].article_num} @ ${data![0].updated_at}`)
  }
}

main().catch(console.error)
