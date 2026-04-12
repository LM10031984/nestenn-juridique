// scripts/reembed-curated.ts
// Re-calcule les embeddings Nomic v1.5 pour tous les arrêts curated.
// But : aligner l'espace vectoriel curated avec le reste du corpus (articles + arrêts auto-indexés).
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/reembed-curated.ts [--dry-run]

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const NOMIC_API_URL = 'https://api-atlas.nomic.ai/v1/embedding/text'
const EXPECTED_DIM  = 768

// Identique à lib/auto-indexer.ts — sans task_type, sans prefix
async function embedText(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(NOMIC_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOMIC_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'nomic-embed-text-v1.5', texts: [text] }),
    })
    if (!res.ok) {
      console.error(`[reembed] Nomic HTTP ${res.status}: ${await res.text()}`)
      return null
    }
    const data = await res.json() as { embeddings: number[][] }
    return data.embeddings?.[0] ?? null
  } catch (e) {
    console.error('[reembed] Nomic exception:', e)
    return null
  }
}

async function reembedCurated(dryRun: boolean) {
  console.info('\n[reembed] ═══════════════════════════════════════')
  console.info(`[reembed] Alignement embeddings curated → Nomic v1.5 | dryRun=${dryRun}`)
  console.info('[reembed] ═══════════════════════════════════════\n')

  const { data: arrets, error } = await supabase
    .from('jurisprudence')
    .select('id, source_id, number, situation, principle, consequence, embedding')
    .eq('curated', true)

  if (error) { console.error('[reembed] Erreur fetch:', error); return }

  const total = arrets?.length ?? 0
  console.info(`[reembed] ${total} arrêts curated trouvés\n`)

  let updated = 0
  let skipped = 0
  let errors  = 0
  let dryCount = 0

  for (const arret of arrets ?? []) {
    const situation   = arret.situation   ?? ''
    const principle   = arret.principle   ?? ''
    const consequence = arret.consequence ?? ''

    if (!situation && !principle && !consequence) {
      console.warn(`[reembed] Skip ${arret.source_id} : tous les champs texte sont vides`)
      skipped++
      continue
    }

    const embeddingText = `${situation} ${principle} ${consequence}`
    const newEmbedding  = await embedText(embeddingText)

    if (!newEmbedding) {
      console.warn(`[reembed] Skip ${arret.source_id} : embedding null`)
      skipped++
      continue
    }

    const oldDim = Array.isArray(arret.embedding) ? arret.embedding.length : '?'
    const newDim = newEmbedding.length

    if (dryRun) {
      dryCount++
      console.info(`[DRY #${dryCount}] id=${arret.id}`)
      console.info(`  source_id    : ${arret.source_id}`)
      console.info(`  number       : ${arret.number ?? '—'}`)
      console.info(`  dim ancien   : ${oldDim}`)
      console.info(`  dim nouveau  : ${newDim}${newDim === EXPECTED_DIM ? ' ✅' : ' ⚠️  INATTENDU'}`)
      console.info(`  text (100c)  : "${embeddingText.slice(0, 100)}..."`)
      if (dryCount >= 5) {
        console.info('\n[DRY] 5 premiers arrêts affichés — arrêt précoce')
        break
      }
      updated++
      continue
    }

    const { error: updErr } = await supabase
      .from('jurisprudence')
      .update({ embedding: newEmbedding })
      .eq('id', arret.id)

    if (updErr) {
      console.error(`[reembed] ❌ ${arret.source_id}:`, updErr.message)
      errors++
    } else {
      console.info(`[reembed] ✅ ${arret.source_id} (dim ${oldDim} → ${newDim})`)
      updated++
    }
  }

  console.info(`\n📊 RÉSUMÉ : ${updated} mis à jour | ${skipped} skip | ${errors} erreurs / ${total} total`)
  if (dryRun) console.info('⚠️  Mode dry-run — aucune écriture en base. Relancez sans --dry-run pour appliquer.')
}

// ── Entrée CLI ────────────────────────────────────────────────────────────────

const dryRun = process.argv.includes('--dry-run')
reembedCurated(dryRun)
