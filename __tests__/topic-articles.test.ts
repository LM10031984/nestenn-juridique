// __tests__/topic-articles.test.ts
// Tests de la shortlist métier : articles pivots par domaine.
// Lancer : npx vitest run __tests__/topic-articles.test.ts

import { describe, it, expect } from 'vitest'
import { detectTopicArticles } from '@/lib/topic-articles'

// ─────────────────────────────────────────────────────────────────────────────
// P2 — Shortlist métier : impayés de loyer
// Priorité : loi 89-462 art. 24 comme pivot, avant Code civil
// ─────────────────────────────────────────────────────────────────────────────

describe('detectTopicArticles — impayés de loyer', () => {

  it('retourne loyers_impayes_procedure sur "impayé de loyer"', () => {
    const entry = detectTopicArticles('Mon locataire ne paie plus ses loyers impayés depuis 3 mois. Quelle procédure ?')
    expect(entry).not.toBeNull()
    expect(entry!.id).toBe('loyers_impayes_procedure')
  })

  it('l\'art. 24 loi 89-462 est le PREMIER article de la shortlist', () => {
    const entry = detectTopicArticles('Locataire ne paye plus le loyer — commandement de payer ?')
    expect(entry).not.toBeNull()
    expect(entry!.forcedArticles[0].law).toBe('loi 89-462')
    expect(entry!.forcedArticles[0].artNum).toBe('24')
  })

  it('la shortlist ne contient PAS d\'articles du Code civil en tête', () => {
    const entry = detectTopicArticles('Mon locataire est en arriéré de loyer.')
    expect(entry).not.toBeNull()
    // Les articles du Code civil ne doivent PAS être les premiers pivots
    // pour une question d'impayés de loyer
    const firstLaw = entry!.forcedArticles[0].law
    expect(firstLaw).not.toBe('code civil')
  })

  it('résiliation bail impayé → loyers_impayes_procedure', () => {
    const entry = detectTopicArticles('Comment résilier le bail pour impayé de loyer ?')
    expect(entry).not.toBeNull()
    expect(entry!.id).toBe('loyers_impayes_procedure')
  })

  it('trêve hivernale → topic treve_hivernale (pas loyers_impayes_procedure)', () => {
    // excludeTriggers doit éviter la confusion avec treve_hivernale
    const entry = detectTopicArticles('Mon locataire ne paie plus : la trêve hivernale bloque-t-elle l\'expulsion ?')
    // Si trêve hivernale est exclue, le topic doit être treve_hivernale
    // (car trêve hivernale apparaît dans le texte — excludeTrigger activé)
    expect(entry).not.toBeNull()
    expect(entry!.id).toBe('treve_hivernale')
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// P2 — Shortlist métier : droit de passage / servitudes
// Priorité : 682, 683, 684 C. civ. — pas d'articles périphériques
// ─────────────────────────────────────────────────────────────────────────────

describe('detectTopicArticles — droit de passage / servitudes', () => {

  it('droit de passage → servitudes_mitoyennete', () => {
    const entry = detectTopicArticles('Mon voisin conteste mon droit de passage. Que dit la loi ?')
    expect(entry).not.toBeNull()
    expect(entry!.id).toBe('servitudes_mitoyennete')
  })

  it('art. 682 est le PREMIER article de la shortlist servitudes', () => {
    const entry = detectTopicArticles('J\'ai un terrain enclavé — droit de passage sur le voisin ?')
    expect(entry).not.toBeNull()
    expect(entry!.forcedArticles[0].artNum).toBe('682')
  })

  it('art. 683 (tracé) est présent dans la shortlist servitudes', () => {
    const entry = detectTopicArticles('Servitude de passage enclavé — où doit passer le chemin ?')
    expect(entry).not.toBeNull()
    const artNums = entry!.forcedArticles.map(a => a.artNum)
    expect(artNums).toContain('683')
  })

  it('art. 684 (sans enclave) est présent dans la shortlist servitudes', () => {
    const entry = detectTopicArticles('Servitude de passage sans enclave — est-elle possible ?')
    expect(entry).not.toBeNull()
    const artNums = entry!.forcedArticles.map(a => a.artNum)
    expect(artNums).toContain('684')
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// P2 — Shortlist métier : fosse septique / SPANC / ANC
// Stratégie prudente : pas d'articles Code de l'environnement lourds
// ─────────────────────────────────────────────────────────────────────────────

describe('detectTopicArticles — fosse septique / SPANC / ANC', () => {

  it('fosse septique → spanc_anc_fosse', () => {
    const entry = detectTopicArticles('Ma fosse septique est vieille. Le SPANC exige une mise en conformité avant vente.')
    expect(entry).not.toBeNull()
    expect(entry!.id).toBe('spanc_anc_fosse')
  })

  it('SPANC → spanc_anc_fosse', () => {
    const entry = detectTopicArticles('Le SPANC a contrôlé mon installation d\'assainissement non collectif.')
    expect(entry).not.toBeNull()
    expect(entry!.id).toBe('spanc_anc_fosse')
  })

  it('ANC non conforme → spanc_anc_fosse', () => {
    const entry = detectTopicArticles('Mon ANC est déclaré non conforme. Dois-je faire les travaux avant la vente ?')
    expect(entry).not.toBeNull()
    expect(entry!.id).toBe('spanc_anc_fosse')
  })

  it('la shortlist ANC ne contient PAS d\'articles Code de l\'environnement lourds (ICPE, pollution)', () => {
    const entry = detectTopicArticles('Fosse septique non conforme — quelles obligations ?')
    expect(entry).not.toBeNull()
    // Vérifier qu'on n'a pas d'articles du Code de l'environnement sur ICPE/pollution
    const hasHeavyEnvArticle = entry!.forcedArticles.some(a =>
      a.law.toLowerCase().includes('environnement') &&
      (a.artNum.startsWith('L511') || a.artNum.startsWith('L514') || a.artNum.startsWith('L557')),
    )
    expect(hasHeavyEnvArticle).toBe(false)
  })

  it('la shortlist ANC contient l\'art. L1331-1-1 CSP comme pivot', () => {
    const entry = detectTopicArticles('Diagnostic assainissement non collectif avant vente.')
    expect(entry).not.toBeNull()
    const pivotArt = entry!.forcedArticles.find(a => a.artNum === 'L1331-1-1')
    expect(pivotArt).toBeDefined()
  })

})
