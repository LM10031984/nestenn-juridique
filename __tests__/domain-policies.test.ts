// __tests__/domain-policies.test.ts
// Tests de cohérence des policies runtime par domaine
// Lancer : npx vitest run __tests__/domain-policies.test.ts

import { describe, it, expect } from 'vitest'
import {
  DOMAIN_POLICIES,
  FORCE_JURISPRUDENCE_DOMAINS,
  getDomainPolicy,
  requiresLiveSync,
  isCriticalDomain,
} from '@/lib/domain-policies'

// Doit rester aligné avec VALID_DOMAINS dans lib/auto-indexer.ts
const VALID_DOMAINS = [
  // Domaines existants
  'baux_habitation', 'gestion_locative',
  'copropriete', 'syndic_copropriete',
  'agent_immobilier',
  'vente_immobiliere', 'diagnostics', 'construction',
  'urbanisme', 'bail_commercial', 'viager_demembrement',
  // Rétro-compat legacy
  'fiscalite', 'servitudes', 'litiges',
  // V1
  'droit_social_immo', 'fiscalite_investisseurs', 'sci_patrimoine',
  // V2
  'responsabilite_agent', 'location_touristique', 'environnement_immo',
  // V3
  'conformite_lcb_ft', 'rgpd_agence',
]

// Domaines critiques qui doivent avoir forceJurisprudence = true
const CRITICAL_JURI_DOMAINS = [
  'baux_habitation',
  'copropriete',
  'agent_immobilier',
  'vente_immobiliere',
  'construction',
  'bail_commercial',
  'servitudes',
  'responsabilite_agent',
]

// ─────────────────────────────────────────────────────────────────────────────
// Cohérence structurelle
// ─────────────────────────────────────────────────────────────────────────────

describe('DOMAIN_POLICIES — cohérence structurelle', () => {

  it('chaque domaine de VALID_DOMAINS a une policy', () => {
    const orphans = VALID_DOMAINS.filter(d => !DOMAIN_POLICIES[d])
    expect(orphans, `Domaines sans policy : ${orphans.join(', ')}`).toHaveLength(0)
  })

  it('chaque policy a un code qui correspond à sa clé', () => {
    const mismatches = Object.entries(DOMAIN_POLICIES)
      .filter(([key, policy]) => key !== policy.code)
      .map(([key, policy]) => `clé=${key} code=${policy.code}`)
    expect(mismatches, `Incohérences clé/code : ${mismatches.join(', ')}`).toHaveLength(0)
  })

  it('maxLiveArticles est entre 1 et 5 pour toutes les policies', () => {
    const invalid = Object.values(DOMAIN_POLICIES)
      .filter(p => p.maxLiveArticles < 1 || p.maxLiveArticles > 5)
      .map(p => p.code)
    expect(invalid, `maxLiveArticles hors bornes : ${invalid.join(', ')}`).toHaveLength(0)
  })

  it('safetyLevel est medium, high ou critical', () => {
    const valid = new Set(['medium', 'high', 'critical'])
    const invalid = Object.values(DOMAIN_POLICIES)
      .filter(p => !valid.has(p.safetyLevel))
      .map(p => `${p.code}=${p.safetyLevel}`)
    expect(invalid, `safetyLevel invalide : ${invalid.join(', ')}`).toHaveLength(0)
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// Domaines critiques — flags obligatoires
// ─────────────────────────────────────────────────────────────────────────────

describe('DOMAIN_POLICIES — domaines critiques', () => {

  it.each(CRITICAL_JURI_DOMAINS)(
    '%s a forceJurisprudence = true',
    (domain) => {
      expect(DOMAIN_POLICIES[domain]?.forceJurisprudence).toBe(true)
    },
  )

  it.each(CRITICAL_JURI_DOMAINS)(
    '%s a useLiveArticleSync = true',
    (domain) => {
      expect(DOMAIN_POLICIES[domain]?.useLiveArticleSync).toBe(true)
    },
  )

  it('baux_habitation a safetyLevel critical', () => {
    expect(DOMAIN_POLICIES['baux_habitation'].safetyLevel).toBe('critical')
  })

  it('copropriete a safetyLevel critical', () => {
    expect(DOMAIN_POLICIES['copropriete'].safetyLevel).toBe('critical')
  })

  it('agent_immobilier a safetyLevel critical', () => {
    expect(DOMAIN_POLICIES['agent_immobilier'].safetyLevel).toBe('critical')
  })

  it('vente_immobiliere a safetyLevel critical', () => {
    expect(DOMAIN_POLICIES['vente_immobiliere'].safetyLevel).toBe('critical')
  })

  it('environnement_immo a safetyLevel critical', () => {
    expect(DOMAIN_POLICIES['environnement_immo'].safetyLevel).toBe('critical')
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// FORCE_JURISPRUDENCE_DOMAINS — dérivé correct
// ─────────────────────────────────────────────────────────────────────────────

describe('FORCE_JURISPRUDENCE_DOMAINS', () => {

  it('contient tous les domaines avec forceJurisprudence = true', () => {
    const expected = Object.values(DOMAIN_POLICIES)
      .filter(p => p.forceJurisprudence)
      .map(p => p.code)
    for (const domain of expected) {
      expect(FORCE_JURISPRUDENCE_DOMAINS.has(domain)).toBe(true)
    }
  })

  it('ne contient aucun domaine avec forceJurisprudence = false', () => {
    const shouldNotBePresent = Object.values(DOMAIN_POLICIES)
      .filter(p => !p.forceJurisprudence)
      .map(p => p.code)
      .filter(d => FORCE_JURISPRUDENCE_DOMAINS.has(d))
    expect(shouldNotBePresent).toHaveLength(0)
  })

  it('contient baux_habitation, copropriete, responsabilite_agent, servitudes', () => {
    expect(FORCE_JURISPRUDENCE_DOMAINS.has('baux_habitation')).toBe(true)
    expect(FORCE_JURISPRUDENCE_DOMAINS.has('copropriete')).toBe(true)
    expect(FORCE_JURISPRUDENCE_DOMAINS.has('responsabilite_agent')).toBe(true)
    expect(FORCE_JURISPRUDENCE_DOMAINS.has('servitudes')).toBe(true)
  })

  it('ne contient plus les anciens codes obsolètes (responsabilite, vices_caches, garanties)', () => {
    expect(FORCE_JURISPRUDENCE_DOMAINS.has('responsabilite')).toBe(false)
    expect(FORCE_JURISPRUDENCE_DOMAINS.has('vices_caches')).toBe(false)
    expect(FORCE_JURISPRUDENCE_DOMAINS.has('garanties')).toBe(false)
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('getDomainPolicy()', () => {

  it('retourne la policy pour un domaine existant', () => {
    const p = getDomainPolicy('baux_habitation')
    expect(p).toBeDefined()
    expect(p?.forceJurisprudence).toBe(true)
  })

  it('retourne undefined pour un domaine inconnu', () => {
    expect(getDomainPolicy('domaine_inexistant')).toBeUndefined()
  })

})

describe('requiresLiveSync()', () => {

  it('retourne true pour baux_habitation', () => {
    expect(requiresLiveSync('baux_habitation')).toBe(true)
  })

  it('retourne false pour fiscalite (legacy)', () => {
    expect(requiresLiveSync('fiscalite')).toBe(false)
  })

  it('retourne false pour litiges (legacy)', () => {
    expect(requiresLiveSync('litiges')).toBe(false)
  })

  it('retourne false pour un domaine inconnu', () => {
    expect(requiresLiveSync('inconnu')).toBe(false)
  })

})

describe('isCriticalDomain()', () => {

  it('retourne true pour baux_habitation', () => {
    expect(isCriticalDomain('baux_habitation')).toBe(true)
  })

  it('retourne true pour responsabilite_agent', () => {
    expect(isCriticalDomain('responsabilite_agent')).toBe(true)
  })

  it('retourne false pour un domaine inconnu', () => {
    expect(isCriticalDomain('inconnu')).toBe(false)
  })

})
