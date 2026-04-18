// Patch ciblé : réécrit content_summary de l'art. 1304-3 du Code civil
// pour cadrer correctement la situation acheteur (condition suspensive
// de prêt + sort du dépôt de garantie) et couvrir les axes :
//   - non-perte automatique du dépôt si la condition est défaillie
//   - exception en cas de faute / absence de diligence de l'acheteur
//
// GÉNÈRE l'embedding (actuellement ABSENT — l'article ne remonte pas
// du tout dans le retrieval car la RPC filtre WHERE embedding IS NOT NULL).
//
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/_patch-art1304-3-summary.ts
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
)

const ART1304_3_ID = '8887c860-229d-4905-8c45-c177a86cc340'
const NOMIC_API_URL = 'https://api-atlas.nomic.ai/v1/embedding/text'

async function embedNomic(text: string): Promise<number[] | null> {
  const res = await fetch(NOMIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.NOMIC_API_KEY}`,
    },
    body: JSON.stringify({ texts: [text], model: 'nomic-embed-text-v1.5' }),
  })
  if (!res.ok) { console.error('embed HTTP', res.status); return null }
  const data = await res.json() as { embeddings: number[][] }
  return data.embeddings?.[0] ?? null
}

const NEW_SUMMARY = {
  situation:
    "Lorsqu'un acheteur conclut une vente immobilière sous condition suspensive (notamment d'obtention d'un prêt bancaire) et qu'il a versé un dépôt de garantie ou un séquestre, l'enjeu de la défaillance de la condition est de savoir si ce dépôt lui est restitué ou s'il le perd.",
  principe:
    "L'article 1304-3 du Code civil pose un principe central : la condition suspensive est réputée accomplie si celui qui y avait intérêt en a empêché l'accomplissement, et elle est réputée défaillie si son accomplissement a été provoqué par la partie qui y avait intérêt. Appliqué à la condition suspensive de prêt : si l'acheteur a accompli des diligences sérieuses et de bonne foi (au moins deux demandes de prêt auprès d'établissements distincts, dans le délai contractuel) et que le prêt n'a pas été obtenu, la condition est défaillie sans faute de sa part. Dans ce cas, l'acheteur ne perd PAS automatiquement son dépôt de garantie : celui-ci doit lui être restitué intégralement. À l'inverse, si l'acheteur n'a pas fait les diligences requises ou a empêché de mauvaise foi l'obtention du prêt (faute de l'acheteur), la condition est réputée accomplie au sens de l'art. 1304-3 du Code civil : le dépôt peut alors être conservé par le vendeur et la vente devient parfaite.",
  consequence:
    "Le dépôt de garantie n'est PAS automatiquement perdu en cas de non-obtention du prêt : il est restitué intégralement à l'acheteur si la condition suspensive est défaillie sans faute de sa part, en application de l'art. 1304-3 du Code civil. La perte du dépôt n'intervient que sauf faute de l'acheteur — absence de diligence, mauvaise foi, demandes hors délai ou refus d'une offre conforme.",
}

async function main() {
  const { data: before } = await sb
    .from('legal_articles')
    .select('id, article_num, content_summary, embedding')
    .eq('id', ART1304_3_ID)
    .single()

  if (!before) { console.error('❌ Ligne introuvable'); process.exit(1) }

  console.log('AVANT (content_summary):')
  console.log(before.content_summary)
  console.log('embedding présent avant :', Array.isArray(before.embedding) ? `oui (${before.embedding.length})` : 'NON')
  console.log('')

  const embedText = `${NEW_SUMMARY.situation} ${NEW_SUMMARY.principe} ${NEW_SUMMARY.consequence}`
  console.log(`Génération embedding (${embedText.length} chars)…`)
  const embedding = await embedNomic(embedText)
  if (!embedding?.length) { console.error('❌ embedding échec'); process.exit(1) }
  console.log(`✓ embedding (${embedding.length} dims)\n`)

  const { error } = await sb
    .from('legal_articles')
    .update({ content_summary: JSON.stringify(NEW_SUMMARY), embedding })
    .eq('id', ART1304_3_ID)

  if (error) { console.error('❌', error.message); process.exit(1) }

  const { data: after } = await sb
    .from('legal_articles')
    .select('content_summary, embedding')
    .eq('id', ART1304_3_ID)
    .single()

  console.log('APRÈS (content_summary):')
  console.log(after?.content_summary)
  console.log('embedding présent après :', Array.isArray(after?.embedding) ? `oui (${after?.embedding.length})` : 'NON')
  console.log('\n✅ Patch appliqué (résumé + embedding généré).')
}

main().catch(err => { console.error(err); process.exit(1) })
