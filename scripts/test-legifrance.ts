// scripts/test-legifrance.ts
// Usage : npx dotenv-cli -e .env.local -- npx tsx scripts/test-legifrance.ts

import { fetchLegalContext } from '../lib/legifrance'

const cases = [
  {
    label: 'Via visaRefs Judilibre (Décret 67-223 art. 11)',
    query: 'Le syndic refuse de convoquer une assemblée générale',
    visaRefs: ['Décret 67-223 1967-03-17 art. 11'],
  },
  {
    label: 'Via visaRefs Judilibre (Code civil 1250 et 1252)',
    query: "L'agence n'a pas informé l'acheteur",
    visaRefs: ['articles 1250 et 1252 du code civil'],
  },
  {
    label: 'Via thème (bail/locataire)',
    query: 'Mon locataire ne paie plus son loyer depuis 3 mois',
    visaRefs: [],
  },
  {
    label: 'Via thème (vices cachés)',
    query: "L'acheteur découvre des vices cachés après la vente",
    visaRefs: [],
  },
]

async function main() {
  for (const { label, query, visaRefs } of cases) {
    console.log('\n══════════════════════════════════════════════════')
    console.log('Cas :', label)
    const ctx = await fetchLegalContext(query, undefined, visaRefs.length > 0 ? visaRefs : undefined)
    console.log(`→ available=${ctx.available} texts=${ctx.texts.length}`)
    for (const t of ctx.texts) {
      console.log(`  • ${t.title}`)
      console.log(`    ${t.content.slice(0, 120)}…`)
    }
  }
}

main()
