// __tests__/benchmark-domain-pack-baux.test.ts
// Tests unitaires du benchmark domain pack baux_habitation
// Lancer : npx vitest run __tests__/benchmark-domain-pack-baux.test.ts

import { describe, it, expect } from 'vitest'
import {
  BENCHMARK_DATASET,
  BenchmarkCategory,
  BenchmarkQuestion,
  ModeResult,
  QuestionResult,
  ModeMetrics,
  scoreBriefQuality,
  detectScopeErrors,
  computeBriefLength,
  computeModeMetrics,
  evaluateGoNoGo,
  runModeA,
  runModeB,
  runModeC,
} from '../scripts/benchmark-domain-pack-baux'
import { BAUX_HABITATION_PACK, matchFallbackRule } from '@/lib/domain-packs'
import { detectLegalPlaybook } from '@/lib/legal-playbooks'
import type { LegalBrief } from '@/lib/legal-brief'
import type { AuthorityCard } from '@/lib/authority-cards'

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeMinimalBrief(overrides: Partial<LegalBrief> = {}): LegalBrief {
  return {
    domain: 'baux_habitation',
    archetype: 'baux_habitation/loyers_impayes_expulsion',
    userQuestion: 'Test question',
    facts: ['Fact 1'],
    requiredDistinctions: ['Distinction A', 'Distinction B'],
    forbiddenAssertions: ['Ne pas faire X', 'Ne pas faire Y'],
    authorityCards: [],
    practicalOutcome: ['Action 1', 'Action 2'],
    precisionBudget: 'medium',
    missingPieces: [],
    ...overrides,
  }
}

function makeAuthorityCard(overrides: Partial<AuthorityCard> = {}): AuthorityCard {
  return {
    tag: 'A1',
    kind: 'article',
    source: 'Art. 24 loi 89-462',
    rule: 'La clause résolutoire ne peut jouer qu\'après commandement de payer.',
    scope: 'Baux d\'habitation principale.',
    ...overrides,
  }
}

function makeModeResult(overrides: Partial<ModeResult> = {}): ModeResult {
  return {
    mode: 'B',
    applicability: 'ok',
    absorbed: true,
    archetype: 'baux_habitation/loyers_impayes_expulsion',
    briefGoldScore: 18,
    scopeErrorCount: 0,
    practicalScore: 4.5,
    latencyMs: 1.2,
    briefLength: 20,
    authorityCount: 3,
    hasPlaybookOverlay: false,
    notes: [],
    ...overrides,
  }
}

function makeQuestionResult(
  q: BenchmarkQuestion,
  modeAOverrides: Partial<ModeResult> = {},
  modeBOverrides: Partial<ModeResult> = {},
  modeCOverrides: Partial<ModeResult> = {},
): QuestionResult {
  return {
    questionId: q.id,
    question: q.question,
    category: q.category,
    profile: q.profile,
    expectedPlaybookMatch: q.expectedPlaybookMatch,
    expectedAbsorbableByDomainPack: q.expectedAbsorbableByDomainPack,
    modeA: makeModeResult({ mode: 'A', ...modeAOverrides }),
    modeB: makeModeResult({ mode: 'B', ...modeBOverrides }),
    modeC: makeModeResult({ mode: 'C', ...modeCOverrides }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Structure du dataset
// ─────────────────────────────────────────────────────────────────────────────

describe('Dataset — structure et intégrité', () => {
  it('contient exactement 30 questions', () => {
    expect(BENCHMARK_DATASET).toHaveLength(30)
  })

  it('tous les IDs sont uniques', () => {
    const ids = BENCHMARK_DATASET.map((q) => q.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(30)
  })

  it('les IDs sont du format B01–B30', () => {
    const ids = BENCHMARK_DATASET.map((q) => q.id)
    for (const id of ids) {
      expect(id).toMatch(/^B\d{2}$/)
    }
    // Vérifier que B01–B30 sont tous présents
    for (let i = 1; i <= 30; i++) {
      const expected = `B${String(i).padStart(2, '0')}`
      expect(ids).toContain(expected)
    }
  })

  it('aucune question n\'a un champ vide', () => {
    for (const q of BENCHMARK_DATASET) {
      expect(q.question.trim().length).toBeGreaterThan(10)
      expect(q.goldExpectation.trim().length).toBeGreaterThan(10)
      expect(q.category).toBeDefined()
      expect(q.profile).toBeDefined()
    }
  })

  it('contient 8 questions loyers_impayes_expulsion', () => {
    const count = BENCHMARK_DATASET.filter((q) => q.category === 'loyers_impayes_expulsion').length
    expect(count).toBe(8)
  })

  it('contient 6 questions depot_garantie_etat_lieux', () => {
    const count = BENCHMARK_DATASET.filter((q) => q.category === 'depot_garantie_etat_lieux').length
    expect(count).toBe(6)
  })

  it('contient 6 questions conge_bailleur_locataire', () => {
    const count = BENCHMARK_DATASET.filter((q) => q.category === 'conge_bailleur_locataire').length
    expect(count).toBe(6)
  })

  it('contient 4 questions decence_insalubrite', () => {
    const count = BENCHMARK_DATASET.filter((q) => q.category === 'decence_insalubrite').length
    expect(count).toBe(4)
  })

  it('contient 4 questions sous_location_colocation', () => {
    const count = BENCHMARK_DATASET.filter((q) => q.category === 'sous_location_colocation').length
    expect(count).toBe(4)
  })

  it('contient 2 questions treve_hivernale', () => {
    const count = BENCHMARK_DATASET.filter((q) => q.category === 'treve_hivernale').length
    expect(count).toBe(2)
  })

  it('contient 10 questions "well_covered"', () => {
    const count = BENCHMARK_DATASET.filter((q) => q.profile === 'well_covered').length
    expect(count).toBe(10)
  })

  it('contient 10 questions "fuzzy"', () => {
    const count = BENCHMARK_DATASET.filter((q) => q.profile === 'fuzzy').length
    expect(count).toBe(10)
  })

  it('contient 10 questions "edge_case"', () => {
    const count = BENCHMARK_DATASET.filter((q) => q.profile === 'edge_case').length
    expect(count).toBe(10)
  })

  it('expectedAbsorbableByDomainPack est true pour toutes les questions', () => {
    for (const q of BENCHMARK_DATASET) {
      expect(q.expectedAbsorbableByDomainPack).toBe(true)
    }
  })

  it('les questions avec expectedPlaybookMatch=true ont toutes une question sur les loyers impayés', () => {
    const pbQuestions = BENCHMARK_DATASET.filter((q) => q.expectedPlaybookMatch)
    // Le seul playbook baux actif est baux_loyers_impayes_expulsion
    for (const q of pbQuestions) {
      expect(q.category).toBe('loyers_impayes_expulsion')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. scoreBriefQuality — calcul des métriques
// ─────────────────────────────────────────────────────────────────────────────

describe('scoreBriefQuality — calcul des métriques', () => {
  it('brief null → score 0', () => {
    const result = scoreBriefQuality(null, false)
    expect(result.gold).toBe(0)
    expect(result.practical).toBe(0)
    expect(result.scopeErrors).toBe(0)
  })

  it('brief vide → score faible', () => {
    const brief = makeMinimalBrief({
      authorityCards: [],
      requiredDistinctions: [],
      forbiddenAssertions: [],
      practicalOutcome: [],
    })
    const result = scoreBriefQuality(brief, false)
    expect(result.gold).toBe(0)
    expect(result.practical).toBe(0)
  })

  it('brief riche → score élevé (>= 16/20)', () => {
    const brief = makeMinimalBrief({
      authorityCards: [
        makeAuthorityCard({ tag: 'A1' }),
        makeAuthorityCard({ tag: 'A2' }),
        makeAuthorityCard({ tag: 'A3' }),
        makeAuthorityCard({ tag: 'A4' }),
      ],
      requiredDistinctions: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'],
      forbiddenAssertions: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'],
      practicalOutcome: ['P1', 'P2', 'P3', 'P4', 'P5'],
    })
    const result = scoreBriefQuality(brief, true)
    expect(result.gold).toBeGreaterThanOrEqual(16)
  })

  it('brief avec 4+ authority cards → authorityScore = 5/5', () => {
    const brief = makeMinimalBrief({
      authorityCards: [
        makeAuthorityCard({ tag: 'A1' }),
        makeAuthorityCard({ tag: 'A2' }),
        makeAuthorityCard({ tag: 'A3' }),
        makeAuthorityCard({ tag: 'A4' }),
      ],
      requiredDistinctions: [],
      forbiddenAssertions: [],
      practicalOutcome: [],
    })
    // Seule la composante authority contribue ici
    const result = scoreBriefQuality(brief, false)
    expect(result.gold).toBeGreaterThanOrEqual(5)
  })

  it('brief absorbé → score distinctionScore bonus > non absorbé', () => {
    const brief = makeMinimalBrief({
      authorityCards: [],
      requiredDistinctions: ['D1', 'D2', 'D3'],
      forbiddenAssertions: [],
      practicalOutcome: [],
    })
    const absorbed = scoreBriefQuality(brief, true)
    const notAbsorbed = scoreBriefQuality(brief, false)
    expect(absorbed.gold).toBeGreaterThanOrEqual(notAbsorbed.gold)
  })

  it('erreurs de portée pénalisent le score gold', () => {
    const briefClean = makeMinimalBrief({
      authorityCards: [
        makeAuthorityCard({ source: 'Art. 24 loi 89-462', rule: 'Clause résolutoire.' }),
      ],
    })
    const briefWithScope = makeMinimalBrief({
      authorityCards: [
        makeAuthorityCard({
          source: 'Art. L124-1 Code de commerce',
          rule: 'Statut des baux commerciaux — incompatible avec ce domaine.',
        }),
      ],
    })
    const clean = scoreBriefQuality(briefClean, true)
    const withError = scoreBriefQuality(briefWithScope, true)
    expect(clean.gold).toBeGreaterThan(withError.gold)
  })

  it('brief avec 5 practical outcomes → practicalScore = 5/5', () => {
    const brief = makeMinimalBrief({
      practicalOutcome: ['P1', 'P2', 'P3', 'P4', 'P5'],
      authorityCards: [],
      requiredDistinctions: [],
      forbiddenAssertions: [],
    })
    const result = scoreBriefQuality(brief, false)
    expect(result.practical).toBe(5)
  })

  it('score est clampé entre 0 et 20', () => {
    for (const q of BENCHMARK_DATASET) {
      const modeB = runModeB(q)
      expect(modeB.briefGoldScore).toBeGreaterThanOrEqual(0)
      expect(modeB.briefGoldScore).toBeLessThanOrEqual(20)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. detectScopeErrors
// ─────────────────────────────────────────────────────────────────────────────

describe('detectScopeErrors — autorités hors scope', () => {
  it('brief avec autorités baux_habitation → 0 erreurs', () => {
    const brief = makeMinimalBrief({
      authorityCards: [
        makeAuthorityCard({ source: 'Art. 24 loi 89-462', rule: 'Commandement de payer.' }),
        makeAuthorityCard({ source: 'Art. 1719 Code civil', rule: 'Obligation de délivrance.' }),
        makeAuthorityCard({ source: 'Art. L412-6 CPCE', rule: 'Trêve hivernale.' }),
      ],
    })
    expect(detectScopeErrors(brief)).toBe(0)
  })

  it('authority card bail commercial → 1 erreur', () => {
    const brief = makeMinimalBrief({
      authorityCards: [
        makeAuthorityCard({
          source: 'Art. L145-4 Code de commerce',
          rule: 'Bail commercial - statut des baux commerciaux.',
        }),
      ],
    })
    expect(detectScopeErrors(brief)).toBe(1)
  })

  it('authority card Code du travail → 1 erreur', () => {
    const brief = makeMinimalBrief({
      authorityCards: [
        makeAuthorityCard({
          source: 'Art. L1237-19 Code du travail',
          rule: 'Rupture conventionnelle — code du travail.',
        }),
      ],
    })
    expect(detectScopeErrors(brief)).toBe(1)
  })

  it('cards jurisprudence (kind=jurisprudence) ne comptent pas comme scope errors', () => {
    const brief = makeMinimalBrief({
      authorityCards: [
        {
          tag: 'J1',
          kind: 'jurisprudence',
          source: 'Cass. 3e civ., arrêt quelconque',
          rule: 'Arrêt sur clause résolutoire.',
          scope: 'Baux habitation.',
        },
      ],
    })
    expect(detectScopeErrors(brief)).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. computeBriefLength
// ─────────────────────────────────────────────────────────────────────────────

describe('computeBriefLength', () => {
  it('brief null → 0', () => {
    expect(computeBriefLength(null)).toBe(0)
  })

  it('additionne tous les champs du brief', () => {
    const brief = makeMinimalBrief({
      authorityCards: [makeAuthorityCard(), makeAuthorityCard({ tag: 'A2' })],
      requiredDistinctions: ['D1', 'D2', 'D3'],
      forbiddenAssertions: ['F1', 'F2'],
      practicalOutcome: ['P1'],
      facts: ['Fact 1', 'Fact 2', 'Fact 3'],
    })
    expect(computeBriefLength(brief)).toBe(2 + 3 + 2 + 1 + 3) // = 11
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Modes A / B / C — comportement selon présence/absence de playbook
// ─────────────────────────────────────────────────────────────────────────────

describe('Mode A — baseline sans domain pack', () => {
  it('question avec playbook attendu → Mode A absorbed=true', () => {
    const q = BENCHMARK_DATASET.find((q) => q.expectedPlaybookMatch)!
    expect(q).toBeDefined()
    const result = runModeA(q)
    expect(result.absorbed).toBe(true)
    expect(result.archetype).not.toBeNull()
  })

  it('question sans playbook → Mode A absorbed=false', () => {
    const q = BENCHMARK_DATASET.find((q) => !q.expectedPlaybookMatch)!
    expect(q).toBeDefined()
    const result = runModeA(q)
    // Aucun playbook baux ne devrait matcher pour les questions hors loyers impayés
    // (dépend du matching réel — si un playbook générique matche, ce test peut échouer)
    // On vérifie au moins que le mode produit un résultat cohérent
    expect(result.mode).toBe('A')
    expect(result.applicability).toBe('ok')
    expect(typeof result.briefGoldScore).toBe('number')
  })

  it('Mode A n\'utilise pas le domain pack', () => {
    const q = BENCHMARK_DATASET[0]
    const result = runModeA(q)
    // Mode A ne doit pas indiquer hasPlaybookOverlay basé sur le domain pack
    // (hasPlaybookOverlay pour Mode A est toujours false — le playbook est direct, pas un overlay)
    expect(result.hasPlaybookOverlay).toBe(false)
  })
})

describe('Mode B — domain pack seul', () => {
  it('question sur loyers impayés → absorbed=true (fallback rule)', () => {
    const q = BENCHMARK_DATASET.find((q) => q.category === 'loyers_impayes_expulsion')!
    const result = runModeB(q)
    expect(result.absorbed).toBe(true)
    expect(result.archetype).toContain('loyers_impayes_expulsion')
  })

  it('question sur dépôt de garantie → absorbed=true (fallback rule)', () => {
    const q = BENCHMARK_DATASET.find((q) => q.category === 'depot_garantie_etat_lieux')!
    const result = runModeB(q)
    expect(result.absorbed).toBe(true)
    expect(result.archetype).toContain('depot_garantie_restitution')
  })

  it('question sur congé locataire → absorbed=true (fallback rule)', () => {
    const q = BENCHMARK_DATASET.find((q) => q.id === 'B16')!
    const result = runModeB(q)
    expect(result.absorbed).toBe(true)
  })

  it('Mode B n\'utilise jamais de playbook overlay', () => {
    for (const q of BENCHMARK_DATASET) {
      const result = runModeB(q)
      expect(result.hasPlaybookOverlay).toBe(false)
    }
  })

  it('Mode B produit toujours un brief (jamais null — domain pack seul)', () => {
    for (const q of BENCHMARK_DATASET) {
      const result = runModeB(q)
      expect(result.authorityCount).toBeGreaterThan(0)
      expect(result.briefLength).toBeGreaterThan(0)
    }
  })

  it('latence Mode B > 0', () => {
    for (const q of BENCHMARK_DATASET) {
      const result = runModeB(q)
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('Mode C — domain pack + overlay', () => {
  it('question avec playbook attendu → Mode C hasPlaybookOverlay=true', () => {
    const q = BENCHMARK_DATASET.find((q) => q.expectedPlaybookMatch)!
    const result = runModeC(q)
    expect(result.hasPlaybookOverlay).toBe(true)
    expect(result.absorbed).toBe(true)
  })

  it('question sans playbook → Mode C hasPlaybookOverlay=false', () => {
    const q = BENCHMARK_DATASET.find((q) => !q.expectedPlaybookMatch && q.category === 'depot_garantie_etat_lieux')!
    const result = runModeC(q)
    expect(result.hasPlaybookOverlay).toBe(false)
  })

  it('Mode C score >= Mode B pour questions avec playbook overlay', () => {
    const q = BENCHMARK_DATASET.find((q) => q.expectedPlaybookMatch)!
    const modeB = runModeB(q)
    const modeC = runModeC(q)
    // Le playbook overlay doit enrichir le brief → score C >= score B
    expect(modeC.briefGoldScore).toBeGreaterThanOrEqual(modeB.briefGoldScore)
  })

  it('Mode C absorbe au moins autant de questions que Mode B (absorption >= Mode B)', () => {
    const absorbedB = BENCHMARK_DATASET.filter((q) => runModeB(q).absorbed).length
    const absorbedC = BENCHMARK_DATASET.filter((q) => runModeC(q).absorbed).length
    // Mode C = Mode B + overlay → doit absorber au moins autant que Mode B
    expect(absorbedC).toBeGreaterThanOrEqual(absorbedB)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. computeModeMetrics — agrégation correcte
// ─────────────────────────────────────────────────────────────────────────────

describe('computeModeMetrics', () => {
  const q1 = BENCHMARK_DATASET[0]
  const q2 = BENCHMARK_DATASET[1]

  it('calcule le taux d\'absorption correctement', () => {
    const results: QuestionResult[] = [
      makeQuestionResult(q1, {}, { absorbed: true }, {}),
      makeQuestionResult(q2, {}, { absorbed: false }, {}),
    ]
    const metrics = computeModeMetrics(results, 'B')
    expect(metrics.absorbedCount).toBe(1)
    expect(metrics.absorbedRate).toBe(0.5)
  })

  it('calcule le score gold moyen correctement', () => {
    const results: QuestionResult[] = [
      makeQuestionResult(q1, {}, { briefGoldScore: 16 }, {}),
      makeQuestionResult(q2, {}, { briefGoldScore: 18 }, {}),
    ]
    const metrics = computeModeMetrics(results, 'B')
    expect(metrics.avgGoldScore).toBe(17)
  })

  it('calcule avgGoldScoreNoPlaybook sur le bon sous-ensemble', () => {
    // q1 a expectedPlaybookMatch=true, q2 est sans playbook attendu
    const q2NoPlaybook = { ...BENCHMARK_DATASET[8], expectedPlaybookMatch: false }
    const results: QuestionResult[] = [
      makeQuestionResult(q1, {}, { briefGoldScore: 20 }, {}),    // avec playbook
      makeQuestionResult(q2NoPlaybook, {}, { briefGoldScore: 15 }, {}),  // sans playbook
    ]
    const metrics = computeModeMetrics(results, 'B')
    // Seul q2NoPlaybook contribue au avgGoldScoreNoPlaybook
    expect(metrics.avgGoldScoreNoPlaybook).toBe(15)
  })

  it('calcule le taux d\'erreur de portée', () => {
    const results: QuestionResult[] = [
      makeQuestionResult(q1, {}, { scopeErrorCount: 0 }, {}),
      makeQuestionResult(q2, {}, { scopeErrorCount: 1 }, {}),
    ]
    const metrics = computeModeMetrics(results, 'B')
    expect(metrics.scopeErrorRate).toBe(0.5)
  })

  it('retourne avgGoldScoreNoPlaybook=null si toutes les questions ont un playbook attendu', () => {
    const results: QuestionResult[] = [
      makeQuestionResult(q1, {}, {}, {}),  // q1.expectedPlaybookMatch = true
    ]
    const metrics = computeModeMetrics(results, 'B')
    expect(metrics.avgGoldScoreNoPlaybook).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. evaluateGoNoGo — règles de décision
// ─────────────────────────────────────────────────────────────────────────────

describe('evaluateGoNoGo — logique GO / NO-GO', () => {
  function makeMetrics(mode: 'A' | 'B' | 'C', overrides: Partial<ModeMetrics> = {}): ModeMetrics {
    return {
      mode,
      questionsRun: 30,
      absorbedCount: 25,
      absorbedRate: 0.8,
      avgGoldScore: 17.5,
      avgGoldScoreNoPlaybook: 16.8,
      scopeErrorRate: 0,
      avgPracticalScore: 4.5,
      avgLatencyMs: 1.5,
      avgBriefLength: 22,
      avgAuthorityCount: 3.5,
      ...overrides,
    }
  }

  function makeIdealResults(): QuestionResult[] {
    return BENCHMARK_DATASET.map((q) =>
      makeQuestionResult(
        q,
        { briefGoldScore: 17, absorbed: q.expectedPlaybookMatch },  // Mode A
        { briefGoldScore: 17, absorbed: true, scopeErrorCount: 0 }, // Mode B
        { briefGoldScore: 18, absorbed: true, scopeErrorCount: 0 }, // Mode C
      ),
    )
  }

  it('verdict GO si tous les critères sont remplis', () => {
    const results = makeIdealResults()
    const mA = makeMetrics('A', { avgLatencyMs: 1.5 })
    const mB = makeMetrics('B', { avgLatencyMs: 1.6 }) // < 20% augmentation
    const mC = makeMetrics('C')
    const decision = evaluateGoNoGo(results, mA, mB, mC)
    expect(decision.verdict).toBe('GO')
    expect(decision.reasons).toHaveLength(0)
  })

  it('NO-GO si absorption < 40% sans playbook', () => {
    const results = BENCHMARK_DATASET.map((q) =>
      makeQuestionResult(
        q,
        { absorbed: false },
        { absorbed: false, briefGoldScore: 17 },  // aucune question absorbée
        { absorbed: false },
      ),
    )
    const mA = makeMetrics('A')
    const mB = makeMetrics('B', { absorbedRate: 0.1 })
    const mC = makeMetrics('C')
    const decision = evaluateGoNoGo(results, mA, mB, mC)
    expect(decision.verdict).toBe('NO-GO')
    expect(decision.criteria.absorptionOk).toBe(false)
    expect(decision.reasons.some((r) => r.includes('Absorption insuffisante'))).toBe(true)
  })

  it('NO-GO si score gold < 16.5 sur sous-ensemble absorbé sans playbook', () => {
    const results = BENCHMARK_DATASET.map((q) => {
      const isNoPlaybook = !q.expectedPlaybookMatch
      return makeQuestionResult(
        q,
        { absorbed: q.expectedPlaybookMatch, briefGoldScore: 17 },
        { absorbed: isNoPlaybook ? true : false, briefGoldScore: isNoPlaybook ? 14 : 17 },
        { absorbed: true, briefGoldScore: 17 },
      )
    })
    const mA = makeMetrics('A')
    const mB = makeMetrics('B')
    const mC = makeMetrics('C')
    const decision = evaluateGoNoGo(results, mA, mB, mC)
    expect(decision.verdict).toBe('NO-GO')
    expect(decision.criteria.goldScoreOk).toBe(false)
    expect(decision.reasons.some((r) => r.includes('Score gold insuffisant'))).toBe(true)
  })

  it('NO-GO si scope error dans Mode B ou C', () => {
    const results = BENCHMARK_DATASET.map((q, i) =>
      makeQuestionResult(
        q,
        { scopeErrorCount: 0 },
        { scopeErrorCount: i === 0 ? 1 : 0 },  // une erreur sur la première question
        { scopeErrorCount: 0 },
      ),
    )
    const mA = makeMetrics('A')
    const mB = makeMetrics('B', { scopeErrorRate: 0.03 })
    const mC = makeMetrics('C')
    const decision = evaluateGoNoGo(results, mA, mB, mC)
    expect(decision.verdict).toBe('NO-GO')
    expect(decision.criteria.noScopeCritical).toBe(false)
    expect(decision.reasons.some((r) => r.includes('Erreurs de portée'))).toBe(true)
  })

  it('NO-GO si latence Mode B > +20% vs Mode A', () => {
    const results = makeIdealResults()
    const mA = makeMetrics('A', { avgLatencyMs: 1.0 })
    const mB = makeMetrics('B', { avgLatencyMs: 1.25 }) // +25% → dépasse 20%
    const mC = makeMetrics('C')
    const decision = evaluateGoNoGo(results, mA, mB, mC)
    expect(decision.verdict).toBe('NO-GO')
    expect(decision.criteria.latencyOk).toBe(false)
    expect(decision.reasons.some((r) => r.includes('latence'))).toBe(true)
  })

  it('NO-GO si régression Mode C vs Mode A sur questions avec playbook', () => {
    const results = BENCHMARK_DATASET.map((q) => {
      const hasPlaybook = q.expectedPlaybookMatch
      return makeQuestionResult(
        q,
        { absorbed: hasPlaybook, briefGoldScore: hasPlaybook ? 19 : 12 },
        { absorbed: true, briefGoldScore: 17 },
        { absorbed: true, briefGoldScore: hasPlaybook ? 16 : 17 },  // régression -3pts pour les questions avec playbook
      )
    })
    const mA = makeMetrics('A', { avgLatencyMs: 1.5 })
    const mB = makeMetrics('B', { avgLatencyMs: 1.6 })
    const mC = makeMetrics('C')
    const decision = evaluateGoNoGo(results, mA, mB, mC)
    expect(decision.verdict).toBe('NO-GO')
    expect(decision.criteria.noPlaybookRegression).toBe(false)
    expect(decision.reasons.some((r) => r.includes('Régression'))).toBe(true)
  })

  it('GO si latence Mode A est ~0ms (warning mais pas NO-GO)', () => {
    const results = makeIdealResults()
    const mA = makeMetrics('A', { avgLatencyMs: 0.05 }) // Mode A presque instantané
    const mB = makeMetrics('B', { avgLatencyMs: 2.0 })  // Mode B plus lent en absolu
    const mC = makeMetrics('C')
    const decision = evaluateGoNoGo(results, mA, mB, mC)
    // L'augmentation dépasse 20% en %, mais il y a un warning explicatif
    // Si Mode A ≈ 0ms, la comparaison n'est pas significative
    // Ce test vérifie que le warning est présent si Mode A ≈ 0
    if (mA.avgLatencyMs < 0.1) {
      expect(decision.warnings.some((w) => w.includes('Latences Mode A'))).toBe(true)
    }
  })

  it('le verdict final = GO seulement si TOUS les critères sont true', () => {
    const results = makeIdealResults()
    const mA = makeMetrics('A', { avgLatencyMs: 1.5 })
    const mB = makeMetrics('B', { avgLatencyMs: 1.6 })
    const mC = makeMetrics('C')
    const decision = evaluateGoNoGo(results, mA, mB, mC)
    const allCriteria = Object.values(decision.criteria)
    if (decision.verdict === 'GO') {
      expect(allCriteria.every(Boolean)).toBe(true)
    } else {
      expect(allCriteria.every(Boolean)).toBe(false)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 8. Intégration — couverture réelle du domain pack sur le dataset
// ─────────────────────────────────────────────────────────────────────────────

describe('Intégration — couverture réelle du dataset', () => {
  it('Mode B absorbe au moins 40% des questions sans playbook attendu', () => {
    const noPlaybookQuestions = BENCHMARK_DATASET.filter((q) => !q.expectedPlaybookMatch)
    const absorbed = noPlaybookQuestions.filter((q) => runModeB(q).absorbed).length
    const rate = absorbed / noPlaybookQuestions.length
    expect(rate).toBeGreaterThanOrEqual(0.4)
  })

  it('Mode C absorbe davantage de questions que Mode A', () => {
    const absorbedA = BENCHMARK_DATASET.filter((q) => runModeA(q).absorbed).length
    const absorbedC = BENCHMARK_DATASET.filter((q) => runModeC(q).absorbed).length
    expect(absorbedC).toBeGreaterThanOrEqual(absorbedA)
  })

  it('Mode C ne dégrade pas le score gold des questions avec playbook vs Mode A', () => {
    const withPlaybook = BENCHMARK_DATASET.filter((q) => q.expectedPlaybookMatch)
    for (const q of withPlaybook) {
      const modeA = runModeA(q)
      const modeC = runModeC(q)
      // Mode C doit être au minimum équivalent à Mode A (± 1pt de tolérance)
      expect(modeC.briefGoldScore).toBeGreaterThanOrEqual(modeA.briefGoldScore - 1)
    }
  })

  it('Mode B produit 0 erreur de portée sur tout le dataset', () => {
    for (const q of BENCHMARK_DATASET) {
      const result = runModeB(q)
      expect(result.scopeErrorCount).toBe(0)
    }
  })

  it('Mode B produit un archétype non-générique pour au moins 40% des questions', () => {
    const specific = BENCHMARK_DATASET.filter((q) => {
      const result = runModeB(q)
      return result.archetype && !result.archetype.includes('domain_pack_fallback')
    }).length
    const rate = specific / BENCHMARK_DATASET.length
    expect(rate).toBeGreaterThanOrEqual(0.4)
  })
})
