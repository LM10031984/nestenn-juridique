// scripts/seed-filter-keywords.ts
// One-shot : insère les keywords manquants dans filter_keywords pour débloquer
// le filtre hors-sujet sur certaines questions terrain (ex. Q32 "bien occupé").
//
// Usage : npx tsx scripts/seed-filter-keywords.ts

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

try {
  const envPath = resolve(__dirname, '../.env.local')
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* */ }

const KEYWORDS: Array<{ keyword: string; domain: string }> = [
  { keyword: 'bien occupé',          domain: 'vente_immobiliere' },
  { keyword: 'logement occupé',      domain: 'vente_immobiliere' },
  { keyword: 'vente avec locataire', domain: 'vente_immobiliere' },
]

async function main(): Promise<void> {
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const rows = KEYWORDS.map(k => ({ ...k, added_by: 'manual' }))
  const { data, error } = await supabase
    .from('filter_keywords')
    .upsert(rows, { onConflict: 'keyword' })
    .select()

  if (error) {
    console.error('❌', error.message)
    process.exit(1)
  }
  console.log(`✅ ${data?.length ?? 0} keywords upsertés :`)
  data?.forEach(d => console.log(`   - ${d.keyword} (${d.domain})`))
}

main().catch(err => { console.error(err); process.exit(1) })
