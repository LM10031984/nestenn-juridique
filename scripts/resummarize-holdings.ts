/**
 * scripts/resummarize-holdings.ts
 * Backfill du champ `holding` pour les arrêts déjà en base.
 *
 * Le script détecte automatiquement quel champ contient le texte brut
 * (motivations_raw, holding, ou reconstitue depuis situation+principle+consequence),
 * génère un résumé 1-2 phrases via GPT-4o-mini, et met à jour `holding`.
 *
 * Usage :
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/resummarize-holdings.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/resummarize-holdings.ts --dry-run
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/resummarize-holdings.ts --force
 *   (--force : réécrit même les holdings déjà courts/résumés)
 */

import { createClient } from '@supabase/supabase-js'

const args    = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const FORCE   = args.includes('--force')

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const SUMMARY_MODEL  = 'openai/gpt-4o-mini'

// Un holding brut > ce seuil mérite d'être résumé
const RAW_THRESHOLD = 200

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ---------------------------------------------------------------------------
// Détection des colonnes disponibles
// ---------------------------------------------------------------------------

async function detectColumns(): Promise<{
  hasMotivationsRaw: boolean
  hasHolding: boolean
  hasSituation: boolean
}> {
  const { data, error } = await supabase
    .from('jurisprudence')
    .select('*')
    .limit(1)

  if (error) throw new Error(`Erreur lecture table : ${error.message}`)
  if (!data || data.length === 0) {
    // Table vide — on tente quand même une sélection pour voir les colonnes
    return { hasMotivationsRaw: false, hasHolding: false, hasSituation: false }
  }

  const keys = Object.keys(data[0])
  return {
    hasMotivationsRaw: keys.includes('motivations_raw'),
    hasHolding:        keys.includes('holding'),
    hasSituation:      keys.includes('situation'),
  }
}

// ---------------------------------------------------------------------------
// LLM — résumé 1-2 phrases
// ---------------------------------------------------------------------------

async function summarizeHolding(rawText: string, number: string): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer':  'https://nestenn.com',
      'X-Title':       'Nestenn Juridique - Resummarize',
    },
    body: JSON.stringify({
      model:      SUMMARY_MODEL,
      messages:   [{
        role:    'user',
        content: `Résume en 1-2 phrases le principe juridique de cet arrêt n° ${number}. Donne uniquement le principe retenu, sans introduction.\n\nTexte : ${rawText.slice(0, 2000)}\n\nRésumé :`,
      }],
      max_tokens:  100,
      temperature: 0.1,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenRouter ${res.status}: ${err.slice(0, 200)}`)
  }
  const data = await res.json()
  const summary = (data?.choices?.[0]?.message?.content ?? '').trim()
  return summary.length > 20 ? summary : rawText.slice(0, 300)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Config : dry-run=${DRY_RUN} force=${FORCE}\n`)

  // 1. Détecter les colonnes disponibles
  const cols = await detectColumns()
  console.log(`Colonnes détectées : motivations_raw=${cols.hasMotivationsRaw} | holding=${cols.hasHolding} | situation=${cols.hasSituation}`)

  // Choisir le champ source (par ordre de priorité)
  const sourceField = cols.hasMotivationsRaw ? 'motivations_raw'
    : cols.hasHolding                         ? 'holding'
    : cols.hasSituation                       ? 'situation'
    : null

  if (!sourceField) {
    console.error('Aucun champ texte trouvé dans la table jurisprudence.')
    process.exit(1)
  }
  console.log(`Champ source utilisé : ${sourceField}\n`)

  // 2. Construire la sélection
  const selectFields = ['id', 'number', sourceField]
  if (cols.hasHolding && sourceField !== 'holding') selectFields.push('holding')
  if (cols.hasSituation && sourceField !== 'situation') selectFields.push('situation', 'principle', 'consequence')

  const { data: arrets, error } = await supabase
    .from('jurisprudence')
    .select(selectFields.join(', '))
    .order('indexed_at' as any, { ascending: false })

  if (error) {
    console.error('Erreur Supabase :', error.message)
    process.exit(1)
  }

  console.log(`${arrets?.length ?? 0} arrêts en base\n`)

  let updated = 0
  let skipped = 0
  let errors  = 0

  for (const arret of arrets ?? []) {
    // Trouver le texte source
    let sourceText: string = (arret as any)[sourceField] ?? ''

    // Si le sourceField est 'situation', reconstituer depuis les 3 champs
    if (sourceField === 'situation') {
      const parts = [
        arret.situation,
        (arret as any).principle,
        (arret as any).consequence,
      ].filter(Boolean)
      sourceText = parts.join(' — ')
    }

    // Skip si texte trop court
    if (!sourceText || sourceText.length < 50) {
      skipped++
      continue
    }

    // Skip si le holding actuel semble déjà résumé (court = déjà traité)
    // sauf si --force
    const currentHolding: string = (arret as any).holding ?? ''
    if (!FORCE && currentHolding && currentHolding.length < RAW_THRESHOLD) {
      skipped++
      continue
    }

    // Skip si le texte source est déjà court (déjà un résumé)
    // sauf si --force
    if (!FORCE && sourceText.length < RAW_THRESHOLD) {
      skipped++
      continue
    }

    process.stdout.write(`  n° ${(arret as any).number ?? (arret as any).id?.slice(0, 8)}... `)

    try {
      const summary = await summarizeHolding(sourceText, (arret as any).number ?? '')

      if (DRY_RUN) {
        console.log(`[DRY] ${summary.slice(0, 100)}`)
      } else {
        const { error: updateError } = await supabase
          .from('jurisprudence')
          .update({ holding: summary } as any)
          .eq('id', arret.id)

        if (updateError) {
          console.log(`[ERREUR] ${updateError.message}`)
          errors++
        } else {
          console.log(summary.slice(0, 100))
          updated++
        }
      }
    } catch (err: any) {
      console.log(`[ERREUR] ${err.message}`)
      errors++
    }

    // Rate limiting — ~5 req/s, conservatif pour GPT-4o-mini
    await new Promise(r => setTimeout(r, 200))
  }

  console.log(`\n${DRY_RUN ? '[DRY-RUN] ' : ''}✅ ${updated} mis à jour | ${skipped} ignorés | ${errors} erreurs`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
