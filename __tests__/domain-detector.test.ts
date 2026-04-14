// __tests__/domain-detector.test.ts
// Tests unitaires du détecteur de domaines — taxonomy alignée sur VALID_DOMAINS
// Lancer : npx vitest run __tests__/domain-detector.test.ts

import { describe, it, expect } from 'vitest'
import { detectDomains, detectDomain } from '@/lib/domain-detector'

// ─────────────────────────────────────────────────────────────────────────────
// Cas de base — 1 domaine évident
// ─────────────────────────────────────────────────────────────────────────────

describe('detectDomains — cas univoques', () => {

  it('offre d\'achat contresignée → vente_immobiliere', () => {
    const res = detectDomains("L'offre d'achat a été contresignée par le vendeur. Puis-je encore me rétracter ?")
    expect(res[0]).toBe('vente_immobiliere')
  })

  it('loyers impayés → baux_habitation', () => {
    const res = detectDomains('Mon locataire ne paie plus ses loyers depuis 3 mois. Comment déclencher la clause résolutoire ?')
    expect(res[0]).toBe('baux_habitation')
  })

  it('SPANC fosse septique non conforme → environnement_immo', () => {
    const res = detectDomains('Le SPANC a contrôlé ma fosse septique et l\'a déclarée non conforme. Quelles sont mes obligations avant la vente ?')
    expect(res[0]).toBe('environnement_immo')
  })

  it('ANC assainissement non collectif → environnement_immo', () => {
    const res = detectDomains('Mon assainissement non collectif (ANC) est refusé par la mairie. Quels recours ?')
    expect(res[0]).toBe('environnement_immo')
  })

  it('droit de passage voisin → servitudes', () => {
    const res = detectDomains('Mon voisin conteste mon droit de passage sur sa parcelle. Que dit la loi sur le fonds dominant ?')
    expect(res[0]).toBe('servitudes')
  })

  it('mitoyenneté mur → servitudes', () => {
    const res = detectDomains('Qui supporte les frais d\'entretien d\'un mur mitoyen ?')
    expect(res[0]).toBe('servitudes')
  })

  it('meublé de tourisme airbnb → location_touristique', () => {
    const res = detectDomains('Je loue mon appartement sur Airbnb comme meublé de tourisme. Dois-je obtenir un numéro d\'enregistrement ?')
    expect(res[0]).toBe('location_touristique')
  })

  it('mandat et honoraires agence → agent_immobilier', () => {
    const res = detectDomains('Mon agence immobilière réclame ses honoraires alors que le mandat de vente est expiré.')
    expect(res[0]).toBe('agent_immobilier')
  })

  it('DPE erroné → diagnostics', () => {
    const res = detectDomains('Le DPE était erroné au moment de la vente. Puis-je engager la responsabilité du diagnostiqueur ?')
    expect(res[0]).toBe('diagnostics')
  })

  it('permis de construire refusé → urbanisme', () => {
    const res = detectDomains('Mon permis de construire a été refusé au regard du PLU. Comment contester cette décision ?')
    expect(res[0]).toBe('urbanisme')
  })

  it('malfaçon VEFA → construction', () => {
    const res = detectDomains('Mon appartement VEFA présente des malfaçons. Comment activer la garantie décennale ?')
    expect(res[0]).toBe('construction')
  })

  it('copropriété syndic charges → copropriete', () => {
    const res = detectDomains('Le syndic a voté des charges de copropriété lors de l\'assemblée générale sans respecter l\'ordre du jour.')
    expect(res[0]).toBe('copropriete')
  })

  it('bail commercial 3-6-9 → bail_commercial', () => {
    const res = detectDomains('Mon bail commercial 3-6-9 arrive à terme. Quelle est la procédure pour le renouvellement ?')
    expect(res[0]).toBe('bail_commercial')
  })

  it('plus-value immobilière LMNP → fiscalite_investisseurs', () => {
    const res = detectDomains('Je vends un appartement en LMNP. Comment est calculée la plus-value immobilière ?')
    expect(res[0]).toBe('fiscalite_investisseurs')
  })

  it('viager nue-propriété → viager_demembrement', () => {
    const res = detectDomains('Je veux acquérir en nue-propriété avec réserve d\'usufruit. Comment fonctionne le démembrement ?')
    expect(res[0]).toBe('viager_demembrement')
  })

  it('crédit immobilier refus de prêt → vente_immobiliere', () => {
    const res = detectDomains('La banque a refusé mon prêt immobilier. La condition suspensive de financement joue-t-elle ?')
    expect(res[0]).toBe('vente_immobiliere')
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// Domaine secondaire — seulement si score >= 70 % du premier
// ─────────────────────────────────────────────────────────────────────────────

describe('detectDomains — domaine secondaire conditionnel', () => {

  it('copro + procédure générique → 1 seul domaine (copropriete)', () => {
    // "procédure" seul (weight 0.3) ne doit pas déclencher litiges en 2e
    const res = detectDomains('Le syndic n\'a pas respecté la procédure lors de l\'assemblée générale.')
    expect(res[0]).toBe('copropriete')
    expect(res.length).toBe(1)
  })

  it('copro + litige fort → 2 domaines possibles', () => {
    // Question qui mêle clairement copropriété ET contentieux judiciaire fort
    const res = detectDomains(
      'Le syndic a lancé une mise en demeure et une expertise judiciaire contre moi pour impayé de charges de copropriété. ' +
      'L\'assemblée générale a voté la saisie.',
    )
    expect(res[0]).toBe('copropriete')
    // litiges peut apparaître en 2e si score >= 70 % de copropriete
    // (mise en demeure + expertise judiciaire + saisie = 5.5 pts litiges vs copropriete >= 6 pts)
    // On vérifie juste que si 2e domaine présent, c'est litiges
    if (res.length === 2) {
      expect(res[1]).toBe('litiges')
    }
  })

  it('question purement générique (tribunal juge procédure) → aucun domaine ou litiges seul', () => {
    // Ces 3 termes ultra-génériques ont des poids très faibles — le score total
    // doit être inférieur au seuil minimal pour éviter les faux positifs
    const res = detectDomains('Je veux aller au tribunal. Le juge suivra quelle procédure ?')
    // Soit vide, soit litiges avec score très faible — dans tous les cas PAS vente_immobiliere
    expect(res).not.toContain('vente_immobiliere')
  })

  it('servitude + vente → servitudes en 1er, vente en 2e possible', () => {
    const res = detectDomains(
      'Le compromis de vente mentionne une servitude de passage qui dessert le fonds dominant. ' +
      'Est-ce opposable à l\'acheteur ?',
    )
    // servitude est le sujet principal (droit de passage, fonds dominant, servitude de passage)
    // mais compromis de vente et acheteur marquent aussi vente_immobiliere
    expect(['servitudes', 'vente_immobiliere']).toContain(res[0])
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// Anti-régression — domaines autrefois mal routés
// ─────────────────────────────────────────────────────────────────────────────

describe('detectDomains — anti-régressions', () => {

  it('servitude NE doit PAS retourner vente_immobiliere seul', () => {
    const res = detectDomains('Quelle est l\'étendue d\'une servitude de vue sur un terrain voisin ?')
    expect(res[0]).not.toBe('vente_immobiliere')
    expect(res[0]).toBe('servitudes')
  })

  it('fosse septique NE doit PAS retourner vente_immobiliere', () => {
    const res = detectDomains('Ma fosse septique est vieille. Le SPANC exige une mise en conformité.')
    expect(res[0]).not.toBe('vente_immobiliere')
    expect(res[0]).toBe('environnement_immo')
  })

  it('location airbnb NE doit PAS retourner baux_habitation', () => {
    const res = detectDomains('Je loue sur Airbnb en meublé de tourisme depuis 2 ans. La mairie menace de sanctions.')
    expect(res[0]).not.toBe('baux_habitation')
    expect(res[0]).toBe('location_touristique')
  })

  it('"nuisance" seul NE DOIT PAS déclencher baux_habitation', () => {
    // "nuisance" a été retiré de baux_habitation pour éviter les faux positifs
    const res = detectDomains('Les nuisances sonores de mon voisinage me posent problème.')
    // Au pire → servitudes (voisinage 0.5), mais pas baux_habitation
    if (res.length > 0) {
      expect(res[0]).not.toBe('baux_habitation')
    }
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// detectDomain — métadonnées Judilibre
// ─────────────────────────────────────────────────────────────────────────────

describe('detectDomain — métadonnées Judilibre', () => {

  it('bail impayé → judilibreTheme = "bail d\'habitation"', () => {
    const match = detectDomain('Mon locataire refuse de payer son loyer depuis 2 mois.')
    expect(match).not.toBeNull()
    expect(match!.judilibreTheme).toBe("bail d'habitation")
  })

  it('diagnostics → judilibreTheme indéfini (pas de thème Judilibre fiable)', () => {
    const match = detectDomain('Le DPE était erroné. La diagnostiqueur est-elle responsable ?')
    expect(match).not.toBeNull()
    expect(match!.judilibreTheme).toBeUndefined()
  })

  it('litiges → judilibreTheme indéfini', () => {
    const match = detectDomain('La mise en demeure n\'a pas reçu de réponse. Je vais assigner en référé.')
    expect(match).not.toBeNull()
    expect(match!.judilibreTheme).toBeUndefined()
  })

  it('viager → judilibreTheme indéfini (pas "vente immobilière" par défaut)', () => {
    const match = detectDomain('Comment fonctionne la rente viagère et le démembrement ?')
    expect(match).not.toBeNull()
    expect(match!.judilibreTheme).toBeUndefined()
    expect(match!.name).toBe('viager_demembrement')
  })

  it('question hors domaine → null', () => {
    const match = detectDomain('Quel est le temps de trajet entre Paris et Lyon ?')
    expect(match).toBeNull()
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// Frontière de mot — termes courts (<= 4 chars)
// Régression critique : "plu" ne doit JAMAIS matcher dans "plus"
// ─────────────────────────────────────────────────────────────────────────────

describe('matchesKeyword — word boundary sur termes courts', () => {

  it('"ne paie plus" NE déclenche PAS urbanisme (plu dans plus)', () => {
    // Régression #1 : "plu" est un sous-string de "plus" — doit être ignoré
    const res = detectDomains('Mon locataire ne paie plus depuis 3 mois, puis-je résilier le bail ?')
    expect(res).not.toContain('urbanisme')
    // Le domaine attendu est baux_habitation
    expect(res[0]).toBe('baux_habitation')
  })

  it('"PLU de la commune" déclenche urbanisme (plu isolé)', () => {
    // "PLU" doit matcher quand il est un mot entier
    const res = detectDomains('Le PLU de la commune interdit les constructions dans cette zone.')
    expect(res[0]).toBe('urbanisme')
  })

  it('"DPE" isolé déclenche diagnostics', () => {
    // "dpe" doit matcher quand c'est un token seul
    const res = detectDomains('Le DPE de mon appartement est classé G.')
    expect(res[0]).toBe('diagnostics')
  })

  it('"dpeur" NE déclenche PAS diagnostics (dpe dans dpeur)', () => {
    // Vérification de la règle inverse : "dpe" ne doit pas matcher dans un mot plus long
    // (cas artificiel pour valider la frontière)
    const res = detectDomains('Le dpeur est passé hier.')
    // "dpeur" n'est pas un vrai mot — soit diagnostics (si \b fonctionne comme substring ici)
    // → avec \b, "dpe" NE matche PAS dans "dpeur" car "r" suit "e" = word char
    expect(res).not.toContain('diagnostics')
  })

  it('"ne paie plus" + baux_habitation : pas de contamination urbanisme ni en 2e domaine', () => {
    const res = detectDomains(
      'Mon locataire ne paie plus le loyer depuis 2 mois. La clause résolutoire peut-elle jouer ?',
    )
    expect(res[0]).toBe('baux_habitation')
    expect(res).not.toContain('urbanisme')
  })

})
