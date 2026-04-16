// __tests__/domain-pack-rollout.test.ts
// Tests de la politique de rollout domain pack
// Lancer : npx vitest run __tests__/domain-pack-rollout.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock est hoisted — la factory ne peut pas référencer des variables top-level.
// On utilise un objet global mutable partagé entre la factory et les tests.
const MOCK = {
  DOMAIN_PACKS_ENABLED: false,
  BAUX_PACK_SHADOW: false,
  BAUX_PACK_ACTIVE: false,
}

vi.mock('@/lib/config', () => ({
  get FEATURES() {
    return {
      DYNAMIC_DOMAINS: false,
      V2_LEGAL_BRIEF_ENABLED: false,
      V2_SHADOW_ENABLED: false,
      DOMAIN_PACKS_ENABLED: MOCK.DOMAIN_PACKS_ENABLED,
      BAUX_PACK_SHADOW: MOCK.BAUX_PACK_SHADOW,
      BAUX_PACK_ACTIVE: MOCK.BAUX_PACK_ACTIVE,
    }
  },
}))

import { getDomainPackPolicy } from '@/lib/domain-pack-rollout'

function setFlags(overrides: Partial<typeof MOCK> = {}) {
  MOCK.DOMAIN_PACKS_ENABLED = overrides.DOMAIN_PACKS_ENABLED ?? false
  MOCK.BAUX_PACK_SHADOW = overrides.BAUX_PACK_SHADOW ?? false
  MOCK.BAUX_PACK_ACTIVE = overrides.BAUX_PACK_ACTIVE ?? false
}

describe('getDomainPackPolicy — flags OFF', () => {
  beforeEach(() => setFlags())

  it('retourne none si master flag désactivé, même baux_habitation sans playbook', () => {
    expect(getDomainPackPolicy('baux_habitation', null)).toBe('none')
  })

  it('retourne none si BAUX_PACK_SHADOW=true mais master OFF', () => {
    setFlags({ BAUX_PACK_SHADOW: true })
    expect(getDomainPackPolicy('baux_habitation', null)).toBe('none')
  })

  it('retourne none si BAUX_PACK_ACTIVE=true mais master OFF', () => {
    setFlags({ BAUX_PACK_ACTIVE: true })
    expect(getDomainPackPolicy('baux_habitation', null)).toBe('none')
  })
})

describe('getDomainPackPolicy — playbook prioritaire', () => {
  beforeEach(() => setFlags({ DOMAIN_PACKS_ENABLED: true, BAUX_PACK_ACTIVE: true }))

  it('retourne none si un playbook est matché — playbook est prioritaire', () => {
    expect(getDomainPackPolicy('baux_habitation', 'baux_loyers_impayes_expulsion')).toBe('none')
  })

  it('retourne none si playbookId non null même en active mode', () => {
    expect(getDomainPackPolicy('baux_habitation', 'un_playbook_quelconque')).toBe('none')
  })
})

describe('getDomainPackPolicy — hors domaine baux_habitation', () => {
  beforeEach(() => setFlags({ DOMAIN_PACKS_ENABLED: true, BAUX_PACK_ACTIVE: true }))

  it('retourne none pour copropriete même avec flags actifs', () => {
    expect(getDomainPackPolicy('copropriete', null)).toBe('none')
  })

  it('retourne none pour vente_immobiliere', () => {
    expect(getDomainPackPolicy('vente_immobiliere', null)).toBe('none')
  })

  it('retourne none si domaine null', () => {
    expect(getDomainPackPolicy(null, null)).toBe('none')
  })

  it('retourne none pour agent_immobilier', () => {
    expect(getDomainPackPolicy('agent_immobilier', null)).toBe('none')
  })
})

describe('getDomainPackPolicy — shadow mode', () => {
  beforeEach(() => setFlags({ DOMAIN_PACKS_ENABLED: true, BAUX_PACK_SHADOW: true }))

  it('retourne shadow pour baux_habitation + pas de playbook', () => {
    expect(getDomainPackPolicy('baux_habitation', null)).toBe('shadow')
  })

  it('shadow n\'impacte pas les autres domaines', () => {
    expect(getDomainPackPolicy('diagnostics', null)).toBe('none')
  })
})

describe('getDomainPackPolicy — active mode', () => {
  beforeEach(() => setFlags({ DOMAIN_PACKS_ENABLED: true, BAUX_PACK_ACTIVE: true }))

  it('retourne active pour baux_habitation + pas de playbook', () => {
    expect(getDomainPackPolicy('baux_habitation', null)).toBe('active')
  })

  it('active prend le dessus sur shadow si les deux sont true', () => {
    setFlags({ DOMAIN_PACKS_ENABLED: true, BAUX_PACK_SHADOW: true, BAUX_PACK_ACTIVE: true })
    expect(getDomainPackPolicy('baux_habitation', null)).toBe('active')
  })
})
