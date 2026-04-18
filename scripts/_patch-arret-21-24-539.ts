// Patch ciblé : enrichit le holding de l'arrêt Cass 3e civ 14 déc 2022
// n° 21-24.539 (jurisprudence) — actuellement tronqué à 230 chars et
// imprécis. L'arrêt est déjà top-1 du retrieval Q41 mais son holding
// confus pousse le LLM à préférer un autre arrêt cité de mémoire.
//
// Active aussi curated=true (boost retrieval +5%) et régénère l'embedding
// pour aligner avec le nouveau holding.
//
// Pas de modification de domain (laissé à vente_immobiliere — la question
// touche techniquement à la fois vente et financement).
//
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/_patch-arret-21-24-539.ts
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
)

const ARRET_ID = 'd97d6ccd-ca68-428b-9cbd-2d47be1581a6'
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

const NEW_HOLDING =
  "Sur condition suspensive de financement, l'acquéreur n'est pas tenu d'accepter une offre de prêt d'un montant inférieur à celui stipulé dans la promesse de vente : une telle offre ne réalise pas la condition suspensive de prêt. L'acquéreur ne commet aucune faute en refusant cette offre, la condition suspensive est défaillie sans faute de sa part et la vente est caduque, le dépôt de garantie devant lui être restitué intégralement (Cass. 3e civ., 14 décembre 2022, n° 21-24.539)."

// Note : sur cette base, la RPC search_all_legal_context (version
// pré-migrations 014/019) n'expose pas les champs `number` et `holding`.
// Conséquence : sources.ts:rowToJuriCase filtre l'arrêt à null car
// caseNumber est vide. Pour contourner sans toucher au moteur :
//   - visa_refs[1] devient le `title` (curated=true) — on y inclut
//     "n° 21-24.539" pour que la regex de fallback extraie le numéro
//   - situation/principle/consequence sont peuplés — le fallback holding
//     les concatène avec " — "
const NEW_VISA = "Cass. 3e civ., 14 décembre 2022, n° 21-24.539"
// Référence préfixée dans situation : Mistral préfère citer ses arrêts
// de mémoire plutôt que ceux des sources si le format date est ISO. On
// rend la référence textuelle "Cass. 3e civ., 14 décembre 2022, n° 21-24.539"
// directement visible dans le contenu servi au LLM via la RPC.
const NEW_SITUATION =
  "Cass. 3e civ., 14 décembre 2022, n° 21-24.539 — Une promesse de vente conclue sous condition suspensive de financement prévoit un montant de prêt déterminé. L'acquéreur reçoit ensuite une offre de prêt d'un montant inférieur à ce montant."
const NEW_PRINCIPLE =
  "Selon Cass. 3e civ., 14 décembre 2022, n° 21-24.539, l'acquéreur n'est pas tenu d'accepter une offre de prêt d'un montant inférieur à celui stipulé dans la promesse de vente : une telle offre ne réalise pas la condition suspensive de prêt et l'acquéreur ne commet aucune faute en la refusant."
const NEW_CONSEQUENCE =
  "Conformément à Cass. 3e civ., 14 décembre 2022, n° 21-24.539, la condition suspensive est défaillie sans faute de l'acquéreur : la vente est caduque et le dépôt de garantie est restitué intégralement."

async function main() {
  const { data: before } = await sb
    .from('jurisprudence')
    .select('id, source_id, number, date, court, domain, curated, holding')
    .eq('id', ARRET_ID)
    .single()

  if (!before) { console.error('❌ Ligne introuvable'); process.exit(1) }

  console.log('AVANT :')
  console.log('  curated:', before.curated, '| domain:', before.domain)
  console.log('  holding (' + (before.holding?.length ?? 0) + ' chars):', before.holding)
  console.log('')

  console.log(`Régénération embedding (${NEW_HOLDING.length} chars)…`)
  const embedding = await embedNomic(NEW_HOLDING)
  if (!embedding?.length) { console.error('❌ embedding échec'); process.exit(1) }
  console.log(`✓ embedding (${embedding.length} dims)\n`)

  // Préfixe "n° " sur number : sur cette base, la RPC active expose
  // title = COALESCE(number, source_id). sources.ts:rowToJuriCase
  // extrait le numéro via la regex /n°\s*([\d\-.\/]+)/ — donc sans
  // préfixe "n°", l'arrêt est filtré (caseNumber vide → return null).
  const PREFIXED_NUMBER = "n° 21-24.539"

  const { error } = await sb
    .from('jurisprudence')
    .update({
      holding: NEW_HOLDING,
      curated: true,
      visa_refs: [NEW_VISA],
      situation: NEW_SITUATION,
      principle: NEW_PRINCIPLE,
      consequence: NEW_CONSEQUENCE,
      number: PREFIXED_NUMBER,
      embedding,
    })
    .eq('id', ARRET_ID)

  if (error) { console.error('❌', error.message); process.exit(1) }

  const { data: after } = await sb
    .from('jurisprudence')
    .select('curated, holding')
    .eq('id', ARRET_ID)
    .single()

  console.log('APRÈS :')
  console.log('  curated:', after?.curated)
  console.log('  holding (' + (after?.holding?.length ?? 0) + ' chars):', after?.holding)
  console.log('\n✅ Patch appliqué (holding enrichi + curated + embedding régénéré).')
}

main().catch(err => { console.error(err); process.exit(1) })
