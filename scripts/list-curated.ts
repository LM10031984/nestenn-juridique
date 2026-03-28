/**
 * scripts/list-curated.ts
 * Lister et supprimer les curated existants
 *
 * Usage :
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/list-curated.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/list-curated.ts --delete <source_id>
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/list-curated.ts --delete-article <law_id> <article_num>
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const args = process.argv.slice(2)

async function main() {
  // ── Soft-delete d'un arrêt curated ────────────────────────────────────────
  if (args.includes('--delete')) {
    const sourceId = args[args.indexOf('--delete') + 1]
    if (!sourceId) { console.error('Usage : --delete <source_id>'); process.exit(1) }

    const { error } = await supabase
      .from('jurisprudence')
      .update({ deleted_at: new Date().toISOString() })
      .eq('source_id', sourceId)
      .eq('curated', true)

    if (error) console.error('❌ Erreur:', error.message)
    else console.log(`✅ Supprimé (soft-delete) : ${sourceId}`)
    return
  }

  // ── Soft-delete d'un article curated ──────────────────────────────────────
  if (args.includes('--delete-article')) {
    const idx = args.indexOf('--delete-article')
    const lawId     = args[idx + 1]
    const articleNum = args[idx + 2]
    if (!lawId || !articleNum) { console.error('Usage : --delete-article <law_id> <article_num>'); process.exit(1) }

    const { error } = await supabase
      .from('legal_articles')
      .update({ deleted_at: new Date().toISOString() })
      .eq('law_id', lawId)
      .ilike('article_num', articleNum)

    if (error) console.error('❌ Erreur:', error.message)
    else console.log(`✅ Supprimé (soft-delete) : ${lawId} art. ${articleNum}`)
    return
  }

  // ── Liste des curated ──────────────────────────────────────────────────────
  const [juriRes, artRes] = await Promise.all([
    supabase
      .from('jurisprudence')
      .select('source_id, court, number, domain, situation, url, indexed_at')
      .eq('curated', true)
      .is('deleted_at', null)
      .order('indexed_at', { ascending: false }),

    supabase
      .from('legal_articles')
      .select('law_id, article_num, title, domain, url, indexed_at')
      .ilike('law_id', 'CURATED-%')
      .is('deleted_at', null)
      .order('indexed_at', { ascending: false }),
  ])

  const juriRows  = juriRes.data ?? []
  const artRows   = artRes.data ?? []
  const total     = juriRows.length + artRows.length

  console.log(`\n=== ${total} CURATED ACTIFS ===\n`)

  if (juriRows.length > 0) {
    console.log(`── Jurisprudence (${juriRows.length}) ─────────────────────`)
    for (const r of juriRows) {
      console.log(`  source_id : ${r.source_id}`)
      console.log(`  court=${r.court} | n°${r.number ?? 'sans-numero'} | domain=${r.domain}`)
      console.log(`  situation : ${r.situation?.slice(0, 90)}...`)
      if (r.url) console.log(`  url : ${r.url}`)
      console.log()
    }
  }

  if (artRows.length > 0) {
    console.log(`── Articles de loi (${artRows.length}) ────────────────────`)
    for (const r of artRows) {
      console.log(`  law_id : ${r.law_id} | art. ${r.article_num} | domain=${r.domain}`)
      console.log(`  ${r.title}`)
      if (r.url) console.log(`  url : ${r.url}`)
      console.log()
    }
  }

  if (total === 0) console.log('Aucun curated dans la base.\n')

  console.log('─────────────────────────────────────────────────────────')
  console.log('Supprimer un arrêt    : npx tsx scripts/list-curated.ts --delete <source_id>')
  console.log('Supprimer un article  : npx tsx scripts/list-curated.ts --delete-article <law_id> <article_num>\n')
}

main().catch(console.error)
