// __tests__/sprint-final-validation.test.ts
// Tests ciblés sprint final : normalizer, gold scorer alias, Q1 praticité
// Chaque test vérifie un comportement spécifique introduit pour passer les seuils.

import { describe, it, expect } from 'vitest'
import { expandAuthorityCitations } from '@/lib/authority-normalizer'
import { scoreAgainstGold } from '@/lib/legal-gold-score'
import { getGoldCase } from '@/lib/legal-gold-cases'
import type { GoldBenchmarkCase } from '@/lib/legal-gold-cases'

// ─────────────────────────────────────────────────────────────────────────────
// 1. expandAuthorityCitations — rendu canonique des abréviations
// ─────────────────────────────────────────────────────────────────────────────

describe('expandAuthorityCitations', () => {
  it('traduit C. civ. en Code civil', () => {
    const input = "l'art. 1113 C. civ. pose les conditions de formation"
    expect(expandAuthorityCitations(input)).toContain('Code civil')
    expect(expandAuthorityCitations(input)).not.toContain('C. civ.')
  })

  it('traduit CSP en Code de la santé publique', () => {
    const input = 'conformément au CSP, le SPANC est compétent'
    const result = expandAuthorityCitations(input)
    expect(result).toContain('Code de la santé publique')
    expect(result).not.toMatch(/\bCSP\b/)
  })

  it('ne remplace pas SPANC (acronyme différent)', () => {
    const input = 'contacter le SPANC de la commune'
    expect(expandAuthorityCitations(input)).toContain('SPANC')
  })

  it('traduit CCH en Code de la construction et de l\'habitation', () => {
    const input = 'le droit de rétractation (L271-1 CCH) est de 10 jours'
    const result = expandAuthorityCitations(input)
    expect(result).toContain("Code de la construction et de l'habitation")
    expect(result).not.toMatch(/\bCCH\b/)
  })

  it('traduit loi 89-462 en loi du 6 juillet 1989', () => {
    const input = 'les délais de restitution prévus par la loi 89-462'
    const result = expandAuthorityCitations(input)
    expect(result).toContain('loi du 6 juillet 1989')
    expect(result).not.toContain('89-462')
  })

  it('traduit C. conso. en Code de la consommation', () => {
    const input = 'art. L313-41 C. conso. — condition suspensive de crédit'
    const result = expandAuthorityCitations(input)
    expect(result).toContain('Code de la consommation')
    expect(result).not.toContain('C. conso.')
  })

  it('est idempotent — double application sans effet cumulatif', () => {
    const input = 'l\'art. 1113 C. civ. s\'applique'
    const once = expandAuthorityCitations(input)
    const twice = expandAuthorityCitations(once)
    expect(once).toEqual(twice)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Gold scorer — bonne autorité / forme différente (alias)
// ─────────────────────────────────────────────────────────────────────────────

const AUTHORITY_ALIAS_GOLD: GoldBenchmarkCase = {
  id: 'T_ALIAS',
  playbookId: 'test',
  question: 'Test alias autorité',
  mustInclude: ['délai de rétractation'],
  mustAvoid: [],
  keyAuthorities: ['code civil', 'loi de 1989', 'code de la santé publique'],
  practicalExpectation: ['consulter un notaire'],
  comments: [],
}

describe('scoreAgainstGold — alias d\'autorités', () => {
  it('score plein si autorités en forme longue canonique', () => {
    const answer = `
      L'art. 1113 du Code civil pose les conditions de formation du contrat.
      La loi du 6 juillet 1989 encadre la restitution du dépôt de garantie.
      Le Code de la santé publique régit l'assainissement non collectif.
      Il est important de respecter le délai de rétractation.
      Consulter un notaire pour sécuriser la démarche.
    `
    const score = scoreAgainstGold(answer, AUTHORITY_ALIAS_GOLD)
    expect(score.authorityScore).toBeGreaterThanOrEqual(4.5)
  })

  it('pénalité réduite (pas 0) si bonne autorité sous forme abrégée', () => {
    // "C. civ." sera normalisé → mais ici on teste AVANT normalizer
    // ce qui simule une réponse non encore normalisée
    const answerAbreviated = `
      L'art. 1113 C. civ. → contrat synallagmatique. Art. 1113 civ.
      La loi 89-462 encadre les délais.
      Le SPANC est compétent selon le CSP.
      Il est important de respecter le délai de rétractation.
      Consulter un notaire.
    `
    const scoreAbrev = scoreAgainstGold(answerAbreviated, AUTHORITY_ALIAS_GOLD)
    // Après normalisation externe, les formes longues seraient là → score plein
    // Sans normalisation : les alias devraient donner une pénalité réduite
    // La pénalité alias est 0.25 pt par autorité trouvée via alias
    // → score > 0 même sans les formes longues
    expect(scoreAbrev.authorityScore).toBeGreaterThan(0)
  })

  it('autorité totalement absente → pénalité forte', () => {
    const answerNoAuth = `
      La réponse est complexe et dépend de nombreux facteurs.
      Il convient d'être prudent et de consulter un professionnel.
      Le délai de rétractation est important à respecter.
      Consulter un notaire.
    `
    const score = scoreAgainstGold(answerNoAuth, AUTHORITY_ALIAS_GOLD)
    // Aucune autorité présente → authorityScore bas
    expect(score.authorityScore).toBeLessThan(2.5)
  })

  it('mauvaise autorité dans wrongAuthorityContexts → pénalité forte maintenue', () => {
    const goldWithWrong: GoldBenchmarkCase = {
      ...AUTHORITY_ALIAS_GOLD,
      keyAuthorities: ['code civil'],
      wrongAuthorityContexts: [
        {
          authority: 'L271-1',
          contexts: ['spanc', 'assainissement'],
          penalty: 2.5,
        },
      ],
    }
    const answer = `
      L'art. L271-1 s'applique au contrôle SPANC et assainissement.
      Code civil encadre les contrats.
      Consulter un notaire. Délai de rétractation.
    `
    const score = scoreAgainstGold(answer, goldWithWrong)
    // L271-1 dans contexte assainissement → pénalité 2.5 sur authorityScore
    expect(score.authorityScore).toBeLessThan(3)
    expect(score.comments.some((c) => c.includes('mal employ'))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Q1 — présence des trois éléments pratiques obligatoires
// ─────────────────────────────────────────────────────────────────────────────

describe('gold Q1 — éléments pratiques obligatoires', () => {
  const goldQ1 = getGoldCase('Q1')!

  it('gold case Q1 chargé correctement', () => {
    expect(goldQ1).toBeDefined()
    expect(goldQ1.practicalExpectation).toContain('consulter un notaire')
    expect(goldQ1.practicalExpectation).toContain('prêt immobilier')
    expect(goldQ1.practicalExpectation).toContain('vérifier la nature')
  })

  it('réponse avec les 3 éléments pratiques → practical = 5/5', () => {
    const answer = `
      L'offre contresignée peut valoir compromis de vente synallagmatique selon le Code civil.
      Le délai de rétractation de 10 jours protège l'acquéreur.
      L'exécution forcée nécessite une action en justice et reste exceptionnelle.
      Les conditions suspensives (notamment la condition de prêt immobilier) limitent l'engagement.
      Il est indispensable de consulter un notaire pour vérifier la nature du document.
    `
    const score = scoreAgainstGold(answer, goldQ1)
    expect(score.practicalScore).toBeGreaterThanOrEqual(4.5)
  })

  it('réponse avec seulement 1 élément pratique → practical < 4', () => {
    const answer = `
      L'offre contresignée peut valoir compromis de vente synallagmatique.
      Le délai de rétractation de 10 jours s'applique.
      L'exécution forcée nécessite une action en justice.
      Il faut consulter un professionnel.
    `
    // "consulter un notaire" → pas de "notaire" explicite (dit "professionnel")
    // "prêt immobilier" → absent
    // "vérifier la nature" → absent
    const score = scoreAgainstGold(answer, goldQ1)
    expect(score.practicalScore).toBeLessThan(4)
  })

  it('réponse Q1 idéale → total ≥ 17/20', () => {
    const answer = `
      Une offre d'achat contresignée par le vendeur peut constituer un contrat synallagmatique
      selon les articles 1113 et 1589 du Code civil.

      Le délai de rétractation de 10 jours (art. L271-1) s'applique pour les biens d'habitation.
      L'acquéreur non professionnel peut se rétracter sans motif.

      Les conditions suspensives — notamment la condition suspensive d'obtention de prêt immobilier —
      limitent l'engagement de l'acquéreur si elles ne se réalisent pas.

      L'exécution forcée est théoriquement possible (art. 1589 Code civil), mais elle nécessite
      une action en justice et est rarement accordée en pratique.

      Il est indispensable de consulter un notaire pour vérifier la nature du document :
      s'agit-il d'une offre simple ou d'un compromis de vente ?
      L'engagement de l'acquéreur dépend de cette qualification.
    `
    const score = scoreAgainstGold(answer, goldQ1)
    expect(score.total).toBeGreaterThanOrEqual(17)
  })
})
