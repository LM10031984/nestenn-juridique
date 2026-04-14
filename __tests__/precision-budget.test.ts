// __tests__/precision-budget.test.ts
import { describe, it, expect } from 'vitest'
import { computePrecisionBudget } from '@/lib/precision-budget'

const base = {
  liveArticlesResolved: 0,
  liveArticleResolutionFailed: false,
  taggedArticles: 0,
  juriSupport: 0,
  noArticleGrounding: false,
  hasTopicNote: false,
  candidatesCount: 0,
}

describe('computePrecisionBudget', () => {

  it('low — no grounding, no topicNote', () => {
    const { budget } = computePrecisionBudget({ ...base, noArticleGrounding: true })
    expect(budget).toBe('low')
  })

  it('low — live sync failed sur domaine critical', () => {
    const { budget } = computePrecisionBudget({
      ...base, safetyLevel: 'critical', liveArticleResolutionFailed: true,
    })
    expect(budget).toBe('low')
  })

  it('low — environnement_immo avec live sync fragile (0 résolu, candidates tentés)', () => {
    const { budget } = computePrecisionBudget({
      ...base, safetyLevel: 'critical', candidatesCount: 3, liveArticlesResolved: 0,
    })
    expect(budget).toBe('low')
  })

  it('medium — environnement_immo live sync réussi (2 articles)', () => {
    const { budget } = computePrecisionBudget({
      ...base, safetyLevel: 'critical',
      liveArticlesResolved: 2, taggedArticles: 2,
    })
    expect(budget).toBe('medium')
  })

  it('high — gestion_locative bien taggé + juri', () => {
    const { budget } = computePrecisionBudget({
      ...base, safetyLevel: 'high',
      liveArticlesResolved: 2, taggedArticles: 2, juriSupport: 2,
    })
    expect(budget).toBe('high')
  })

  it('high — domaine high, 1 live + juri', () => {
    const { budget } = computePrecisionBudget({
      ...base, safetyLevel: 'high',
      liveArticlesResolved: 1, taggedArticles: 1, juriSupport: 1,
    })
    expect(budget).toBe('high')
  })

  it('medium — rgpd_agence : critical + topicNote + tags pgvector', () => {
    const { budget } = computePrecisionBudget({
      ...base, safetyLevel: 'critical',
      hasTopicNote: true, taggedArticles: 2, juriSupport: 1,
    })
    expect(budget).toBe('medium')
  })

  it('medium — rgpd_agence : critical + topicNote + juri (sans tags pgvector)', () => {
    const { budget } = computePrecisionBudget({
      ...base, safetyLevel: 'critical',
      hasTopicNote: true, taggedArticles: 0, juriSupport: 2,
    })
    expect(budget).toBe('medium')
  })

  it('low — critical + 0 tags + pas de topicNote', () => {
    const { budget } = computePrecisionBudget({
      ...base, safetyLevel: 'critical', taggedArticles: 0, hasTopicNote: false,
    })
    expect(budget).toBe('low')
  })

  it('reasons contient critical_domain quand safetyLevel=critical', () => {
    const { reasons } = computePrecisionBudget({ ...base, safetyLevel: 'critical' })
    expect(reasons).toContain('critical_domain')
  })

  it('reasons contient live_sync_failed quand liveArticleResolutionFailed=true', () => {
    const { reasons } = computePrecisionBudget({ ...base, liveArticleResolutionFailed: true })
    expect(reasons).toContain('live_sync_failed')
  })

  it('reasons contient solid_live_sync quand 2+ articles résolus', () => {
    const { reasons } = computePrecisionBudget({ ...base, liveArticlesResolved: 2 })
    expect(reasons).toContain('solid_live_sync')
  })

  it('medium — domaine non-critical, 1 tag, pas de live', () => {
    const { budget } = computePrecisionBudget({
      ...base, safetyLevel: 'medium', taggedArticles: 1,
    })
    expect(budget).toBe('medium')
  })
})
