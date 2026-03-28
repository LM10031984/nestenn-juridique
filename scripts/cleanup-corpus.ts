/**
 * scripts/cleanup-corpus.ts
 * Supprime définitivement les entrées soft-deleted (deleted_at IS NOT NULL)
 *
 * Usage :
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/cleanup-corpus.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/cleanup-corpus.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  console.log(`\n=== NETTOYAGE CORPUS${DRY_RUN ? ' (DRY-RUN)' : ''} ===\n`)

  // Compter les soft-deleted dans chaque table
  const [artCount, juriCount] = await Promise.all([
    supabase
      .from('legal_articles')
      .select('*', { count: 'exact', head: true })
      .not('deleted_at', 'is', null),
    supabase
      .from('jurisprudence')
      .select('*', { count: 'exact', head: true })
      .not('deleted_at', 'is', null),
  ])

  const totalArticles = artCount.count ?? 0
  const totalJuri     = juriCount.count ?? 0

  console.log(`  legal_articles  : ${totalArticles} entrée(s) à supprimer`)
  console.log(`  jurisprudence   : ${totalJuri} entrée(s) à supprimer`)
  console.log(`  Total           : ${totalArticles + totalJuri}\n`)

  if (totalArticles + totalJuri === 0) {
    console.log('Rien à nettoyer.\n')
    return
  }

  if (DRY_RUN) {
    console.log('(dry-run — aucune suppression effectuée)\n')
    return
  }

  const errors: string[] = []

  if (totalArticles > 0) {
    const { error } = await supabase
      .from('legal_articles')
      .delete()
      .not('deleted_at', 'is', null)
    if (error) errors.push(`legal_articles: ${error.message}`)
    else console.log(`✅ ${totalArticles} article(s) supprimé(s)`)
  }

  if (totalJuri > 0) {
    const { error } = await supabase
      .from('jurisprudence')
      .delete()
      .not('deleted_at', 'is', null)
    if (error) errors.push(`jurisprudence: ${error.message}`)
    else console.log(`✅ ${totalJuri} arrêt(s) supprimé(s)`)
  }

  if (errors.length > 0) {
    console.error('\n❌ Erreurs :', errors.join('\n'))
  } else {
    console.log(`\n✅ Nettoyage terminé — ${totalArticles + totalJuri} entrée(s) supprimée(s)\n`)
  }
}

main().catch(console.error)
