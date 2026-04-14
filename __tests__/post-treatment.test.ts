// __tests__/post-treatment.test.ts
// Tests unitaires du pipeline de tags fermés [J1][A1].
// Lancer : npx vitest run __tests__/post-treatment.test.ts

import { describe, it, expect } from 'vitest'
import {
  buildTaggedLiveCases,
  validateUsedCaseTags,
  stripUnauthorizedCaseNumbers,
  injectRealCaseCitations,
  buildTaggedArticles,
  validateUsedArticleTags,
  injectRealArticleCitations,
  findFreeFormArticleCitations,
  stripUnauthorizedArticleCitations,
  optionallyDowngradeUnsupportedNormativeClaims,
  detectNormativeDensity,
  NORMATIVE_DENSITY_HIGH,
  type TaggedCase,
  type TaggedArticle,
} from '@/lib/post-treatment'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const LIVE_CASES = [
  { court: 'cass' as const, date: '12 mars 2020', number: '19-14.531', holding: 'Le vendeur est tenu de la garantie des vices cachés.', url: 'https://judilibre.io/1' },
  { court: 'ca' as const,   date: '5 mai 2021',   number: '20/01234',  holding: 'La clause résolutoire est acquise dès le commandement.' },
  { court: 'cass' as const, date: '8 janvier 2022', number: '21-10.789', holding: 'Le délai de préavis court à compter de la réception.' },
]

const CHUNKS = [
  { sourceLaw: 'loi n° 89-462', sourceArticle: '24', sourceUrl: 'https://legifrance.fr/a1' },
  { sourceLaw: 'loi n° 89-462', sourceArticle: '24', sourceUrl: 'https://legifrance.fr/a1' }, // doublon
  { sourceLaw: 'Code civil',    sourceArticle: '1641', sourceUrl: null },
  { sourceLaw: 'Code civil',    sourceArticle: '215',  sourceUrl: null },
  { sourceLaw: 'loi n° 65-557', sourceArticle: '10',   sourceUrl: 'https://legifrance.fr/a2' },
  { sourceLaw: 'Code civil',    sourceArticle: '1641', sourceUrl: null }, // doublon
]

// ── Orphan tag [A116] — régression ───────────────────────────────────────────

describe('injectRealArticleCitations — tag orphelin', () => {
  it('[A116] est remplacé par [article non autorisé]', () => {
    const tagged: TaggedArticle[] = [
      { tag: 'A1', title: 'Art. 5 — loi 78-17', sourceLaw: 'loi 78-17', sourceArticle: '5' },
    ]
    // Le LLM a écrit [A116] en confondant article 116 et tag A116
    const text = 'Selon [A1] et également [A116] du règlement...'
    const result = injectRealArticleCitations(text, tagged)
    expect(result).toContain('Art. 5 — loi 78-17')
    expect(result).toContain('[article non autorisé]')
    expect(result).not.toContain('[A116]')
  })

  it('les tags [A1] à [A5] valides sont tous remplacés correctement', () => {
    const tagged: TaggedArticle[] = Array.from({ length: 5 }, (_, i) => ({
      tag: `A${i + 1}`,
      title: `Art. ${i + 1} — loi test`,
      sourceLaw: 'loi test',
      sourceArticle: `${i + 1}`,
    }))
    const text = '[A1] [A2] [A3] [A4] [A5] [A6]'
    const result = injectRealArticleCitations(text, tagged)
    expect(result).not.toContain('[A1]')
    expect(result).not.toContain('[A5]')
    expect(result).toContain('[article non autorisé]') // [A6] orphelin
  })
})

// ── buildTaggedLiveCases ──────────────────────────────────────────────────────

describe('buildTaggedLiveCases', () => {
  it('should assign J1, J2, J3 in order', () => {
    const tagged = buildTaggedLiveCases(LIVE_CASES)
    expect(tagged).toHaveLength(3)
    expect(tagged[0].tag).toBe('J1')
    expect(tagged[1].tag).toBe('J2')
    expect(tagged[2].tag).toBe('J3')
  })

  it('should preserve all fields', () => {
    const tagged = buildTaggedLiveCases(LIVE_CASES)
    expect(tagged[0].court).toBe('cass')
    expect(tagged[0].number).toBe('19-14.531')
    expect(tagged[0].url).toBe('https://judilibre.io/1')
    expect(tagged[1].url).toBeUndefined()
  })

  it('should return empty array for empty input', () => {
    expect(buildTaggedLiveCases([])).toEqual([])
  })
})

// ── stripUnauthorizedCaseNumbers ──────────────────────────────────────────────

describe('stripUnauthorizedCaseNumbers', () => {
  it('should remove free-form case numbers (n° XX-XX.XXX)', () => {
    const text = 'Selon Cass. civ. 3e, 12 mars 2020, n° 19-14.531, le vendeur est responsable.'
    const { cleaned, removed } = stripUnauthorizedCaseNumbers(text)
    expect(removed).toHaveLength(1)
    expect(removed[0]).toContain('19-14.531')
    expect(cleaned).not.toContain('19-14.531')
  })

  it('should remove multiple free-form case numbers', () => {
    const text = 'Arrêt n° 21-10.789 et n° 20-05.432 sont pertinents.'
    const { removed } = stripUnauthorizedCaseNumbers(text)
    expect(removed).toHaveLength(2)
  })

  it('should not remove authorized tag references [J1]', () => {
    const text = 'Voir [J1] et [J2] pour le délai.'
    const { cleaned, removed } = stripUnauthorizedCaseNumbers(text)
    expect(removed).toHaveLength(0)
    expect(cleaned).toContain('[J1]')
    expect(cleaned).toContain('[J2]')
  })

  it('should return empty removed array when no free numbers', () => {
    const text = 'La loi n° 89-462 du 6 juillet 1989 s\'applique.'
    // Loi ≠ arrêt : le pattern cible XX-XX.XXX (point décimal obligatoire)
    const { removed } = stripUnauthorizedCaseNumbers(text)
    // "89-462" n'a pas de point → ne doit PAS être supprimé
    expect(removed).toHaveLength(0)
  })
})

// ── validateUsedCaseTags ──────────────────────────────────────────────────────

describe('validateUsedCaseTags', () => {
  it('should return only the allowed tags that are used', () => {
    const text = 'Voir [J1] et [J3] sur ce point. [J5] est inconnu.'
    const result = validateUsedCaseTags(text, ['J1', 'J2', 'J3'])
    expect(result).toContain('J1')
    expect(result).toContain('J3')
    expect(result).not.toContain('J2') // non utilisé
    expect(result).not.toContain('J5') // non autorisé
  })

  it('should deduplicate tags', () => {
    const text = '[J1] est cité ici et encore [J1] plus loin.'
    const result = validateUsedCaseTags(text, ['J1'])
    expect(result).toHaveLength(1)
  })
})

// ── injectRealCaseCitations ───────────────────────────────────────────────────

describe('injectRealCaseCitations', () => {
  it('should replace [J1] with the real Cass. citation', () => {
    const taggedCases = buildTaggedLiveCases(LIVE_CASES)
    const text = 'Selon la jurisprudence [J1], le vendeur est tenu.'
    const result = injectRealCaseCitations(text, taggedCases)
    expect(result).toContain('Cass. 12 mars 2020, n° 19-14.531')
    expect(result).not.toContain('[J1]')
  })

  it('should replace [J2] with the real CA citation', () => {
    const taggedCases = buildTaggedLiveCases(LIVE_CASES)
    const text = 'La clause est acquise ([J2]).'
    const result = injectRealCaseCitations(text, taggedCases)
    expect(result).toContain('CA 5 mai 2021, n° 20/01234')
  })

  it('should add a link when url is present', () => {
    const taggedCases = buildTaggedLiveCases(LIVE_CASES)
    const text = '[J1]'
    const result = injectRealCaseCitations(text, taggedCases)
    expect(result).toContain('https://judilibre.io/1')
    expect(result).toMatch(/\[.+\]\(https:\/\//)
  })

  it('should replace unknown tags with [arrêt non autorisé]', () => {
    const taggedCases = buildTaggedLiveCases(LIVE_CASES)
    const text = 'Voir [J9] pour détail.'
    const result = injectRealCaseCitations(text, taggedCases)
    expect(result).toContain('[arrêt non autorisé]')
    expect(result).not.toContain('[J9]')
  })

  it('should handle empty taggedCases', () => {
    const text = 'Voir [J1].'
    const result = injectRealCaseCitations(text, [])
    expect(result).toContain('[arrêt non autorisé]')
  })
})

// ── buildTaggedArticles ───────────────────────────────────────────────────────

describe('buildTaggedArticles', () => {
  it('should deduplicate article references', () => {
    const tagged = buildTaggedArticles(CHUNKS)
    // loi 89-462 art.24 apparaît 2 fois, Code civil 1641 apparaît 2 fois
    const keys = tagged.map(a => `${a.sourceLaw}|${a.sourceArticle}`)
    const unique = [...new Set(keys)]
    expect(keys).toEqual(unique)
  })

  it('should assign A1, A2, A3 in order', () => {
    const tagged = buildTaggedArticles(CHUNKS)
    expect(tagged[0].tag).toBe('A1')
    expect(tagged[1].tag).toBe('A2')
    expect(tagged[2].tag).toBe('A3')
  })

  it('should cap at 5 articles', () => {
    const manyChunks = Array.from({ length: 10 }, (_, i) => ({
      sourceLaw: `loi n° ${i}`,
      sourceArticle: String(i),
      sourceUrl: null,
    }))
    const tagged = buildTaggedArticles(manyChunks)
    expect(tagged.length).toBeLessThanOrEqual(5)
  })

  it('should build a readable title', () => {
    const tagged = buildTaggedArticles(CHUNKS)
    expect(tagged[0].title).toBe('Art. 24 — loi n° 89-462')
    expect(tagged[1].title).toBe('Art. 1641 — Code civil')
  })

  it('should use sourceLaw as title when sourceArticle is empty', () => {
    const tagged = buildTaggedArticles([
      { sourceLaw: 'Loi Hoguet', sourceArticle: '', sourceUrl: null },
    ])
    expect(tagged[0].title).toBe('Loi Hoguet')
  })
})

// ── validateUsedArticleTags ───────────────────────────────────────────────────

describe('validateUsedArticleTags', () => {
  it('should return only the allowed article tags that are used', () => {
    const text = 'Selon [A1] et [A3], le bailleur doit notifier. [A9] est hors liste.'
    const result = validateUsedArticleTags(text, ['A1', 'A2', 'A3'])
    expect(result).toContain('A1')
    expect(result).toContain('A3')
    expect(result).not.toContain('A2')
    expect(result).not.toContain('A9')
  })
})

// ── injectRealArticleCitations ────────────────────────────────────────────────

describe('injectRealArticleCitations', () => {
  it('should replace [A1] with article title', () => {
    const tagged = buildTaggedArticles(CHUNKS)
    const text = 'Voir [A1] pour les conditions.'
    const result = injectRealArticleCitations(text, tagged)
    expect(result).toContain('Art. 24 — loi n° 89-462')
    expect(result).not.toContain('[A1]')
  })

  it('should add a link when sourceUrl is present', () => {
    const tagged = buildTaggedArticles(CHUNKS)
    const text = '[A1]'
    const result = injectRealArticleCitations(text, tagged)
    expect(result).toContain('https://legifrance.fr/a1')
  })

  it('should replace unknown article tags with [article non autorisé]', () => {
    const tagged = buildTaggedArticles(CHUNKS)
    const text = 'Voir [A9].'
    const result = injectRealArticleCitations(text, tagged)
    expect(result).toContain('[article non autorisé]')
  })
})

// ── findFreeFormArticleCitations ──────────────────────────────────────────────

describe('findFreeFormArticleCitations', () => {
  it('should detect "art. L.1331-8 du Code de la santé publique"', () => {
    const text = 'Le raccordement est prévu par art. L.1331-8 du Code de la santé publique.'
    const found = findFreeFormArticleCitations(text)
    expect(found.length).toBeGreaterThanOrEqual(1)
    expect(found[0].article).toBe('L.1331-8')
  })

  it('should detect "article 1641 du Code civil"', () => {
    const text = 'Selon article 1641 du Code civil, le vendeur est tenu.'
    const found = findFreeFormArticleCitations(text)
    expect(found.length).toBeGreaterThanOrEqual(1)
    expect(found[0].article).toBe('1641')
  })

  it('should detect "l\'art. 215"', () => {
    const text = "L'art. 215 du Code civil protège le logement familial."
    const found = findFreeFormArticleCitations(text)
    expect(found.length).toBeGreaterThanOrEqual(1)
    expect(found[0].article).toMatch(/215/)
  })

  it('should detect "art. R.123-4"', () => {
    const text = 'Conformément à art. R.123-4 du Code de l\'urbanisme.'
    const found = findFreeFormArticleCitations(text)
    expect(found.length).toBeGreaterThanOrEqual(1)
    expect(found[0].article).toBe('R.123-4')
  })

  it('should NOT detect authorized tags [A1][A2]', () => {
    const text = 'Selon [A1] et [A2], le bailleur doit notifier.'
    const found = findFreeFormArticleCitations(text)
    expect(found.length).toBe(0)
  })

  it('should NOT detect law numbers like "loi n° 89-462"', () => {
    // "loi n° 89-462" n'est pas précédé de "art."
    const text = 'La loi n° 89-462 du 6 juillet 1989 s\'applique.'
    const found = findFreeFormArticleCitations(text)
    expect(found.length).toBe(0)
  })

  it('should return empty array when no citations', () => {
    const text = 'Le bailleur doit respecter ses obligations.'
    const found = findFreeFormArticleCitations(text)
    expect(found).toHaveLength(0)
  })
})

// ── stripUnauthorizedArticleCitations ────────────────────────────────────────

describe('stripUnauthorizedArticleCitations', () => {
  it('should replace free citations with "la règle applicable" when tags exist', () => {
    const text = 'Le raccordement est prévu par art. L.1331-8 du Code de la santé publique.'
    const { cleaned, found } = stripUnauthorizedArticleCitations(text, ['A1', 'A2'])
    expect(found.length).toBeGreaterThanOrEqual(1)
    expect(cleaned).toContain('la règle applicable')
    expect(cleaned).not.toContain('L.1331-8')
  })

  it('should not modify text when allowedArticleTags is empty (mode libre)', () => {
    const text = 'Selon art. 1641 du Code civil, le vendeur est responsable.'
    const { cleaned, found } = stripUnauthorizedArticleCitations(text, [])
    expect(cleaned).toBe(text)
    expect(found.length).toBeGreaterThanOrEqual(1) // détectées mais pas supprimées
  })

  it('should handle text with no free citations gracefully', () => {
    const text = 'Selon [A1], le bailleur est tenu de restituer le dépôt.'
    const { cleaned, found } = stripUnauthorizedArticleCitations(text, ['A1'])
    expect(found).toHaveLength(0)
    expect(cleaned).toBe(text)
  })

  it('should strip multiple free citations in one pass', () => {
    const text = 'Voir art. 215 du Code civil et article 1641 du Code civil.'
    const { cleaned, found } = stripUnauthorizedArticleCitations(text, ['A1'])
    expect(found.length).toBeGreaterThanOrEqual(2)
    expect(cleaned.match(/la règle applicable/g)?.length).toBeGreaterThanOrEqual(2)
  })
})

// ── optionallyDowngradeUnsupportedNormativeClaims ─────────────────────────────

describe('optionallyDowngradeUnsupportedNormativeClaims', () => {
  it('should soften "est obligatoire"', () => {
    const text = 'Le raccordement est obligatoire pour tout logement.'
    const result = optionallyDowngradeUnsupportedNormativeClaims(text)
    expect(result).toContain('est en principe obligatoire')
    expect(result).not.toMatch(/\best obligatoire\b/)
  })

  it('should soften "est interdit"', () => {
    const text = 'Couper l\'eau est interdit sans décision judiciaire.'
    const result = optionallyDowngradeUnsupportedNormativeClaims(text)
    expect(result).toContain('pourrait être interdit')
  })

  it('should soften "est nulle"', () => {
    const text = 'La clause est nulle de plein droit.'
    const result = optionallyDowngradeUnsupportedNormativeClaims(text)
    expect(result).toContain('pourrait être nulle')
  })

  it('should add safety footer when not already present', () => {
    const text = 'Le bailleur est tenu.'
    const result = optionallyDowngradeUnsupportedNormativeClaims(text)
    expect(result).toContain('Sources limitées')
  })

  it('should not add duplicate footer if already present', () => {
    const text = 'Test. Sources limitées pour cette question.'
    const result = optionallyDowngradeUnsupportedNormativeClaims(text)
    const footerCount = (result.match(/Sources limitées/g) ?? []).length
    expect(footerCount).toBe(1)
  })
})

// ── detectNormativeDensity ─────────────────────────────────────────────────────

describe('detectNormativeDensity', () => {
  it('should return score 0 for neutral text', () => {
    const text = 'L\'agent immobilier accompagne le vendeur dans sa démarche.'
    const { score } = detectNormativeDensity(text)
    expect(score).toBe(0)
  })

  it('should count distinct pattern types, not occurrences', () => {
    // "doit" apparaît 3 fois mais ne doit compter que pour 1 point
    const text = 'Il doit signer. Il doit payer. Il doit notifier.'
    const { score, patterns } = detectNormativeDensity(text)
    expect(score).toBe(1)
    expect(patterns).toContain('doit')
  })

  it('should detect "est_obligatoire"', () => {
    const text = 'Le raccordement est obligatoire pour tout logement.'
    const { patterns } = detectNormativeDensity(text)
    expect(patterns).toContain('est_obligatoire')
  })

  it('should detect "est_interdit"', () => {
    const text = 'Couper l\'eau est interdit.'
    const { patterns } = detectNormativeDensity(text)
    expect(patterns).toContain('est_interdit')
  })

  it('should detect "s_expose_a"', () => {
    const text = 'Le bailleur s\'expose à des sanctions.'
    const { patterns } = detectNormativeDensity(text)
    expect(patterns).toContain('s_expose_a')
  })

  it('should reach HIGH threshold on a very assertive response', () => {
    const text = [
      'Le vendeur doit déclarer tous les vices cachés.',
      'Cette obligation est obligatoire sous peine de nullité.',
      'Toute clause contraire est interdite.',
      'Le professionnel s\'expose à des dommages-intérêts.',
      'Le locataire est tenu de restituer le bien en bon état.',
    ].join(' ')
    const { score } = detectNormativeDensity(text)
    expect(score).toBeGreaterThanOrEqual(NORMATIVE_DENSITY_HIGH)
  })

  it('should stay below threshold on a prudent response', () => {
    const text = [
      'Cette situation pourrait relever du régime de la garantie.',
      'Il semble que la règle applicable soit favorable à l\'acquéreur.',
      'À vérifier selon la situation et le texte applicable.',
    ].join(' ')
    const { score } = detectNormativeDensity(text)
    expect(score).toBeLessThan(NORMATIVE_DENSITY_HIGH)
  })
})

// ── Safety mode — logique de déclenchement ────────────────────────────────────
// Tests de la logique composite (reconstruite ici sans appeler route.ts)

describe('safety mode trigger logic', () => {
  function computeSafetyMode(opts: {
    taggedArticlesCount: number
    filteredPgJuriCount: number
    liveJuriCount: number
    freeArticleCitationsCount: number
    responseText: string
  }) {
    const noArticleGrounding = opts.taggedArticlesCount === 0
    const lowJuriSupport = opts.filteredPgJuriCount === 0 && opts.liveJuriCount <= 1
    const lowGrounding = noArticleGrounding || lowJuriSupport
    const { score } = detectNormativeDensity(opts.responseText)
    const highNormativeDensity = score >= NORMATIVE_DENSITY_HIGH

    const reasons: string[] = []
    if (noArticleGrounding)                     reasons.push('no_article_grounding')
    if (opts.freeArticleCitationsCount > 0)     reasons.push('free_article_citations')
    if (lowJuriSupport)                         reasons.push('low_jurisprudence_support')
    if (highNormativeDensity)                   reasons.push('high_normative_density')

    const active =
      noArticleGrounding ||
      (lowJuriSupport && opts.freeArticleCitationsCount > 0) ||
      (lowGrounding && highNormativeDensity)

    return { active, reasons }
  }

  const ASSERTIVE_TEXT = [
    'Le vendeur doit déclarer les vices.',
    'Le raccordement est obligatoire.',
    'Cette clause est interdite.',
    'Le bailleur s\'expose à une amende.',
    'Le locataire est tenu de restituer.',
  ].join(' ')

  it('should activate when no article grounding (chunks=0)', () => {
    const { active, reasons } = computeSafetyMode({
      taggedArticlesCount: 0,
      filteredPgJuriCount: 2,
      liveJuriCount: 3,
      freeArticleCitationsCount: 0,
      responseText: 'Réponse prudente.',
    })
    expect(active).toBe(true)
    expect(reasons).toContain('no_article_grounding')
  })

  it('should activate when low juri support + free article citations', () => {
    const { active, reasons } = computeSafetyMode({
      taggedArticlesCount: 2,
      filteredPgJuriCount: 0,
      liveJuriCount: 1,
      freeArticleCitationsCount: 2,
      responseText: 'Texte normal.',
    })
    expect(active).toBe(true)
    expect(reasons).toContain('free_article_citations')
    expect(reasons).toContain('low_jurisprudence_support')
  })

  it('should activate when low grounding + high normative density', () => {
    const { active, reasons } = computeSafetyMode({
      taggedArticlesCount: 0,
      filteredPgJuriCount: 0,
      liveJuriCount: 0,
      freeArticleCitationsCount: 0,
      responseText: ASSERTIVE_TEXT,
    })
    expect(active).toBe(true)
    expect(reasons).toContain('high_normative_density')
  })

  it('should NOT activate when sources are good and text is prudent', () => {
    const { active } = computeSafetyMode({
      taggedArticlesCount: 3,
      filteredPgJuriCount: 2,
      liveJuriCount: 3,
      freeArticleCitationsCount: 0,
      responseText: 'Il semble que la règle soit favorable. À vérifier.',
    })
    expect(active).toBe(false)
  })

  it('should collect multiple reasons when several signals fire', () => {
    const { reasons } = computeSafetyMode({
      taggedArticlesCount: 0,
      filteredPgJuriCount: 0,
      liveJuriCount: 0,
      freeArticleCitationsCount: 2,
      responseText: ASSERTIVE_TEXT,
    })
    expect(reasons.length).toBeGreaterThanOrEqual(3)
    expect(reasons).toContain('no_article_grounding')
    expect(reasons).toContain('free_article_citations')
    expect(reasons).toContain('high_normative_density')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// P3 — V2 stripUnauthorizedArticleCitations : patterns contextuels
// Phrases réelles issues des logs de production
// ─────────────────────────────────────────────────────────────────────────────

describe('stripUnauthorizedArticleCitations — V2 patterns contextuels', () => {

  const TAGS = ['A1', 'A2']  // tags actifs → mode strict

  it('P1 — bloc parenthétique "(Art. 24 loi 89-462)" supprimé', () => {
    const { cleaned } = stripUnauthorizedArticleCitations(
      'La clause résolutoire joue (Art. 24 loi 89-462) dès le commandement.',
      TAGS,
    )
    expect(cleaned).not.toMatch(/Art\.\s*24/)
    expect(cleaned).toContain('La clause résolutoire joue')
    expect(cleaned).toContain('dès le commandement')
  })

  it('P1 — bloc parenthétique ne laisse pas de parenthèses vides', () => {
    const { cleaned } = stripUnauthorizedArticleCitations(
      'La servitude est légale (art. 682 du Code civil).',
      TAGS,
    )
    expect(cleaned).not.toMatch(/\(\s*\)/)
    expect(cleaned).not.toMatch(/art\.\s*682/i)
  })

  it('P2 — lien markdown "[Art. X](url)" remplacé par "la règle applicable"', () => {
    const { cleaned } = stripUnauthorizedArticleCitations(
      'Selon [Art. 24 de la loi 89-462](https://example.com/art24), la procédure est obligatoire.',
      TAGS,
    )
    expect(cleaned).not.toMatch(/Art\.\s*24/)
    expect(cleaned).toContain('la règle applicable')
    // Ne doit pas laisser de lien markdown brisé
    expect(cleaned).not.toMatch(/\]\(https?:/)
  })

  it('P2 — lien markdown brisé "[la disposition applicable traverse..." ne doit pas apparaître', () => {
    // Régression : "[Art. X traverse une habitation](url)" ne doit pas devenir
    // "[la disposition applicable traverse une habitation](...)"
    const { cleaned } = stripUnauthorizedArticleCitations(
      'La servitude [art. 682 du Code civil traverse une habitation](https://example.com) est légale.',
      TAGS,
    )
    // Pas de fragment de lien markdown brisé
    expect(cleaned).not.toMatch(/\[la disposition applicable/)
    expect(cleaned).not.toMatch(/\]\(https?:/)
  })

  it('P3 — "selon l\'art. X" → "selon la règle applicable"', () => {
    const { cleaned } = stripUnauthorizedArticleCitations(
      'Le bailleur peut résilier selon l\'art. 24 de la loi 89-462 le bail.',
      TAGS,
    )
    expect(cleaned).not.toMatch(/art\.\s*24/i)
    expect(cleaned).toContain('selon la règle applicable')
  })

  it('P3 — "conformément à l\'art. X" → "conformément à la règle applicable"', () => {
    const { cleaned } = stripUnauthorizedArticleCitations(
      'L\'expulsion est prononcée conformément à l\'art. L412-6 du CPCE.',
      TAGS,
    )
    expect(cleaned).not.toMatch(/art\.\s*L412/i)
    expect(cleaned).toContain('conformément à la règle applicable')
  })

  it('P4 — "l\'art. X prévoit que" → "la règle applicable prévoit que"', () => {
    const { cleaned } = stripUnauthorizedArticleCitations(
      'L\'art. 1641 du Code civil prévoit que le vendeur répond des vices cachés.',
      TAGS,
    )
    expect(cleaned).not.toMatch(/art\.\s*1641/i)
    expect(cleaned).toContain('la règle applicable prévoit')
    // Pas de sortie brisée type "la disposition applicable suivre"
    expect(cleaned).not.toMatch(/applicable\s+(?:suivre|traverse|dispose\b)/i)
  })

  it('P4 — "l\'art. X dispose que" → "la règle applicable dispose que"', () => {
    const { cleaned } = stripUnauthorizedArticleCitations(
      'L\'art. 1738 CC dispose que le bail peut être tacitement reconduit.',
      TAGS,
    )
    expect(cleaned).not.toMatch(/art\.\s*1738/i)
    expect(cleaned).toContain('la règle applicable dispose')
  })

  it('P5 — fallback générique pour citation non capturée', () => {
    const { cleaned } = stripUnauthorizedArticleCitations(
      'Le vendeur est tenu par art. 1641.',
      TAGS,
    )
    expect(cleaned).not.toMatch(/art\.\s*1641/i)
    expect(cleaned).toContain('la règle applicable')
  })

  it('NO-OP si aucun tag actif (mode libre)', () => {
    const input = 'Le bailleur peut résilier selon l\'art. 24 de la loi 89-462.'
    const { cleaned } = stripUnauthorizedArticleCitations(input, [])
    expect(cleaned).toBe(input)
  })

  it('préserve les tags [A1][A2] — ne les neutralise pas', () => {
    const { cleaned } = stripUnauthorizedArticleCitations(
      'Selon [A1], la procédure est obligatoire. L\'art. 1641 s\'applique aussi.',
      TAGS,
    )
    expect(cleaned).toContain('[A1]')
    expect(cleaned).not.toMatch(/art\.\s*1641/i)
  })

})
