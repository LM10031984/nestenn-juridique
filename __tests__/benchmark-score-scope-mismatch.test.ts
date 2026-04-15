// __tests__/benchmark-score-scope-mismatch.test.ts
// Vérifie que AUTHORITY_SCOPE_MISMATCH pénalise le score interne V2

import { describe, it, expect } from 'vitest'
import { scoreAnswer } from '@/lib/legal-benchmark-score'
import { validateAnswerAgainstBrief } from '@/lib/answer-validator'
import type { LegalBrief } from '@/lib/legal-brief'
import type { AuthorityCard } from '@/lib/authority-cards'

const cardSPANC: AuthorityCard = {
  tag: 'A1',
  kind: 'article',
  source: 'Art. L1331-11-1 — CSP',
  rule: 'Le SPANC contrôle les installations d\'assainissement non collectif.',
  scope: 'Assainissement non collectif.',
  articleNum: 'L1331-11-1',
}

const briefQ3: LegalBrief = {
  domain: 'environnement_immo',
  archetype: 'environnement_immo_spanc',
  userQuestion: "Que faire si ma fosse septique n'est pas aux normes ?",
  facts: [],
  requiredDistinctions: [],
  forbiddenAssertions: [],
  authorityCards: [cardSPANC],
  practicalOutcome: [],
  precisionBudget: 'medium',
  missingPieces: [],
}

describe('scoreAnswer — pénalité AUTHORITY_SCOPE_MISMATCH', () => {
  it('réponse sans erreur de portée → legalAccuracy = 5', () => {
    const answer = `
      Contacter le SPANC. Demander un rapport écrit sur la mise en conformité.
      La dénonciation du voisin ne constitue pas une sanction directe.
    `
    const report = validateAnswerAgainstBrief(answer, briefQ3)
    const score = scoreAnswer('Q3', answer, report, briefQ3)
    expect(score.legalAccuracy).toBe(5)
  })

  it('réponse avec L271-1 en contexte SPANC → legalAccuracy pénalisée (AUTHORITY_SCOPE_MISMATCH)', () => {
    const answer = `
      Le SPANC se fonde sur l'article L271-1 pour contrôler l'assainissement non collectif.
      Contacter le SPANC, demander un rapport écrit.
    `
    const report = validateAnswerAgainstBrief(answer, briefQ3)
    const score = scoreAnswer('Q3', answer, report, briefQ3)
    expect(score.legalAccuracy).toBeLessThan(5)
    expect(score.safety).toBeLessThan(5)
  })

  it('score interne ne donne pas 20/20 à une réponse avec AUTHORITY_SCOPE_MISMATCH', () => {
    const answer = `
      Le SPANC applique l'article L271-1 CCH pour contrôler les fosses septiques.
      En cas de non-conformité SPANC, contacter le SPANC et demander un rapport écrit.
      Risque sanitaire : mettre en conformité dans les délais impartis.
    `
    const report = validateAnswerAgainstBrief(answer, briefQ3)
    const score = scoreAnswer('Q3', answer, report, briefQ3)
    expect(score.total).toBeLessThan(20)
  })
})
