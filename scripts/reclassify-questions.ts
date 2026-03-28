// scripts/reclassify-questions.ts
// Reclassifie les messages existants qui n'ont pas de sub_domain
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/reclassify-questions.ts

import { createClient } from '@supabase/supabase-js'
import { openRouterChat, MODELS } from '../lib/openrouter'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function classifySubDomain(question: string): Promise<string | null> {
  const prompt = `Tu classifies les questions d'agents immobiliers en thèmes précis.
Choisis UN thème dans la liste ci-dessous. Si aucun ne correspond, crée un nouveau thème en 2-3 mots.

THÈMES EXISTANTS :
- Commission et honoraires
- Mandat exclusif
- Mandat simple
- Compromis et promesse
- Conditions suspensives
- Vices cachés
- Tutelle et capacité
- Préemption
- Dépôt de garantie
- Loyers impayés
- Expulsion locataire
- Congé bailleur
- Congé locataire
- Révision loyer
- Sous-location
- Décès locataire
- Bail meublé
- Diagnostics obligatoires
- DPE validité
- Copropriété AG
- Syndic contrat
- Charges copropriété
- Travaux copropriété
- Permis de construire
- Frais de notaire
- Plus-value immobilière
- Responsabilité agent
- Double mandat
- Assignation et procédure
- Servitude
- Viager
- Usufruit
- Bail commercial
- Indivision
- SCI

Question : "${question}"

Réponds avec UNIQUEMENT le thème, rien d'autre.`

  try {
    const result = await openRouterChat(
      [{ role: 'user', content: prompt }],
      MODELS.FILTER,
      30
    )
    return result.trim().slice(0, 60)
  } catch {
    return null
  }
}

async function main() {
  console.log('\n=== RECLASSIFICATION DES QUESTIONS ===\n')

  const { data: messages } = await supabase
    .from('messages')
    .select('id, content')
    .eq('role', 'user')
    .is('sub_domain', null)
    .order('created_at', { ascending: false })
    .limit(100)

  if (!messages?.length) {
    console.log('Aucune question à reclassifier.')
    return
  }

  console.log(`${messages.length} question(s) à classifier\n`)

  let classified = 0
  for (const msg of messages) {
    const question = (msg.content as string)?.slice(0, 200) ?? ''
    if (!question) continue

    process.stdout.write(`  "${question.slice(0, 60)}..." → `)

    const subDomain = await classifySubDomain(question)
    if (subDomain) {
      await supabase
        .from('messages')
        .update({ sub_domain: subDomain })
        .eq('id', msg.id)

      console.log(subDomain)
      classified++
    } else {
      console.log('(échec)')
    }

    await new Promise(r => setTimeout(r, 200))
  }

  console.log(`\n✅ ${classified}/${messages.length} questions classifiées\n`)
}

main().catch(console.error)
