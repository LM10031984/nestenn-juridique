// __tests__/legifrance.test.ts
// Tests unitaires de lookupLegitext — mapping LEGITEXT_MAP (pas de réseau)
// Lancer : npx vitest run __tests__/legifrance.test.ts

import { describe, it, expect } from 'vitest'
import { lookupLegitext } from '@/lib/legifrance'

// ─────────────────────────────────────────────────────────────────────────────
// lookupLegitext — résolution LEGITEXT sans réseau
// ─────────────────────────────────────────────────────────────────────────────

describe('lookupLegitext — codes fondamentaux', () => {

  it('code civil → LEGITEXT000006070721', () => {
    expect(lookupLegitext('code civil')).toBe('LEGITEXT000006070721')
  })

  it('loi 89-462 → LEGITEXT000006069108', () => {
    expect(lookupLegitext('loi 89-462')).toBe('LEGITEXT000006069108')
  })

  it('inconnue → null', () => {
    expect(lookupLegitext('loi inconnue xyz')).toBeNull()
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// Régression — Code de la construction et de l'habitation (L271-1)
// Bug : le nom complet "code de la construction et de l'habitation" n'était pas
// mappé → lookupLegitext retournait null → L271-1 ne se résolvait jamais.
// ─────────────────────────────────────────────────────────────────────────────

describe('lookupLegitext — CCH (Code de la construction et de l\'habitation)', () => {

  it('alias court "cch" → LEGITEXT000006074096', () => {
    expect(lookupLegitext('cch')).toBe('LEGITEXT000006074096')
  })

  it('alias partiel "code de la construction" → LEGITEXT000006074096', () => {
    expect(lookupLegitext('code de la construction')).toBe('LEGITEXT000006074096')
  })

  it('nom complet "code de la construction et de l\'habitation" → LEGITEXT000006074096 (régression L271-1)', () => {
    expect(lookupLegitext("code de la construction et de l'habitation")).toBe('LEGITEXT000006074096')
  })

  it('insensible à la casse : "Code de la Construction et de l\'Habitation" → résolu', () => {
    expect(lookupLegitext("Code de la Construction et de l'Habitation")).toBe('LEGITEXT000006074096')
  })

})
