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

// ─────────────────────────────────────────────────────────────────────────────
// droit_social_immo — détection IDCC 1527 + licenciement négociateur
// ─────────────────────────────────────────────────────────────────────────────

describe('detectDomains — droit_social_immo (Phase 3)', () => {

  it('IDCC 1527 → droit_social_immo', () => {
    const res = detectDomains('Quelle est la convention collective applicable ? Mon agence relève de l\'IDCC 1527.')
    expect(res[0]).toBe('droit_social_immo')
  })

  it('licenciement négociateur salarié → droit_social_immo', () => {
    // "licenciement négociateur" (2.0) + "négociateur salarié" (2.0) → score 4.0 droit_social_immo
    // vs "agent_immobilier" qui ne matche rien de spécifique ici
    const res = detectDomains('Le licenciement négociateur salarié dans mon cabinet : quelles sont les règles de préavis selon la convention collective immobilier ?')
    expect(res[0]).toBe('droit_social_immo')
  })

  it('rupture conventionnelle agence → droit_social_immo', () => {
    const res = detectDomains('Je souhaite faire une rupture conventionnelle agence. Quels sont mes droits ?')
    expect(res[0]).toBe('droit_social_immo')
  })

  it('négociateur salarié immobilier → droit_social_immo', () => {
    const res = detectDomains('Le négociateur salarié immobilier a-t-il droit à des commissions en cas de licenciement ?')
    expect(res[0]).toBe('droit_social_immo')
  })

  it('convention collective immobilier → droit_social_immo', () => {
    const res = detectDomains('La convention collective immobilier prévoit-elle un préavis spécifique pour les négociateurs ?')
    expect(res[0]).toBe('droit_social_immo')
  })

  it('agent immobilier seul → agent_immobilier (non droit_social_immo)', () => {
    // La présence de "agent immobilier" sans signaux droit social → domaine métier, pas social
    const res = detectDomains('L\'agent immobilier a réclamé ses honoraires après la vente.')
    expect(res[0]).toBe('agent_immobilier')
    expect(res).not.toContain('droit_social_immo')
  })

  it('négociateur immobilier + mandat (sans signal salarié) → agent_immobilier', () => {
    // "négociateur immobilier" existe dans agent_immobilier (weight 1.5)
    // Sans signal salarié explicite → ne doit PAS déclencher droit_social_immo seul
    const res = detectDomains('Le négociateur immobilier de l\'agence est-il soumis à la loi Hoguet ?')
    // Accepter agent_immobilier OU droit_social_immo — dépend du score
    // Mais droit_social_immo NE DOIT PAS surclasser agent_immobilier ici
    expect(res[0]).toBe('agent_immobilier')
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 1 — nouveaux domaines ajoutés au détecteur
// ─────────────────────────────────────────────────────────────────────────────

describe('detectDomains — nouveaux domaines Sprint 1', () => {

  it('mandat de gestion + dépôt non restitué agence → gestion_locative', () => {
    const res = detectDomains(
      'Mon propriétaire a confié la gestion locative à une agence. ' +
      'L\'agence ne rend pas le dépôt de garantie à la fin du bail. ' +
      'Quel est le compte rendu de gérance que je peux demander ?',
    )
    expect(res[0]).toBe('gestion_locative')
  })

  it('dépôt de garantie géré par agence → gestion_locative', () => {
    const res = detectDomains(
      'Le dépôt de garantie est détenu par l\'administrateur de biens. ' +
      'Il ne le restitue pas depuis 3 mois.',
    )
    expect(res[0]).toBe('gestion_locative')
  })

  it('indemnisation + faute professionnelle agent → responsabilite_agent détecté', () => {
    // responsabilite_agent et agent_immobilier sont proches : on vérifie que
    // responsabilite_agent apparaît dans les résultats (1er ou 2e selon le texte).
    // Une question purement centrée sur la faute et l'indemnisation doit scorer responsabilite_agent.
    const res = detectDomains(
      'L\'indemnisation par l\'agence est-elle possible ? ' +
      'La faute professionnelle de l\'agent est avérée et le préjudice acheteur agence est documenté. ' +
      'Sa RC pro agence est-elle activable ?',
    )
    // responsabilite_agent doit être détecté (1er ou 2e selon scoring)
    expect(res).toContain('responsabilite_agent')
  })

  it('responsabilite_agent seul sur question pure indemnisation → 1er domaine', () => {
    // Texte sans mention d'"agence immobilière" ni "agent immobilier" directement
    const res = detectDomains(
      'Ma mise en cause de l\'agence repose sur une erreur de l\'agent. ' +
      'L\'indemnisation agent peut-elle couvrir mon préjudice ? ' +
      'Le manquement agent est documenté.',
    )
    expect(res[0]).toBe('responsabilite_agent')
  })

  it('syndic + assemblée générale → copropriete (comportement normal)', () => {
    // "syndic" (2.0) + "assemblée générale" (2.0) dans copropriete écrase syndic_copropriete
    // sur les questions générales de fonctionnement. C'est le comportement attendu.
    const res = detectDomains(
      'Le syndic ne convoque pas l\'assemblée générale depuis 18 mois. ' +
      'Quelles sont les conséquences ?',
    )
    expect(res[0]).toBe('copropriete')
  })

  it('mise en concurrence + contrat de syndic + honoraires syndic → syndic_copropriete', () => {
    // Question centrée sur le MANDAT du syndic : mise en concurrence, honoraires, contrat
    // → syndic_copropriete doit scorer nettement au-dessus de copropriete
    const res = detectDomains(
      'La mise en concurrence du syndic est obligatoire avant le renouvellement. ' +
      'Comment comparer les honoraires syndic dans le contrat de syndic présenté en AG ?',
    )
    expect(res[0]).toBe('syndic_copropriete')
  })

  it('cession parts sociales SCI familiale → sci_patrimoine', () => {
    const res = detectDomains(
      'Peut-on vendre un bien détenu en SCI familiale sans l\'accord de tous les associés ? ' +
      'La cession de parts sociales nécessite-t-elle un acte notarié ?',
    )
    expect(res[0]).toBe('sci_patrimoine')
  })

  it('sci + gérant → sci_patrimoine plutôt que fiscalite_investisseurs', () => {
    const res = detectDomains(
      'Je suis gérant de SCI. Mon associé veut procéder à la dissolution de la SCI. ' +
      'Quelles sont les étapes ?',
    )
    expect(res[0]).toBe('sci_patrimoine')
  })

  it('déclaration de soupçon TRACFIN → conformite_lcb_ft', () => {
    const res = detectDomains(
      'Quels documents dois-je demander au client pour respecter la lutte anti-blanchiment ? ' +
      'Dois-je faire une déclaration de soupçon TRACFIN si le paiement est en espèces ?',
    )
    expect(res[0]).toBe('conformite_lcb_ft')
  })

  it('personne politiquement exposée PPE → conformite_lcb_ft', () => {
    const res = detectDomains(
      'Mon client est une personne politiquement exposée (PPE). ' +
      'Quelles obligations LCB-FT s\'appliquent à mon agence ?',
    )
    expect(res[0]).toBe('conformite_lcb_ft')
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// RGPD — domaine rgpd_agence doit surclasser agent_immobilier sur les questions
// CRM / consentement / données prospects
// ─────────────────────────────────────────────────────────────────────────────

describe('detectDomains — rgpd_agence vs agent_immobilier', () => {

  it('consentement prospect CRM → rgpd_agence (pas agent_immobilier)', () => {
    // Contient "agence immobilière" (2.0 pour agent_immobilier)
    // mais aussi consentement(1.0) + CRM(1.5) + prospect(1.0) + données(0.5) = 4.0
    const res = detectDomains(
      'Une agence immobilière doit-elle obtenir le consentement d\'un prospect avant d\'enregistrer ses données dans son CRM ?',
    )
    expect(res[0]).toBe('rgpd_agence')
    expect(res).not.toContain('agent_immobilier')
  })

  it('durée conservation données prospect vendeur → rgpd_agence', () => {
    // Pas de "agence immobilière" exact → agent_immobilier = 0
    // "conserver les données"(2.0) + prospect(1.0) + données(0.5) = 3.5
    const res = detectDomains(
      'Combien de temps une agence peut-elle conserver les données d\'un prospect vendeur ?',
    )
    expect(res[0]).toBe('rgpd_agence')
  })

  it('effacement données CRM agence → rgpd_agence', () => {
    // effacement(1.5) + crm(1.5) + prospect(1.0) + données(0.5) = 4.5
    const res = detectDomains(
      'Un prospect peut-il demander l\'effacement de ses données dans le CRM de l\'agence ?',
    )
    expect(res[0]).toBe('rgpd_agence')
  })

})

// ─────────────────────────────────────────────────────────────────────────────
// Anti-régression Sprint 1 — les nouveaux domaines ne perturbent pas les anciens
// ─────────────────────────────────────────────────────────────────────────────

describe('detectDomains — anti-régression après Sprint 1', () => {

  it('dégradations + état des lieux incomplet + agence de gestion → gestion_locative en 1er', () => {
    const res = detectDomains(
      'Le propriétaire me demande de retenir une partie du dépôt de garantie pour des dégradations, ' +
      "mais l'état des lieux de sortie est incomplet. Que peut faire l'agence de gestion ?",
    )
    expect(res[0]).toBe('gestion_locative')
  })

  it('mandat de vente (agent_immobilier) ≠ mandat de gestion (gestion_locative)', () => {
    const res = detectDomains(
      'Mon mandat de vente est exclusif. L\'agence réclame sa commission alors que j\'ai trouvé l\'acheteur moi-même.',
    )
    expect(res[0]).toBe('agent_immobilier')
    expect(res).not.toContain('gestion_locative')
  })

  it('syndic + charges assemblée générale → toujours copropriete en 1er', () => {
    const res = detectDomains(
      'Le syndic a soumis les charges à l\'assemblée générale sans respecter les tantièmes.',
    )
    expect(res[0]).toBe('copropriete')
  })

  it('tracfin dans contexte agent → agent_immobilier (pas uniquement conformite_lcb_ft)', () => {
    // "tracfin" est maintenant dans les deux domaines — on vérifie que agent_immobilier
    // reste détecté sur une question générale d'agence (carte T + tracfin)
    const res = detectDomains(
      'Mon agence immobilière doit-elle faire une déclaration TRACFIN ? ' +
      'J\'ai une carte T depuis 3 ans et je gère des mandats.',
    )
    // Les deux domaines peuvent scorer — agent_immobilier ou conformite_lcb_ft en 1er
    expect(['agent_immobilier', 'conformite_lcb_ft']).toContain(res[0])
  })

  it('sci + lmnp → fiscalite_investisseurs peut apparaître (pas éliminé par sci_patrimoine)', () => {
    const res = detectDomains(
      'Je loue en LMNP via une SCI à l\'IS. Comment s\'applique le déficit foncier ?',
    )
    // Question fiscale → fiscalite_investisseurs doit scorer haut
    // sci_patrimoine peut apparaître en 2e (sci=2.0 pour sci_patrimoine)
    expect(['fiscalite_investisseurs', 'sci_patrimoine']).toContain(res[0])
  })

})
