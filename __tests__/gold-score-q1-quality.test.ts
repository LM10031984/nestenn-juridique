// __tests__/gold-score-q1-quality.test.ts
// Tests de score Q1 sur réponse de référence — cible ≥ 17/20

import { describe, it, expect } from 'vitest'
import { scoreAgainstGold } from '@/lib/legal-gold-score'
import { getGoldCase } from '@/lib/legal-gold-cases'

// ── Réponse Q1 de référence ───────────────────────────────────────────────────
// Correcte juridiquement : évite toute affirmation d'exécution forcée automatique.
// Utilise "automatiquement" uniquement dans le contexte des conditions suspensives
// (usage normal et juste, pas une erreur).

const GOOD_Q1_ANSWER = `
  L'acquéreur non professionnel d'un bien à usage d'habitation bénéficie d'un
  délai de rétractation de 10 jours selon le code civil (L271-1 CCH), à compter
  de la notification de l'acte.

  Une offre d'achat contresignée par le vendeur peut former un contrat synallagmatique
  si elle réunit les éléments essentiels (chose + prix). Dans ce cas, le droit de
  rétractation constitue la protection centrale de l'acquéreur non professionnel.

  Compromis de vente ou simple offre ? Vérifier la nature du document est la
  première démarche indispensable : la qualification conditionne toute la suite.

  Conditions suspensives : si la condition suspensive d'obtention de prêt immobilier
  n'est pas remplie, l'engagement tombe automatiquement sans pénalité.

  Exécution forcée : théoriquement fondée sur l'art. 1589 du code civil (promesse
  de vente vaut vente), elle nécessite une action en justice et reste rarement
  accordée en pratique — les juges préfèrent les dommages-intérêts.

  Consulter un notaire pour qualifier le document et évaluer les risques exacts.
`

// ── Réponse Q1 erronée (pour contrôle) ───────────────────────────────────────

const BAD_Q1_ANSWER = `
  Dès que le vendeur contresigne l'offre d'achat, la vente est définitivement parfaite.
  L'acquéreur est forcément tenu d'acheter. L'exécution forcée est immédiate.
`

describe('scoreAgainstGold Q1 — qualité de réponse', () => {
  const goldQ1 = getGoldCase('Q1')!

  it('réponse Q1 correcte → score ≥ 17/20', () => {
    const score = scoreAgainstGold(GOOD_Q1_ANSWER, goldQ1)
    expect(score.total).toBeGreaterThanOrEqual(17)
  })

  it('réponse Q1 correcte → mustAvoidScore = 5 (automatiquement dans conditions suspensives ne pénalise pas)', () => {
    const score = scoreAgainstGold(GOOD_Q1_ANSWER, goldQ1)
    expect(score.mustAvoidScore).toBe(5)
  })

  it('réponse Q1 correcte → practicalScore ≥ 4 (nature, prêt immobilier, notaire)', () => {
    const score = scoreAgainstGold(GOOD_Q1_ANSWER, goldQ1)
    expect(score.practicalScore).toBeGreaterThanOrEqual(4)
  })

  it('réponse Q1 erronée → mustAvoidScore ≤ 1 (vente parfaite + forcément tenu + exécution immédiate)', () => {
    const score = scoreAgainstGold(BAD_Q1_ANSWER, goldQ1)
    expect(score.mustAvoidScore).toBeLessThanOrEqual(1)
  })
})
