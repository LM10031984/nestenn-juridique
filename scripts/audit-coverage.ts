// scripts/audit-coverage.ts
// Rapport d'état du corpus par domaine — compare DB vs seuils cibles (domain-reference-corpus.ts)
//
// Usage :
//   npx dotenv-cli -e .env.local -- npx tsx scripts/audit-coverage.ts
//   npx dotenv-cli -e .env.local -- npx tsx scripts/audit-coverage.ts --vague V1
//   npx dotenv-cli -e .env.local -- npx tsx scripts/audit-coverage.ts --domain droit_social_immo
//   npx dotenv-cli -e .env.local -- npx tsx scripts/audit-coverage.ts --json > audit.json

import { createClient } from '@supabase/supabase-js'
import { readFileSync, resolve as pathResolve } from 'fs'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { DOMAIN_CORPUS, ALL_DOMAIN_CODES } from '../lib/domain-reference-corpus.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Charger .env.local
try {
  const envPath = pathResolve(__dirname, '../.env.local')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
} catch { /* variables système utilisées */ }

const args = process.argv.slice(2)
const VAGUE_FILTER  = args.includes('--vague')  ? args[args.indexOf('--vague')  + 1] : null
const DOMAIN_FILTER = args.includes('--domain') ? args[args.indexOf('--domain') + 1] : null
const JSON_OUTPUT   = args.includes('--json')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface DomainAuditRow {
  code: string
  label: string
  vague: string
  articles_count: number
  articles_min: number
  articles_ok: boolean
  articles_gap: number
  juri_count: number
  juri_min: number
  juri_ok: boolean
  juri_gap: number
  status: 'OK' | 'WARN' | 'KO'
}

async function countArticles(domain: string): Promise<number> {
  const { count } = await supabase
    .from('legal_articles')
    .select('*', { count: 'exact', head: true })
    .contains('domains', [domain])
    .eq('in_force', true)
  return count ?? 0
}

async function countJurisprudence(domain: string): Promise<number> {
  const { count } = await supabase
    .from('jurisprudence')
    .select('*', { count: 'exact', head: true })
    .contains('domains', [domain])
  return count ?? 0
}

async function main() {
  const domains = DOMAIN_CORPUS.filter(d => {
    if (VAGUE_FILTER  && d.vague !== VAGUE_FILTER)  return false
    if (DOMAIN_FILTER && d.code  !== DOMAIN_FILTER) return false
    return true
  })

  if (!JSON_OUTPUT) {
    console.log('\n╔══════════════════════════════════════════════════════════════════════════╗')
    console.log('║           NESTENN JURIDIQUE — AUDIT COUVERTURE CORPUS                   ║')
    console.log('╚══════════════════════════════════════════════════════════════════════════╝')
    console.log(`\nDate   : ${new Date().toLocaleDateString('fr-FR')}`)
    console.log(`Filtre : vague=${VAGUE_FILTER ?? 'tous'}, domaine=${DOMAIN_FILTER ?? 'tous'}`)
    console.log(`Domaines analysés : ${domains.length} / ${DOMAIN_CORPUS.length}\n`)
  }

  const rows: DomainAuditRow[] = []

  for (const spec of domains) {
    const [artCount, juriCount] = await Promise.all([
      countArticles(spec.code),
      countJurisprudence(spec.code),
    ])

    const artOk  = artCount  >= spec.minArticles
    const juriOk = juriCount >= spec.minJurisprudence
    const artGap  = Math.max(0, spec.minArticles - artCount)
    const juriGap = Math.max(0, spec.minJurisprudence - juriCount)

    let status: 'OK' | 'WARN' | 'KO'
    if (artOk && juriOk) {
      status = 'OK'
    } else if (artCount === 0 && juriCount === 0) {
      status = 'KO'
    } else {
      status = 'WARN'
    }

    rows.push({
      code: spec.code,
      label: spec.label,
      vague: spec.vague,
      articles_count: artCount,
      articles_min: spec.minArticles,
      articles_ok: artOk,
      articles_gap: artGap,
      juri_count: juriCount,
      juri_min: spec.minJurisprudence,
      juri_ok: juriOk,
      juri_gap: juriGap,
      status,
    })
  }

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(rows, null, 2))
    return
  }

  // Affichage tabulaire
  const colW = { code: 28, vague: 8, art: 18, juri: 18, status: 6 }
  const header = [
    'Domaine'.padEnd(colW.code),
    'Vague'.padEnd(colW.vague),
    'Articles (fact/min)'.padEnd(colW.art),
    'Jurisprud. (fait/min)'.padEnd(colW.juri),
    'État'.padEnd(colW.status),
  ].join('  ')
  const sep = '─'.repeat(header.length)

  console.log(header)
  console.log(sep)

  const byStatus: Record<string, DomainAuditRow[]> = { OK: [], WARN: [], KO: [] }

  for (const row of rows) {
    const artStr  = `${row.articles_count}/${row.articles_min}`.padEnd(colW.art)
    const juriStr = `${row.juri_count}/${row.juri_min}`.padEnd(colW.juri)
    const icon    = row.status === 'OK' ? '✅' : row.status === 'WARN' ? '⚠️ ' : '❌'
    const codePad = row.code.padEnd(colW.code)
    const vaguePad = row.vague.padEnd(colW.vague)
    console.log(`${codePad}  ${vaguePad}  ${artStr}  ${juriStr}  ${icon}`)
    byStatus[row.status].push(row)
  }

  console.log(sep)

  // Récapitulatif
  console.log('\n📊 RÉCAPITULATIF')
  console.log(`  ✅ OK   : ${byStatus.OK.length} domaines`)
  console.log(`  ⚠️  WARN : ${byStatus.WARN.length} domaines — corpus partiel`)
  console.log(`  ❌ KO   : ${byStatus.KO.length} domaines — corpus vide`)

  if (byStatus.KO.length > 0) {
    console.log('\n❌ Domaines à créer en priorité :')
    for (const r of byStatus.KO) {
      console.log(`   [${r.vague}] ${r.code} — manque ${r.articles_gap} articles, ${r.juri_gap} arrêts`)
    }
  }
  if (byStatus.WARN.length > 0) {
    console.log('\n⚠️  Domaines à enrichir :')
    for (const r of byStatus.WARN) {
      const parts = []
      if (!r.articles_ok)  parts.push(`+${r.articles_gap} articles`)
      if (!r.juri_ok)      parts.push(`+${r.juri_gap} arrêts`)
      console.log(`   [${r.vague}] ${r.code} — manque ${parts.join(', ')}`)
    }
  }

  // Total global
  const totalArt  = rows.reduce((s, r) => s + r.articles_count, 0)
  const totalJuri = rows.reduce((s, r) => s + r.juri_count, 0)
  console.log(`\n📚 Total corpus analysé : ${totalArt} articles | ${totalJuri} arrêts`)
  console.log('\n→ Pour enrichir : npx dotenv-cli -e .env.local -- npx tsx scripts/enrich-corpus.ts --vague V1\n')
}

main().catch(err => {
  console.error('Erreur audit-coverage :', err)
  process.exit(1)
})
