// __tests__/legal-brief-v2.test.ts
// Tests unitaires du moteur V2 : detectLegalPlaybook, buildLegalBrief, validateAnswerAgainstBrief
// Lancer : npx vitest run __tests__/legal-brief-v2.test.ts

import { describe, it, expect } from 'vitest'
import { detectLegalPlaybook, PLAYBOOKS } from '@/lib/legal-playbooks'
import { buildLegalBrief } from '@/lib/legal-brief'
import { validateAnswerAgainstBrief } from '@/lib/answer-validator'
import type { TaggedArticle } from '@/lib/post-treatment'

// ─────────────────────────────────────────────────────────────────────────────
// detectLegalPlaybook — 3 questions benchmark exactes
// ─────────────────────────────────────────────────────────────────────────────

describe('detectLegalPlaybook — questions benchmark exactes', () => {
  it('Q1 : offre contresignée → vente_offre_contre_signee', () => {
    const result = detectLegalPlaybook(
      "Une offre d'achat contresignée par le vendeur oblige-t-elle l'acquéreur à acheter ?"
    )
    expect(result).not.toBeNull()
    expect(result?.id).toBe('vente_offre_contre_signee')
  })

  it('Q2 : dépôt de garantie état des lieux incomplet → gestion_locative_depot_garantie', () => {
    const result = detectLegalPlaybook(
      "Le propriétaire me demande de retenir une partie du dépôt de garantie pour des dégradations, mais l'état des lieux de sortie est incomplet. Que peut faire l'agence de gestion ?"
    )
    expect(result).not.toBeNull()
    expect(result?.id).toBe('gestion_locative_depot_garantie')
  })

  it('Q3 : fosse septique voisin → environnement_immo_spanc', () => {
    const result = detectLegalPlaybook(
      "Que faire si ma fosse septique n'est pas aux normes et que mon voisin m'a dénoncé ?"
    )
    expect(result).not.toBeNull()
    expect(result?.id).toBe('environnement_immo_spanc')
  })
})

describe('detectLegalPlaybook — variantes de formulation', () => {
  it('variante apostrophe typographique (offre d\u2019achat)', () => {
    const result = detectLegalPlaybook(
      "L\u2019offre d\u2019achat contresign\u00e9e par le vendeur engage-t-elle l\u2019acqu\u00e9reur ?"
    )
    expect(result?.id).toBe('vente_offre_contre_signee')
  })

  it('variante minuscule sans accent : offre achat contresignee vendeur', () => {
    const result = detectLegalPlaybook(
      'une offre achat contresignee vendeur oblige acquereur acheter'
    )
    expect(result?.id).toBe('vente_offre_contre_signee')
  })

  it('question non couverte → null', () => {
    const result = detectLegalPlaybook(
      "Quel est le délai de préavis pour un bail commercial ?"
    )
    expect(result).toBeNull()
  })

  it('question vide → null', () => {
    const result = detectLegalPlaybook('')
    expect(result).toBeNull()
  })

  it('question partielle ambiguë sans trigger → null', () => {
    const result = detectLegalPlaybook('bonjour')
    expect(result).toBeNull()
  })
})

describe('detectLegalPlaybook — pas de confusion entre playbooks', () => {
  it('SPANC ne matche pas offre contresignée', () => {
    const result = detectLegalPlaybook(
      "Que faire si ma fosse septique n'est pas aux normes et que mon voisin m'a dénoncé ?"
    )
    expect(result?.id).not.toBe('vente_offre_contre_signee')
  })

  it('dépôt garantie ne matche pas SPANC', () => {
    const result = detectLegalPlaybook(
      "Le propriétaire me demande de retenir une partie du dépôt de garantie"
    )
    expect(result?.id).not.toBe('environnement_immo_spanc')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// buildLegalBrief — construction déterministe
// ─────────────────────────────────────────────────────────────────────────────

describe('buildLegalBrief', () => {
  const playbook = PLAYBOOKS.find((p) => p.id === 'vente_offre_contre_signee')!

  it('retourne un brief avec les champs obligatoires', () => {
    const brief = buildLegalBrief({
      userQuestion: "Une offre d'achat contresignée oblige-t-elle l'acquéreur ?",
      domain: 'vente_immobiliere',
      playbook,
      taggedArticles: [],
      taggedLiveCases: [],
      precisionBudget: 'medium',
    })

    expect(brief.domain).toBe('vente_immobiliere')
    expect(brief.archetype).toBe('vente_offre_contre_signee')
    expect(brief.requiredDistinctions).toHaveLength(playbook.requiredDistinctions.length)
    expect(brief.forbiddenAssertions).toHaveLength(playbook.forbiddenAssertions.length)
    expect(brief.precisionBudget).toBe('medium')
  })

  it('avec des articles taggés → authorityCards non vides', () => {
    const taggedArticles = [
      { tag: 'A1', title: 'Art. 1113 — Code civil', sourceLaw: 'code civil', sourceArticle: '1113', sourceUrl: 'https://legifrance.fr' },
      { tag: 'A2', title: 'Art. L271-1 — CCH', sourceLaw: 'code de la construction et de l\'habitation', sourceArticle: 'L271-1', sourceUrl: undefined },
    ]

    const brief = buildLegalBrief({
      userQuestion: "Une offre d'achat contresignée oblige-t-elle l'acquéreur ?",
      domain: 'vente_immobiliere',
      playbook,
      taggedArticles,
      taggedLiveCases: [],
      precisionBudget: 'high',
    })

    expect(brief.authorityCards).toHaveLength(2)
    expect(brief.authorityCards[0].tag).toBe('A1')
    expect(brief.authorityCards[0].kind).toBe('article')
    expect(brief.authorityCards[1].tag).toBe('A2')
  })

  it('article requis non résolu → signalé dans missingPieces', () => {
    const brief = buildLegalBrief({
      userQuestion: "Une offre d'achat contresignée oblige-t-elle l'acquéreur ?",
      domain: 'vente_immobiliere',
      playbook,
      taggedArticles: [], // aucun article résolu
      taggedLiveCases: [],
      precisionBudget: 'low',
    })

    // Tous les articles required doivent apparaître dans missingPieces
    const requiredArticles = playbook.forcedArticles.filter((a) => a.required)
    for (const art of requiredArticles) {
      const found = brief.missingPieces.some((m) => m.includes(art.artNum))
      expect(found).toBe(true)
    }
  })

  it('jurisprudence absente → signalé dans missingPieces', () => {
    const brief = buildLegalBrief({
      userQuestion: "Une offre d'achat contresignée oblige-t-elle l'acquéreur ?",
      domain: 'vente_immobiliere',
      playbook,
      taggedArticles: [],
      taggedLiveCases: [],
      precisionBudget: 'low',
    })

    const hasJuriMissing = brief.missingPieces.some((m) =>
      m.toLowerCase().includes('jurisprudence')
    )
    expect(hasJuriMissing).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateAnswerAgainstBrief — validateur déterministe
// ─────────────────────────────────────────────────────────────────────────────

describe('validateAnswerAgainstBrief', () => {
  const playbook = PLAYBOOKS.find((p) => p.id === 'vente_offre_contre_signee')!

  function makeBrief(taggedArticles: TaggedArticle[] = [], taggedLiveCases: never[] = [], precisionBudget: 'high' | 'medium' | 'low' = 'medium') {
    return buildLegalBrief({
      userQuestion: "Une offre d'achat contresignée oblige-t-elle l'acquéreur ?",
      domain: 'vente_immobiliere',
      playbook,
      taggedArticles,
      taggedLiveCases,
      precisionBudget,
    })
  }

  it('réponse propre → validation OK', () => {
    const brief = makeBrief()
    const answer = `
      Une offre d'achat contresignée peut en principe engager les deux parties
      selon l'article 1113 du Code civil. Toutefois, en pratique, la situation
      est plus nuancée. Les conditions suspensives (prêt, financement) peuvent
      affecter cet engagement. Si le bien est à usage d'habitation, l'acquéreur
      non professionnel dispose d'un droit de rétractation de 10 jours (L271-1 CCH).
      L'exécution forcée est théoriquement possible mais non automatique en pratique.
    `
    const report = validateAnswerAgainstBrief(answer, brief)
    // Pas de high severity
    const highIssues = report.issues.filter((i) => i.severity === 'high')
    expect(highIssues).toHaveLength(0)
  })

  it('assertion interdite "l\'acquéreur est forcément tenu d\'acheter" → issue high', () => {
    const brief = makeBrief()
    const answer = `
      Oui, l'acquéreur est forcément tenu d'acheter dès lors que le vendeur a contresigné l'offre.
      La vente est parfaite et les parties sont engagées.
    `
    const report = validateAnswerAgainstBrief(answer, brief)
    const forbiddenIssues = report.issues.filter((i) => i.code === 'FORBIDDEN_ASSERTION')
    expect(forbiddenIssues.length).toBeGreaterThan(0)
    expect(report.ok).toBe(false)
  })

  it('assertion "la vente est définitivement parfaite" → issue high', () => {
    const brief = makeBrief()
    const answer = `
      La vente est définitivement parfaite dès la contresignature. L'exécution forcée est automatique.
    `
    const report = validateAnswerAgainstBrief(answer, brief)
    const forbiddenIssues = report.issues.filter((i) => i.code === 'FORBIDDEN_ASSERTION')
    expect(forbiddenIssues.length).toBeGreaterThan(0)
  })

  it('tag inexistant [A9] dans la réponse → issue high NONEXISTENT_TAG', () => {
    const brief = makeBrief() // aucun article résolu → aucun tag disponible
    const answer = `Selon l'article [A9], l'acquéreur doit acheter.`
    const report = validateAnswerAgainstBrief(answer, brief)
    const tagIssues = report.issues.filter((i) => i.code === 'NONEXISTENT_TAG')
    expect(tagIssues.length).toBeGreaterThan(0)
    expect(tagIssues[0].severity).toBe('high')
  })

  it('budget low + délai précis sans tag → issue medium', () => {
    const brief = makeBrief([], [], 'low')
    const answer = `
      L'acquéreur dispose de 15 jours pour se rétracter.
      En cas de non-respect, une amende de 5000 euros peut être infligée.
    `
    const report = validateAnswerAgainstBrief(answer, brief)
    const delayIssues = report.issues.filter(
      (i) => i.code === 'UNCOVERED_PRECISE_DELAY' || i.code === 'UNCOVERED_PRECISE_SANCTION'
    )
    expect(delayIssues.length).toBeGreaterThan(0)
  })

  it('budget low + délai couvert par tag [A1] → pas d\'issue délai', () => {
    const taggedArticles = [
      { tag: 'A1', title: 'Art. L271-1 CCH', sourceLaw: 'code de la construction et de l\'habitation', sourceArticle: 'L271-1', sourceUrl: undefined },
    ]
    const brief = makeBrief(taggedArticles, [], 'low')
    const answer = `L'acquéreur dispose d'un délai de 10 jours [A1] pour exercer son droit de rétractation.`
    const report = validateAnswerAgainstBrief(answer, brief)
    const delayIssues = report.issues.filter((i) => i.code === 'UNCOVERED_PRECISE_DELAY')
    expect(delayIssues).toHaveLength(0)
  })

  // Tests sur le playbook SPANC
  describe('playbook environnement_immo_spanc', () => {
    const playbookSpanc = PLAYBOOKS.find((p) => p.id === 'environnement_immo_spanc')!

    function makeSpancBrief(precisionBudget: 'high' | 'medium' | 'low' = 'low') {
      return buildLegalBrief({
        userQuestion: "Que faire si ma fosse septique n'est pas aux normes et que mon voisin m'a dénoncé ?",
        domain: 'environnement_immo',
        playbook: playbookSpanc,
        taggedArticles: [],
        taggedLiveCases: [],
        precisionBudget,
      })
    }

    it('assertion "la dénonciation entraîne automatiquement une sanction" → issue high', () => {
      const brief = makeSpancBrief()
      const answer = `
        La dénonciation entraîne automatiquement une sanction administrative.
        La commune imposera des travaux immédiats.
      `
      const report = validateAnswerAgainstBrief(answer, brief)
      const forbidden = report.issues.filter((i) => i.code === 'FORBIDDEN_ASSERTION')
      expect(forbidden.length).toBeGreaterThan(0)
    })
  })
})
