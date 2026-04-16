// __tests__/gold-score-phase3-quality.test.ts
// Tests de score Q7/Q8/Q9 sur réponses de référence — cible ≥ 17/20
// Phase 3 : expulsion, DPE F/G interdits, mandat exclusif résiliation
// Lancer : npx vitest run __tests__/gold-score-phase3-quality.test.ts

import { describe, it, expect } from 'vitest'
import { scoreAgainstGold } from '@/lib/legal-gold-score'
import { getGoldCase } from '@/lib/legal-gold-cases'

// ─────────────────────────────────────────────────────────────────────────────
// Q7 — Loyers impayés et expulsion
// ─────────────────────────────────────────────────────────────────────────────

const GOOD_Q7_ANSWER = `
  Face à un locataire qui ne paie plus son loyer, la procédure est strictement
  encadrée par la loi. Voici les étapes obligatoires.

  Étape 1 — Commandement de payer : faire délivrer par un commissaire de justice
  un commandement de payer visant la clause résolutoire du bail (art. 24 loi du
  6 juillet 1989). Ce commandement ouvre un délai de 2 mois au locataire pour
  régulariser sa situation.

  Étape 2 — Saisine du tribunal judiciaire : si le locataire ne règle pas dans
  ce délai, saisir le tribunal judiciaire (juge des contentieux de la protection)
  pour obtenir la résiliation du bail et prononcer l'expulsion. Toute expulsion
  nécessite obligatoirement une décision de justice (art. L411-1 CPCE).

  Point critique — Trêve hivernale : l'exécution physique de l'expulsion est
  suspendue du 1er novembre au 31 mars (art. L412-6 CPCE). La procédure judiciaire
  peut être engagée mais l'expulsion ne peut être mise à exécution pendant cette période.

  Toute voie de fait (forcer une entrée, interrompre les services) est pénalement
  sanctionnée. La procédure passe obligatoirement par un commissaire de justice mandaté.

  Consulter un avocat spécialisé en baux d'habitation — les erreurs de forme
  dans les actes d'huissier invalident la procédure et la retardent de plusieurs mois.
`

const BAD_Q7_ANSWER = `
  Le bailleur peut expulser directement le locataire par voie de fait.
  L'expulsion immédiate sans tribunal est possible dès le premier impayé.
  Le délai trêve hivernale est supprimé depuis la réforme récente.
  Les serrures suffisent pour reprendre possession du logement.
`

describe('scoreAgainstGold Q7 — loyers impayés expulsion', () => {
  const goldQ7 = getGoldCase('Q7')!

  it('Q7 gold case existe', () => {
    expect(goldQ7).not.toBeNull()
    expect(goldQ7.id).toBe('Q7')
  })

  it('réponse Q7 correcte → score ≥ 17/20', () => {
    const score = scoreAgainstGold(GOOD_Q7_ANSWER, goldQ7)
    expect(score.total).toBeGreaterThanOrEqual(17)
  })

  it('réponse Q7 correcte → mustInclude : commandement de payer + clause résolutoire + tribunal + trêve hivernale + commissaire', () => {
    const score = scoreAgainstGold(GOOD_Q7_ANSWER, goldQ7)
    expect(score.mustIncludeScore).toBeGreaterThanOrEqual(3)
  })

  it('réponse Q7 erronée → mustAvoidScore ≤ 1 (expulser directement + sans tribunal + serrures suffisent)', () => {
    const score = scoreAgainstGold(BAD_Q7_ANSWER, goldQ7)
    expect(score.mustAvoidScore).toBeLessThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Q8 — Logement classé G, peut-il être loué en 2025 ?
// ─────────────────────────────────────────────────────────────────────────────

const GOOD_Q8_ANSWER = `
  Depuis le 1er janvier 2025, un logement classé G au DPE est interdit à la location
  résidentielle. Il ne peut plus faire l'objet d'un nouveau bail, d'un renouvellement
  ou d'une reconduction tacite (art. L173-2 Code de la construction et de l'habitation,
  loi Climat-Résilience n° 2021-1104).

  Pour les baux en cours conclus avant 2025 : le bail se poursuit normalement pour le
  locataire en place. Aucune expulsion n'est possible pour le seul motif de la
  classe énergie G. Le bailleur ne peut toutefois pas augmenter le loyer (gel des
  loyers F et G depuis le 24 août 2022, art. 17-1 loi 89-462 — gel des loyers
  pour les logements à faible performance énergétique).

  Calendrier complet : G interdit dès 2025, F interdit dès 2028, E interdit dès 2034.
  Anticiper sur la classe F permet d'éviter une nouvelle mise en conformité dans 3 ans.

  Options pour le bailleur : (a) rénover le logement pour sortir de la classe G
  avant tout nouveau bail — un nouveau DPE sera établi après travaux ; (b) vendre le bien.
  La rénovation n'est pas une obligation immédiate mais conditionne toute nouvelle location.

  Contacts utiles : France Rénov' (conseiller gratuit), MaPrimeRénov', éco-PTZ pour
  financer les travaux de rénovation énergétique.
`

const BAD_Q8_ANSWER = `
  Le locataire a été expulsé en raison du DPE G défavorable.
  La vente est interdite pour tout bien classé G depuis 2025.
  La rénovation immédiate obligatoire s'impose avant toute démarche de location.
`

describe('scoreAgainstGold Q8 — logement G interdit location 2025', () => {
  const goldQ8 = getGoldCase('Q8')!

  it('Q8 gold case existe', () => {
    expect(goldQ8).not.toBeNull()
    expect(goldQ8.id).toBe('Q8')
  })

  it('réponse Q8 correcte → score ≥ 17/20', () => {
    const score = scoreAgainstGold(GOOD_Q8_ANSWER, goldQ8)
    expect(score.total).toBeGreaterThanOrEqual(17)
  })

  it('réponse Q8 correcte → mustInclude : interdit + 2025 + nouveau bail + gel + travaux', () => {
    const score = scoreAgainstGold(GOOD_Q8_ANSWER, goldQ8)
    expect(score.mustIncludeScore).toBeGreaterThanOrEqual(3)
  })

  it('réponse Q8 erronée → mustAvoidScore ≤ 1 (expulsé en raison du dpe + vente interdite + rénovation immédiate obligatoire)', () => {
    const score = scoreAgainstGold(BAD_Q8_ANSWER, goldQ8)
    expect(score.mustAvoidScore).toBeLessThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Q9 — Résiliation mandat exclusif avant 3 mois
// ─────────────────────────────────────────────────────────────────────────────

const GOOD_Q9_ANSWER = `
  Pendant les 3 premiers mois d'un mandat exclusif de vente, le vendeur ne peut
  pas résilier unilatéralement le contrat (art. 78 décret n° 72-678 du 20 juillet
  1972). Cette période initiale est incompressible : ni la volonté du vendeur, ni
  un désaccord sur le prix ne suffisent à mettre fin au mandat.

  Exception : si l'agence immobilière a manqué à ses obligations contractuelles
  (absence de compte-rendus d'activité, défaut de publicité documenté, comportement
  fautif), le vendeur peut invoquer la faute de l'agence pour demander la résiliation
  anticipée. Cette faute doit être documentée par écrit (lettres recommandées) et
  prouvée, conformément aux obligations découlant de la loi Hoguet (loi 70-9).

  Après 3 mois : le mandat exclusif peut être résilié par lettre recommandée avec
  avis de réception, en respectant un délai de préavis de 15 jours avant chaque
  date d'échéance. À défaut de cette formalité, le mandat est reconduit tacitement.

  Risque post-résiliation : si l'agence avait présenté un acquéreur identifié avant
  la résiliation et que la vente se conclut avec lui après résiliation, l'agence
  peut réclamer ses honoraires. Vérifier les clauses du mandat signé sur ce point.

  Consulter un avocat en cas de litige sur la résiliation du mandat exclusif.
  La DGCCRF traite les plaintes contre les pratiques commerciales illicites des agences.
`

const BAD_Q9_ANSWER = `
  Le vendeur peut résilier le mandat exclusif à tout moment sans préavis.
  Le mandat exclusif peut être rompu sans lettre recommandée.
  L'agence n'a droit à aucune indemnité en cas de rupture anticipée.
  Après 3 mois, aucun préavis n'est nécessaire pour résilier.
`

describe('scoreAgainstGold Q9 — mandat exclusif résiliation avant 3 mois', () => {
  const goldQ9 = getGoldCase('Q9')!

  it('Q9 gold case existe', () => {
    expect(goldQ9).not.toBeNull()
    expect(goldQ9.id).toBe('Q9')
  })

  it('réponse Q9 correcte → score ≥ 17/20', () => {
    const score = scoreAgainstGold(GOOD_Q9_ANSWER, goldQ9)
    expect(score.total).toBeGreaterThanOrEqual(17)
  })

  it('réponse Q9 correcte → mustInclude : 3 mois + incompressible + faute + préavis + lettre recommandée', () => {
    const score = scoreAgainstGold(GOOD_Q9_ANSWER, goldQ9)
    expect(score.mustIncludeScore).toBeGreaterThanOrEqual(3)
  })

  it('réponse Q9 erronée → mustAvoidScore ≤ 1 (à tout moment + sans préavis + aucune indemnité)', () => {
    const score = scoreAgainstGold(BAD_Q9_ANSWER, goldQ9)
    expect(score.mustAvoidScore).toBeLessThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Intégrité de GOLD_CASES — 9 cas total (Phase 1 + 2 + 3)
// ─────────────────────────────────────────────────────────────────────────────

describe('GOLD_CASES — intégrité catalogue Phase 3', () => {
  it('GOLD_CASES contient 9 cas (Q1 à Q9)', async () => {
    const { GOLD_CASES } = await import('@/lib/legal-gold-cases')
    expect(GOLD_CASES).toHaveLength(9)
    const ids = GOLD_CASES.map((c) => c.id)
    expect(ids).toContain('Q7')
    expect(ids).toContain('Q8')
    expect(ids).toContain('Q9')
  })

  it('Q7 est associé au playbook baux_loyers_impayes_expulsion', () => {
    const q7 = getGoldCase('Q7')!
    expect(q7.playbookId).toBe('baux_loyers_impayes_expulsion')
  })

  it('Q8 est associé au playbook diagnostics_dpe_fg_interdits', () => {
    const q8 = getGoldCase('Q8')!
    expect(q8.playbookId).toBe('diagnostics_dpe_fg_interdits')
  })

  it('Q9 est associé au playbook agent_mandat_exclusif_resiliation', () => {
    const q9 = getGoldCase('Q9')!
    expect(q9.playbookId).toBe('agent_mandat_exclusif_resiliation')
  })
})
