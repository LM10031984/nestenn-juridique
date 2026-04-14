// __tests__/legifrance-resolver.test.ts
// Tests unitaires de l'orchestration resolveLiveArticle / resolveLiveArticles / resolvedArticlesToChunks
// Lancer : npx vitest run __tests__/legifrance-resolver.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveLiveArticle, resolveLiveArticles, resolvedArticlesToChunks } from '@/lib/legifrance-resolver'

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock getAccessToken pour éviter tout appel réseau
vi.mock('@/lib/legifrance', () => ({
  getAccessToken: vi.fn().mockResolvedValue('mock-token'),
  lookupLegitext: vi.fn((law: string) => {
    const map: Record<string, string> = {
      'loi 2021-1104': 'LEGITEXT000043957598',
      'cch':           'LEGITEXT000006074096',
      '89-462':        'LEGITEXT000006069108',
    }
    return map[law] ?? map[law.toLowerCase()] ?? null
  }),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CSP_LEGITEXT = 'LEGITEXT000006072665'

// Réponse legiPart minimale avec des articles en VIGUEUR + un abrogé
const MOCK_LEGI_PART_TREE = {
  legalTexts: [{
    sections: [
      {
        articles: [],
        sections: [
          {
            articles: [
              { etat: 'VIGUEUR', num: 'L.1331-1', id: 'LEGIARTI000006685784', cid: 'LEGIARTI000006685784' },
              { etat: 'VIGUEUR', num: 'L.1331-6', id: 'LEGIARTI000006685788', cid: 'LEGIARTI000006685788' },
              { etat: 'VIGUEUR', num: 'L.1331-8', id: 'LEGIARTI000006685791', cid: 'LEGIARTI000006685791' },
              { etat: 'ABROGE',  num: 'L.1331-5', id: 'LEGIARTI000000000001', cid: 'LEGIARTI000000000001' },
            ],
            sections: [],
          },
        ],
      },
    ],
    articles: [],
  }],
}

// Réponse getArticle minimale
function makeArticleResponse(id: string, num: string, texte: string) {
  return { article: { id, num, etat: 'VIGUEUR', dateDebut: '2022-01-01', texte } }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Mock dispatch basé sur l'URL — robuste aux appels parallèles
function makeFetchMock(opts: {
  legiPart: { ok: boolean; body: unknown }
  // Clé = LEGIARTI id attendu dans le body { id }
  getArticle: Record<string, { ok: boolean; body: unknown }>
}) {
  return vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
    let responseBody: unknown
    let ok: boolean

    if ((url as string).includes('/consult/legiPart')) {
      ok = opts.legiPart.ok
      responseBody = opts.legiPart.body
    } else if ((url as string).includes('/consult/getArticle')) {
      const reqBody = JSON.parse(init.body as string) as { id: string }
      const hit = opts.getArticle[reqBody.id]
      ok = hit?.ok ?? false
      responseBody = hit?.body ?? {}
    } else {
      ok = false
      responseBody = {}
    }

    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
    }
  })
}

// ── resolveLiveArticle ────────────────────────────────────────────────────────

describe('resolveLiveArticle', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('retourne un ResolvedArticle complet sur le happy path', async () => {
    const articleTexte = 'Nul ne peut mettre en location un logement sans avoir...'
    global.fetch = makeFetchMock({
      legiPart: { ok: true, body: MOCK_LEGI_PART_TREE },
      getArticle: { 'LEGIARTI000006685784': { ok: true, body: makeArticleResponse('LEGIARTI000006685784', 'L.1331-1', articleTexte) } },
    })

    const result = await resolveLiveArticle(CSP_LEGITEXT, 'L.1331-1', 'Code de la santé publique')

    expect(result).not.toBeNull()
    expect(result!.articleNum).toBe('L.1331-1')
    expect(result!.legiartiId).toBe('LEGIARTI000006685784')
    expect(result!.lawName).toBe('Code de la santé publique')
    expect(result!.title).toBe('Art. L.1331-1 — Code de la santé publique')
    expect(result!.text).toBe(articleTexte)
    expect(result!.url).toContain('LEGIARTI000006685784')
    expect(result!.source).toBe('legiPart+getArticle')
    expect(result!.lawId).toBe(CSP_LEGITEXT)
  })

  it('utilise le lawName par défaut si non fourni', async () => {
    const texte = 'Article de test'
    global.fetch = makeFetchMock({
      legiPart: { ok: true, body: MOCK_LEGI_PART_TREE },
      getArticle: { 'LEGIARTI000006685784': { ok: true, body: makeArticleResponse('LEGIARTI000006685784', 'L.1331-1', texte) } },
    })

    const result = await resolveLiveArticle(CSP_LEGITEXT, 'L.1331-1')

    expect(result!.lawName).toBe('Texte officiel')
    expect(result!.title).toBe('Art. L.1331-1 — Texte officiel')
  })

  it('retourne null si legiPart répond HTTP 500', async () => {
    global.fetch = makeFetchMock({
      legiPart: { ok: false, body: { error: 'Internal Server Error' } },
      getArticle: {},
    })

    const result = await resolveLiveArticle(CSP_LEGITEXT, 'L.1331-1', 'Code de la santé publique')

    expect(result).toBeNull()
  })

  it('retourne null si l\'article est absent de l\'arbre legiPart', async () => {
    global.fetch = makeFetchMock({
      legiPart: { ok: true, body: MOCK_LEGI_PART_TREE },
      getArticle: {},
    })

    const result = await resolveLiveArticle(CSP_LEGITEXT, 'L.9999-99', 'Code de la santé publique')

    expect(result).toBeNull()
  })

  it('retourne null si l\'article est ABROGE dans l\'arbre', async () => {
    // L.1331-5 est ABROGE dans MOCK_LEGI_PART_TREE
    global.fetch = makeFetchMock({
      legiPart: { ok: true, body: MOCK_LEGI_PART_TREE },
      getArticle: {},
    })

    const result = await resolveLiveArticle(CSP_LEGITEXT, 'L.1331-5', 'Code de la santé publique')

    expect(result).toBeNull()
  })

  it('retourne null si getArticle répond HTTP 404', async () => {
    global.fetch = makeFetchMock({
      legiPart: { ok: true, body: MOCK_LEGI_PART_TREE },
      getArticle: { 'LEGIARTI000006685784': { ok: false, body: { error: 'Not Found' } } },
    })

    const result = await resolveLiveArticle(CSP_LEGITEXT, 'L.1331-1', 'Code de la santé publique')

    expect(result).toBeNull()
  })

  it('retourne null si le texte de l\'article est vide', async () => {
    global.fetch = makeFetchMock({
      legiPart: { ok: true, body: MOCK_LEGI_PART_TREE },
      getArticle: { 'LEGIARTI000006685784': { ok: true, body: makeArticleResponse('LEGIARTI000006685784', 'L.1331-1', '') } },
    })

    const result = await resolveLiveArticle(CSP_LEGITEXT, 'L.1331-1', 'Code de la santé publique')

    expect(result).toBeNull()
  })

  it('tronque le texte à 4000 caractères', async () => {
    const longTexte = 'A'.repeat(6000)
    global.fetch = makeFetchMock({
      legiPart: { ok: true, body: MOCK_LEGI_PART_TREE },
      getArticle: { 'LEGIARTI000006685784': { ok: true, body: makeArticleResponse('LEGIARTI000006685784', 'L.1331-1', longTexte) } },
    })

    const result = await resolveLiveArticle(CSP_LEGITEXT, 'L.1331-1', 'Code de la santé publique')

    expect(result!.text.length).toBe(4000)
  })

  it('retourne null si fetch lève une exception (réseau)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const result = await resolveLiveArticle(CSP_LEGITEXT, 'L.1331-1', 'Code de la santé publique')

    expect(result).toBeNull()
  })

  it('gère l\'arbre sans legalTexts (lois LODA)', async () => {
    // Certaines lois retournent la structure directement, sans legalTexts[]
    const flatTree = {
      sections: [{
        articles: [
          { etat: 'VIGUEUR', num: '24', id: 'LEGIARTI000029042573', cid: 'LEGIARTI000029042573' },
        ],
        sections: [],
      }],
      articles: [],
    }
    global.fetch = makeFetchMock({
      legiPart: { ok: true, body: flatTree },
      getArticle: { 'LEGIARTI000029042573': { ok: true, body: makeArticleResponse('LEGIARTI000029042573', '24', 'Le bailleur doit...') } },
    })

    const result = await resolveLiveArticle('LEGITEXT000006069108', '24', 'Loi n° 89-462')

    expect(result).not.toBeNull()
    expect(result!.articleNum).toBe('24')
    expect(result!.legiartiId).toBe('LEGIARTI000029042573')
  })
})

// ── resolveLiveArticles ───────────────────────────────────────────────────────

describe('resolveLiveArticles', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('retourne les articles résolus en parallèle', async () => {
    global.fetch = makeFetchMock({
      legiPart: { ok: true, body: MOCK_LEGI_PART_TREE },
      getArticle: {
        'LEGIARTI000006685784': { ok: true, body: makeArticleResponse('LEGIARTI000006685784', 'L.1331-1', 'Texte L.1331-1') },
        'LEGIARTI000006685791': { ok: true, body: makeArticleResponse('LEGIARTI000006685791', 'L.1331-8', 'Texte L.1331-8') },
      },
    })

    const results = await resolveLiveArticles([
      { textId: CSP_LEGITEXT, articleNum: 'L.1331-1', lawName: 'Code de la santé publique' },
      { textId: CSP_LEGITEXT, articleNum: 'L.1331-8', lawName: 'Code de la santé publique' },
    ])

    expect(results).toHaveLength(2)
    expect(results.map(r => r.articleNum)).toContain('L.1331-1')
    expect(results.map(r => r.articleNum)).toContain('L.1331-8')
  })

  it('limite à 3 articles maximum (MAX_LIVE_ARTICLES)', async () => {
    global.fetch = makeFetchMock({
      legiPart: { ok: true, body: MOCK_LEGI_PART_TREE },
      getArticle: {
        'LEGIARTI000006685784': { ok: true, body: makeArticleResponse('LEGIARTI000006685784', 'L.1331-1', 'Texte L.1331-1') },
        'LEGIARTI000006685788': { ok: true, body: makeArticleResponse('LEGIARTI000006685788', 'L.1331-6', 'Texte L.1331-6') },
        'LEGIARTI000006685791': { ok: true, body: makeArticleResponse('LEGIARTI000006685791', 'L.1331-8', 'Texte L.1331-8') },
      },
    })

    const results = await resolveLiveArticles([
      { textId: CSP_LEGITEXT, articleNum: 'L.1331-1', lawName: 'CSP' },
      { textId: CSP_LEGITEXT, articleNum: 'L.1331-6', lawName: 'CSP' },
      { textId: CSP_LEGITEXT, articleNum: 'L.1331-8', lawName: 'CSP' },
      { textId: CSP_LEGITEXT, articleNum: 'L.9999-99', lawName: 'CSP' }, // ignoré (MAX=3)
    ])

    // 4e candidat ignoré → legiPart appelé 3 fois, getArticle 3 fois = 6 calls
    expect(global.fetch).toHaveBeenCalledTimes(6)
    expect(results).toHaveLength(3)
  })

  it('retourne un tableau vide si tous les articles échouent', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('timeout'))

    const results = await resolveLiveArticles([
      { textId: CSP_LEGITEXT, articleNum: 'L.1331-1' },
    ])

    expect(results).toHaveLength(0)
  })

  it('retourne les articles partiels si certains échouent (allSettled)', async () => {
    // Article 1 : L.1331-1 → présent dans l'arbre → succès
    // Article 2 : L.9999-99 → absent de l'arbre → null (pas de getArticle appelé)
    global.fetch = makeFetchMock({
      legiPart: { ok: true, body: MOCK_LEGI_PART_TREE },
      getArticle: {
        'LEGIARTI000006685784': { ok: true, body: makeArticleResponse('LEGIARTI000006685784', 'L.1331-1', 'texte ok') },
      },
    })

    const results = await resolveLiveArticles([
      { textId: CSP_LEGITEXT, articleNum: 'L.1331-1', lawName: 'CSP' },
      { textId: CSP_LEGITEXT, articleNum: 'L.9999-99', lawName: 'CSP' },
    ])

    expect(results).toHaveLength(1)
    expect(results[0].articleNum).toBe('L.1331-1')
  })

  it('retourne tableau vide sur liste vide', async () => {
    global.fetch = vi.fn()
    const results = await resolveLiveArticles([])
    expect(results).toHaveLength(0)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('retourne tableau vide quand fetch lève AbortError (timeout simulé)', async () => {
    // Simule le cas environnement_immo : legiPart timeout sur les articles SPANC
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    global.fetch = vi.fn().mockRejectedValue(abortError)

    const results = await resolveLiveArticles([
      { textId: 'LEGITEXT000006074096', articleNum: 'L.2224-8', lawName: 'Code général des collectivités territoriales' },
      { textId: 'LEGITEXT000006074096', articleNum: 'L.2224-9', lawName: 'Code général des collectivités territoriales' },
    ])

    // Tous les articles doivent échouer silencieusement (Promise.allSettled)
    expect(results).toHaveLength(0)
  })
})

// ── fallback-critical-mode : logique de détection d'échec ─────────────────────

describe('détection fallback-critical-mode (environnement_immo / SPANC)', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => { originalFetch = global.fetch })
  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('retourne 0 articles quand tous les candidats échouent avec AbortError', async () => {
    // Scénario réel : legiPart timeout sur les articles SPANC (Art. L.2224-8/9 CGCT)
    global.fetch = vi.fn().mockRejectedValue(
      new DOMException('The operation was aborted.', 'AbortError')
    )

    const SPANC_CANDIDATES = [
      { textId: 'LEGITEXT000006074096', articleNum: 'L.2224-8', lawName: 'CGCT' },
      { textId: 'LEGITEXT000006074096', articleNum: 'L.2224-9', lawName: 'CGCT' },
      { textId: 'LEGITEXT000006074096', articleNum: 'L.2224-10', lawName: 'CGCT' },
    ]

    const resolved = await resolveLiveArticles(SPANC_CANDIDATES)

    // Aucun article résolu → le pipeline doit activer fallback-critical-mode
    expect(resolved).toHaveLength(0)

    // Tous les candidats ont été tentés (legiPart appelé pour chacun)
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  it('ne retourne pas d\'articles résolus quand legiPart répond 503 sur tous les candidats', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'Service Unavailable' }),
      text: async () => 'Service Unavailable',
    })

    const resolved = await resolveLiveArticles([
      { textId: 'LEGITEXT000006074096', articleNum: 'L.2224-8', lawName: 'CGCT' },
    ])

    expect(resolved).toHaveLength(0)
  })
})

// ── resolvedArticlesToChunks ──────────────────────────────────────────────────

describe('resolvedArticlesToChunks', () => {
  const RESOLVED: import('@/lib/legifrance-resolver').ResolvedArticle[] = [
    {
      lawId: CSP_LEGITEXT,
      articleNum: 'L.1331-1',
      legiartiId: 'LEGIARTI000006685784',
      lawName: 'Code de la santé publique',
      title: 'Art. L.1331-1 — Code de la santé publique',
      text: 'Nul ne peut mettre en location un logement sans avoir...',
      url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006685784',
      source: 'legiPart+getArticle',
    },
    {
      lawId: CSP_LEGITEXT,
      articleNum: 'L.1331-8',
      legiartiId: 'LEGIARTI000006685791',
      lawName: 'Code de la santé publique',
      title: 'Art. L.1331-8 — Code de la santé publique',
      text: 'Les locaux utilisés à usage d\'habitation...',
      url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006685791',
      source: 'legiPart+getArticle',
    },
  ]

  it('convertit chaque article en SourceChunk valide', () => {
    const chunks = resolvedArticlesToChunks(RESOLVED)

    expect(chunks).toHaveLength(2)

    expect(chunks[0].sourceLaw).toBe('Code de la santé publique')
    expect(chunks[0].sourceArticle).toBe('L.1331-1')
    expect(chunks[0].sourceUrl).toBe('https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006685784')
    expect(chunks[0].chunkText).toBe('Nul ne peut mettre en location un logement sans avoir...')
    expect(chunks[0].similarity).toBe(1.0)

    expect(chunks[1].sourceArticle).toBe('L.1331-8')
  })

  it('retourne un tableau vide sur entrée vide', () => {
    const chunks = resolvedArticlesToChunks([])
    expect(chunks).toHaveLength(0)
  })

  it('affecte similarity=1.0 à tous les articles (confiance maximale)', () => {
    const chunks = resolvedArticlesToChunks(RESOLVED)
    for (const chunk of chunks) {
      expect(chunk.similarity).toBe(1.0)
    }
  })
})
