// __tests__/high-risk-claims.test.ts
// Tests unitaires pour lib/high-risk-claims.ts
// Phrases issues de vrais runs domaines : gestion_locative, rgpd_agence,
// baux_habitation, environnement_immo.
// Lancer : npx vitest run __tests__/high-risk-claims.test.ts

import { describe, it, expect } from 'vitest'
import { detectHighRiskClaims, softenHighRiskClaims, type HighRiskClaimType } from '@/lib/high-risk-claims'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function types(text: string): HighRiskClaimType[] {
  return [...new Set(detectHighRiskClaims(text).map(c => c.type))]
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. detectHighRiskClaims — sanction
// ─────────────────────────────────────────────────────────────────────────────

describe('detectHighRiskClaims — sanction', () => {

  it('détecte "amende" simple', () => {
    const claims = detectHighRiskClaims("L'agence risque une amende.")
    expect(claims.some(c => c.type === 'sanction')).toBe(true)
  })

  it('détecte "amende de 20 M€" (run rgpd_agence)', () => {
    const t = "En cas de violation grave, la CNIL peut infliger une amende de 20 M€ ou 4 % du CA."
    expect(types(t)).toContain('sanction')
  })

  it('détecte "4 % du chiffre d\'affaires"', () => {
    const t = "La sanction peut atteindre 4 % du chiffre d'affaires annuel mondial."
    expect(types(t)).toContain('sanction')
  })

  it('détecte "sanctionnée"', () => {
    const t = "Une agence qui conserve les données trop longtemps sera sanctionnée."
    expect(types(t)).toContain('sanction')
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// 2. detectHighRiskClaims — delay
// ─────────────────────────────────────────────────────────────────────────────

describe('detectHighRiskClaims — delay', () => {

  it('détecte "dans un délai de 2 mois" (run gestion_locative)', () => {
    const t = "L'agence doit restituer le dépôt dans un délai de 2 mois."
    expect(types(t)).toContain('delay')
  })

  it('détecte "sous 48h"', () => {
    const t = "Le propriétaire doit répondre sous 48h à la demande."
    expect(types(t)).toContain('delay')
  })

  it('détecte "dans le mois"', () => {
    const t = "La restitution doit intervenir dans le mois suivant la remise des clés."
    expect(types(t)).toContain('delay')
  })

  it('détecte "dans les 3 ans"', () => {
    const t = "Le locataire peut agir dans les 3 ans suivant la fin du bail."
    expect(types(t)).toContain('delay')
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// 3. detectHighRiskClaims — automatic_effect
// ─────────────────────────────────────────────────────────────────────────────

describe('detectHighRiskClaims — automatic_effect', () => {

  it('détecte "de plein droit"', () => {
    const t = "Le bail est résilié de plein droit en cas de non-paiement."
    expect(types(t)).toContain('automatic_effect')
  })

  it('détecte "automatiquement"', () => {
    const t = "La clause résolutoire joue automatiquement sans intervention du juge."
    expect(types(t)).toContain('automatic_effect')
  })

  it('détecte "est nulle" (run baux_habitation)', () => {
    const t = "La clause d'indexation au-delà de l'IRL est nulle."
    expect(types(t)).toContain('automatic_effect')
  })

  it('détecte "nulle et non avenue"', () => {
    const t = "La clause est nulle et non avenue, sans effet juridique."
    expect(types(t)).toContain('automatic_effect')
  })

  it('ne déclenche PAS sur "nul besoin" (faux positif typique)', () => {
    const t = "Il est nul besoin de notifier le bailleur."
    const autoClaims = detectHighRiskClaims(t).filter(c => c.type === 'automatic_effect')
    expect(autoClaims).toHaveLength(0)
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// 4. detectHighRiskClaims — mandatory_procedure
// ─────────────────────────────────────────────────────────────────────────────

describe('detectHighRiskClaims — mandatory_procedure', () => {

  it('détecte "sous peine de"', () => {
    const t = "La mise en demeure doit être envoyée sous peine de forclusion."
    expect(types(t)).toContain('mandatory_procedure')
  })

  it('détecte "est obligatoire" (run gestion_locative)', () => {
    const t = "L'état des lieux contradictoire est obligatoire pour tout type de bail."
    expect(types(t)).toContain('mandatory_procedure')
  })

  it('détecte "doit impérativement"', () => {
    const t = "L'agence doit impérativement obtenir le mandat avant toute mise en gestion."
    expect(types(t)).toContain('mandatory_procedure')
  })

  it('détecte "toute retenue est illégale"', () => {
    const t = "Toute retenue sur le dépôt est illégale en l'absence d'état des lieux."
    expect(types(t)).toContain('mandatory_procedure')
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// 5. detectHighRiskClaims — liability_or_causation
// ─────────────────────────────────────────────────────────────────────────────

describe('detectHighRiskClaims — liability_or_causation', () => {

  it('détecte "engage sa responsabilité" (run gestion_locative)', () => {
    const t = "Un état des lieux incomplet engage sa responsabilité envers le bailleur."
    expect(types(t)).toContain('liability_or_causation')
  })

  it('détecte "prive de la preuve" (run baux_habitation)', () => {
    const t = "L'absence d'état des lieux de sortie prive le bailleur de la preuve des dégradations."
    expect(types(t)).toContain('liability_or_causation')
  })

  it('détecte "s\'expose à"', () => {
    const t = "L'agence qui ne restitue pas le dépôt s'expose à une condamnation."
    expect(types(t)).toContain('liability_or_causation')
  })

  it('détecte "encourt une sanction"', () => {
    const t = "Le responsable de traitement encourt une sanction pouvant aller jusqu'à 20 M€."
    expect(types(t)).toContain('liability_or_causation')
    // Le montant peut aussi déclencher 'sanction'
    expect(types(t)).toContain('sanction')
  })

  it('détecte "rend illégal"', () => {
    const t = "Cette pratique rend illégal le renouvellement du bail."
    expect(types(t)).toContain('liability_or_causation')
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// 6. detectHighRiskClaims — détection multi-types
// ─────────────────────────────────────────────────────────────────────────────

describe('detectHighRiskClaims — multi-types sur une réponse complexe', () => {

  const RGPD_RUN = `
    En cas de non-respect du RGPD, le responsable de traitement encourt une amende de 20 M€.
    Le droit d'opposition doit être honoré dans un délai de 30 jours.
    Toute conservation au-delà de 3 ans est illégale et engage sa responsabilité de plein droit.
  `

  it('détecte au moins 4 types différents sur un run rgpd_agence', () => {
    const detected = types(RGPD_RUN)
    expect(detected.length).toBeGreaterThanOrEqual(4)
  })

  it('retourne des claims avec sentence non vide', () => {
    const claims = detectHighRiskClaims(RGPD_RUN)
    expect(claims.every(c => c.sentence.length > 0)).toBe(true)
  })

  it('retourne des claims triés par position dans le texte', () => {
    const claims = detectHighRiskClaims(RGPD_RUN)
    for (let i = 1; i < claims.length; i++) {
      expect(claims[i].index).toBeGreaterThanOrEqual(claims[i - 1].index)
    }
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// 7. softenHighRiskClaims — reformulations prudentes
// ─────────────────────────────────────────────────────────────────────────────

describe('softenHighRiskClaims — reformulations', () => {

  it('"engage sa responsabilité" → "peut engager sa responsabilité"', () => {
    const r = softenHighRiskClaims("Un état des lieux incomplet engage sa responsabilité.")
    expect(r).toContain('peut engager sa responsabilité')
    expect(r).not.toContain('engage sa responsabilité')
  })

  it('"prive de la preuve" → "affaiblit fortement la preuve"', () => {
    const r = softenHighRiskClaims("L'absence d'EDL prive le bailleur de la preuve.")
    expect(r).toContain('affaiblit fortement la preuve')
  })

  it('"toute retenue est illégale" → formulation contestable', () => {
    const r = softenHighRiskClaims("Toute retenue est illégale sans état des lieux.")
    // Le pattern capture "toute retenue est illégale" → reformulation
    expect(r.toLowerCase()).toContain('contestable')
  })

  it('"est nulle" → "peut être remis(e) en cause"', () => {
    const r = softenHighRiskClaims("La clause d'indexation est nulle.")
    expect(r).toContain('peut être remis')
    expect(r).not.toMatch(/\best\s+nulle?\b/)
  })

  it('"de plein droit" → formulation avec réserve', () => {
    const r = softenHighRiskClaims("Le bail est résilié de plein droit.")
    expect(r).toContain('sous réserve des circonstances')
  })

  it('"doit impérativement" → "devrait en principe"', () => {
    const r = softenHighRiskClaims("L'agence doit impérativement obtenir le mandat.")
    expect(r).toContain('devrait en principe')
  })

  it('"est obligatoire" → formulation à vérifier', () => {
    const r = softenHighRiskClaims("L'état des lieux est donc obligatoire.")
    expect(r).toContain('à vérifier')
  })

  it('le texte sans risque est retourné inchangé', () => {
    const clean = "Pour toute question, contactez un notaire ou un avocat."
    expect(softenHighRiskClaims(clean)).toBe(clean)
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// 8. softenHighRiskClaims — mode aggressive
// ─────────────────────────────────────────────────────────────────────────────

describe('softenHighRiskClaims — mode aggressive', () => {

  it('remplace "amende de 20 M€" en mode aggressive', () => {
    const t = "La CNIL peut infliger une amende de 20 M€ au responsable."
    const r = softenHighRiskClaims(t, { aggressive: true })
    expect(r).toContain('sanctions administratives')
    expect(r).not.toContain('amende de 20')
  })

  it('ne remplace PAS "amende de 20 M€" en mode normal', () => {
    const t = "La CNIL peut infliger une amende de 20 M€ au responsable."
    const r = softenHighRiskClaims(t)
    // En mode normal, le montant ne doit pas être remplacé
    expect(r).toContain('amende')
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// 9. Absence de casse syntaxique
// ─────────────────────────────────────────────────────────────────────────────

describe('softenHighRiskClaims — intégrité syntaxique', () => {

  it('ne produit pas de doubles espaces', () => {
    const t = "L'agence engage sa responsabilité et doit impérativement restituer."
    const r = softenHighRiskClaims(t)
    expect(r).not.toMatch(/  /)
  })

  it('préserve le markdown (gras, listes)', () => {
    const t = "**Attention** : l'état des lieux est donc obligatoire.\n- Étape 1 : engage sa responsabilité."
    const r = softenHighRiskClaims(t)
    expect(r).toContain('**Attention**')
    expect(r).toContain('- Étape 1')
  })

  it('gère un texte vide sans erreur', () => {
    expect(() => softenHighRiskClaims('')).not.toThrow()
    expect(softenHighRiskClaims('')).toBe('')
  })

})
