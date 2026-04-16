// __tests__/gold-score-phase2-quality.test.ts
// Tests de score Q4/Q5/Q6 sur réponses de référence — cible ≥ 17/20
// (Sprint qualité Phase 2 : alignment sur le niveau Phase 1, seuil relevé 15→17)
// Lancer : npx vitest run __tests__/gold-score-phase2-quality.test.ts

import { describe, it, expect } from 'vitest'
import { scoreAgainstGold } from '@/lib/legal-gold-score'
import { getGoldCase } from '@/lib/legal-gold-cases'

// ─────────────────────────────────────────────────────────────────────────────
// Q4 — Copropriété travaux urgents
// ─────────────────────────────────────────────────────────────────────────────

const GOOD_Q4_ANSWER = `
  Le syndic de copropriété est habilité à engager des travaux urgents sans vote préalable
  de l'assemblée générale, sous conditions strictes (art. 18 loi du 10 juillet 1965).

  L'urgence doit être réelle : risque immédiat pour la sécurité des personnes ou la
  conservation de l'immeuble. Des travaux de confort ou d'amélioration planifiables ne
  constituent pas une urgence au sens de cet article.

  Obligation post-travaux : le syndic doit informer l'assemblée générale dans les
  meilleurs délais et lui rendre compte (art. 37 décret du 17 mars 1967). À défaut,
  il engage sa responsabilité.

  Les charges résultant de ces travaux urgents sont réparties entre les copropriétaires
  selon leurs tantièmes, même sans vote préalable. Le refus de payer expose à une
  action en recouvrement.

  Pour contester : demander au syndic le rapport d'urgence documentant le sinistre.
  Si l'urgence était contestable, consulter un avocat spécialisé en copropriété.
`

const BAD_Q4_ANSWER = `
  Le syndic n'a jamais le droit de faire des travaux sans vote en assemblée générale.
  Les copropriétaires ne doivent rien payer sans avoir voté.
  Tout travaux urgent est forcément illégal sans vote préalable.
`

describe('scoreAgainstGold Q4 — copropriété travaux urgents', () => {
  const goldQ4 = getGoldCase('Q4')!

  it('Q4 gold case existe', () => {
    expect(goldQ4).not.toBeNull()
    expect(goldQ4.id).toBe('Q4')
  })

  it('réponse Q4 correcte → score ≥ 17/20', () => {
    const score = scoreAgainstGold(GOOD_Q4_ANSWER, goldQ4)
    expect(score.total).toBeGreaterThanOrEqual(17)
  })

  it('réponse Q4 correcte → mustInclude : assemblée générale + travaux urgents + charges + urgence + information', () => {
    const score = scoreAgainstGold(GOOD_Q4_ANSWER, goldQ4)
    expect(score.mustIncludeScore).toBeGreaterThanOrEqual(3)
  })

  it('réponse Q4 erronée → mustAvoidScore ≤ 1 (syndic jamais + ne doivent rien + forcément illégal)', () => {
    const score = scoreAgainstGold(BAD_Q4_ANSWER, goldQ4)
    expect(score.mustAvoidScore).toBeLessThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Q5 — DPE erroné, recours acheteur
// ─────────────────────────────────────────────────────────────────────────────

const GOOD_Q5_ANSWER = `
  Depuis le 1er juillet 2021, le DPE est opposable (loi Climat-Résilience n° 2021-1104).
  Un DPE erroné peut donc fonder une action, sous conditions.

  Le recours prioritaire est dirigé contre le diagnostiqueur : si une faute dans
  l'établissement du DPE est démontrée, sa responsabilité délictuelle est engagée
  (art. 1240 Code civil). Il doit disposer d'une assurance responsabilité civile pro.

  Le recours contre le vendeur est possible via la garantie des vices cachés
  (art. 1641 Code civil) si la mauvaise performance énergétique constitue un défaut
  rendant le bien impropre à l'usage normal. Délai : 2 ans à compter de la découverte.

  Première démarche : faire établir un nouveau DPE par un expert indépendant pour
  documenter l'écart avec le DPE initial. Sans preuve de l'erreur, aucun recours
  sérieux n'est possible.

  Consulter un avocat spécialisé pour choisir entre action contre le diagnostiqueur
  ou contre le vendeur selon les circonstances.
`

const BAD_Q5_ANSWER = `
  Le DPE erroné entraîne automatiquement la nullité de la vente.
  Le vendeur est toujours responsable des erreurs du diagnostiqueur.
  Tout DPE erroné donne droit à une indemnisation automatique.
`

describe('scoreAgainstGold Q5 — DPE erroné', () => {
  const goldQ5 = getGoldCase('Q5')!

  it('Q5 gold case existe', () => {
    expect(goldQ5).not.toBeNull()
    expect(goldQ5.id).toBe('Q5')
  })

  it('réponse Q5 correcte → score ≥ 17/20', () => {
    const score = scoreAgainstGold(GOOD_Q5_ANSWER, goldQ5)
    expect(score.total).toBeGreaterThanOrEqual(17)
  })

  it('réponse Q5 correcte → mustInclude : diagnostiqueur + opposable + vice caché + preuve + délai', () => {
    const score = scoreAgainstGold(GOOD_Q5_ANSWER, goldQ5)
    expect(score.mustIncludeScore).toBeGreaterThanOrEqual(3)
  })

  it('réponse Q5 erronée → mustAvoidScore ≤ 1 (nullité automatique + toujours responsable + automatique)', () => {
    const score = scoreAgainstGold(BAD_Q5_ANSWER, goldQ5)
    expect(score.mustAvoidScore).toBeLessThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Q6 — Responsabilité agent immobilier
// ─────────────────────────────────────────────────────────────────────────────

const GOOD_Q6_ANSWER = `
  L'agent immobilier est soumis à un devoir d'information et de conseil envers toutes
  les parties (loi Hoguet, art. 6 loi 70-9 du 2 janvier 1970). S'il avait connaissance
  d'un problème et ne l'a pas signalé, sa responsabilité délictuelle est engageable
  (art. 1240 Code civil).

  La preuve de la connaissance est centrale : il faut démontrer que l'agent savait,
  ou aurait dû savoir dans l'exercice normal de sa mission. Vérifier les rapports
  de visite, échanges écrits, expertises préalables.

  Cette action en responsabilité est distincte de l'action en garantie des vices cachés
  contre le vendeur (art. 1641 Code civil). Les deux peuvent être menées simultanément.

  Les dommages-intérêts couvrent le préjudice réel : coût des travaux, perte de valeur.
  Délai de prescription : 5 ans à compter de la découverte (art. 2224 Code civil).

  Consulter un avocat pour évaluer la solidité du dossier avant toute mise en demeure.
`

const BAD_Q6_ANSWER = `
  L'agent est automatiquement responsable de tout vice caché.
  L'acheteur est toujours indemnisé si l'agent n'a rien dit.
  Le contrat de vente est nul automatiquement.
`

describe('scoreAgainstGold Q6 — responsabilité agent', () => {
  const goldQ6 = getGoldCase('Q6')!

  it('Q6 gold case existe', () => {
    expect(goldQ6).not.toBeNull()
    expect(goldQ6.id).toBe('Q6')
  })

  it('réponse Q6 correcte → score ≥ 17/20', () => {
    const score = scoreAgainstGold(GOOD_Q6_ANSWER, goldQ6)
    expect(score.total).toBeGreaterThanOrEqual(17)
  })

  it('réponse Q6 correcte → mustInclude : devoir + preuve + connaissance + dommages-intérêts + responsabilité', () => {
    const score = scoreAgainstGold(GOOD_Q6_ANSWER, goldQ6)
    expect(score.mustIncludeScore).toBeGreaterThanOrEqual(3)
  })

  it('réponse Q6 erronée → mustAvoidScore ≤ 1 (automatiquement + toujours + nul automatiquement)', () => {
    const score = scoreAgainstGold(BAD_Q6_ANSWER, goldQ6)
    expect(score.mustAvoidScore).toBeLessThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Intégrité de GOLD_CASES — 6 cas total
// ─────────────────────────────────────────────────────────────────────────────

describe('GOLD_CASES — intégrité catalogue', () => {
  it('GOLD_CASES contient 9 cas (Q1 à Q9)', async () => {
    const { GOLD_CASES } = await import('@/lib/legal-gold-cases')
    expect(GOLD_CASES).toHaveLength(9)
    const ids = GOLD_CASES.map((c) => c.id)
    expect(ids).toContain('Q1')
    expect(ids).toContain('Q2')
    expect(ids).toContain('Q3')
    expect(ids).toContain('Q4')
    expect(ids).toContain('Q5')
    expect(ids).toContain('Q6')
    expect(ids).toContain('Q7')
    expect(ids).toContain('Q8')
    expect(ids).toContain('Q9')
  })
})
