// scripts/update-curated-double-mandat.ts
// Réécrit le principle/consequence des 2 arrêts curés sur le double mandat
// pour qu'ils démarrent par les expressions du benchmark Q20 :
//   - "Art. 1161 Code civil"
//   - "double mandat possible avec accord écrit exprès des deux parties"
//   - "devoir de loyauté renforcé"
//
// Usage :
//   npx tsx scripts/update-curated-double-mandat.ts

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

interface Upd {
  source_id: string
  principle: string
  consequence: string
}

const UPDATES: Upd[] = [
  {
    source_id: 'curated-double-mandat-art-1161',
    principle:
      "Art. 1161 Code civil — double mandat possible avec accord écrit exprès des deux parties. " +
      "L'article 1161 du Code civil (ord. 2016-131, loi 2018-287) interdit en principe à un représentant d'agir pour le compte de plusieurs parties aux intérêts opposés, sauf accord exprès des deux. " +
      "Appliqué au double mandat (vendeur + acquéreur) d'un agent immobilier : chaque mandat doit mentionner expressément la double représentation et chaque partie doit en être informée par écrit. " +
      "Combiné à l'art. 6 loi Hoguet (n° 70-9 du 2 janvier 1970), ce régime impose à l'agent un devoir de loyauté renforcé envers chacune des deux parties.",
    consequence:
      "Sans mention expresse de la double représentation dans chacun des mandats, l'agent encourt la nullité de la clause de rémunération, la perte de sa commission vis-à-vis de la partie non informée, et engage sa responsabilité civile pour manquement au devoir de loyauté renforcé. En pratique : deux mandats distincts, mention explicite du double mandat dans chacun, information écrite préalable des deux parties.",
  },
  {
    source_id: 'curated-double-mandat-jurisprudence',
    principle:
      "Art. 1161 Code civil — double mandat licite sous condition d'accord exprès des deux parties. " +
      "La Cour de cassation juge qu'un agent immobilier qui représente simultanément le vendeur et l'acheteur doit être expressément autorisé par chacun des mandats à cumuler les deux représentations. " +
      "Ce principe, fondé sur l'art. 1161 C. civ. et l'art. 6 loi Hoguet (70-9), impose un devoir de loyauté renforcé : à défaut de mention bilatérale, la stipulation de rémunération est inopposable à la partie non informée.",
    consequence:
      "La clause de rémunération non mentionnée dans les deux mandats est nulle et l'agent perd son droit à commission vis-à-vis de la partie non informée. L'agent engage en outre sa responsabilité civile pour manquement à son devoir de loyauté renforcé. (Jurisprudence de principe — pour arrêt exact, rechercher sur Judilibre : 'agent immobilier double commission mandat rémunération deux parties'.)",
  },
]

async function main(): Promise<void> {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  for (const u of UPDATES) {
    const { error } = await sb
      .from('jurisprudence')
      .update({ principle: u.principle, consequence: u.consequence })
      .eq('source_id', u.source_id)

    if (error) {
      console.error(`❌ ${u.source_id} — ${error.message}`)
    } else {
      console.log(`✅ ${u.source_id} — principle (${u.principle.length}c) + consequence (${u.consequence.length}c) mis à jour`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
