// scripts/debug-similarity.ts
// Mesure le mismatch sémantique entre questions terrain et articles pivots.
//
// Pour chaque question :
//   1. embed via Nomic (même pipeline que prod)
//   2. appelle la RPC search_all_legal_context avec match_count=200 (équivalent threshold=0)
//   3. affiche le top 15 avec marqueur ⭐ sur les pivots
//   4. affiche le rang de chaque pivot (ou "absent" si hors top 200)
//
// Usage :
//   npx tsx scripts/debug-similarity.ts

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Charger .env.local AVANT les imports dynamiques ──────────────────────────

try {
  const envPath = resolve(__dirname, '../.env.local')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* .env.local absent */ }

for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NOMIC_API_KEY']) {
  if (!process.env[key]) {
    console.error(`❌  ${key} manquant dans .env.local`)
    process.exit(1)
  }
}

// ── Questions à diagnostiquer + domaines associés ────────────────────────────

interface Question {
  id:           string
  text:         string
  boostDomains: string[]
}

const QUESTIONS: Question[] = [
  {
    id:   'Q1',
    text: 'Un propriétaire peut-il donner congé pour loger son fils majeur ?',
    boostDomains: ['baux_habitation'],
  },
  {
    id:   'Q4',
    text: 'Que faire si un locataire ne paie plus son loyer depuis 2 mois ?',
    boostDomains: ['baux_habitation'],
  },
  {
    id:   'Q5',
    text: 'Un logement classé G peut-il encore être mis en location ?',
    boostDomains: ['baux_habitation'],
  },
  {
    id:   'Q6',
    text: 'Un agent immobilier peut-il réclamer sa commission sans mandat signé ?',
    boostDomains: ['agent_immobilier'],
  },
]

// ── Pivots à suivre ──────────────────────────────────────────────────────────

interface Pillar {
  law_id:      string
  article_num: string
  label:       string
}

const PILLARS: Pillar[] = [
  // Loi 89-462 — baux d'habitation
  { law_id: 'LEGITEXT000006069108', article_num: '3',   label: 'art. 3 loi 89-462' },
  { law_id: 'LEGITEXT000006069108', article_num: '6',   label: 'art. 6 loi 89-462 (décence)' },
  { law_id: 'LEGITEXT000006069108', article_num: '7-1', label: 'art. 7-1 loi 89-462 (prescription)' },
  { law_id: 'LEGITEXT000006069108', article_num: '15',  label: 'art. 15 loi 89-462 (congé)' },
  { law_id: 'LEGITEXT000006069108', article_num: '17',  label: 'art. 17 loi 89-462 (loyer)' },
  { law_id: 'LEGITEXT000006069108', article_num: '24',  label: 'art. 24 loi 89-462 (clause résol.)' },
  // Loi Hoguet
  { law_id: 'LEGITEXT000006068387', article_num: '1',   label: 'art. 1 Hoguet' },
  { law_id: 'LEGITEXT000006068387', article_num: '3',   label: 'art. 3 Hoguet' },
  { law_id: 'LEGITEXT000006068387', article_num: '6',   label: 'art. 6 Hoguet (mandat)' },
  { law_id: 'LEGITEXT000006068387', article_num: '14',  label: 'art. 14 Hoguet (sanctions)' },
  // CCH — passoires thermiques
  { law_id: 'LEGITEXT000006074096', article_num: 'L.173-1-1', label: 'art. L.173-1-1 CCH (DPE)' },
]

// ── Row renvoyée par la RPC (même shape que lib/sources.ts) ──────────────────

interface RpcRow {
  source:      'article' | 'arret'
  doc_id:      string
  title:       string
  number:      string | null
  situation:   string | null
  principe:    string | null
  consequence: string | null
  holding:     string | null
  url:         string | null
  domain:      string
  similarity:  number
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Imports dynamiques APRÈS chargement .env.local
  const { createClient } = await import('@supabase/supabase-js')
  const embedding = await import('../lib/embedding')

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // 1. Résoudre les doc_id des 6 pivots (pour pouvoir les marquer dans les résultats)
  const pivotById = new Map<string, string>()  // doc_id → label
  for (const p of PILLARS) {
    const { data, error } = await supabase
      .from('legal_articles')
      .select('id')
      .eq('law_id', p.law_id)
      .eq('article_num', p.article_num)
      .maybeSingle()
    if (error || !data) {
      console.warn(`⚠️   pivot introuvable : ${p.label}`)
      continue
    }
    pivotById.set(data.id as string, p.label)
  }

  console.log(`\n🎯  ${pivotById.size}/${PILLARS.length} pivots résolus`)
  for (const [id, label] of pivotById) {
    console.log(`    ${id.slice(0, 8)}… → ${label}`)
  }

  // 2. Pour chaque question : embed + RPC + affichage
  for (const q of QUESTIONS) {
    console.log(`\n${'═'.repeat(92)}`)
    console.log(`🔎  ${q.id} : "${q.text}"`)
    console.log(`    boost_domains = [${q.boostDomains.join(', ')}]`)
    console.log('═'.repeat(92))

    const emb = await embedding.embedQuestion(q.text)
    if (!emb.length) {
      console.error('❌  embedding vide — vérifiez NOMIC_API_KEY')
      continue
    }
    console.log(`    embedding dim: ${emb.length}`)

    const { data, error } = await supabase.rpc('search_all_legal_context', {
      query_embedding: emb,
      match_count:     200,
      boost_domains:   q.boostDomains,
    })

    if (error || !data) {
      console.error('❌  RPC error:', error?.message ?? 'data vide')
      continue
    }

    const rows = data as RpcRow[]
    console.log(`    ${rows.length} résultats retournés\n`)

    // Top 15 avec marqueur pivot + séparateur visuel au rang 8 (frontière retrieval pipeline)
    console.log('    Top 15 résultats (─── frontière top 8 ─── = ce qui entre dans le prompt) :')
    console.log('    ' + '  #  '.padEnd(6) + 'sim  '.padEnd(7) + 'type   '.padEnd(10) + 'domaine             '.padEnd(22) + 'titre')
    console.log('    ' + '─'.repeat(110))
    rows.slice(0, 15).forEach((r, i) => {
      const marker = pivotById.has(r.doc_id) ? '⭐' : '  '
      const rank   = `#${String(i + 1).padStart(2)}`.padEnd(4)
      const sim    = r.similarity.toFixed(3).padEnd(7)
      const type   = (r.source === 'article' ? 'article' : 'arrêt').padEnd(10)
      const dom    = (r.domain ?? '—').padEnd(22).slice(0, 22)
      const title  = r.title.replace(/\s+/g, ' ').slice(0, 62)
      console.log(`    ${marker} ${rank} ${sim}${type}${dom}${title}`)
      if (i === 7) console.log('    ' + '═'.repeat(110) + '  ← frontière top 8')
    })

    // Position des pivots — NB : la pipeline slice par type, donc le rang pertinent est le rang ARTICLE
    const articleRows = rows.filter(r => r.source === 'article')
    console.log('\n    Position des pivots (rang article-only = ce qui compte pour le prompt) :')
    for (const [id, label] of pivotById) {
      const overallIdx = rows.findIndex(r => r.doc_id === id)
      const articleIdx = articleRows.findIndex(r => r.doc_id === id)
      if (overallIdx === -1) {
        console.log(`    ❌ ${label.padEnd(36)} absent du top 200`)
      } else {
        const sim = rows[overallIdx].similarity.toFixed(3)
        const inPrompt = articleIdx >= 0 && articleIdx < 8
        const icon = inPrompt ? '🟢' : (articleIdx >= 0 && articleIdx < 15) ? '🟡' : '🔴'
        const status = inPrompt
          ? `DANS le prompt (article #${articleIdx + 1})`
          : articleIdx >= 0
            ? `HORS prompt (article #${articleIdx + 1}, au-delà du top 8)`
            : 'non-article ou trop loin'
        console.log(`    ${icon} ${label.padEnd(36)} overall #${String(overallIdx + 1).padStart(3)}  sim=${sim}  → ${status}`)
      }
    }

    // Stats rapides
    const minSim = rows[rows.length - 1]?.similarity ?? 0
    const maxSim = rows[0]?.similarity ?? 0
    console.log(`\n    Plage sim : ${maxSim.toFixed(3)} (top) → ${minSim.toFixed(3)} (rang 200)`)
  }

  console.log(`\n${'═'.repeat(92)}\n`)
}

main().catch(err => { console.error(err); process.exit(1) })
