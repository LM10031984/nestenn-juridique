import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const resultsDir = join(process.cwd(), 'scripts', 'benchmark-results')

try {
  const files = readdirSync(resultsDir).filter(f => f.endsWith('.json') && !f.includes('compare'))

  if (files.length === 0) {
    console.log('❌ Aucun fichier JSON de résultat trouvé dans scripts/benchmark-results/')
    process.exit(0)
  }

  // On prend le fichier le plus récent par ordre alphabétique (qui correspond à la date grâce au format ISO)
  const latestFile = files.sort().reverse()[0]
  const data = JSON.parse(readFileSync(join(resultsDir, latestFile), 'utf-8'))

  const avgDurationMs = data.results.length > 0 ? data.results.reduce((acc: any, r: any) => acc + (r.durationMs || 0), 0) / data.results.length : 0;

  const rows = [
    ['SYNTHÈSE', `Total Questions: ${data.evaluated}`, `Moyenne Score: ${data.globalRate}%`, `Coût Total: ${data.totalCost?.toFixed(4)} €`, `Temps moyen: ${(avgDurationMs / 1000).toFixed(1)}s`, '', '', '', '', ''],
    ['ID', 'Theme', 'Validation Juridique', 'Sources Légifrance Citées', 'Mots-Cles Trouves', 'Tokens Estimes', 'Investissement API (€)', 'Duree (s)', 'Status', 'Question']
  ]

  for (const r of data.results) {
    const isSlow = r.durationMs > 25000;
    const noRefs = !r.refsFound;
    const status = (isSlow || noRefs) ? '⚠️ Attention' : '';
    const durationSec = (r.durationMs / 1000).toFixed(1) + 's';
    const costPer1000 = ((r.costEur || 0) * 1000).toFixed(4);

    rows.push([
      r.id,
      r.theme,
      r.judgeScore === true ? 'PASS' : r.judgeScore === false ? 'FAIL' : (r.skipReason || 'SKIP'),
      r.refsFound ? 'OUI' : 'NON',
      r.keywordsFound ? 'OUI' : 'NON',
      r.tokensUsed,
      costPer1000,
      durationSec,
      status,
      // Échapper les guillemets pour le CSV
      `"${(r.question || '').replace(/"/g, '""')}"`
    ])
  }

  const csvContent = rows.map(row => row.join(';')).join('\n')
  const outPath = join(resultsDir, latestFile.replace('.json', '.csv'))
  writeFileSync(outPath, csvContent)

  console.log(`\n✅ Export CSV généré avec succès :`)
  console.log(`   📂 ${outPath}\n`)
  console.log(`📊 Résumé du fichier exporté :`)
  console.log(`   Modèle       : ${data.model}`)
  console.log(`   Questions    : ${data.evaluated}`)
  console.log(`   Précision    : ${data.globalRate}%`)
  console.log(`   Coût total   : ${data.totalCost?.toFixed(4)} €\n`)

} catch (error) {
  console.error('❌ Erreur lors de l\'export CSV:', error)
}
