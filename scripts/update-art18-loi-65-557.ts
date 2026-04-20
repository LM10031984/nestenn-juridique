// scripts/update-art18-loi-65-557.ts
// Réécrit le content_summary de l'art. 18 loi 65-557 (pouvoirs du syndic)
// pour que le I (fondement légal des pouvoirs généraux, y compris en cas
// d'urgence) soit saillant et remonte dans le top 12 articles sur la
// question des travaux urgents (Q48). Re-embed nécessaire (rank actuel
// #20 article-only, hors prompt).
//
// Le décret 67-223 art. 37 (cité à tort par le modèle comme fondement
// principal) n'est PAS modifié — il reste légitime pour les modalités
// pratiques. L'objectif est la co-citation loi + décret, pas substitution.
//
// Usage :
//   npx tsx scripts/update-art18-loi-65-557.ts

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
} catch { /* noop */ }

for (const k of ['NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','NOMIC_API_KEY']) {
  if (!process.env[k]) { console.error(`❌ ${k} manquant`); process.exit(1) }
}

const SUMMARY = {
  situation:
    "Un syndic doit faire face à une situation d'urgence en copropriété (fuite, infiltration, ascenseur arrêté, menace d'effondrement partiel, etc.) et envisage d'engager des travaux de sauvegarde sans passer par un vote préalable en assemblée générale.",
  principe:
    "L'art. 18 I de la loi n° 65-557 du 10 juillet 1965 est le fondement LÉGAL des pouvoirs du syndic : il est chargé d'assurer l'exécution du règlement de copropriété et des décisions de l'AG, d'administrer l'immeuble, de pourvoir à sa conservation, à sa garde et à son entretien, et — explicitement — d'exécuter de sa propre initiative les travaux nécessaires à la sauvegarde de l'immeuble EN CAS D'URGENCE. Cette faculté de travaux urgents sans vote AG découle donc directement de la loi (art. 18 I), et non du décret d'application. Les modalités pratiques (information des copropriétaires, avis du conseil syndical, provision plafonnée à un tiers du devis) sont précisées par l'art. 37 du décret n° 67-223 du 17 mars 1967, qui applique et organise cette prérogative légale.",
  consequence:
    "Le syndic peut engager seul des travaux urgents sur le fondement de l'art. 18 I de la loi 65-557, sous trois conditions cumulatives issues de la loi et de son décret (art. 37 décret 67-223) : (1) urgence objective pour la sauvegarde de l'immeuble, (2) information immédiate des copropriétaires et convocation d'une AG a posteriori pour ratification, (3) provision demandée limitée à un tiers du devis estimatif, après avis du conseil syndical s'il en existe un. À défaut d'urgence réelle ou du respect de ces conditions, le syndic engage sa responsabilité pour dépassement de ses pouvoirs (art. 18-1 loi 65-557).",
}

const EMBED_PARAPHRASES = [
  "le syndic peut-il engager seul des travaux urgents en copropriété",
  "pouvoirs du syndic fondement légal art. 18 I loi 65-557",
  "travaux urgents sauvegarde de l'immeuble sans vote assemblée générale",
  "art. 18 I loi Hoguet copropriété administration conservation entretien",
  "syndic de copropriété cas d'urgence fondement loi 1965",
  "distinction loi 65-557 art. 18 I et décret 67-223 art. 37 sur travaux urgents",
]

async function embedTextNomic(text: string): Promise<number[] | null> {
  const res = await fetch('https://api-atlas.nomic.ai/v1/embedding/text', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.NOMIC_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nomic-embed-text-v1.5', texts: [text] }),
  })
  if (!res.ok) { console.warn(`   embedding HTTP ${res.status}`); return null }
  const data = await res.json() as { embeddings: number[][] }
  return data.embeddings?.[0] ?? null
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: row } = await sb
    .from('legal_articles')
    .select('id, title')
    .eq('law_id', 'LEGITEXT000006068256')
    .eq('article_num', '18')
    .maybeSingle()
  if (!row) { console.error('❌ art. 18 loi 65-557 introuvable'); process.exit(1) }
  const r = row as any

  // Embed text : label court + summary + paraphrases terrain
  const embedText = [
    'art. 18 I loi 65-557 — pouvoirs généraux du syndic (fondement légal, y compris travaux urgents)',
    `Situation : ${SUMMARY.situation}`,
    `Règle : ${SUMMARY.principe}`,
    `Conséquence : ${SUMMARY.consequence}`,
    `Mots-clés : ${EMBED_PARAPHRASES.join(' | ')}`,
  ].join('\n')

  console.log(`→ art. 18 loi 65-557 (id=${r.id.slice(0,8)}…)`)
  console.log(`  summary : ${JSON.stringify(SUMMARY).length}c`)
  console.log(`  embed_text : ${embedText.length}c`)

  const emb = await embedTextNomic(embedText)
  if (!emb?.length) { console.error('❌ embedding échec'); process.exit(1) }
  console.log(`  ✓ embedding (${emb.length} dims)`)

  const { error } = await sb
    .from('legal_articles')
    .update({ content_summary: JSON.stringify(SUMMARY), embedding: emb })
    .eq('id', r.id)
  if (error) { console.error(`❌ update : ${error.message}`); process.exit(1) }
  console.log(`  ✅ mis à jour (summary + embedding)`)
}

main().catch(e => { console.error(e); process.exit(1) })
