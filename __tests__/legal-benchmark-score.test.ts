// __tests__/legal-benchmark-score.test.ts
// Tests unitaires du scoring benchmark V2
// Lancer : npx vitest run __tests__/legal-benchmark-score.test.ts

import { describe, it, expect } from 'vitest'
import { scoreAnswer } from '@/lib/legal-benchmark-score'
import type { LegalBrief } from '@/lib/legal-brief'
import type { ValidationReport } from '@/lib/answer-validator'

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeBrief(overrides: Partial<LegalBrief> = {}): LegalBrief {
  return {
    domain: 'immobilier',
    archetype: 'vente_offre_contre_signee',
    userQuestion: "Une offre d'achat contresignée oblige-t-elle l'acquéreur ?",
    facts: ["Mention d'une contresignature"],
    requiredDistinctions: ['offre vs compromis', 'délai de rétractation', 'exécution forcée'],
    forbiddenAssertions: ["l'acquéreur est forcément tenu", 'vente est définitivement parfaite'],
    authorityCards: [
      {
        tag: 'A1',
        kind: 'article',
        source: 'Art. 1113 — Code civil',
        rule: "Le contrat est formé par la rencontre d'une offre et d'une acceptation.",
        scope: 'Formation du contrat',
      },
    ],
    practicalOutcome: ['Vérifier la rédaction', 'Consulter un notaire'],
    precisionBudget: 'medium',
    missingPieces: [],
    ...overrides,
  }
}

const REPORT_OK: ValidationReport = { ok: true, issues: [] }

const REPORT_FORBIDDEN: ValidationReport = {
  ok: false,
  issues: [
    {
      severity: 'high',
      code: 'FORBIDDEN_ASSERTION',
      message: "L'assertion \"l'acquéreur est forcément tenu\" est interdite",
    },
  ],
}

const REPORT_MISSING_DISTINCTIONS: ValidationReport = {
  ok: false,
  issues: [
    {
      severity: 'medium',
      code: 'MISSING_DISTINCTION',
      message: 'Distinction "offre vs compromis" non abordée',
    },
    {
      severity: 'medium',
      code: 'MISSING_DISTINCTION',
      message: 'Distinction "délai de rétractation" non abordée',
    },
  ],
}

const GOOD_ANSWER = `
L'offre d'achat contresignée par le vendeur peut constituer un compromis de vente selon les circonstances.
Il est important de vérifier la rédaction pour distinguer une simple offre d'un contrat synallagmatique.
L'acquéreur doit être informé du délai de rétractation de 10 jours [A1].
En principe, l'exécution forcée n'est pas automatique et nécessite une démarche judiciaire.
Il est recommandé de consulter un notaire pour analyser la situation précise et de procéder à une analyse.
`

// ─────────────────────────────────────────────────────────────────────────────
// Tests — réponse propre
// ─────────────────────────────────────────────────────────────────────────────

describe('scoreAnswer — réponse propre', () => {
  it('réponse propre avec validation ok → legalAccuracy = 5', () => {
    const score = scoreAnswer('Q1', GOOD_ANSWER, REPORT_OK, makeBrief())
    expect(score.legalAccuracy).toBe(5)
  })

  it('réponse propre avec validation ok → mandatoryNuances = 5', () => {
    const score = scoreAnswer('Q1', GOOD_ANSWER, REPORT_OK, makeBrief())
    expect(score.mandatoryNuances).toBe(5)
  })

  it('réponse propre avec validation ok → safety = 5', () => {
    const score = scoreAnswer('Q1', GOOD_ANSWER, REPORT_OK, makeBrief())
    expect(score.safety).toBe(5)
  })

  it('total = somme exacte des 4 dimensions', () => {
    const score = scoreAnswer('Q1', GOOD_ANSWER, REPORT_OK, makeBrief())
    const expectedTotal =
      score.legalAccuracy + score.mandatoryNuances + score.practicalUsefulness + score.safety
    expect(score.total).toBe(expectedTotal)
  })

  it('structure de retour complète avec comments contenant questionId', () => {
    const score = scoreAnswer('Q1', GOOD_ANSWER, REPORT_OK, makeBrief())
    expect(score).toHaveProperty('legalAccuracy')
    expect(score).toHaveProperty('mandatoryNuances')
    expect(score).toHaveProperty('practicalUsefulness')
    expect(score).toHaveProperty('safety')
    expect(score).toHaveProperty('total')
    expect(Array.isArray(score.comments)).toBe(true)
    expect(score.comments.some((c) => c.includes('Q1'))).toBe(true)
  })

  it('toutes les dimensions entre 0 et 5', () => {
    const score = scoreAnswer('Q1', GOOD_ANSWER, REPORT_OK, makeBrief())
    expect(score.legalAccuracy).toBeGreaterThanOrEqual(0)
    expect(score.legalAccuracy).toBeLessThanOrEqual(5)
    expect(score.mandatoryNuances).toBeGreaterThanOrEqual(0)
    expect(score.mandatoryNuances).toBeLessThanOrEqual(5)
    expect(score.practicalUsefulness).toBeGreaterThanOrEqual(0)
    expect(score.practicalUsefulness).toBeLessThanOrEqual(5)
    expect(score.safety).toBeGreaterThanOrEqual(0)
    expect(score.safety).toBeLessThanOrEqual(5)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Tests — assertion interdite
// ─────────────────────────────────────────────────────────────────────────────

describe('scoreAnswer — assertion interdite', () => {
  it('FORBIDDEN_ASSERTION → legalAccuracy ≤ 3 (pénalité -2)', () => {
    const score = scoreAnswer('Q1', 'réponse avec assertion interdite', REPORT_FORBIDDEN, makeBrief())
    expect(score.legalAccuracy).toBeLessThanOrEqual(3)
  })

  it('FORBIDDEN_ASSERTION → safety ≤ 3 (pénalité -2)', () => {
    const score = scoreAnswer('Q1', 'réponse', REPORT_FORBIDDEN, makeBrief())
    expect(score.safety).toBeLessThanOrEqual(3)
  })

  it('commentaires mentionnent assertion interdite', () => {
    const score = scoreAnswer('Q1', 'réponse', REPORT_FORBIDDEN, makeBrief())
    expect(
      score.comments.some((c) => c.includes('assertion interdite') || c.includes('Sécurité'))
    ).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Tests — distinctions manquantes
// ─────────────────────────────────────────────────────────────────────────────

describe('scoreAnswer — distinctions manquantes', () => {
  it('2 distinctions manquantes sur 3 → mandatoryNuances < 4', () => {
    const score = scoreAnswer('Q1', 'réponse courte', REPORT_MISSING_DISTINCTIONS, makeBrief())
    // 1/3 trouvée → 1.5/5 arrondi
    expect(score.mandatoryNuances).toBeLessThan(4)
    expect(score.mandatoryNuances).toBeGreaterThanOrEqual(0)
  })

  it('commentaires mentionnent le nombre de distinctions manquantes', () => {
    const score = scoreAnswer('Q1', 'réponse', REPORT_MISSING_DISTINCTIONS, makeBrief())
    expect(score.comments.some((c) => c.includes('distinction'))).toBe(true)
    expect(score.comments.some((c) => c.includes('2'))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Tests — dimensions safety
// ─────────────────────────────────────────────────────────────────────────────

describe('scoreAnswer — safety par type d\'issue', () => {
  it('NONEXISTENT_TAG → safety ≤ 3.5 (pénalité -1.5)', () => {
    const report: ValidationReport = {
      ok: false,
      issues: [{ severity: 'high', code: 'NONEXISTENT_TAG', message: 'Tag [A9] inexistant' }],
    }
    const score = scoreAnswer('Q1', GOOD_ANSWER, report, makeBrief())
    expect(score.safety).toBeLessThanOrEqual(3.5)
  })

  it('FORBIDDEN_AUTOMATICITY → safety ≤ 4 (pénalité -1)', () => {
    const report: ValidationReport = {
      ok: false,
      issues: [{ severity: 'medium', code: 'FORBIDDEN_AUTOMATICITY', message: 'automatisme interdit' }],
    }
    const score = scoreAnswer('Q1', GOOD_ANSWER, report, makeBrief())
    expect(score.safety).toBeLessThanOrEqual(4)
  })

  it('safety est clampée à 0 en cas de multiples pénalités', () => {
    const report: ValidationReport = {
      ok: false,
      issues: [
        { severity: 'high', code: 'FORBIDDEN_ASSERTION', message: 'assertion' },
        { severity: 'high', code: 'FORBIDDEN_ASSERTION', message: 'assertion2' },
        { severity: 'high', code: 'NONEXISTENT_TAG', message: 'tag' },
        { severity: 'high', code: 'UNCOVERED_PRECISE_SANCTION', message: 'sanction' },
      ],
    }
    const score = scoreAnswer('Q1', 'réponse', report, makeBrief())
    expect(score.safety).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Tests — practicalUsefulness
// ─────────────────────────────────────────────────────────────────────────────

describe('scoreAnswer — practicalUsefulness', () => {
  it('réponse très courte → practicalUsefulness = 0', () => {
    const score = scoreAnswer('Q1', 'Oui.', REPORT_OK, makeBrief())
    expect(score.practicalUsefulness).toBe(0)
  })

  it('réponse longue sans termes pratiques → practicalUsefulness = 1', () => {
    const longAnswer = 'a'.repeat(300)
    const score = scoreAnswer('Q1', longAnswer, REPORT_OK, makeBrief())
    expect(score.practicalUsefulness).toBe(1)
  })
})
