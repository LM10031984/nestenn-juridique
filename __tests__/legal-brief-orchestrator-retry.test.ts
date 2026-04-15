// __tests__/legal-brief-orchestrator-retry.test.ts
// Tests unitaires du retry dans runRetryStep
// Lancer : npx vitest run __tests__/legal-brief-orchestrator-retry.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runRetryStep } from '@/lib/pipeline/legal-brief-orchestrator'
import type { LegalBrief } from '@/lib/legal-brief'
import type { ValidationReport } from '@/lib/answer-validator'

// ─────────────────────────────────────────────────────────────────────────────
// Mock openRouterChat
// Le module openrouter est importé par legal-brief-orchestrator
// ─────────────────────────────────────────────────────────────────────────────

const mockOpenRouterChat = vi.fn()

vi.mock('@/lib/openrouter', () => ({
  openRouterChat: (...args: unknown[]) => mockOpenRouterChat(...args),
}))

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeBrief(): LegalBrief {
  return {
    domain: 'immobilier',
    archetype: 'vente_offre_contre_signee',
    userQuestion: "Une offre d'achat contresignée oblige-t-elle l'acquéreur ?",
    facts: [],
    requiredDistinctions: ['offre vs compromis', 'délai de rétractation'],
    forbiddenAssertions: ["l'acquéreur est forcément tenu"],
    authorityCards: [
      {
        tag: 'A1',
        kind: 'article',
        source: 'Art. 1113 CC',
        rule: "Le contrat est formé par la rencontre d'une offre et d'une acceptation.",
        scope: 'Formation du contrat',
      },
    ],
    practicalOutcome: ['Vérifier la clause'],
    precisionBudget: 'medium',
    missingPieces: [],
  }
}

const INITIAL_ANSWER =
  "L'acquéreur peut se rétracter dans les 10 jours [A1]. Il est recommandé de vérifier la clause."

const REPORT_OK: ValidationReport = { ok: true, issues: [] }

const REPORT_FAIL: ValidationReport = {
  ok: false,
  issues: [
    {
      severity: 'high',
      code: 'FORBIDDEN_ASSERTION',
      message: "L'assertion \"l'acquéreur est forcément tenu\" est interdite",
    },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — pas de retry si validation ok
// ─────────────────────────────────────────────────────────────────────────────

describe('runRetryStep — pas de retry si validationReport.ok === true', () => {
  beforeEach(() => {
    mockOpenRouterChat.mockReset()
  })

  it('retried = false si ok === true', async () => {
    const result = await runRetryStep(makeBrief(), INITIAL_ANSWER, REPORT_OK, 'model', 6000)
    expect(result.retried).toBe(false)
  })

  it('answer inchangée si ok === true', async () => {
    const result = await runRetryStep(makeBrief(), INITIAL_ANSWER, REPORT_OK, 'model', 6000)
    expect(result.answer).toBe(INITIAL_ANSWER)
  })

  it('openRouterChat NOT appelé si ok === true', async () => {
    await runRetryStep(makeBrief(), INITIAL_ANSWER, REPORT_OK, 'model', 6000)
    expect(mockOpenRouterChat).not.toHaveBeenCalled()
  })

  it('validationReport retourné inchangé si ok === true', async () => {
    const result = await runRetryStep(makeBrief(), INITIAL_ANSWER, REPORT_OK, 'model', 6000)
    expect(result.validationReport).toBe(REPORT_OK)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Tests — retry déclenché si validationReport.ok === false
// ─────────────────────────────────────────────────────────────────────────────

describe('runRetryStep — retry déclenché si validationReport.ok === false', () => {
  beforeEach(() => {
    mockOpenRouterChat.mockReset()
  })

  it('retried = true si ok === false', async () => {
    mockOpenRouterChat.mockResolvedValue('Réponse corrigée sans assertion interdite.')
    const result = await runRetryStep(makeBrief(), INITIAL_ANSWER, REPORT_FAIL, 'model', 6000)
    expect(result.retried).toBe(true)
  })

  it('openRouterChat appelé exactement 1 fois lors du retry', async () => {
    mockOpenRouterChat.mockResolvedValue('Réponse corrigée.')
    await runRetryStep(makeBrief(), INITIAL_ANSWER, REPORT_FAIL, 'model', 6000)
    expect(mockOpenRouterChat).toHaveBeenCalledTimes(1)
  })

  it('answer = réponse du retry (pas la réponse initiale)', async () => {
    const retryAnswer = 'Réponse corrigée après retry — nouvelle version.'
    mockOpenRouterChat.mockResolvedValue(retryAnswer)
    const result = await runRetryStep(makeBrief(), INITIAL_ANSWER, REPORT_FAIL, 'model', 6000)
    expect(result.answer).toBe(retryAnswer)
  })

  it('validationReport recalculé sur la réponse retry', async () => {
    mockOpenRouterChat.mockResolvedValue(
      "L'acquéreur peut se rétracter dans les 10 jours [A1]. Vérifiez la clause avec un notaire."
    )
    const result = await runRetryStep(makeBrief(), INITIAL_ANSWER, REPORT_FAIL, 'model', 6000)
    expect(result.validationReport).toHaveProperty('ok')
    expect(result.validationReport).toHaveProperty('issues')
    expect(Array.isArray(result.validationReport.issues)).toBe(true)
  })

  it('modèle et maxTokens transmis correctement à openRouterChat', async () => {
    mockOpenRouterChat.mockResolvedValue('Réponse retry.')
    await runRetryStep(
      makeBrief(),
      INITIAL_ANSWER,
      REPORT_FAIL,
      'mistralai/mistral-large-2512',
      6000
    )
    expect(mockOpenRouterChat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ role: 'system' }),
        expect.objectContaining({ role: 'user' }),
      ]),
      'mistralai/mistral-large-2512',
      6000
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Tests — contenu du message retry
// ─────────────────────────────────────────────────────────────────────────────

describe('runRetryStep — contenu du message retry', () => {
  beforeEach(() => {
    mockOpenRouterChat.mockReset()
    mockOpenRouterChat.mockResolvedValue('Réponse corrigée.')
  })

  it('user message contient [CORRECTION REQUISE]', async () => {
    await runRetryStep(makeBrief(), INITIAL_ANSWER, REPORT_FAIL, 'model', 6000)
    const messages: Array<{ role: string; content: string }> = mockOpenRouterChat.mock.calls[0][0]
    const userMsg = messages.find((m) => m.role === 'user')
    expect(userMsg?.content).toContain('[CORRECTION REQUISE]')
  })

  it('user message contient la réponse précédente', async () => {
    await runRetryStep(makeBrief(), INITIAL_ANSWER, REPORT_FAIL, 'model', 6000)
    const messages: Array<{ role: string; content: string }> = mockOpenRouterChat.mock.calls[0][0]
    const userMsg = messages.find((m) => m.role === 'user')
    expect(userMsg?.content).toContain(INITIAL_ANSWER)
  })

  it('user message contient le code de l\'issue (FORBIDDEN_ASSERTION)', async () => {
    await runRetryStep(makeBrief(), INITIAL_ANSWER, REPORT_FAIL, 'model', 6000)
    const messages: Array<{ role: string; content: string }> = mockOpenRouterChat.mock.calls[0][0]
    const userMsg = messages.find((m) => m.role === 'user')
    expect(userMsg?.content).toContain('FORBIDDEN_ASSERTION')
  })

  it('messages contiennent bien un role system et un role user', async () => {
    await runRetryStep(makeBrief(), INITIAL_ANSWER, REPORT_FAIL, 'model', 6000)
    const messages: Array<{ role: string; content: string }> = mockOpenRouterChat.mock.calls[0][0]
    expect(messages.some((m) => m.role === 'system')).toBe(true)
    expect(messages.some((m) => m.role === 'user')).toBe(true)
  })
})
