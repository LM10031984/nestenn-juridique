// Patch ciblé : enrichit content_summary de l'art. 15 loi 89-462 pour
// inclure le droit de préemption du locataire (II) et l'obligation de
// seconde notification au locataire si le bailleur vend à un prix plus
// avantageux pour un tiers (à peine de nullité de la vente).
//
// Conserve le contenu utile sur les délais et formalismes du congé
// (utilisé par d'autres questions du benchmark).
//
// Régénère également l'embedding pour aligner le retrieval sur le
// nouveau texte (l'ancien embedding ne capture pas "préemption /
// nouvelle offre / prix plus avantageux").
//
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/_patch-art15-summary.ts
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
)

const ART15_ID = '5ec9242a-bdf9-444c-b2a0-244a48d526db'
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
    "Lorsqu'un bailleur d'un logement loué nu (loi du 6 juillet 1989) délivre un congé pour vendre, le locataire dispose d'un droit de préemption et doit être informé de toute baisse ultérieure du prix consentie à un tiers.",
  principe:
    "Le congé pour vente vaut, à peine de nullité, offre de vente au profit du locataire : il doit indiquer le prix et les conditions de la vente projetée, et le locataire dispose des deux premiers mois du préavis pour exercer son droit de préemption et se porter acquéreur. Si le bailleur décide ensuite de vendre à un prix ou à des conditions plus avantageux pour un tiers, il est tenu — directement ou via le notaire — de notifier au locataire ce nouveau prix : cette seconde notification vaut nouvelle offre soumise au même délai d'acceptation, à peine de nullité de la vente. Plus généralement, le congé du bailleur doit être motivé (reprise pour habiter, vente, ou motif légitime et sérieux) et délivré au moins six mois avant l'échéance du bail ; le congé du locataire respecte un préavis de trois mois, ramené à un mois en zone tendue, en cas de mutation, de premier emploi, de perte d'emploi ou pour raison de santé.",
  consequence:
    "À défaut de seconde notification au locataire en cas de baisse du prix consenti à un tiers, la vente conclue avec ce tiers est nulle. Le congé non motivé ou délivré hors délai est également nul. À l'expiration du préavis, le locataire qui n'a pas accepté l'offre de vente est déchu de tout titre d'occupation.",
}

async function main() {
  const { data: before } = await sb
    .from('legal_articles')
    .select('id, article_num, content_summary')
    .eq('id', ART15_ID)
    .single()

  if (!before) { console.error('❌ Ligne introuvable'); process.exit(1) }

  console.log('AVANT (content_summary):')
  console.log(before.content_summary)
  console.log('')

  // Régénération de l'embedding sur le nouveau texte (même formule
  // qu'index-legifrance.ts:972 → situation + principe + consequence).
  const embedText = `${NEW_SUMMARY.situation} ${NEW_SUMMARY.principe} ${NEW_SUMMARY.consequence}`
  console.log(`Régénération embedding (${embedText.length} chars)…`)
  const embedding = await embedNomic(embedText)
  if (!embedding?.length) { console.error('❌ embedding échec'); process.exit(1) }
  console.log(`✓ embedding (${embedding.length} dims)\n`)

  const { error } = await sb
    .from('legal_articles')
    .update({ content_summary: JSON.stringify(NEW_SUMMARY), embedding })
    .eq('id', ART15_ID)

  if (error) { console.error('❌', error.message); process.exit(1) }

  const { data: after } = await sb
    .from('legal_articles')
    .select('content_summary')
    .eq('id', ART15_ID)
    .single()

  console.log('APRÈS (content_summary):')
  console.log(after?.content_summary)
  console.log('\n✅ Patch appliqué (résumé + embedding).')
}

main().catch(err => { console.error(err); process.exit(1) })
