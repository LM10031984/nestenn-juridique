// Patch ciblé : enrichit content_summary de l'art. 20-1 loi 89-462 pour
// couvrir les 4 axes opérationnels attendus :
//   - logement décent (référence décret n° 2002-120)
//   - interdiction de suspension unilatérale du loyer par le locataire
//   - obligation de saisir le juge (commission de conciliation puis TJ)
//   - consignation du loyer possible UNIQUEMENT sur autorisation judiciaire
//
// Régénère également l'embedding pour aligner le retrieval sur le nouveau
// texte (l'ancien embedding ne capturait pas "consignation").
//
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/_patch-art20-1-summary.ts
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
)

const ART20_1_ID = 'b85ae61d-42e7-4864-a2f5-ff2d1c446c21'
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
    "Lorsqu'un locataire estime que son logement loué (loi du 6 juillet 1989) ne satisfait pas aux critères de décence fixés par le décret n° 2002-120 du 30 janvier 2002, il ne peut pas suspendre seul le paiement du loyer.",
  principe:
    "Les caractéristiques du logement décent sont définies par le décret n° 2002-120 du 30 janvier 2002 (sécurité, salubrité, surface, performance énergétique). Le locataire qui constate un manquement doit d'abord demander au bailleur la mise en conformité du logement. À défaut d'accord amiable, il saisit la commission départementale de conciliation puis, si nécessaire, le tribunal judiciaire pour obtenir une autorisation judiciaire. Seul le juge peut, sur autorisation expresse, déterminer la nature des travaux et leur délai d'exécution, réduire le montant du loyer, ou en suspendre le paiement — avec ou sans consignation — jusqu'à exécution des travaux. Toute suspension unilatérale du loyer par le locataire, sans autorisation judiciaire préalable, constitue un manquement contractuel l'exposant à une procédure d'expulsion pour impayés.",
  consequence:
    "La consignation du loyer comme sa suspension ne sont possibles que sur autorisation expresse du juge : sans cette autorisation judiciaire préalable, toute consignation est irrégulière. Le bail demeure exécutoire pendant l'instance : le loyer reste dû tant que le juge n'a pas accordé son autorisation. La référence opposable au bailleur est le décret n° 2002-120.",
}

async function main() {
  const { data: before } = await sb
    .from('legal_articles')
    .select('id, article_num, content_summary')
    .eq('id', ART20_1_ID)
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
    .eq('id', ART20_1_ID)

  if (error) { console.error('❌', error.message); process.exit(1) }

  const { data: after } = await sb
    .from('legal_articles')
    .select('content_summary')
    .eq('id', ART20_1_ID)
    .single()

  console.log('APRÈS (content_summary):')
  console.log(after?.content_summary)
  console.log('\n✅ Patch appliqué (résumé + embedding).')
}

main().catch(err => { console.error(err); process.exit(1) })
