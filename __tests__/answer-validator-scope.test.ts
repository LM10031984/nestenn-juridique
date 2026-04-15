// __tests__/answer-validator-scope.test.ts
// Tests du check de portée d'autorité — AUTHORITY_SCOPE_MISMATCH

import { describe, it, expect } from 'vitest'
import { validateAnswerAgainstBrief } from '@/lib/answer-validator'
import type { LegalBrief } from '@/lib/legal-brief'
import type { AuthorityCard } from '@/lib/authority-cards'

// ─────────────────────────────────────────────────────────────────────────────
// Brief Q1 (L271-1 légitime dans le brief)
// ─────────────────────────────────────────────────────────────────────────────

const cardL271_1: AuthorityCard = {
  tag: 'A1',
  kind: 'article',
  source: 'Art. L271-1 — CCH',
  rule: "L'acquéreur non professionnel bénéficie d'un délai de rétractation de 10 jours.",
  scope: "Applicable aux ventes immobilières à usage d'habitation.",
  articleNum: 'L271-1',
}

const briefQ1: LegalBrief = {
  domain: 'vente_immobiliere',
  archetype: 'vente_offre_contre_signee',
  userQuestion: "Une offre d'achat contresignée par le vendeur oblige-t-elle l'acquéreur à acheter ?",
  facts: [],
  requiredDistinctions: [],
  forbiddenAssertions: [],
  authorityCards: [cardL271_1],
  practicalOutcome: [],
  precisionBudget: 'medium',
  missingPieces: [],
}

// ─────────────────────────────────────────────────────────────────────────────
// Brief Q3 SPANC (L271-1 absent du brief)
// ─────────────────────────────────────────────────────────────────────────────

const cardSPANC: AuthorityCard = {
  tag: 'A1',
  kind: 'article',
  source: 'Art. L1331-11-1 — CSP',
  rule: 'Le SPANC contrôle les installations et met en demeure en cas de non-conformité.',
  scope: 'Assainissement non collectif.',
  articleNum: 'L1331-11-1',
}

const briefQ3: LegalBrief = {
  domain: 'environnement_immo',
  archetype: 'environnement_immo_spanc',
  userQuestion: "Que faire si ma fosse septique n'est pas aux normes et que mon voisin m'a dénoncé ?",
  facts: [],
  requiredDistinctions: [],
  forbiddenAssertions: [],
  authorityCards: [cardSPANC],
  practicalOutcome: [],
  precisionBudget: 'medium',
  missingPieces: [],
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('checkAuthorityScopeMismatch — L271-1 en contexte SPANC', () => {
  it('L271-1 cité près de "spanc" dans brief Q3 → AUTHORITY_SCOPE_MISMATCH high', () => {
    const answer = `
      Votre fosse septique n'est pas conforme. Selon l'article L271-1 du CCH,
      le SPANC doit vérifier la conformité de l'installation et peut diligenter un contrôle.
    `
    const report = validateAnswerAgainstBrief(answer, briefQ3)
    const scopeIssue = report.issues.find((i) => i.code === 'AUTHORITY_SCOPE_MISMATCH')
    expect(scopeIssue).toBeDefined()
    expect(scopeIssue?.severity).toBe('high')
    expect(scopeIssue?.message).toContain('L271-1')
  })

  it('L271-1 cité près de "assainissement" → AUTHORITY_SCOPE_MISMATCH', () => {
    const answer = `
      En matière d'assainissement non collectif, l'article L271-1 prévoit
      les obligations de mise en conformité de la fosse septique.
    `
    const report = validateAnswerAgainstBrief(answer, briefQ3)
    const scopeIssue = report.issues.find((i) => i.code === 'AUTHORITY_SCOPE_MISMATCH')
    expect(scopeIssue).toBeDefined()
  })

  it('L271-1 dans brief Q1 (légitime) → pas de AUTHORITY_SCOPE_MISMATCH', () => {
    const answer = `
      L'acquéreur bénéficie d'un délai de rétractation de 10 jours en vertu de l'article L271-1 CCH.
      Ce droit est applicable pour les biens à usage d'habitation.
    `
    const report = validateAnswerAgainstBrief(answer, briefQ1)
    const scopeIssue = report.issues.find((i) => i.code === 'AUTHORITY_SCOPE_MISMATCH')
    expect(scopeIssue).toBeUndefined()
  })

  it('L271-1 absent de la réponse Q3 → pas de AUTHORITY_SCOPE_MISMATCH', () => {
    const answer = `
      Le SPANC est l'autorité compétente. Contacter le SPANC pour un rapport écrit.
      La mise en conformité dépend de la gravité et du contexte de vente.
    `
    const report = validateAnswerAgainstBrief(answer, briefQ3)
    const scopeIssue = report.issues.find((i) => i.code === 'AUTHORITY_SCOPE_MISMATCH')
    expect(scopeIssue).toBeUndefined()
  })

  it('L271-1 cité loin de tout contexte SPANC (>300 chars) → pas de AUTHORITY_SCOPE_MISMATCH', () => {
    const padding = 'Le présent document traite de droit civil général. '.repeat(7)
    const answer = `L'article L271-1 CCH accorde un délai de rétractation. ${padding} La fosse septique doit être contrôlée par le SPANC.`
    const report = validateAnswerAgainstBrief(answer, briefQ3)
    const scopeIssue = report.issues.find((i) => i.code === 'AUTHORITY_SCOPE_MISMATCH')
    expect(scopeIssue).toBeUndefined()
  })

  it('validation report.ok === false quand AUTHORITY_SCOPE_MISMATCH présent', () => {
    const answer = `Le SPANC se fonde sur l'article L271-1 pour contrôler les installations d'assainissement.`
    const report = validateAnswerAgainstBrief(answer, briefQ3)
    expect(report.ok).toBe(false)
  })
})

describe('checkAuthorityScopeMismatch — L1331-1-1 en contexte vente', () => {
  it('L1331-1-1 cité près de "droit de rétractation" dans brief Q1 → AUTHORITY_SCOPE_MISMATCH', () => {
    const answer = `
      L'acquéreur dispose d'un droit de rétractation selon l'article L1331-1-1 CSP
      qui lui permet de se rétracter dans un délai de 10 jours.
    `
    const report = validateAnswerAgainstBrief(answer, briefQ1)
    const scopeIssue = report.issues.find((i) => i.code === 'AUTHORITY_SCOPE_MISMATCH')
    expect(scopeIssue).toBeDefined()
    expect(scopeIssue?.message).toContain('L1331-1-1')
  })
})
