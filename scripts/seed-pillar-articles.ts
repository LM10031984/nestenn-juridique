// scripts/seed-pillar-articles.ts
// Indexe les articles "piliers" qui manquent en base pour que pgvector
// puisse remonter des sources sur les questions terrain typiques.
//
// Réutilise la logique existante de lib/auto-indexer.ts :
//   PISTE OAuth → fetch Légifrance → résumé GPT → embedding Nomic → upsert.
//
// Usage :
//   npx tsx scripts/seed-pillar-articles.ts

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

for (const key of [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'PISTE_CLIENT_ID',
  'PISTE_CLIENT_SECRET',
  'NOMIC_API_KEY',
  'OPENROUTER_API_KEY',
]) {
  if (!process.env[key]) {
    console.error(`❌  ${key} manquant dans .env.local`)
    process.exit(1)
  }
}

// ── Articles pivots à indexer ────────────────────────────────────────────────

interface Pillar {
  law:        string  // libellé humain (figurera dans le title de la row)
  legitextId: string
  article:    string
  domain:     string  // force le domain (plus fiable qu'un appel LLM)
}

const PILLARS: Pillar[] = [
  // Loi n° 89-462 du 6 juillet 1989 — baux d'habitation
  { law: 'loi n° 89-462 du 6 juillet 1989', legitextId: 'LEGITEXT000006069108', article: '3',   domain: 'baux_habitation' },
  { law: 'loi n° 89-462 du 6 juillet 1989', legitextId: 'LEGITEXT000006069108', article: '6',   domain: 'baux_habitation' }, // décence / décence énergétique
  { law: 'loi n° 89-462 du 6 juillet 1989', legitextId: 'LEGITEXT000006069108', article: '7-1', domain: 'baux_habitation' }, // prescription triennale des actions
  { law: 'loi n° 89-462 du 6 juillet 1989', legitextId: 'LEGITEXT000006069108', article: '15',  domain: 'baux_habitation' },
  { law: 'loi n° 89-462 du 6 juillet 1989', legitextId: 'LEGITEXT000006069108', article: '17',  domain: 'baux_habitation' },
  { law: 'loi n° 89-462 du 6 juillet 1989', legitextId: 'LEGITEXT000006069108', article: '24',  domain: 'baux_habitation' }, // clause résolutoire impayés

  // Loi n° 70-9 du 2 janvier 1970 — loi Hoguet (agents immobiliers)
  { law: 'loi n° 70-9 du 2 janvier 1970', legitextId: 'LEGITEXT000006068387', article: '1',  domain: 'agent_immobilier' },
  { law: 'loi n° 70-9 du 2 janvier 1970', legitextId: 'LEGITEXT000006068387', article: '3',  domain: 'agent_immobilier' },
  { law: 'loi n° 70-9 du 2 janvier 1970', legitextId: 'LEGITEXT000006068387', article: '6',  domain: 'agent_immobilier' },
  { law: 'loi n° 70-9 du 2 janvier 1970', legitextId: 'LEGITEXT000006068387', article: '14', domain: 'agent_immobilier' }, // sanctions pénales Hoguet

  // Code de la construction et de l'habitation — calendrier passoires thermiques
  { law: "Code de la construction et de l'habitation", legitextId: 'LEGITEXT000006074096', article: 'L.173-1-1', domain: 'baux_habitation' },

  // Code civil — obligation précontractuelle d'information (réforme 2016)
  { law: 'Code civil', legitextId: 'LEGITEXT000006070721', article: '1112-1', domain: 'vente_immobiliere' },

  // Loi n° 65-557 du 10 juillet 1965 — art. 46 (loi Carrez)
  { law: 'loi n° 65-557 du 10 juillet 1965', legitextId: 'LEGITEXT000006068256', article: '46', domain: 'vente_immobiliere' },

  // Pivots de second rang
  { law: 'loi n° 89-462 du 6 juillet 1989', legitextId: 'LEGITEXT000006069108', article: '8-1', domain: 'baux_habitation' },
  { law: 'Code civil', legitextId: 'LEGITEXT000006070721', article: '1161', domain: 'agent_immobilier' },
]

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Imports dynamiques APRÈS chargement .env.local
  // (auto-indexer.ts initialise son client Supabase au niveau module)
  const { createClient } = await import('@supabase/supabase-js')
  const auto = await import('../lib/auto-indexer')

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const token = await auto.getPisteToken()
  if (!token) {
    console.error('❌  Token PISTE indisponible — vérifiez PISTE_CLIENT_ID / PISTE_CLIENT_SECRET')
    process.exit(1)
  }

  console.log(`\n🌱  Indexation de ${PILLARS.length} articles pivots\n`)

  let indexed = 0
  let skipped = 0
  let failed  = 0

  for (const p of PILLARS) {
    const label = `${p.law} — art. ${p.article}`

    try {
      // 1. Skip si déjà en base
      if (await auto.isIndexed(p.legitextId, p.article)) {
        console.log(`⏭️   déjà en base : ${label}`)
        skipped++
        continue
      }

      // 2. Fetch Légifrance
      const articleData = await auto.fetchArticleFromLegifrance(token, p.legitextId, p.article)
      if (!articleData) {
        console.warn(`❌  fetch Légifrance échec : ${label}`)
        failed++
        continue
      }

      // 3. Résumé GPT
      const summary = await auto.summarizeArticle(p.article, p.law, articleData.texte)
      if (!summary) {
        console.warn(`❌  résumé GPT échec : ${label}`)
        failed++
        continue
      }

      // 4. Embedding Nomic
      const embeddingText = `${summary.situation} ${summary.principe} ${summary.consequence}`
      const embedding = await auto.embedText(embeddingText)
      if (!embedding) {
        console.warn(`❌  embedding Nomic échec : ${label}`)
        failed++
        continue
      }

      // 5. Upsert (même schéma que auto-indexer.ts)
      const { error } = await supabase
        .from('legal_articles')
        .upsert({
          law_id:          p.legitextId,
          article_num:     p.article,
          title:           `Art. ${p.article} — ${p.law}`,
          content:         articleData.texte,
          content_summary: JSON.stringify(summary),
          date_version:    new Date().toISOString().split('T')[0],
          url:             articleData.url,
          domain:          p.domain,
          sub_themes:      [],
          in_force:        true,
          embedding,
        }, { onConflict: 'law_id,article_num' })

      if (error) {
        console.error(`❌  upsert échec : ${label} — ${error.message}`)
        failed++
      } else {
        console.log(`✅  indexé : ${label} (${articleData.texte.length} chars, domain=${p.domain})`)
        indexed++
      }
    } catch (err) {
      console.error(`❌  exception : ${label} —`, err)
      failed++
    }
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`📊  Récap : ${indexed} indexés  |  ${skipped} ignorés  |  ${failed} échecs`)
  console.log(`${'═'.repeat(60)}\n`)
}

main().catch(err => { console.error(err); process.exit(1) })
