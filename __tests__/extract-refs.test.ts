// __tests__/extract-refs.test.ts
// Tests unitaires de extractArticleRefs / refsToCandidates
// Lancer : npx vitest run __tests__/extract-refs.test.ts

import { describe, it, expect, vi } from 'vitest'
import { extractArticleRefs, refsToCandidates } from '@/lib/extract-refs'
import { normalizeArticleNum } from '@/lib/legifrance-resolver'

// Mock lookupLegitext pour éviter la dépendance à LEGITEXT_MAP réel
vi.mock('@/lib/legifrance', () => ({
  getAccessToken: vi.fn().mockResolvedValue('mock-token'),
  lookupLegitext: vi.fn((law: string) => {
    const map: Record<string, string> = {
      'code civil':   'LEGITEXT000006070721',
      'loi 89-462':   'LEGITEXT000006069108',
      'loi 70-9':     'LEGITEXT000006068387',
      'code commerce': 'LEGITEXT000005634379',
      'csp':          'LEGITEXT000006072665',
      'urbanisme':    'LEGITEXT000006074075',
    }
    return map[law] ?? map[law.toLowerCase()] ?? null
  }),
}))

// ── extractArticleRefs ────────────────────────────────────────────────────────

describe('extractArticleRefs', () => {
  it('extrait « article X du code civil »', () => {
    const refs = extractArticleRefs('Que dit l\'article 1751 du code civil sur le bail des époux ?')
    expect(refs).toEqual([{ law: 'code civil', artNums: ['1751'] }])
  })

  it('extrait « article X de la loi 89-462 »', () => {
    const refs = extractArticleRefs('Quel est le préavis prévu par l\'article 15 de la loi 89-462 ?')
    expect(refs).toEqual([{ law: 'loi 89-462', artNums: ['15'] }])
  })

  it('extrait un article codifié L avec la loi la plus proche', () => {
    const refs = extractArticleRefs('L\'article L145-40-2 du code de commerce impose-t-il un inventaire des charges ?')
    expect(refs.length).toBe(1)
    expect(refs[0].law).toBe('code commerce')
    expect(refs[0].artNums.length).toBe(1)
    expect(normalizeArticleNum(refs[0].artNums[0])).toBe('L145-40-2')
  })

  it('extrait plusieurs articles de la même loi', () => {
    const refs = extractArticleRefs('Compare l\'article 6 et l\'article 7 de la loi hoguet.')
    const hoguet = refs.find(r => r.law === 'loi 70-9')
    expect(hoguet).toBeDefined()
    expect(hoguet!.artNums).toContain('6')
    expect(hoguet!.artNums).toContain('7')
  })

  it('retourne [] quand aucune référence n\'est citée', () => {
    expect(extractArticleRefs('Mon locataire ne paie plus son loyer, que faire ?')).toEqual([])
  })

  it('ignore un numéro d\'article sans loi identifiable à proximité', () => {
    expect(extractArticleRefs('Voir l\'article 12 pour plus de détails.')).toEqual([])
  })
})

// ── refsToCandidates ──────────────────────────────────────────────────────────

describe('refsToCandidates', () => {
  it('convertit une ref en candidat avec LEGITEXT et nom lisible', () => {
    const candidates = refsToCandidates([{ law: 'code civil', artNums: ['1751'] }])
    expect(candidates).toEqual([{
      textId: 'LEGITEXT000006070721',
      articleNum: '1751',
      lawName: 'Code civil',
    }])
  })

  it('déplie plusieurs numéros d\'articles en autant de candidats', () => {
    const candidates = refsToCandidates([{ law: 'loi 89-462', artNums: ['15', '22'] }])
    expect(candidates.length).toBe(2)
    expect(candidates.map(c => c.articleNum)).toEqual(['15', '22'])
    expect(candidates.every(c => c.textId === 'LEGITEXT000006069108')).toBe(true)
  })

  it('ignore silencieusement une loi absente de LEGITEXT_MAP', () => {
    const candidates = refsToCandidates([
      { law: 'loi inconnue 99-999', artNums: ['1'] },
      { law: 'csp', artNums: ['L1331-1'] },
    ])
    expect(candidates.length).toBe(1)
    expect(candidates[0].textId).toBe('LEGITEXT000006072665')
  })
})

// ── normalizeArticleNum (résolveur) ──────────────────────────────────────────

describe('normalizeArticleNum', () => {
  it('uniformise les variantes de format d\'un article codifié', () => {
    expect(normalizeArticleNum('L. 412-6')).toBe('L412-6')
    expect(normalizeArticleNum('L412-6')).toBe('L412-6')
    expect(normalizeArticleNum('L-412-6')).toBe('L412-6')
    expect(normalizeArticleNum('l 412-6')).toBe('L412-6')
  })

  it('préserve les numéros simples', () => {
    expect(normalizeArticleNum('1751')).toBe('1751')
    expect(normalizeArticleNum(' 15 ')).toBe('15')
  })
})
