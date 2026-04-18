// Patch ciblé : enrichit content_summary de l'art. 22 loi 89-462 pour
// inclure la règle ALUR (retenue provisoire ≤ 20 % en immeuble collectif
// jusqu'à l'arrêté annuel des comptes).
//
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/_patch-art22-summary.ts
import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
)

const ART22_ID = 'c686f202-c6a7-4689-925b-857720a1450d'

const NEW_SUMMARY = {
  situation:
    "Dans le cadre d'une location régie par la loi du 6 juillet 1989, lorsque le locataire verse un dépôt de garantie au bailleur lors de la signature du bail.",
  principe:
    "Le dépôt de garantie ne peut excéder un mois de loyer hors charges (location vide). Il doit être restitué dans le mois suivant la remise des clés si l'état des lieux de sortie est conforme à celui d'entrée, ou dans les deux mois si des dégradations sont constatées, déduction faite des sommes dûment justifiées. Lorsque le logement se situe dans un immeuble collectif, le bailleur procède à un arrêté des comptes provisoire et peut, dûment justifié, conserver une provision n'excédant pas 20 % du dépôt de garantie jusqu'à l'arrêté annuel des comptes ; la régularisation définitive et la restitution du solde interviennent dans le mois suivant l'approbation des comptes.",
  consequence:
    "Tout retard de restitution donne lieu à une majoration de plein droit de 10 % du loyer mensuel par mois de retard commencé (loi ALUR, art. 22 al. 7). Une retenue intégrale du dépôt au seul motif que les charges ne sont pas encore régularisées est abusive : seule la provision plafonnée à 20 % est admise et uniquement pour les immeubles collectifs.",
}

async function main() {
  const { data: before } = await sb
    .from('legal_articles')
    .select('id, article_num, content_summary')
    .eq('id', ART22_ID)
    .single()

  if (!before) {
    console.error('❌ Ligne introuvable')
    process.exit(1)
  }

  console.log('AVANT (content_summary):')
  console.log(before.content_summary)
  console.log('')

  const { error } = await sb
    .from('legal_articles')
    .update({ content_summary: JSON.stringify(NEW_SUMMARY) })
    .eq('id', ART22_ID)

  if (error) { console.error('❌', error.message); process.exit(1) }

  const { data: after } = await sb
    .from('legal_articles')
    .select('content_summary')
    .eq('id', ART22_ID)
    .single()

  console.log('APRÈS (content_summary):')
  console.log(after?.content_summary)
  console.log('\n✅ Patch appliqué. Embedding inchangé (l\'art. 22 remonte déjà au top-12 sur Q11).')
}

main().catch(err => { console.error(err); process.exit(1) })
