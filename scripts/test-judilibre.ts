// scripts/test-judilibre.ts
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/test-judilibre.ts

import { fetchJurisprudence } from '../lib/judilibre'

const tests = [
  'Mon locataire ne paie plus son loyer depuis 3 mois, que puis-je faire ?',
  'Le syndic refuse de convoquer une assemblée générale extraordinaire pour voter des travaux urgents',
  "L'agence immobilière n'a pas informé l'acheteur des vices cachés de l'immeuble",
  "La condition suspensive d'obtention du prêt immobilier a expiré sans réponse de la banque",
]

async function main() {
  for (const q of tests) {
    console.log('\n══════════════════════════════════════════════════')
    console.log('Question :', q.slice(0, 70))
    const ctx = await fetchJurisprudence(q)
    console.log('visaRefs :', ctx.visaRefs)
    if (ctx.text) {
      console.log('\n' + ctx.text)
    } else {
      console.log('(aucune jurisprudence)')
    }
  }
}

main()
