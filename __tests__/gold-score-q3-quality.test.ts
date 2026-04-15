// __tests__/gold-score-q3-quality.test.ts
// Tests de score Q3 sur réponse de référence — cible ≥ 17/20

import { describe, it, expect } from 'vitest'
import { scoreAgainstGold } from '@/lib/legal-gold-score'
import { getGoldCase } from '@/lib/legal-gold-cases'

const GOOD_Q3_ANSWER = `
  La dénonciation d'un voisin ne constitue pas un contrôle officiel ni une sanction.
  Seul le SPANC (Service Public d'Assainissement Non Collectif), autorité compétente
  selon le Code de la Santé Publique (art. L1331-11-1 CSP), peut déclencher une
  procédure de mise en conformité.

  Première démarche : prendre contact avec le SPANC de la commune et demander un
  rapport écrit précisant la nature des non-conformités, le risque sanitaire ou
  environnemental, et les délais de mise en conformité locaux.

  En cas de vente : le diagnostic assainissement est obligatoire. Les non-conformités
  doivent être portées à la connaissance de l'acquéreur (art. L1331-1-1 CSP).
  En exploitation normale, les délais dépendent de la gravité du risque sanitaire
  et de la politique locale du SPANC.

  Consulter un professionnel agréé avant tout engagement de travaux.
`

const BAD_Q3_ANSWER = `
  La dénonciation de votre voisin entraîne automatiquement une sanction.
  La commune imposera forcément des travaux immédiats sur votre fosse septique.
  Vous devrez payer une amende immédiate.
`

describe('scoreAgainstGold Q3 — qualité de réponse', () => {
  const goldQ3 = getGoldCase('Q3')!

  it('réponse Q3 correcte → score ≥ 17/20', () => {
    const score = scoreAgainstGold(GOOD_Q3_ANSWER, goldQ3)
    expect(score.total).toBeGreaterThanOrEqual(17)
  })

  it('réponse Q3 correcte → authorityScore = 5 (code de la santé publique + 2 autres)', () => {
    const score = scoreAgainstGold(GOOD_Q3_ANSWER, goldQ3)
    expect(score.authorityScore).toBe(5)
  })

  it('réponse Q3 correcte → practicalScore ≥ 4 (contact SPANC + rapport écrit + diagnostic assainissement)', () => {
    const score = scoreAgainstGold(GOOD_Q3_ANSWER, goldQ3)
    expect(score.practicalScore).toBeGreaterThanOrEqual(4)
  })

  it('réponse Q3 erronée → mustAvoidScore ≤ 1 (automatiquement + forcément)', () => {
    const score = scoreAgainstGold(BAD_Q3_ANSWER, goldQ3)
    expect(score.mustAvoidScore).toBeLessThanOrEqual(1)
  })
})
