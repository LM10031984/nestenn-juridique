// __tests__/legal-brief-v2-phase2.test.ts
// Tests Phase 2 : détection des 3 nouveaux playbooks + validation des distinctions obligatoires
// Lancer : npx vitest run __tests__/legal-brief-v2-phase2.test.ts

import { describe, it, expect } from 'vitest'
import { detectLegalPlaybook, PLAYBOOKS } from '@/lib/legal-playbooks'

// ─────────────────────────────────────────────────────────────────────────────
// detectLegalPlaybook — 3 questions exactes Phase 2
// ─────────────────────────────────────────────────────────────────────────────

describe('detectLegalPlaybook — questions exactes Phase 2', () => {
  it('Q4 : travaux urgents syndic → syndic_travaux_urgents', () => {
    const result = detectLegalPlaybook(
      "Le syndic peut-il engager des travaux urgents sans vote préalable de l'assemblée générale ?"
    )
    expect(result).not.toBeNull()
    expect(result?.id).toBe('syndic_travaux_urgents')
  })

  it('Q5 : DPE erroné acheteur vendeur → vente_dpe_errone', () => {
    const result = detectLegalPlaybook(
      "Le vendeur peut-il être poursuivi si le DPE était erroné et que l'acheteur découvre après la vente une consommation bien plus élevée ?"
    )
    expect(result).not.toBeNull()
    expect(result?.id).toBe('vente_dpe_errone')
  })

  it('Q6 : agent responsable problème non signalé → agent_defaut_information', () => {
    const result = detectLegalPlaybook(
      "L'agent immobilier peut-il être responsable s'il n'a pas signalé un problème connu sur le bien au moment de la vente ?"
    )
    expect(result).not.toBeNull()
    expect(result?.id).toBe('agent_defaut_information')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Variantes de formulation Phase 2
// ─────────────────────────────────────────────────────────────────────────────

describe('detectLegalPlaybook — variantes Phase 2', () => {
  it('Q4 variante : "travaux urgents copropriete sans vote" → syndic_travaux_urgents', () => {
    const result = detectLegalPlaybook(
      "Les travaux urgents en copropriété peuvent-ils se faire sans vote en assemblée générale ?"
    )
    expect(result?.id).toBe('syndic_travaux_urgents')
  })

  it('Q5 variante : "dpe erroné recours vendeur" → vente_dpe_errone', () => {
    const result = detectLegalPlaybook(
      "Le DPE était erroné lors de la vente — quels recours contre le vendeur ?"
    )
    expect(result?.id).toBe('vente_dpe_errone')
  })

  it('Q6 variante : "agent immobilier n\'a pas dit vice" → agent_defaut_information', () => {
    const result = detectLegalPlaybook(
      "L'agent immobilier n'a pas signalé un problème — peut-il être responsable ?"
    )
    expect(result?.id).toBe('agent_defaut_information')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Pas de confusion entre playbooks Phase 1 et Phase 2
// ─────────────────────────────────────────────────────────────────────────────

describe('detectLegalPlaybook — pas de confusion Phase 1 vs Phase 2', () => {
  it('Q4 ne matche pas Q1 (offre contresignée)', () => {
    const result = detectLegalPlaybook(
      "Le syndic peut-il engager des travaux urgents sans vote préalable de l'assemblée générale ?"
    )
    expect(result?.id).not.toBe('vente_offre_contre_signee')
  })

  it('Q5 ne matche pas Q3 (SPANC)', () => {
    const result = detectLegalPlaybook(
      "Le vendeur peut-il être poursuivi si le DPE était erroné ?"
    )
    expect(result?.id).not.toBe('environnement_immo_spanc')
  })

  it('Q6 ne matche pas Q2 (dépôt de garantie)', () => {
    const result = detectLegalPlaybook(
      "L'agent immobilier peut-il être responsable s'il n'a pas signalé un problème ?"
    )
    expect(result?.id).not.toBe('gestion_locative_depot_garantie')
  })

  it('Q3 SPANC ne matche pas Q4 (travaux urgents syndic)', () => {
    const result = detectLegalPlaybook(
      "Que faire si ma fosse septique n'est pas aux normes et que mon voisin m'a dénoncé ?"
    )
    expect(result?.id).not.toBe('syndic_travaux_urgents')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Présence des nouveaux playbooks dans PLAYBOOKS
// ─────────────────────────────────────────────────────────────────────────────

describe('PLAYBOOKS — catalogue Phase 2', () => {
  it('PLAYBOOKS contient 6 entrées (3 Phase 1 + 3 Phase 2)', () => {
    expect(PLAYBOOKS).toHaveLength(6)
  })

  it('syndic_travaux_urgents est présent', () => {
    const p = PLAYBOOKS.find((p) => p.id === 'syndic_travaux_urgents')
    expect(p).toBeDefined()
    expect(p?.domain).toBe('copropriete')
  })

  it('vente_dpe_errone est présent', () => {
    const p = PLAYBOOKS.find((p) => p.id === 'vente_dpe_errone')
    expect(p).toBeDefined()
    expect(p?.domain).toBe('vente_immobiliere')
  })

  it('agent_defaut_information est présent', () => {
    const p = PLAYBOOKS.find((p) => p.id === 'agent_defaut_information')
    expect(p).toBeDefined()
    expect(p?.domain).toBe('vente_immobiliere')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Validation des distinctions obligatoires Phase 2
// ─────────────────────────────────────────────────────────────────────────────

describe('Distinctions obligatoires — Phase 2', () => {
  it('Q4 syndic_travaux_urgents : distinction urgence réelle vs commodité', () => {
    const p = PLAYBOOKS.find((p) => p.id === 'syndic_travaux_urgents')!
    const hasUrgenceDistinction = p.requiredDistinctions.some((d) =>
      d.includes('urgence') || d.includes('urgente')
    )
    expect(hasUrgenceDistinction).toBe(true)
  })

  it('Q4 syndic_travaux_urgents : distincton vote vs information AG', () => {
    const p = PLAYBOOKS.find((p) => p.id === 'syndic_travaux_urgents')!
    const hasInfoDistinction = p.requiredDistinctions.some((d) =>
      d.includes('information') || d.includes('AG')
    )
    expect(hasInfoDistinction).toBe(true)
  })

  it('Q5 vente_dpe_errone : distinction DPE opposable (2021) vs DPE informatif', () => {
    const p = PLAYBOOKS.find((p) => p.id === 'vente_dpe_errone')!
    const hasOpposableDistinction = p.requiredDistinctions.some((d) =>
      d.includes('opposable') || d.includes('2021')
    )
    expect(hasOpposableDistinction).toBe(true)
  })

  it('Q5 vente_dpe_errone : distinction vendeur vs diagnostiqueur', () => {
    const p = PLAYBOOKS.find((p) => p.id === 'vente_dpe_errone')!
    const hasActeurDistinction = p.requiredDistinctions.some((d) =>
      d.includes('diagnostiqueur') && d.includes('vendeur')
    )
    expect(hasActeurDistinction).toBe(true)
  })

  it('Q6 agent_defaut_information : distinction connaissance réelle vs inconnue', () => {
    const p = PLAYBOOKS.find((p) => p.id === 'agent_defaut_information')!
    const hasConnuDistinction = p.requiredDistinctions.some((d) =>
      d.includes('connaissait') || d.includes('connaissance')
    )
    expect(hasConnuDistinction).toBe(true)
  })

  it('Q6 agent_defaut_information : distinction responsabilité agent vs vendeur', () => {
    const p = PLAYBOOKS.find((p) => p.id === 'agent_defaut_information')!
    const hasVendeurDistinction = p.requiredDistinctions.some((d) =>
      d.includes('vendeur') && (d.includes('agent') || d.includes('mandataire'))
    )
    expect(hasVendeurDistinction).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Assertions interdites Phase 2
// ─────────────────────────────────────────────────────────────────────────────

describe('Assertions interdites — Phase 2', () => {
  it('Q4 : "le syndic n\'a jamais le droit" est interdit', () => {
    const p = PLAYBOOKS.find((p) => p.id === 'syndic_travaux_urgents')!
    expect(p.forbiddenAssertions).toContain('le syndic n\'a jamais le droit de faire des travaux sans AG')
  })

  it('Q5 : "nullité automatique de la vente" est interdit', () => {
    const p = PLAYBOOKS.find((p) => p.id === 'vente_dpe_errone')!
    const hasNullite = p.forbiddenAssertions.some((a) => a.includes('nullité'))
    expect(hasNullite).toBe(true)
  })

  it('Q6 : "automatiquement responsable" est interdit', () => {
    const p = PLAYBOOKS.find((p) => p.id === 'agent_defaut_information')!
    const hasAutomatique = p.forbiddenAssertions.some((a) => a.includes('automatiquement'))
    expect(hasAutomatique).toBe(true)
  })
})
