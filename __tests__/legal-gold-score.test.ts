// __tests__/legal-gold-score.test.ts
import { describe, it, expect } from 'vitest'
import { scoreAgainstGold, determineWinner } from '@/lib/legal-gold-score'
import { getGoldCase, GOLD_CASES } from '@/lib/legal-gold-cases'
import type { GoldBenchmarkCase } from '@/lib/legal-gold-cases'

const MINIMAL_GOLD: GoldBenchmarkCase = {
  id: 'T1',
  playbookId: 'test',
  question: 'Question test',
  mustInclude: ['compromis de vente', 'délai de rétractation', 'exécution forcée'],
  mustAvoid: ["l'acquéreur est forcément tenu", 'automatique et immédiat'],
  keyAuthorities: ['code civil', 'droit de rétractation', 'contrat synallagmatique'],
  practicalExpectation: ['consulter un notaire', 'vérifier la rédaction'],
  comments: [],
}

const GOOD_ANSWER = `
L'offre d'achat contresignée peut valoir compromis de vente synallagmatique selon les termes.
L'acquéreur bénéficie d'un délai de rétractation prévu par le Code civil et le code de la construction.
L'exécution forcée n'est pas automatique : une action en justice est nécessaire.
Il est recommandé de consulter un notaire pour vérifier la rédaction du document.
`

const BAD_ANSWER = `
L'acquéreur est forcément tenu d'acheter dès la contresignature.
La vente est parfaite automatique et immédiat.
`

const PARTIAL_ANSWER = `
L'offre contresignée peut être un compromis de vente.
Il est conseillé de vérifier la rédaction du document.
`

// ─── chargement des cas gold ───────────────────────────────────────────────

describe('GOLD_CASES — chargement', () => {
  it('retourne 3 cas', () => { expect(GOLD_CASES).toHaveLength(3) })

  it('Q1 → vente_offre_contre_signee', () => {
    expect(getGoldCase('Q1')?.playbookId).toBe('vente_offre_contre_signee')
  })

  it('Q2 → gestion_locative_depot_garantie', () => {
    expect(getGoldCase('Q2')?.playbookId).toBe('gestion_locative_depot_garantie')
  })

  it('Q3 → environnement_immo_spanc', () => {
    expect(getGoldCase('Q3')?.playbookId).toBe('environnement_immo_spanc')
  })

  it('id inconnu → null', () => { expect(getGoldCase('INCONNU')).toBeNull() })

  it('chaque cas a mustInclude non vide', () => {
    GOLD_CASES.forEach((c) => expect(c.mustInclude.length).toBeGreaterThan(0))
  })

  it('chaque cas a mustAvoid non vide', () => {
    GOLD_CASES.forEach((c) => expect(c.mustAvoid.length).toBeGreaterThan(0))
  })

  it('chaque cas a keyAuthorities non vide', () => {
    GOLD_CASES.forEach((c) => expect(c.keyAuthorities.length).toBeGreaterThan(0))
  })
})

// ─── scoreAgainstGold — réponse complète ──────────────────────────────────

describe('scoreAgainstGold — réponse complète', () => {
  it('mustIncludeScore = 5 si tout couvert', () => {
    expect(scoreAgainstGold(GOOD_ANSWER, MINIMAL_GOLD).mustIncludeScore).toBe(5)
  })

  it('mustAvoidScore = 5 si rien d\'interdit', () => {
    expect(scoreAgainstGold(GOOD_ANSWER, MINIMAL_GOLD).mustAvoidScore).toBe(5)
  })

  it('total = somme des 4 dimensions', () => {
    const s = scoreAgainstGold(GOOD_ANSWER, MINIMAL_GOLD)
    expect(s.total).toBe(s.mustIncludeScore + s.mustAvoidScore + s.authorityScore + s.practicalScore)
  })

  it('structure complète', () => {
    const s = scoreAgainstGold(GOOD_ANSWER, MINIMAL_GOLD)
    expect(s).toHaveProperty('mustIncludeScore')
    expect(s).toHaveProperty('mustAvoidScore')
    expect(s).toHaveProperty('authorityScore')
    expect(s).toHaveProperty('practicalScore')
    expect(s).toHaveProperty('total')
    expect(Array.isArray(s.comments)).toBe(true)
  })
})

// ─── scoreAgainstGold — formulations interdites ───────────────────────────

describe('scoreAgainstGold — mustAvoid', () => {
  it('formulation interdite → mustAvoidScore ≤ 3', () => {
    expect(scoreAgainstGold(BAD_ANSWER, MINIMAL_GOLD).mustAvoidScore).toBeLessThanOrEqual(3)
  })

  it('2 formulations interdites → mustAvoidScore = 1 (5 - 2*2 = 1)', () => {
    expect(scoreAgainstGold(BAD_ANSWER, MINIMAL_GOLD).mustAvoidScore).toBe(1)
  })

  it('commentaires mentionnent les formulations interdites', () => {
    const s = scoreAgainstGold(BAD_ANSWER, MINIMAL_GOLD)
    expect(s.comments.some((c) => c.toLowerCase().includes('interdite'))).toBe(true)
  })

  it('mustAvoidScore clampée à 0 si trop de pénalités', () => {
    const g: GoldBenchmarkCase = {
      ...MINIMAL_GOLD,
      mustAvoid: ['forcément tenu', 'définitivement parfaite', 'automatique immédiat'],
    }
    const answer = 'Vous êtes forcément tenu, la vente est définitivement parfaite et automatique immédiat.'
    expect(scoreAgainstGold(answer, g).mustAvoidScore).toBe(0)
  })
})

// ─── scoreAgainstGold — réponse partielle ────────────────────────────────

describe('scoreAgainstGold — réponse partielle', () => {
  it('mustIncludeScore < 5 si concepts manquants', () => {
    expect(scoreAgainstGold(PARTIAL_ANSWER, MINIMAL_GOLD).mustIncludeScore).toBeLessThan(5)
  })

  it('commentaires mentionnent les manquants', () => {
    const s = scoreAgainstGold(PARTIAL_ANSWER, MINIMAL_GOLD)
    expect(s.comments.some((c) => c.includes('manquants') || c.includes('manquantes'))).toBe(true)
  })
})

// ─── determineWinner ──────────────────────────────────────────────────────

describe('determineWinner', () => {
  it('V2 score > V1 + matché → V2', () => { expect(determineWinner(12, 16, true)).toBe('V2') })
  it('V1 score > V2 → V1', () => { expect(determineWinner(16, 12, true)).toBe('V1') })
  it('scores égaux → TIE', () => { expect(determineWinner(14, 14, true)).toBe('TIE') })
  it('V2 non matché → V2_NO_MATCH', () => { expect(determineWinner(12, 0, false)).toBe('V2_NO_MATCH') })
  it('V2 no match même si score hypothétique supérieur → V2_NO_MATCH', () => {
    expect(determineWinner(10, 18, false)).toBe('V2_NO_MATCH')
  })
})
