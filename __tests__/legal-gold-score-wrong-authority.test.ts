// __tests__/legal-gold-score-wrong-authority.test.ts
// Tests de pénalité wrong authority dans scoreAgainstGold

import { describe, it, expect } from 'vitest'
import { scoreAgainstGold } from '@/lib/legal-gold-score'
import { getGoldCase } from '@/lib/legal-gold-cases'

describe('scoreAgainstGold — wrongAuthorityContexts Q3', () => {
  const goldQ3 = getGoldCase('Q3')!

  it('réponse Q3 sans L271-1 → pas de pénalité wrong authority', () => {
    const answer = `
      Le SPANC est l'autorité compétente pour contrôler les installations d'assainissement non collectif.
      Contacter le SPANC pour obtenir un rapport écrit sur votre situation.
      La mise en conformité dépend de la gravité de la non-conformité et du contexte de vente.
    `
    const score = scoreAgainstGold(answer, goldQ3)
    const hasWrongAuthorityComment = score.comments.some((c) =>
      c.includes('mal employée') || c.includes('L271-1')
    )
    expect(hasWrongAuthorityComment).toBe(false)
  })

  it('réponse Q3 avec L271-1 près de "spanc" → authorityScore pénalisé', () => {
    // scoreSain inclut explicitement les keyAuthorities de Q3 pour obtenir un authorityScore > 0
    const scoreSain = scoreAgainstGold(`
      Selon le code de la santé publique, l'assainissement non collectif est soumis
      au contrôle SPANC. Contacter le SPANC pour obtenir un rapport écrit.
      La mise en conformité dépend de la gravité et du contexte de vente.
    `, goldQ3)

    // scoreAvecErreur inclut les mêmes termes + L271-1 en contexte SPANC → pénalité
    const scoreAvecErreur = scoreAgainstGold(`
      Selon le code de la santé publique, l'assainissement non collectif est soumis
      au contrôle SPANC. Le SPANC se fonde notamment sur l'article L271-1
      pour contrôler les installations. Contacter le SPANC, obtenir un rapport écrit,
      mise en conformité selon le contexte de vente.
    `, goldQ3)

    expect(scoreAvecErreur.authorityScore).toBeLessThan(scoreSain.authorityScore)
    expect(scoreAvecErreur.comments.some((c) => c.includes('mal employée'))).toBe(true)
  })

  it('pénalité est bornée à 0 (clampHalf)', () => {
    const answer = `
      Le SPANC utilise l'article L271-1 pour contrôler l'assainissement non collectif de la fosse septique.
      L271-1 est le texte principal du contrôle SPANC selon le code de la santé publique.
    `
    const score = scoreAgainstGold(answer, goldQ3)
    expect(score.authorityScore).toBeGreaterThanOrEqual(0)
  })
})
