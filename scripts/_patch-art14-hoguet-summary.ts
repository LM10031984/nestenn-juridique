// Patch ciblé : réécrit content_summary de l'art. 14 loi Hoguet
// (LEGITEXT000006068387) pour couvrir les axes opérationnels attendus sur
// Q23 :
//   - fondement Hoguet (art. 14)
//   - peines (6 mois emprisonnement + 7 500 € amende, x5 pour morale)
//   - interdiction d'exercer
//   - contre-indication explicite : l'art. 313-1 CP (escroquerie) ne
//     s'applique pas à la seule absence de carte professionnelle
//
// Régénère l'embedding pour aligner le retrieval sur la sémantique
// "risque agence sans carte" (actuellement l'art. 14 est absent du top-20).
//
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/_patch-art14-hoguet-summary.ts
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
)

const ART14_HOGUET_ID = '5f621a9b-f075-4338-8675-327bbdb5da9e'
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
    "Lorsqu'une agence immobilière ou une personne exerce, à titre habituel (même accessoire), des activités de transaction, d'entremise ou de gestion immobilière visées à l'article 1er de la loi Hoguet sans être titulaire d'une carte professionnelle valide (carte T, G ou S) ou en méconnaissance d'une interdiction temporaire ou définitive d'exercer.",
  principe:
    "L'article 14 de la loi n° 70-9 du 2 janvier 1970 (loi Hoguet) est le fondement unique des sanctions pénales en cas d'exercice sans carte professionnelle : est puni de six mois d'emprisonnement et de 7 500 € d'amende le fait de se livrer, même accessoirement, à des opérations d'entremise ou de gestion immobilière sans être titulaire de la carte instituée par l'article 3. La même peine s'applique à l'usage non autorisé des titres d'agent immobilier, syndic de copropriété ou administrateur de biens, ainsi qu'à l'exercice en méconnaissance d'une interdiction d'exercer. Pour une personne morale, l'amende est quintuplée (art. 131-38 CP) et le tribunal peut prononcer des peines complémentaires : interdiction d'exercer l'activité pour une durée de cinq ans maximum, dissolution, fermeture d'établissement.",
  consequence:
    "Le risque pénal pour une agence qui exerce sans carte professionnelle valide est strictement défini par l'article 14 de la loi Hoguet : six mois d'emprisonnement, 7 500 € d'amende (personne physique) ou 37 500 € (personne morale), et interdiction d'exercer. L'article 313-1 du Code pénal (escroquerie) ne s'applique PAS à la seule absence de carte professionnelle : la loi Hoguet est un régime spécial qui écarte le droit commun pénal. De plus, les mandats et commissions sont nuls, et l'agence engage sa responsabilité civile envers les clients lésés.",
}

async function main() {
  const { data: before } = await sb
    .from('legal_articles')
    .select('id, article_num, content_summary')
    .eq('id', ART14_HOGUET_ID)
    .single()

  if (!before) { console.error('❌ Ligne introuvable'); process.exit(1) }

  console.log('AVANT (content_summary):')
  console.log(before.content_summary)
  console.log('')

  const embedText = `${NEW_SUMMARY.situation} ${NEW_SUMMARY.principe} ${NEW_SUMMARY.consequence}`
  console.log(`Régénération embedding (${embedText.length} chars)…`)
  const embedding = await embedNomic(embedText)
  if (!embedding?.length) { console.error('❌ embedding échec'); process.exit(1) }
  console.log(`✓ embedding (${embedding.length} dims)\n`)

  const { error } = await sb
    .from('legal_articles')
    .update({ content_summary: JSON.stringify(NEW_SUMMARY), embedding })
    .eq('id', ART14_HOGUET_ID)

  if (error) { console.error('❌', error.message); process.exit(1) }

  const { data: after } = await sb
    .from('legal_articles')
    .select('content_summary')
    .eq('id', ART14_HOGUET_ID)
    .single()

  console.log('APRÈS (content_summary):')
  console.log(after?.content_summary)
  console.log('\n✅ Patch appliqué (résumé + embedding).')
}

main().catch(err => { console.error(err); process.exit(1) })
