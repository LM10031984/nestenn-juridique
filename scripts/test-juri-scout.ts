// scripts/test-juri-scout.ts
// Diagnostic direct de searchJudilibreByArticles (hors serveur).
// Usage : npx tsx scripts/test-juri-scout.ts

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envContent = readFileSync(resolve(__dirname, '../.env.local'), 'utf-8')
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

async function main() {
  const { searchJudilibreByArticles } = await import('@/lib/judilibre')

  const CANDIDATES = [
    { articleNum: 'L145-17', lawName: 'Code de commerce' },
    { articleNum: '1751', lawName: 'Code civil' },
    { articleNum: '15', lawName: 'Loi n° 89-462 du 6 juillet 1989' },
  ]

  for (const c of CANDIDATES) {
    const out = await searchJudilibreByArticles([c], 1, 2)
    console.log(`\n>>> ${c.lawName} art. ${c.articleNum} → ${out.length} arrêt(s)`)
    for (const a of out) console.log(`    ${a.court} ${a.date} n°${a.number} — ${a.holding.slice(0, 120)}`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
