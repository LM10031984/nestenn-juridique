// scripts/regenerate-summaries.ts
// Régénère les content_summary + embeddings pour les articles d'un domaine donné.
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/regenerate-summaries.ts --domaine environnement_immo [--dry-run]

import { createClient } from '@supabase/supabase-js'
import { openRouterChat, MODELS } from '../lib/openrouter'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const NOMIC_API_URL = 'https://api-atlas.nomic.ai/v1/embedding/text'

// ── Prompt amélioré (vocabulaire transactionnel, 3 perspectives) ─────────────

async function summarizeArticle(
  articleNum: string,
  lawLabel: string,
  texte: string,
): Promise<{ situation: string; principe: string; consequence: string } | null> {
  try {
    const raw = await openRouterChat([
      {
        role: 'system',
        content: `Tu es juriste spécialisé en droit immobilier français.
Résume cet article de loi en 3 champs JSON stricts (pas de markdown), du point de vue d'un agent immobilier qui doit conseiller ses clients (vendeur, acheteur, locataire, bailleur).
EXIGENCES IMPÉRATIVES pour maximiser la pertinence :
- Utilise un VOCABULAIRE TRANSACTIONNEL naturel : vendeur, acheteur, bailleur, locataire, achat, vente, location, signature, compromis, acte authentique, découverte, obligations, droits, recours, sanctions, indemnisation, dommages-intérêts, nullité, résolution, dépollution, diagnostic
- Couvre les 3 PERSPECTIVES quand applicable : que doit faire le vendeur ? quels sont les droits de l'acheteur ? quel est le rôle du bailleur/locataire ?
- Utilise des FORMULATIONS DE QUESTION typiques : "lorsque le vendeur découvre que...", "l'acheteur peut demander...", "en cas de non-respect, le locataire est en droit de..."
- Mentionne les RECOURS PRATIQUES : action en nullité, garantie des vices cachés, dommages-intérêts, résolution du contrat, réduction du prix
- Évite le vocabulaire institutionnel froid ("L'État établit", "Cet article s'applique") au profit de tournures concrètes ("Le vendeur doit...", "L'acheteur peut...")
Champs à remplir :
- situation : la situation concrète où cet article s'applique pour un agent immobilier (mentionne acheteur/vendeur/locataire/bailleur selon les cas)
- principe : la règle ou obligation, formulée du point de vue des parties à la transaction immobilière
- consequence : les recours et sanctions concrets en cas de non-respect (résolution, indemnisation, nullité, etc.)
Réponds UNIQUEMENT avec du JSON valide : {"situation":"...","principe":"...","consequence":"..."}`,
      },
      {
        role: 'user',
        content: `Article ${articleNum} — ${lawLabel}\n\n${texte.slice(0, 2000)}`,
      },
    ], MODELS.FILTER, 300)

    const parsed = JSON.parse(raw.trim())
    if (!parsed.situation || !parsed.principe) return null
    return parsed
  } catch {
    return null
  }
}

// ── Embedding Nomic ───────────────────────────────────────────────────────────

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
    if (!res.ok) return null
    const data = await res.json() as { embeddings: number[][] }
    return data.embeddings?.[0] ?? null
  } catch {
    return null
  }
}

// ── Régénération ──────────────────────────────────────────────────────────────

async function regenerateDomain(domain: string, dryRun: boolean) {
  console.info(`\n[regenerate] ═══════════════════════════════════════`)
  console.info(`[regenerate] Domaine cible : ${domain} | dryRun=${dryRun}`)
  console.info(`[regenerate] ═══════════════════════════════════════\n`)

  const { data: articles, error } = await supabase
    .from('legal_articles')
    .select('id, article_num, title, content, content_summary')
    .contains('domains', [domain])
    .or('content_summary.is.null,content_summary.eq.')

  if (error) { console.error('[regenerate] Erreur fetch:', error); return }
  console.info(`[regenerate] ${articles?.length ?? 0} articles sans résumé (null/vide) à traiter\n`)

  let updated = 0
  let skipped = 0
  let errors  = 0
  let dryCount = 0
  const total  = articles?.length ?? 0
  let idx = 0

  for (const article of articles ?? []) {
    idx++
    try {
      const lawLabel = article.title?.split(' — ')[1] ?? 'Article'
      const newSummary = await summarizeArticle(article.article_num, lawLabel, article.content ?? '')

      if (!newSummary) {
        console.warn(`[regenerate] [${idx}/${total}] Skip ${article.article_num} : résumé null`)
        skipped++
        continue
      }

      const embeddingText = `${newSummary.situation} ${newSummary.principe} ${newSummary.consequence}`
      const newEmbedding = await embedText(embeddingText)

      if (!newEmbedding) {
        console.warn(`[regenerate] [${idx}/${total}] Skip ${article.article_num} : embedding null`)
        skipped++
        continue
      }

      if (dryRun) {
        dryCount++
        console.info(`[DRY #${dryCount}] ${article.article_num}`)
        console.info(`  situation  : "${newSummary.situation.slice(0, 120)}..."`)
        console.info(`  principe   : "${newSummary.principe.slice(0, 120)}..."`)
        console.info(`  consequence: "${newSummary.consequence.slice(0, 120)}..."`)
        if (dryCount >= 5) {
          console.info('\n[DRY] 5 premiers articles affichés — arrêt précoce (--dry-run)')
          break
        }
        updated++
        continue
      }

      const { error: updErr } = await supabase
        .from('legal_articles')
        .update({
          content_summary: JSON.stringify(newSummary),
          embedding: newEmbedding,
        })
        .eq('id', article.id)

      if (updErr) {
        console.error(`[regenerate] [${idx}/${total}] ❌ ${article.article_num}:`, updErr.message)
        errors++
      } else {
        console.info(`[regenerate] [${idx}/${total}] ✅ ${article.article_num}`)
        updated++
      }
    } catch (e) {
      console.error(`[regenerate] Exception ${article.article_num}:`, e)
      errors++
    }
  }

  console.info(`\n📊 RÉSUMÉ : ${updated} mis à jour | ${skipped} skip | ${errors} erreurs`)
  if (dryRun) console.info('⚠️  Mode dry-run — aucune écriture en base. Relancez sans --dry-run pour appliquer.')
}

// ── Entrée CLI ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const domainIdx = args.indexOf('--domaine')
const domain = domainIdx !== -1
  ? args[domainIdx + 1]
  : args.find(a => a.startsWith('--domaine='))?.split('=')[1]
const dryRun = args.includes('--dry-run')

if (!domain) {
  console.error('Usage: npx tsx scripts/regenerate-summaries.ts --domaine <nom> [--dry-run]')
  process.exit(1)
}

regenerateDomain(domain, dryRun)
