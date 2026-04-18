// Patch ciblé : réécrit content_summary de l'art. 3 loi 89-462 pour
// traiter explicitement la validité du bail verbal d'habitation et
// neutraliser la dérive du LLM vers l'art. 1715 du Code civil
// (régime archaïque du serment, écarté par le régime spécial de
// la loi de 1989).
//
// Régénère également l'embedding pour aligner le retrieval sur le
// nouveau texte (l'art. 3 n'apparaissait pas dans le top-20 sur Q15).
//
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/_patch-art3-summary.ts
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
)

const ART3_ID = '3c1b9164-6d9b-4c95-83ef-1c73340fa7ec'
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
    "Lorsqu'un bailleur et un locataire concluent un bail d'habitation principale soumis à la loi du 6 juillet 1989, notamment dans le cas d'un bail verbal sans contrat écrit signé entre eux.",
  principe:
    "Le contrat de location à usage de résidence principale doit être établi par écrit selon un contrat type fixé par décret (décret n° 2015-587). Cette obligation d'écrit n'est cependant PAS une condition de validité du bail : un bail verbal d'habitation principale reste pleinement valable et engage le bailleur comme le locataire à toutes les obligations légales (durée minimale, décence, jouissance paisible, encadrement du loyer, etc.). En cas de bail verbal, l'existence et le contenu du contrat se prouvent par tous moyens : quittances de loyer, virements bancaires, témoignages, échanges écrits, état des lieux. La règle archaïque du serment posée par l'art. 1715 du Code civil ne s'applique pas au bail d'habitation principale, écartée par le régime spécial de la loi de 1989. Chaque partie peut à tout moment exiger de l'autre la régularisation du bail par un écrit conforme au contrat type.",
  consequence:
    "L'absence d'écrit n'entraîne ni nullité ni inexistence du bail : la validité n'est pas affectée et les droits du locataire et du bailleur sont préservés. Le bail verbal est présumé conclu pour la durée minimale légale (3 ans pour un bailleur personne physique ou SCI familiale, 6 ans pour une personne morale). En cas de litige, le juge apprécie le contenu du bail à partir de la preuve produite par tous moyens et peut ordonner la rédaction d'un écrit régularisateur.",
}

async function main() {
  const { data: before } = await sb
    .from('legal_articles')
    .select('id, article_num, content_summary')
    .eq('id', ART3_ID)
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
    .eq('id', ART3_ID)

  if (error) { console.error('❌', error.message); process.exit(1) }

  const { data: after } = await sb
    .from('legal_articles')
    .select('content_summary')
    .eq('id', ART3_ID)
    .single()

  console.log('APRÈS (content_summary):')
  console.log(after?.content_summary)
  console.log('\n✅ Patch appliqué (résumé + embedding).')
}

main().catch(err => { console.error(err); process.exit(1) })
