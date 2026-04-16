// __tests__/legal-v2-rollout.test.ts
// Tests unitaires de la politique de rollout V2
// Vérifie : conditions d'activation, whitelist, fallback, headers logiques
// Lancer : npx vitest run __tests__/legal-v2-rollout.test.ts

import { describe, it, expect } from 'vitest'
import {
  shouldUseLegalV2,
  isV2EnabledPlaybook,
  V2_ROLLOUT_PLAYBOOKS,
  type V2RoutingParams,
} from '@/lib/legal-v2-rollout'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function allConditionsOk(overrides: Partial<V2RoutingParams> = {}): V2RoutingParams {
  return {
    featureEnabled: true,
    playbookId: 'vente_offre_contre_signee',
    orchestratorOk: true,
    validationOk: true,
    hasAuthorityScopeMismatch: false,
    retried: false,
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Whitelist
// ─────────────────────────────────────────────────────────────────────────────

describe('isV2EnabledPlaybook — whitelist', () => {
  it('9 playbooks sont dans la whitelist (Phase 1 + 2 + 3)', () => {
    expect(V2_ROLLOUT_PLAYBOOKS).toHaveLength(9)
  })

  it.each(V2_ROLLOUT_PLAYBOOKS)('playbook whitelisté : %s', (id) => {
    expect(isV2EnabledPlaybook(id)).toBe(true)
  })

  it('playbook hors whitelist → false', () => {
    expect(isV2EnabledPlaybook('contrat_location_meublee')).toBe(false)
    expect(isV2EnabledPlaybook('')).toBe(false)
    expect(isV2EnabledPlaybook('unknown_playbook')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// shouldUseLegalV2 — cas V2 activé
// ─────────────────────────────────────────────────────────────────────────────

describe('shouldUseLegalV2 — V2 activée', () => {
  it('toutes conditions remplies → useV2=true reason=ok', () => {
    const d = shouldUseLegalV2(allConditionsOk())
    expect(d.useV2).toBe(true)
    expect(d.reason).toBe('ok')
  })

  it.each(V2_ROLLOUT_PLAYBOOKS)('playbook whitelisté %s → useV2=true', (id) => {
    const d = shouldUseLegalV2(allConditionsOk({ playbookId: id }))
    expect(d.useV2).toBe(true)
  })

  it('retried=true mais validation ok → useV2=true (retry réussi)', () => {
    const d = shouldUseLegalV2(allConditionsOk({ retried: true }))
    expect(d.useV2).toBe(true)
    expect(d.reason).toBe('ok')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// shouldUseLegalV2 — fallback V1
// ─────────────────────────────────────────────────────────────────────────────

describe('shouldUseLegalV2 — fallback V1', () => {
  it('feature flag désactivé → reason=feature_flag_disabled', () => {
    const d = shouldUseLegalV2(allConditionsOk({ featureEnabled: false }))
    expect(d.useV2).toBe(false)
    expect(d.reason).toBe('feature_flag_disabled')
  })

  it('pas de playbook détecté → reason=no_playbook_match', () => {
    const d = shouldUseLegalV2(allConditionsOk({ playbookId: null }))
    expect(d.useV2).toBe(false)
    expect(d.reason).toBe('no_playbook_match')
  })

  it('playbook non whitelisté → reason=playbook_not_whitelisted', () => {
    const d = shouldUseLegalV2(allConditionsOk({ playbookId: 'contrat_location_meublee' }))
    expect(d.useV2).toBe(false)
    expect(d.reason).toBe('playbook_not_whitelisted')
  })

  it('orchestrateur échoué → reason=orchestrator_failed', () => {
    const d = shouldUseLegalV2(allConditionsOk({ orchestratorOk: false }))
    expect(d.useV2).toBe(false)
    expect(d.reason).toBe('orchestrator_failed')
  })

  it('validation échouée (premier essai) → reason=validation_failed', () => {
    const d = shouldUseLegalV2(allConditionsOk({ validationOk: false, retried: false }))
    expect(d.useV2).toBe(false)
    expect(d.reason).toBe('validation_failed')
  })

  it('validation échouée après retry → reason=retry_failed_validation', () => {
    const d = shouldUseLegalV2(allConditionsOk({ validationOk: false, retried: true }))
    expect(d.useV2).toBe(false)
    expect(d.reason).toBe('retry_failed_validation')
  })

  it('AUTHORITY_SCOPE_MISMATCH → reason=authority_scope_mismatch', () => {
    const d = shouldUseLegalV2(allConditionsOk({ hasAuthorityScopeMismatch: true }))
    expect(d.useV2).toBe(false)
    expect(d.reason).toBe('authority_scope_mismatch')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Priorité des conditions (order matters — test chaque couche en isolation)
// ─────────────────────────────────────────────────────────────────────────────

describe('shouldUseLegalV2 — priorité des conditions', () => {
  it('feature_flag_disabled prime sur playbook_not_whitelisted', () => {
    const d = shouldUseLegalV2({
      featureEnabled: false,
      playbookId: 'unknown',
      orchestratorOk: true,
      validationOk: true,
      hasAuthorityScopeMismatch: false,
      retried: false,
    })
    expect(d.reason).toBe('feature_flag_disabled')
  })

  it('no_playbook_match prime sur orchestrator_failed', () => {
    const d = shouldUseLegalV2({
      featureEnabled: true,
      playbookId: null,
      orchestratorOk: false,
      validationOk: false,
      hasAuthorityScopeMismatch: true,
      retried: false,
    })
    expect(d.reason).toBe('no_playbook_match')
  })

  it('playbook_not_whitelisted prime sur validation_failed', () => {
    const d = shouldUseLegalV2({
      featureEnabled: true,
      playbookId: 'unknown_playbook',
      orchestratorOk: true,
      validationOk: false,
      hasAuthorityScopeMismatch: false,
      retried: false,
    })
    expect(d.reason).toBe('playbook_not_whitelisted')
  })

  it('validation_failed prime sur authority_scope_mismatch', () => {
    const d = shouldUseLegalV2(allConditionsOk({
      validationOk: false,
      hasAuthorityScopeMismatch: true,
      retried: false,
    }))
    expect(d.reason).toBe('validation_failed')
  })
})
