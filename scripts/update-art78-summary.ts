// scripts/update-art78-summary.ts
// Réécrit le content_summary de l'art. 78 décret 72-678 pour y intégrer
// explicitement les trois notions présentes dans le texte brut mais absentes
// du résumé LLM initial :
//   - clause pénale autorisée (art. 78 la mentionne textuellement)
//   - période irrévocable de 3 mois (corollaire du délai avant dénonciation)
//   - dénonciation par LRAR avec préavis de 15 jours après 3 mois
//
// L'embedding n'est pas régénéré : art. 78 est déjà #1 article au retrieval
// sur Q21 (sim 0.933). Le seul blocage était le summary injecté dans le prompt.
//
// Usage :
//   npx tsx scripts/update-art78-summary.ts

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

try {
  const envPath = resolve(__dirname, '../.env.local')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* noop */ }

const SUMMARY = {
  situation:
    "Un vendeur a signé un mandat exclusif avec un agent immobilier, assorti d'une clause d'exclusivité et/ou d'une clause pénale, et veut connaître la durée pendant laquelle il ne peut ni le résilier ni vendre seul.",
  principe:
    "Le mandat exclusif (ou assorti d'une clause pénale) n'est opposable au mandant que s'il résulte d'une stipulation expresse, qu'un exemplaire lui a été remis, et que la clause figure en caractères très apparents. Période irrévocable de 3 mois à compter de la signature : pendant ces 3 mois, ni le mandant ni l'agent ne peuvent dénoncer le mandat. Passé ce délai de 3 mois, le mandat peut être dénoncé à tout moment par chacune des parties, moyennant un préavis de quinze jours donné par lettre recommandée avec demande d'avis de réception (LRAR). La clause pénale est explicitement autorisée par ce texte (et encadrée par le même formalisme).",
  consequence:
    "Dans les 3 premiers mois : le vendeur qui vend seul ou résilie s'expose à la clause pénale prévue (dommages-intérêts forfaitaires) ou à des dommages-intérêts équivalents à la commission. Après 3 mois : dénonciation libre avec préavis de 15 jours par LRAR. Si le formalisme (stipulation expresse, exemplaire remis, caractères très apparents) n'est pas respecté, la clause d'exclusivité ou pénale est inopposable au mandant.",
}

async function main(): Promise<void> {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { error } = await sb
    .from('legal_articles')
    .update({ content_summary: JSON.stringify(SUMMARY) })
    .eq('law_id', 'LEGITEXT000006061974') // décret 72-678
    .eq('article_num', '78')

  if (error) {
    console.error(`❌ ${error.message}`)
    process.exit(1)
  }
  console.log(`✅ art. 78 décret 72-678 — summary réécrit (${JSON.stringify(SUMMARY).length}c)`)
  console.log('   • situation : ' + SUMMARY.situation.slice(0, 100) + '...')
  console.log('   • principe  : ' + SUMMARY.principe.slice(0, 100) + '...')
  console.log('   • consequence : ' + SUMMARY.consequence.slice(0, 100) + '...')
}

main().catch(e => { console.error(e); process.exit(1) })
