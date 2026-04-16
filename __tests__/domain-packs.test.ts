// __tests__/domain-packs.test.ts
// Tests du domain pack baux_habitation et du builder associé
// Lancer : npx vitest run __tests__/domain-packs.test.ts

import { describe, it, expect } from 'vitest'
import {
  BAUX_HABITATION_PACK,
  getDomainPack,
  matchFallbackRule,
  DOMAIN_PACKS,
} from '@/lib/domain-packs'
import { buildBriefFromDomainPack } from '@/lib/domain-pack-builder'
import { detectLegalPlaybook } from '@/lib/legal-playbooks'
import type { TaggedArticle, TaggedCase } from '@/lib/post-treatment'

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_ARTICLES: TaggedArticle[] = []
const EMPTY_CASES: TaggedCase[] = []

const LIVE_ARTICLES_LOYERS: TaggedArticle[] = [
  {
    tag: 'A1',
    title: 'Art. 24 — loi 89-462',
    sourceLaw: 'loi 89-462',
    sourceArticle: '24',
    sourceUrl: 'https://legifrance.gouv.fr/mock/art24',
  },
  {
    tag: 'A2',
    title: 'Art. L412-6 — CPCE',
    sourceLaw: "code des procédures civiles d'exécution",
    sourceArticle: 'L412-6',
    sourceUrl: 'https://legifrance.gouv.fr/mock/L412-6',
  },
]

const LIVE_CASES: TaggedCase[] = [
  {
    tag: 'J1',
    court: 'cass',
    date: '2023-04-15',
    number: '21-12345',
    holding: "La clause résolutoire ne joue qu'après commandement de payer resté infructueux 2 mois.",
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// 1. Chargement du domain pack
// ─────────────────────────────────────────────────────────────────────────────

describe('DomainPack — chargement et structure', () => {
  it('BAUX_HABITATION_PACK est exporté et a un id', () => {
    expect(BAUX_HABITATION_PACK).toBeDefined()
    expect(BAUX_HABITATION_PACK.id).toBe('baux_habitation_v1')
    expect(BAUX_HABITATION_PACK.domain).toBe('baux_habitation')
  })

  it('getDomainPack("baux_habitation") retourne le bon pack', () => {
    const pack = getDomainPack('baux_habitation')
    expect(pack).not.toBeNull()
    expect(pack?.id).toBe('baux_habitation_v1')
  })

  it('getDomainPack("domaine_inexistant") retourne null', () => {
    expect(getDomainPack('domaine_inexistant')).toBeNull()
  })

  it('DOMAIN_PACKS contient au moins baux_habitation', () => {
    const domaines = DOMAIN_PACKS.map((p) => p.domain)
    expect(domaines).toContain('baux_habitation')
  })

  it('le pack a des pivotArticles non vides', () => {
    expect(BAUX_HABITATION_PACK.pivotArticles.length).toBeGreaterThan(0)
  })

  it('le pack a des archetypesCovered', () => {
    expect(BAUX_HABITATION_PACK.archetypesCovered.length).toBeGreaterThan(0)
  })

  it('le pack a des fallbackRules pour les archétypes principaux', () => {
    const archetypeIds = BAUX_HABITATION_PACK.fallbackRules.map((r) => r.archetypeId)
    expect(archetypeIds).toContain('loyers_impayes_expulsion')
    expect(archetypeIds).toContain('depot_garantie_restitution')
    expect(archetypeIds).toContain('conge_bailleur')
    expect(archetypeIds).toContain('treve_hivernale')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Distinctions obligatoires — présence et cohérence
// ─────────────────────────────────────────────────────────────────────────────

describe('DomainPack — distinctions obligatoires', () => {
  it('recurringDistinctions contient la distinction bail nu / bail meublé', () => {
    const text = BAUX_HABITATION_PACK.recurringDistinctions.join('\n').toLowerCase()
    expect(text).toContain('meublé')
    expect(text).toContain('nu')
  })

  it('recurringDistinctions contient la distinction zone tendue / hors zone tendue', () => {
    const text = BAUX_HABITATION_PACK.recurringDistinctions.join('\n').toLowerCase()
    expect(text).toContain('zone tendue')
  })

  it('recurringDistinctions contient la mention de résidence principale', () => {
    const text = BAUX_HABITATION_PACK.recurringDistinctions.join('\n').toLowerCase()
    expect(text).toContain('résidence principale')
  })

  it('forbiddenAssertions interdit l\'expulsion sans décision de justice', () => {
    const found = BAUX_HABITATION_PACK.forbiddenAssertions.some((a) =>
      a.toLowerCase().includes('sans décision de justice') ||
      a.toLowerCase().includes('sans decision de justice')
    )
    expect(found).toBe(true)
  })

  it('forbiddenAssertions interdit la rétention du dépôt sans justification', () => {
    const found = BAUX_HABITATION_PACK.forbiddenAssertions.some((a) =>
      a.toLowerCase().includes('dépôt de garantie') ||
      a.toLowerCase().includes('depot de garantie')
    )
    expect(found).toBe(true)
  })

  it('fallback rule loyers_impayes inclut les distinctions commandement/mise en demeure', () => {
    const rule = BAUX_HABITATION_PACK.fallbackRules.find(
      (r) => r.archetypeId === 'loyers_impayes_expulsion',
    )
    expect(rule).toBeDefined()
    const text = rule!.mandatoryDistinctions.join('\n').toLowerCase()
    expect(text).toContain('commandement de payer')
  })

  it('fallback rule depot_garantie inclut la distinction délai restitution', () => {
    const rule = BAUX_HABITATION_PACK.fallbackRules.find(
      (r) => r.archetypeId === 'depot_garantie_restitution',
    )
    expect(rule).toBeDefined()
    const text = rule!.mandatoryDistinctions.join('\n').toLowerCase()
    expect(text).toContain('délai de restitution')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. matchFallbackRule — détection de la règle active
// ─────────────────────────────────────────────────────────────────────────────

describe('matchFallbackRule — détection de la règle active', () => {
  it('question sur loyers impayés → règle loyers_impayes_expulsion', () => {
    const rule = matchFallbackRule(
      BAUX_HABITATION_PACK,
      "Mon locataire ne paie plus son loyer depuis 3 mois, que faire ?",
    )
    expect(rule).not.toBeNull()
    expect(rule?.archetypeId).toBe('loyers_impayes_expulsion')
  })

  it('question sur dépôt de garantie → règle depot_garantie_restitution', () => {
    const rule = matchFallbackRule(
      BAUX_HABITATION_PACK,
      "Le propriétaire refuse de restituer mon dépôt de garantie après l'état des lieux de sortie.",
    )
    expect(rule).not.toBeNull()
    expect(rule?.archetypeId).toBe('depot_garantie_restitution')
  })

  it('question sur congé bailleur → règle conge_bailleur', () => {
    const rule = matchFallbackRule(
      BAUX_HABITATION_PACK,
      "Mon bailleur veut donner congé pour vente, quelles sont les conditions ?",
    )
    expect(rule).not.toBeNull()
    expect(rule?.archetypeId).toBe('conge_bailleur')
  })

  it('question sur trêve hivernale → règle treve_hivernale', () => {
    const rule = matchFallbackRule(
      BAUX_HABITATION_PACK,
      "La trêve hivernale s'applique-t-elle encore même si j'ai une décision de justice ?",
    )
    expect(rule).not.toBeNull()
    expect(rule?.archetypeId).toBe('treve_hivernale')
  })

  it('question sur sous-location → règle sous_location', () => {
    const rule = matchFallbackRule(
      BAUX_HABITATION_PACK,
      "Mon locataire sous-loue son appartement sur Airbnb sans m'en informer.",
    )
    expect(rule).not.toBeNull()
    expect(rule?.archetypeId).toBe('sous_location')
  })

  it('question hors domaine → retourne null (pas de match fort)', () => {
    const rule = matchFallbackRule(
      BAUX_HABITATION_PACK,
      "Quel est le délai de rétractation pour l'achat d'une voiture ?",
    )
    // Peut retourner null ou une règle avec score 0
    // Dans tous les cas, si une règle est retournée, score doit être minimal
    if (rule !== null) {
      // Vérifier que ce n'est pas un faux positif sur un mot générique
      const matchWords = rule.triggerKeywords.filter((kw) =>
        "quel est le délai de rétractation pour l'achat d'une voiture ?".toLowerCase().includes(kw),
      )
      expect(matchWords.length).toBe(0)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. buildBriefFromDomainPack — sans playbook overlay
// ─────────────────────────────────────────────────────────────────────────────

describe('buildBriefFromDomainPack — sans playbook overlay', () => {
  it('produit un LegalBrief valide pour une question sur les loyers impayés', () => {
    const brief = buildBriefFromDomainPack({
      userQuestion: "Mon locataire ne paie plus son loyer depuis 3 mois, que faire ?",
      domainPack: BAUX_HABITATION_PACK,
      taggedArticles: LIVE_ARTICLES_LOYERS,
      taggedLiveCases: LIVE_CASES,
      precisionBudget: 'medium',
    })

    expect(brief.domain).toBe('baux_habitation')
    expect(brief.archetype).toContain('loyers_impayes_expulsion')
    expect(brief.authorityCards.length).toBeGreaterThan(0)
    expect(brief.requiredDistinctions.length).toBeGreaterThan(0)
    expect(brief.forbiddenAssertions.length).toBeGreaterThan(0)
    expect(brief.practicalOutcome.length).toBeGreaterThan(0)
    expect(brief.facts.length).toBeGreaterThan(2)
    expect(brief.precisionBudget).toBe('medium')
  })

  it('le brief inclut les articles live dans les authorityCards', () => {
    const brief = buildBriefFromDomainPack({
      userQuestion: "Mon locataire ne paie plus son loyer, comment l'expulser ?",
      domainPack: BAUX_HABITATION_PACK,
      taggedArticles: LIVE_ARTICLES_LOYERS,
      taggedLiveCases: LIVE_CASES,
      precisionBudget: 'high',
    })

    const tags = brief.authorityCards.map((c) => c.tag)
    expect(tags).toContain('A1') // art. 24 live
    expect(tags).toContain('A2') // L412-6 live
    expect(tags).toContain('J1') // jurisprudence live
  })

  it('le brief ajoute des articles synthétiques pivot si la résolution live est incomplète', () => {
    const brief = buildBriefFromDomainPack({
      userQuestion: "Le bailleur refuse de restituer mon dépôt de garantie.",
      domainPack: BAUX_HABITATION_PACK,
      taggedArticles: EMPTY_ARTICLES, // aucun article résolu live
      taggedLiveCases: EMPTY_CASES,
      precisionBudget: 'low',
    })

    // Avec 0 articles live, les pivot articles doivent être synthétisés
    expect(brief.authorityCards.length).toBeGreaterThan(0)
    expect(brief.authorityCards.some((c) => c.kind === 'article')).toBe(true)
  })

  it('missingPieces signale l\'absence de playbook overlay', () => {
    const brief = buildBriefFromDomainPack({
      userQuestion: "Mon locataire ne paie plus son loyer.",
      domainPack: BAUX_HABITATION_PACK,
      taggedArticles: EMPTY_ARTICLES,
      taggedLiveCases: EMPTY_CASES,
      precisionBudget: 'low',
    })

    const mentionsPlaybook = brief.missingPieces.some((m) =>
      m.toLowerCase().includes('playbook'),
    )
    expect(mentionsPlaybook).toBe(true)
  })

  it('missingPieces signale l\'absence de jurisprudence live', () => {
    const brief = buildBriefFromDomainPack({
      userQuestion: "Mon locataire ne paie plus son loyer.",
      domainPack: BAUX_HABITATION_PACK,
      taggedArticles: LIVE_ARTICLES_LOYERS,
      taggedLiveCases: EMPTY_CASES,
      precisionBudget: 'medium',
    })

    const mentionsJuri = brief.missingPieces.some((m) =>
      m.toLowerCase().includes('jurisprudence'),
    )
    expect(mentionsJuri).toBe(true)
  })

  it('les distinctions incluent celles de la fallback rule active + domaine', () => {
    const brief = buildBriefFromDomainPack({
      userQuestion: "Mon locataire ne paie plus son loyer, je veux l'expulser.",
      domainPack: BAUX_HABITATION_PACK,
      taggedArticles: EMPTY_ARTICLES,
      taggedLiveCases: EMPTY_CASES,
      precisionBudget: 'medium',
    })

    const allDistinctions = brief.requiredDistinctions.join('\n').toLowerCase()
    // Doit contenir la distinction commandement/mise en demeure (fallback rule)
    expect(allDistinctions).toContain('commandement de payer')
    // Doit contenir une distinction générique du domaine (bail nu/meublé)
    const hasGeneralDistinction = allDistinctions.includes('meublé') || allDistinctions.includes('zone tendue')
    expect(hasGeneralDistinction).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. buildBriefFromDomainPack — avec playbook overlay
// ─────────────────────────────────────────────────────────────────────────────

describe('buildBriefFromDomainPack — avec playbook overlay (baux_loyers_impayes_expulsion)', () => {
  it('le playbook overlay est détecté pour la question canonique', () => {
    const playbook = detectLegalPlaybook(
      "Mon locataire ne paie plus son loyer et je veux l'expulser.",
    )
    expect(playbook).not.toBeNull()
    expect(playbook?.id).toBe('baux_loyers_impayes_expulsion')
    expect(playbook?.domain).toBe('baux_habitation')
  })

  it('avec overlay, le brief utilise l\'id du playbook comme archétype', () => {
    const playbook = detectLegalPlaybook("Mon locataire ne paie plus son loyer.")!
    expect(playbook).not.toBeNull()

    const brief = buildBriefFromDomainPack({
      userQuestion: "Mon locataire ne paie plus son loyer.",
      domainPack: BAUX_HABITATION_PACK,
      playbookOverlay: playbook!,
      taggedArticles: LIVE_ARTICLES_LOYERS,
      taggedLiveCases: LIVE_CASES,
      precisionBudget: 'high',
    })

    expect(brief.archetype).toBe('baux_loyers_impayes_expulsion')
  })

  it('avec overlay, les distinctions du playbook sont prioritaires', () => {
    const playbook = detectLegalPlaybook("Expulsion locataire loyer impayé.")!
    expect(playbook).not.toBeNull()

    const brief = buildBriefFromDomainPack({
      userQuestion: "Expulsion locataire loyer impayé.",
      domainPack: BAUX_HABITATION_PACK,
      playbookOverlay: playbook!,
      taggedArticles: LIVE_ARTICLES_LOYERS,
      taggedLiveCases: LIVE_CASES,
      precisionBudget: 'high',
    })

    const firstDistinctions = brief.requiredDistinctions.slice(0, playbook!.requiredDistinctions.length)
    expect(firstDistinctions).toEqual(playbook!.requiredDistinctions)
  })

  it('avec overlay, les distinctions du domaine complètent celles du playbook', () => {
    const playbook = detectLegalPlaybook("Expulsion locataire loyer impayé.")!
    expect(playbook).not.toBeNull()

    const brief = buildBriefFromDomainPack({
      userQuestion: "Expulsion locataire loyer impayé.",
      domainPack: BAUX_HABITATION_PACK,
      playbookOverlay: playbook!,
      taggedArticles: LIVE_ARTICLES_LOYERS,
      taggedLiveCases: LIVE_CASES,
      precisionBudget: 'high',
    })

    // Le brief doit avoir plus de distinctions que le playbook seul
    expect(brief.requiredDistinctions.length).toBeGreaterThan(
      playbook!.requiredDistinctions.length,
    )
  })

  it('avec overlay, les forbidden assertions incluent domaine + playbook (sans doublon)', () => {
    const playbook = detectLegalPlaybook("Mon locataire ne paie plus son loyer.")!
    expect(playbook).not.toBeNull()

    const brief = buildBriefFromDomainPack({
      userQuestion: "Mon locataire ne paie plus son loyer.",
      domainPack: BAUX_HABITATION_PACK,
      playbookOverlay: playbook!,
      taggedArticles: LIVE_ARTICLES_LOYERS,
      taggedLiveCases: LIVE_CASES,
      precisionBudget: 'high',
    })

    // Toutes les forbidden assertions du playbook sont présentes
    for (const assertion of playbook!.forbiddenAssertions) {
      expect(brief.forbiddenAssertions).toContain(assertion)
    }

    // Pas de doublons
    const unique = new Set(brief.forbiddenAssertions)
    expect(unique.size).toBe(brief.forbiddenAssertions.length)
  })

  it('avec overlay, les practicalOutcome viennent du playbook (pas du domain pack)', () => {
    const playbook = detectLegalPlaybook("Locataire impayé expulsion.")!
    expect(playbook).not.toBeNull()

    const brief = buildBriefFromDomainPack({
      userQuestion: "Locataire impayé expulsion.",
      domainPack: BAUX_HABITATION_PACK,
      playbookOverlay: playbook!,
      taggedArticles: LIVE_ARTICLES_LOYERS,
      taggedLiveCases: LIVE_CASES,
      precisionBudget: 'high',
    })

    expect(brief.practicalOutcome).toEqual(playbook!.practicalOutcome)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. Non-régression — playbooks baux existants (via detectLegalPlaybook)
// ─────────────────────────────────────────────────────────────────────────────

describe('Non-régression — playbooks baux_habitation existants', () => {
  it('Q7 : "locataire ne paie plus loyer expulsion" → baux_loyers_impayes_expulsion', () => {
    const result = detectLegalPlaybook(
      "Que faire si mon locataire ne paie plus son loyer et que je veux l'expulser ?",
    )
    expect(result).not.toBeNull()
    expect(result?.id).toBe('baux_loyers_impayes_expulsion')
    expect(result?.domain).toBe('baux_habitation')
  })

  it('Q7 variante : commandement de payer locataire → baux_loyers_impayes_expulsion', () => {
    const result = detectLegalPlaybook(
      "J'ai envoyé un commandement de payer à mon locataire, quelle est la suite ?",
    )
    expect(result).not.toBeNull()
    expect(result?.id).toBe('baux_loyers_impayes_expulsion')
  })

  it('Q7 variante : clause résolutoire → baux_loyers_impayes_expulsion', () => {
    const result = detectLegalPlaybook(
      "La clause résolutoire du bail peut-elle jouer automatiquement ?",
    )
    expect(result).not.toBeNull()
    expect(result?.id).toBe('baux_loyers_impayes_expulsion')
  })

  it('Q7 variante : trêve hivernale + expulsion → baux_loyers_impayes_expulsion', () => {
    const result = detectLegalPlaybook(
      "La trêve hivernale empêche-t-elle toujours l'expulsion ?",
    )
    expect(result).not.toBeNull()
    expect(result?.id).toBe('baux_loyers_impayes_expulsion')
  })

  it('playbook baux_loyers_impayes a les 4 forbidden assertions anti-expulsion brutale', () => {
    const result = detectLegalPlaybook("loyer impayé expulsion locataire")!
    expect(result).not.toBeNull()
    expect(result.forbiddenAssertions).toContain(
      'le bailleur peut changer les serrures ou couper les fluides lui-même',
    )
    expect(result.forbiddenAssertions).toContain(
      "le locataire peut être expulsé sans décision de justice",
    )
  })

  it('brief construit avec playbook existant a le bon archétype et les bonnes cartes', () => {
    const playbook = detectLegalPlaybook("Locataire impayé depuis 4 mois, procédure expulsion.")!
    expect(playbook).not.toBeNull()

    const brief = buildBriefFromDomainPack({
      userQuestion: "Locataire impayé depuis 4 mois, procédure expulsion.",
      domainPack: BAUX_HABITATION_PACK,
      playbookOverlay: playbook!,
      taggedArticles: LIVE_ARTICLES_LOYERS,
      taggedLiveCases: LIVE_CASES,
      precisionBudget: 'high',
    })

    expect(brief.archetype).toBe('baux_loyers_impayes_expulsion')
    expect(brief.domain).toBe('baux_habitation')
    expect(brief.authorityCards.length).toBeGreaterThan(1)
    expect(brief.requiredDistinctions.length).toBeGreaterThanOrEqual(5)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. Couverture sans playbook — questions absorbées par le domain pack seul
// ─────────────────────────────────────────────────────────────────────────────

describe('Domain pack seul — questions absorbables sans playbook', () => {
  it('question sur la trêve hivernale (hors playbook) → brief valide', () => {
    const playbook = detectLegalPlaybook(
      "Peut-on expulser un locataire en décembre ?",
    )
    // Ce trigger ne correspond pas exactement au playbook existant — peut être null
    // Le test vérifie que le domain pack produit quand même un brief utile

    const brief = buildBriefFromDomainPack({
      userQuestion: "Peut-on expulser un locataire en décembre ?",
      domainPack: BAUX_HABITATION_PACK,
      playbookOverlay: playbook ?? undefined,
      taggedArticles: EMPTY_ARTICLES,
      taggedLiveCases: EMPTY_CASES,
      precisionBudget: 'medium',
    })

    expect(brief.domain).toBe('baux_habitation')
    expect(brief.authorityCards.length).toBeGreaterThan(0)
    expect(brief.forbiddenAssertions.length).toBeGreaterThan(0)
  })

  it('question sur le dépôt de garantie (pas de playbook) → brief avec art. 22', () => {
    const question = "Le propriétaire peut-il garder mon dépôt de garantie si l'état des lieux est incomplet ?"
    const playbook = detectLegalPlaybook(question)
    // Le playbook gestion_locative_depot_garantie existe, mais c'est du domaine gestion_locative

    const brief = buildBriefFromDomainPack({
      userQuestion: question,
      domainPack: BAUX_HABITATION_PACK,
      playbookOverlay: undefined, // on force l'absence d'overlay pour tester le domain pack seul
      taggedArticles: EMPTY_ARTICLES,
      taggedLiveCases: EMPTY_CASES,
      precisionBudget: 'medium',
    })

    const articleSources = brief.authorityCards.map((c) => c.source.toLowerCase())
    const hasArt22 = articleSources.some(
      (s) => s.includes('22') || s.includes('dépôt de garantie') || s.includes('depot de garantie'),
    )
    expect(hasArt22).toBe(true)
  })

  it('question sur le congé bailleur (pas de playbook) → distinctions congé présentes', () => {
    const brief = buildBriefFromDomainPack({
      userQuestion: "Mon propriétaire m'a donné congé pour reprise, est-ce légal ?",
      domainPack: BAUX_HABITATION_PACK,
      playbookOverlay: undefined,
      taggedArticles: EMPTY_ARTICLES,
      taggedLiveCases: EMPTY_CASES,
      precisionBudget: 'medium',
    })

    const distinctions = brief.requiredDistinctions.join('\n').toLowerCase()
    const hasCongeDistinction = distinctions.includes('congé') || distinctions.includes('conge') || distinctions.includes('reprise') || distinctions.includes('préavis')
    expect(hasCongeDistinction).toBe(true)
  })
})
