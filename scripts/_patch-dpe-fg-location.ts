// Patch ciblé Q51 : deux résumés à corriger côté loi 89-462 pour éliminer
// la confusion art. 17 ↔ art. 6 sur l'interdiction de location F/G.
//
//   1. art. 6 loi 89-462 (vrai fondement de la décence énergétique) :
//      enrichi avec calendrier complet 2023/2025/2028/2034, classes F/G/E,
//      renvoi art. L.173-1-1 et L.173-2 CCH.
//
//   2. art. 17 loi 89-462 (fixation du loyer) :
//      nettoyé de la mention "classe F ou G" hors contexte. L'art. 17
//      régit l'encadrement des loyers en zone tendue, NON l'interdiction
//      de louer un logement énergivore — cette dernière relève de l'art. 6
//      et de l'art. L.173-2 CCH.
//
// Les deux embeddings sont régénérés.
//
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/_patch-dpe-fg-location.ts
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
)

const ART6_ID = 'df878acb-502d-4a80-8119-87b494e3d886'
const ART17_ID = 'ac78629d-2dd8-45da-85bc-73c77368419c'
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

const ART6_SUMMARY = {
  situation:
    "Lorsqu'un bailleur souhaite mettre en location un logement à usage de résidence principale (loi du 6 juillet 1989) et que ce logement est classé F ou G au DPE (diagnostic de performance énergétique) : la classification énergétique A à G des logements est définie par l'article L.173-1-1 du code de la construction et de l'habitation (CCH), et le calendrier d'interdiction progressive de la location des passoires thermiques par l'article L.173-2 du même code.",
  principe:
    "L'article 6 de la loi n° 89-462 du 6 juillet 1989 est le fondement de l'obligation de décence du logement loué, y compris de sa décence énergétique. La décence énergétique impose le respect d'un niveau de performance minimal défini à l'article L.173-1-1 CCH (classification énergétique A à G), avec un calendrier d'interdiction progressive fixé à l'article L.173-2 CCH : logements G les plus consommateurs (G lourds, > 450 kWh/m²/an) interdits à la location depuis le 1er janvier 2023 ; tous les logements classés G interdits au 1er janvier 2025 pour les nouveaux contrats ; logements classés F interdits au 1er janvier 2028 ; logements classés E interdits au 1er janvier 2034. Ces interdictions relèvent de l'article 6 de la loi de 1989 (décence) combiné aux articles L.173-1-1 et L.173-2 CCH, et NON de l'article 17 de la loi de 1989 qui régit uniquement la fixation du loyer en zone tendue.",
  consequence:
    "Un logement classé G ne peut plus être mis en location pour un nouveau bail depuis le 1er janvier 2025 (art. 6 loi 89-462 + art. L.173-1-1 et L.173-2 CCH). Le locataire d'un logement non décent peut saisir le juge pour obtenir la mise en conformité, une réduction du loyer ou une suspension du paiement (art. 20-1 loi 89-462). Les montants d'amende pénale spécifiques doivent être vérifiés sur Légifrance : aucune sanction pénale forfaitaire de 30 000 € n'est prévue au titre de la seule indécence énergétique.",
}

const ART17_SUMMARY = {
  situation:
    "Lorsqu'un bailleur fixe le loyer initial d'un nouveau bail d'habitation principale (loi du 6 juillet 1989) dans une zone d'urbanisation continue de plus de 50 000 habitants caractérisée par un déséquilibre marqué entre l'offre et la demande (zone tendue).",
  principe:
    "L'article 17 de la loi n° 89-462 du 6 juillet 1989 régit exclusivement la fixation et la révision du loyer : en zone tendue, le loyer du bail en cours ne peut excéder le dernier loyer appliqué au précédent locataire, et l'encadrement du loyer s'applique sur la base d'un loyer de référence. L'article 17 ne traite PAS de la décence énergétique ni de l'interdiction de louer les passoires thermiques : ces questions relèvent de l'article 6 de la même loi combiné à l'article L.173-2 du code de la construction et de l'habitation.",
  consequence:
    "Le locataire dont le loyer excède les plafonds de l'article 17 peut demander une action en diminution du loyer. L'article 17 n'est PAS le fondement de l'interdiction de location des logements classés F ou G : pour cette question, se référer à l'article 6 loi 89-462 (décence énergétique) et à l'article L.173-2 CCH (calendrier d'interdiction).",
}

async function updateRow(id: string, summary: object, tag: string) {
  const text = JSON.stringify(summary)
  const parsed = JSON.parse(text) as Record<string, string>
  const embedText = `${parsed.situation} ${parsed.principe} ${parsed.consequence}`
  console.log(`[${tag}] embedding (${embedText.length} chars)…`)
  const embedding = await embedNomic(embedText)
  if (!embedding?.length) throw new Error(`[${tag}] embedding échec`)
  console.log(`[${tag}] ✓ embedding (${embedding.length} dims)`)
  const { error } = await sb
    .from('legal_articles')
    .update({ content_summary: text, embedding })
    .eq('id', id)
  if (error) throw new Error(`[${tag}] update: ${error.message}`)
  console.log(`[${tag}] ✅ patché`)
}

async function main() {
  console.log('=== AVANT ===')
  for (const { id, tag } of [{ id: ART6_ID, tag: 'art.6' }, { id: ART17_ID, tag: 'art.17' }]) {
    const { data } = await sb.from('legal_articles').select('content_summary').eq('id', id).single()
    console.log(`[${tag}] ${data?.content_summary}`)
  }
  console.log('')

  await updateRow(ART6_ID, ART6_SUMMARY, 'art.6')
  await updateRow(ART17_ID, ART17_SUMMARY, 'art.17')

  console.log('\n=== APRÈS ===')
  for (const { id, tag } of [{ id: ART6_ID, tag: 'art.6' }, { id: ART17_ID, tag: 'art.17' }]) {
    const { data } = await sb.from('legal_articles').select('content_summary').eq('id', id).single()
    console.log(`[${tag}] ${data?.content_summary}`)
  }
  console.log('\n✅ Patch complet appliqué (2 résumés + 2 embeddings).')
}

main().catch(err => { console.error(err); process.exit(1) })
