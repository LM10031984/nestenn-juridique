// __tests__/high-risk-claims.test.ts
// Tests unitaires pour lib/high-risk-claims.ts
// Phrases issues de vrais runs domaines : gestion_locative, rgpd_agence,
// baux_habitation, environnement_immo.
// Lancer : npx vitest run __tests__/high-risk-claims.test.ts

import { describe, it, expect } from 'vitest'
import { detectHighRiskClaims, softenHighRiskClaims, type HighRiskClaimType, type SoftenLevel } from '@/lib/high-risk-claims'

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

// ─────────────────────────────────────────────────────────────────────────────
// 10. Nouveaux patterns — automatic_effect : déclencheurs (run environnement_immo)
// ─────────────────────────────────────────────────────────────────────────────

describe('detectHighRiskClaims — automatic_effect : déclencheurs', () => {

  it('détecte "déclenche" (run environnement_immo)', () => {
    const t = "Un défaut de conformité déclenche généralement un contrôle de l'administration."
    expect(types(t)).toContain('automatic_effect')
  })

  it('détecte "déclenchent" (pluriel)', () => {
    const t = "Ces infractions déclenchent une procédure de mise en demeure."
    expect(types(t)).toContain('automatic_effect')
  })

  it('détecte "entraîne" (run baux_habitation)', () => {
    const t = "Le défaut de restitution entraîne la responsabilité du bailleur."
    expect(types(t)).toContain('automatic_effect')
  })

  it('détecte "entraînent" (pluriel)', () => {
    const t = "Ces manquements entraînent une résiliation de plein droit."
    expect(types(t)).toContain('automatic_effect')
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// 11. Nouveaux patterns — mandatory_procedure : obligations pratiques
// ─────────────────────────────────────────────────────────────────────────────

describe('detectHighRiskClaims — mandatory_procedure : obligations pratiques', () => {

  it('détecte "doit restituer" (run gestion_locative)', () => {
    const t = "L'agence doit restituer le dépôt de garantie dans le délai légal."
    expect(types(t)).toContain('mandatory_procedure')
  })

  it('détecte "doit réaliser" (run gestion_locative)', () => {
    const t = "Le bailleur doit réaliser l'état des lieux de sortie contradictoirement."
    expect(types(t)).toContain('mandatory_procedure')
  })

  it('détecte "impossible sans" (run baux_habitation)', () => {
    const t = "La retenue sur dépôt est impossible sans état des lieux contradictoire."
    expect(types(t)).toContain('mandatory_procedure')
  })

  it('détecte "impose de" (run environnement_immo)', () => {
    const t = "Le décret impose de réaliser une mise en conformité sous 4 ans."
    expect(types(t)).toContain('mandatory_procedure')
  })

  it('détecte "impose que" (run rgpd_agence)', () => {
    const t = "Le RGPD impose que le consentement soit explicite."
    expect(types(t)).toContain('mandatory_procedure')
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// 12. Nouveaux patterns — liability_or_causation : additionnels
// ─────────────────────────────────────────────────────────────────────────────

describe('detectHighRiskClaims — liability_or_causation : additionnels', () => {

  it('détecte "rend X impossible" (run baux_habitation)', () => {
    const t = "L'absence d'EDL rend impossible la récupération des retenues."
    expect(types(t)).toContain('liability_or_causation')
  })

  it('détecte "est imputable à" (run gestion_locative)', () => {
    const t = "La dégradation est imputable au locataire selon l'état des lieux."
    expect(types(t)).toContain('liability_or_causation')
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// 13. Nouveaux patterns — delay : "sous X ans"
// ─────────────────────────────────────────────────────────────────────────────

describe('detectHighRiskClaims — delay : sous X ans', () => {

  it('détecte "sous 4 ans" (run environnement_immo)', () => {
    const t = "La mise en conformité doit être réalisée sous 4 ans."
    expect(types(t)).toContain('delay')
  })

  it('détecte "sous 3 ans" (prescription)', () => {
    const t = "L'action en garantie se prescrit sous 3 ans."
    expect(types(t)).toContain('delay')
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// 14. softenHighRiskClaims — niveau high (gestion_locative)
// ─────────────────────────────────────────────────────────────────────────────

describe('softenHighRiskClaims — safetyLevel=high', () => {

  it('"déclenche" → "peut déclencher"', () => {
    const r = softenHighRiskClaims(
      "Un défaut déclenche généralement un contrôle.",
      { safetyLevel: 'high' }
    )
    expect(r).toContain('peut déclencher')
    expect(r).not.toMatch(/\bdéclenche\b/)
  })

  it('"entraîne" → "peut entraîner"', () => {
    const r = softenHighRiskClaims(
      "Le défaut entraîne la résiliation du bail.",
      { safetyLevel: 'high' }
    )
    expect(r).toContain('peut entraîner')
  })

  it('"doit restituer" → "doit en principe restituer"', () => {
    const r = softenHighRiskClaims(
      "L'agence doit restituer le dépôt sous 30 jours.",
      { safetyLevel: 'high' }
    )
    expect(r).toContain('doit en principe restituer')
    expect(r).not.toMatch(/\bdoit restituer\b/)
  })

  it('"impossible sans" → "difficile à justifier sans"', () => {
    const r = softenHighRiskClaims(
      "La retenue est impossible sans état des lieux.",
      { safetyLevel: 'high' }
    )
    expect(r).toContain('difficile à justifier sans')
  })

  it('"rend X impossible" → "rend X très difficile"', () => {
    const r = softenHighRiskClaims(
      "L'absence d'EDL rend la récupération impossible.",
      { safetyLevel: 'high' }
    )
    expect(r.toLowerCase()).toContain('très difficile')
  })

  it('"est imputable à / au" → "serait en principe imputable"', () => {
    const r = softenHighRiskClaims(
      "La dégradation est imputable au locataire.",
      { safetyLevel: 'high' }
    )
    expect(r).toContain('serait en principe imputable au locataire')
  })

  it('"impose de" → "prévoit en principe de"', () => {
    const r = softenHighRiskClaims(
      "Le décret impose de réaliser les travaux.",
      { safetyLevel: 'high' }
    )
    expect(r).toContain('prévoit en principe de')
  })

  // Les règles critical NE doivent PAS s'appliquer en high
  it('ne reformule PAS "amende jusqu\'à X €" en mode high', () => {
    const t = "Une amende jusqu'à 1 500 € peut être infligée."
    const r = softenHighRiskClaims(t, { safetyLevel: 'high' })
    expect(r).toContain('1 500')   // le montant reste visible
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// 15. softenHighRiskClaims — niveau critical (environnement_immo, rgpd_agence)
// ─────────────────────────────────────────────────────────────────────────────

describe('softenHighRiskClaims — safetyLevel=critical', () => {

  it('"amende jusqu\'à 1 500 €" → reformulation prudente', () => {
    const t = "Une amende jusqu'à 1 500 € peut être infligée par la DGCCRF."
    const r = softenHighRiskClaims(t, { safetyLevel: 'critical' })
    expect(r).toContain('peuvent être encourues selon la situation')
    expect(r).not.toContain("amende jusqu'à")
  })

  it('"sous 4 ans" → reformulation avec réserve (run environnement_immo)', () => {
    const t = "La mise en conformité doit être réalisée sous 4 ans."
    const r = softenHighRiskClaims(t, { safetyLevel: 'critical' })
    expect(r).toContain('sous réserve des textes applicables')
    expect(r).toContain('4 ans')           // le chiffre reste
    expect(r).not.toMatch(/\bsous 4 ans\b/)
  })

  it('"amende de 20 M€" → reformulation sans montant brut', () => {
    const t = "La CNIL peut infliger une amende de 20 M€ au responsable."
    const r = softenHighRiskClaims(t, { safetyLevel: 'critical' })
    expect(r).toContain('sanctions administratives importantes')
    expect(r).not.toContain('amende de 20')
  })

  it('applique aussi les règles high et medium en mode critical', () => {
    const t = "Le défaut déclenche un contrôle et doit restituer le dépôt."
    const r = softenHighRiskClaims(t, { safetyLevel: 'critical' })
    expect(r).toContain('peut déclencher')
    expect(r).toContain('doit en principe restituer')
  })

  it('compat. descendante : aggressive=true équivaut à critical', () => {
    const t = "La CNIL peut infliger une amende de 20 M€."
    const rAggressive = softenHighRiskClaims(t, { aggressive: true })
    const rCritical   = softenHighRiskClaims(t, { safetyLevel: 'critical' })
    expect(rAggressive).toBe(rCritical)
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// 16. softenHighRiskClaims — niveau medium (défaut)
// ─────────────────────────────────────────────────────────────────────────────

describe('softenHighRiskClaims — safetyLevel=medium (défaut)', () => {

  it('applique les règles de base en mode medium', () => {
    const t = "Un état des lieux incomplet engage sa responsabilité."
    const r = softenHighRiskClaims(t, { safetyLevel: 'medium' })
    expect(r).toContain('peut engager sa responsabilité')
  })

  it('ne reformule PAS "déclenche" en mode medium', () => {
    const t = "Cette action déclenche un contrôle."
    const r = softenHighRiskClaims(t, { safetyLevel: 'medium' })
    // déclenche est une règle high — ne doit pas être transformé en medium
    expect(r).toContain('déclenche')
  })

  it('sans options = même résultat que medium', () => {
    const t = "La clause est nulle et non avenue."
    expect(softenHighRiskClaims(t)).toBe(softenHighRiskClaims(t, { safetyLevel: 'medium' }))
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// 17. Runs complets par domaine
// ─────────────────────────────────────────────────────────────────────────────

describe('runs complets — gestion_locative (safetyLevel=high)', () => {

  const GESTION_RUN = `
    L'agence doit restituer le dépôt dans un délai de 30 jours.
    L'absence d'état des lieux rend impossible la récupération des retenues.
    Un EDL incomplet engage sa responsabilité envers le propriétaire.
    La retenue est impossible sans état des lieux de sortie contradictoire.
  `

  it('détecte delay, mandatory_procedure et liability_or_causation', () => {
    const detected = types(GESTION_RUN)
    expect(detected).toContain('delay')
    expect(detected).toContain('mandatory_procedure')
    expect(detected).toContain('liability_or_causation')
  })

  it('reformule toutes les formulations trop absolues en high', () => {
    const r = softenHighRiskClaims(GESTION_RUN, { safetyLevel: 'high' })
    expect(r).toContain('doit en principe restituer')
    expect(r).toContain('difficile à justifier sans')
    expect(r).toContain('peut engager sa responsabilité')
  })

})

describe('runs complets — environnement_immo (safetyLevel=critical)', () => {

  const ENV_RUN = `
    Un défaut de conformité déclenche généralement un contrôle.
    La mise en conformité doit être réalisée sous 4 ans.
    Le règlement impose de signaler tout dépassement dans les 30 jours.
    En cas de violation grave, une amende jusqu'à 1 500 € peut être prononcée.
    Cette situation entraîne la responsabilité du propriétaire de plein droit.
  `

  it('détecte au moins 4 types différents', () => {
    expect(types(ENV_RUN).length).toBeGreaterThanOrEqual(4)
  })

  it('reformule les signaux forts en critical', () => {
    const r = softenHighRiskClaims(ENV_RUN, { safetyLevel: 'critical' })
    expect(r).toContain('peut déclencher')
    expect(r).toContain('sous réserve des textes applicables')
    expect(r).toContain('peuvent être encourues selon la situation')
    expect(r).toContain('peut entraîner')
  })

})
