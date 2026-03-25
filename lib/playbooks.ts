// lib/playbooks.ts
// Playbooks juridiques — contrats de qualité pour le moteur déterministe.
// Chaque playbook définit : triggers de détection, références légales forcées,
// mots-clés requis dans la réponse, et grands arrêts curated prioritaires.
//
// Utilisé par app/api/chat/route.ts et lib/live-validator.ts.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForcedArticle {
  law: string      // ex: 'loi 89-462', 'code civil', 'CCH'
  artNum: string   // ex: '24', 'L271-1', '1641'
  label?: string   // ex: 'Art. 24 — commandement de payer'
}

export interface Playbook {
  id: string
  name: string
  triggers: string[]             // lowercase — détection OR (un seul suffit)
  excludeTriggers?: string[]     // si l'un est présent → ne pas déclencher
  subThemes: string[]            // sous-thèmes Judilibre correspondants
  forcedArticles: ForcedArticle[]
  requiredKeywords: string[]     // ≥2 doivent apparaître dans la réponse (normalisés)
  keywordSynonyms?: Record<string, string[]>  // synonymes tolérés pour chaque keyword
  curatedCaseIds: string[]       // source_ids dans table jurisprudence (curated=true)
  answerNote: string             // instruction courte injectée dans le system prompt
}

// ---------------------------------------------------------------------------
// CLUSTER 1 — MANDAT & COMMISSION (4 playbooks)
// ---------------------------------------------------------------------------

const COMMISSION_ACTE_OBLIGATOIRE: Playbook = {
  id: 'commission_acte_obligatoire',
  name: 'Commission — acte authentique obligatoire',
  triggers: ['commission', 'honoraires', 'rémunération agent', 'remuneration agent', 'paiement agent', 'payer l\'agent', 'doit-on payer'],
  excludeTriggers: ['primo-visiteur', 'deux agences', 'inter-agences', 'partage'],
  subThemes: ['commission_acheteur_defaillant', 'commission_vendeur_defaillant'],
  forcedArticles: [
    { law: 'loi 70-9', artNum: '6', label: 'Art. 6 loi Hoguet — conditions de rémunération' },
    { law: 'décret 72-678', artNum: '72', label: 'Décret 72-678 Art. 72 — mandat écrit' },
  ],
  requiredKeywords: ['commission due', 'acte authentique', 'mandat écrit', 'loi Hoguet'],
  keywordSynonyms: {
    'acte authentique': ['acte notarié', 'signature chez le notaire', 'signature definitive'],
    'loi Hoguet': ['loi 70-9', 'loi hoguet', 'loi du 2 janvier 1970'],
  },
  curatedCaseIds: ['curated-commission-acte-authentique', 'curated-mandat-ecrit-obligatoire'],
  answerNote: 'La commission n\'est due que si : (1) le mandat est écrit et valide, (2) l\'acte authentique a été signé, (3) l\'agent est la cause efficiente de la vente (loi Hoguet art. 6, décret 72-678 art. 72).',
}

const COMMISSION_PARTAGE_INTER_AGENCES: Playbook = {
  id: 'commission_partage_inter_agences',
  name: 'Commission — partage inter-agences et primo-visiteur',
  triggers: ['deux agences', 'primo-visiteur', 'premier visiteur', 'inter-agences', 'partage commission', 'partage honoraires', 'deux mandats'],
  subThemes: ['commission_partage'],
  forcedArticles: [
    { law: 'loi 70-9', artNum: '6', label: 'Art. 6 loi Hoguet — cause efficiente' },
    { law: 'loi 70-9', artNum: '7', label: 'Art. 7 loi Hoguet — partage honoraires' },
  ],
  requiredKeywords: ['primo-visiteur', 'cause efficiente', 'partage commission', 'accord inter-agences'],
  keywordSynonyms: {
    'primo-visiteur': ['premier visiteur', 'premiere agence', 'premiere visite'],
    'cause efficiente': ['cause determinante', 'ayant apporté l\'acquereur'],
  },
  curatedCaseIds: ['curated-commission-acte-authentique', 'curated-mandat-ecrit-obligatoire'],
  answerNote: 'La commission revient à l\'agence primo-visiteur (cause efficiente de la vente). Un accord de partage entre agences peut modifier la répartition. En l\'absence d\'accord, la commission revient à l\'agence qui a présenté en premier l\'acquéreur.',
}

const MANDAT_EXPIRE_COMMISSION: Playbook = {
  id: 'mandat_expire_commission',
  name: 'Commission — mandat expiré ou invalide',
  triggers: ['mandat expiré', 'mandat expire', 'mandat périmé', 'mandat perime', 'sans mandat valide', 'mandat non valide', 'mandat non renouvelé', 'mandat non renouvele', 'après expiration du mandat'],
  subThemes: ['mandat_expire'],
  forcedArticles: [
    { law: 'loi 70-9', artNum: '6', label: 'Art. 6 loi Hoguet — mandat valide requis' },
    { law: 'décret 72-678', artNum: '72', label: 'Décret 72-678 Art. 72 — formalisme mandat' },
  ],
  requiredKeywords: ['commission non due', 'mandat valide', 'mandat expiré', 'loi Hoguet'],
  keywordSynonyms: {
    'commission non due': ['commission pas due', 'ne peut pas reclamer sa commission', 'aucune remuneration'],
    'mandat expiré': ['mandat expire', 'mandat perime', 'mandat n\'est plus valide'],
  },
  curatedCaseIds: ['curated-mandat-ecrit-obligatoire'],
  answerNote: 'Aucune commission n\'est due si le mandat est expiré, non écrit, ou irrégulier au moment de la transaction. Le formalisme du mandat est d\'ordre public (loi 70-9 art. 6).',
}

const DEVOIR_CONSEIL_AGENT: Playbook = {
  id: 'devoir_conseil_agent',
  name: 'Devoir de conseil et responsabilité de l\'agent',
  triggers: ['agent n\'a pas informé', 'agent n\'a pas signale', 'devoir de conseil', 'réticence dolosive', 'reticence dolosive', 'responsabilité agent', 'responsabilite agent', 'agent n\'a pas dit', 'information non divulguée', 'information non divulguee', 'agent savait', 'agent n\'a pas vérifié', 'n\'a pas informe l\'acquereur'],
  subThemes: ['responsabilite_agent_info'],
  forcedArticles: [
    { law: 'code civil', artNum: '1240', label: 'Art. 1240 C. civ. — responsabilité civile' },
    { law: 'loi 70-9', artNum: '1', label: 'Art. 1 loi Hoguet — obligations professionnelles' },
  ],
  requiredKeywords: ['devoir de conseil', 'obligation d\'information', 'réticence dolosive', 'article 1240'],
  keywordSynonyms: {
    'article 1240': ['1240 du code civil', '1240 c. civ', 'faute civile'],
    'réticence dolosive': ['reticence dolosive', 'dol par omission'],
    'devoir de conseil': ['obligation de conseil', 'devoir d\'information'],
  },
  curatedCaseIds: ['curated-devoir-conseil-agent', 'curated-devoir-conseil-etat-bien', 'curated-reticence-dolosive-vendeur'],
  answerNote: 'L\'agent doit informer son client ET l\'acquéreur de tout élément déterminant sur l\'état du bien : vices apparents visibles lors de la visite, résultats des diagnostics techniques obligatoires, renseignements sur la situation juridique et matérielle du bien. Le manquement à cette obligation d\'information engage sa responsabilité délictuelle (art. 1240 C. civ.). La réticence dolosive peut entraîner la nullité de la vente.',
}

// ---------------------------------------------------------------------------
// CLUSTER 2 — BAIL D'HABITATION (6 playbooks)
// ---------------------------------------------------------------------------

const CLAUSE_RESOLUTOIRE_COMMANDEMENT: Playbook = {
  id: 'clause_resolutoire_commandement',
  name: 'Bail — clause résolutoire et commandement de payer',
  triggers: ['commandement de payer', 'clause résolutoire', 'clause resolutoire', 'impayé loyer', 'impaye loyer', 'expulsion locataire', 'huissier loyer', 'loyers impayés', 'loyers impayes', 'procédure expulsion', 'procedure expulsion'],
  subThemes: ['bail'],
  forcedArticles: [
    { law: 'loi 89-462', artNum: '24', label: 'Art. 24 loi 89-462 — clause résolutoire' },
  ],
  requiredKeywords: ['commandement de payer', '2 mois', 'clause résolutoire', 'huissier'],
  keywordSynonyms: {
    '2 mois': ['deux mois', 'delai de deux mois'],
    'clause résolutoire': ['clause resolutoire'],
    'huissier': ['commissaire de justice', 'acte d\'huissier'],
  },
  curatedCaseIds: ['curated-clause-resolutoire-commandement'],
  answerNote: 'La clause résolutoire ne peut produire effet qu\'après un commandement de payer resté sans effet pendant 2 mois (loi 89-462 art. 24). Le commandement doit être délivré par huissier et mentionner ce délai.',
}

const DEPOT_GARANTIE_RESTITUTION: Playbook = {
  id: 'depot_garantie_restitution',
  name: 'Bail — dépôt de garantie et restitution',
  triggers: ['dépôt de garantie', 'depot de garantie', 'restitution caution', 'caution restituee', 'retenue caution', 'vétusté', 'vetuste', 'usure normale', 'grille vétusté', 'grille vetuste'],
  subThemes: ['depot_garantie_vetuste', 'depot_garantie_degradation'],
  forcedArticles: [
    { law: 'loi 89-462', artNum: '22', label: 'Art. 22 loi 89-462 — dépôt de garantie' },
  ],
  requiredKeywords: ['dépôt de garantie', '1 mois', '2 mois', 'état des lieux', 'vétusté'],
  keywordSynonyms: {
    '1 mois': ['un mois', 'dans le mois'],
    '2 mois': ['deux mois', 'dans les deux mois'],
    'dépôt de garantie': ['depot de garantie', 'caution'],
    'état des lieux': ['etat des lieux', 'etat de sortie'],
    'vétusté': ['vetuste', 'usure normale', 'degradation'],
  },
  curatedCaseIds: [],
  answerNote: 'Délai de restitution : 1 mois si l\'état des lieux de sortie est conforme à l\'entrée, 2 mois si des dégradations sont constatées (loi 89-462 art. 22). Les retenues pour vétusté doivent se baser sur la grille réglementaire (décret 2016-382).',
}

const TREVE_HIVERNALE: Playbook = {
  id: 'treve_hivernale',
  name: 'Trêve hivernale — protection contre l\'expulsion',
  triggers: ['trêve hivernale', 'treve hivernale', 'période hivernale', 'periode hivernale', 'expulsion hiver', 'expulsion hivernale', 'expulsion novembre', 'expulsion décembre', 'expulsion janvier', 'expulsion mars'],
  subThemes: ['bail'],
  forcedArticles: [
    { law: 'CASF', artNum: 'L412-6', label: 'Art. L412-6 CASF — trêve hivernale' },
  ],
  requiredKeywords: ['trêve hivernale', '1er novembre', '31 mars'],
  keywordSynonyms: {
    'trêve hivernale': ['treve hivernale', 'periode hivernale', 'protection hivernale'],
    '1er novembre': ['premier novembre', '1 novembre'],
    '31 mars': ['trente et un mars'],
  },
  curatedCaseIds: ['curated-treve-hivernale-expulsion-urgente'],
  answerNote: 'Interdiction d\'expulser un locataire du 1er novembre au 31 mars (trêve hivernale, CASF art. L412-6). Exceptions : logement de remplacement fourni, violence domestique, relogement. La décision de justice reste valable et s\'exécute après la trêve.',
}

const ENCADREMENT_LOYERS_ZONES: Playbook = {
  id: 'encadrement_loyers_zones',
  name: 'Encadrement des loyers en zone tendue',
  triggers: ['encadrement loyers', 'encadrement des loyers', 'loyer référence', 'loyer reference', 'zone tendue', 'complément de loyer', 'complement de loyer', 'loyer maximum', 'loyer plafonné', 'loyer plafonne', 'loyer trop élevé', 'loyer trop eleve'],
  subThemes: ['bail'],
  forcedArticles: [
    { law: 'loi 89-462', artNum: '17', label: 'Art. 17 loi 89-462 — fixation du loyer' },
    { law: 'décret', artNum: '2024-854', label: 'Décret 2024-854 — zones d\'encadrement' },
  ],
  requiredKeywords: ['loyer référence', 'complément de loyer', 'zones tendues', 'encadrement'],
  keywordSynonyms: {
    'loyer référence': ['loyer reference', 'loyer de reference', 'loyer median'],
    'complément de loyer': ['complement de loyer', 'supplement de loyer'],
    'zones tendues': ['zone tendue', 'zone d\'encadrement'],
  },
  curatedCaseIds: ['curated-encadrement-loyers-villes-2024'],
  answerNote: 'En zone tendue (Paris, Lille, Lyon, Bordeaux, Montpellier, etc.), le loyer ne peut dépasser le loyer référence majoré. Un complément de loyer est possible si le logement présente des caractéristiques exceptionnelles. Sanction : remboursement du trop-perçu (Décret 2024-854, loi 89-462 art. 17).',
}

const CONGE_LOCATAIRE_BAILLEUR: Playbook = {
  id: 'conge_locataire_bailleur',
  name: 'Bail — congé du bailleur ou du locataire',
  triggers: ['donner congé', 'donner conge', 'préavis bail', 'preavis bail', 'résiliation bail', 'resiliation bail', 'reprise du logement', 'congé pour vente', 'conge pour vente', 'fin du bail', 'ne pas renouveler', 'non-renouvellement'],
  subThemes: ['bail'],
  forcedArticles: [
    { law: 'loi 89-462', artNum: '15', label: 'Art. 15 loi 89-462 — congé du bailleur' },
  ],
  requiredKeywords: ['préavis', '3 mois', '6 mois', 'motif légitime'],
  keywordSynonyms: {
    'préavis': ['preavis', 'delai de preavis'],
    '3 mois': ['trois mois'],
    '6 mois': ['six mois'],
    'motif légitime': ['motif legitime', 'motif serieux', 'motif reel et serieux'],
  },
  curatedCaseIds: ['curated-droit-preference-locataire-vente'],
  answerNote: 'Congé bailleur : délai 6 mois avant l\'échéance du bail, motif légitime obligatoire (reprise pour habiter, vente, motif sérieux). Congé locataire : 3 mois en zone non tendue, 1 mois en zone tendue ou cas particuliers. Forme écrite obligatoire (LRAR ou acte d\'huissier).',
}

const BAIL_MEUBLE_MOBILITE: Playbook = {
  id: 'bail_meuble_mobilite',
  name: 'Bail meublé et bail mobilité',
  triggers: ['bail meublé', 'bail meuble', 'bail mobilité', 'bail mobilite', 'location meublée', 'location meublee', 'meublé étudiant', 'meuble etudiant', 'logement meublé', 'logement meuble'],
  excludeTriggers: ['tourisme', 'airbnb', 'meublé de tourisme', 'meuble de tourisme', 'location saisonnière'],
  subThemes: ['bail'],
  forcedArticles: [
    { law: 'loi 89-462', artNum: '25-4', label: 'Art. 25-4 loi 89-462 — bail meublé' },
    { law: 'loi 2018-1021', artNum: '107', label: 'Loi ELAN Art. 107 — bail mobilité' },
  ],
  requiredKeywords: ['bail meublé', 'bail mobilité', '10 mois', 'non renouvelable'],
  keywordSynonyms: {
    'bail meublé': ['bail meuble', 'location meublee'],
    'bail mobilité': ['bail mobilite'],
    '10 mois': ['dix mois'],
    'non renouvelable': ['non reconductible', 'ne peut pas etre renouvele'],
  },
  curatedCaseIds: ['curated-contrat-meuble-mentions-obligatoires'],
  answerNote: 'Bail meublé classique : durée 1 an (9 mois si étudiant), reconductible tacitement. Bail mobilité (loi ELAN) : 1 à 10 mois, strictement non renouvelable et non reconductible, réservé aux personnes en formation/mobilité professionnelle.',
}

// ---------------------------------------------------------------------------
// CLUSTER 3 — COPROPRIÉTÉ (4 playbooks)
// ---------------------------------------------------------------------------

const AG_COPROPRIETE_VOTES: Playbook = {
  id: 'ag_copropriete_votes',
  name: 'Copropriété — assemblée générale et règles de vote',
  triggers: ['assemblée générale', 'assemblee generale', 'convocation ag', 'convocation assemblée', 'ordre du jour ag', 'résolution copropriété', 'resolution copropriete', 'vote copropriétaires', 'majorité copropriété', 'double majorité'],
  subThemes: ['copropriete'],
  forcedArticles: [
    { law: 'loi 65-557', artNum: '17', label: 'Art. 17 loi 65-557 — tenue de l\'AG' },
    { law: 'loi 65-557', artNum: '18', label: 'Art. 18 loi 65-557 — missions et contrat du syndic' },
    { law: 'loi 65-557', artNum: '18-1 A', label: 'Art. 18-1 A loi 65-557 — contrat type et rémunération du syndic' },
    { law: 'loi 65-557', artNum: '24', label: 'Art. 24 loi 65-557 — majorité simple' },
    { law: 'loi 65-557', artNum: '25', label: 'Art. 25 loi 65-557 — majorité absolue' },
    { law: 'loi 65-557', artNum: '42', label: 'Art. 42 loi 65-557 — délai de contestation 2 mois' },
  ],
  requiredKeywords: ['convocation', '21 jours', 'ordre du jour', 'majorité'],
  keywordSynonyms: {
    '21 jours': ['vingt et un jours', 'trois semaines'],
    'majorité': ['majorite', 'quorum'],
  },
  curatedCaseIds: ['curated-ag-copropriete-contestation-2mois'],
  answerNote: 'Convocation AG : minimum 21 jours avant la réunion. Art. 24 = majorité simple (> 1/2 des présents/représentés). Art. 25 = majorité absolue (> 1/2 de tous les copropriétaires). Art. 26 = double majorité (2/3 des voix + majorité des copropriétaires).',
}

const CONTESTATION_AG_COPROPRIETE: Playbook = {
  id: 'contestation_ag_copropriete',
  name: 'Copropriété — contestation d\'une décision d\'AG',
  triggers: ['contester assemblée', 'contester assemblee', 'nullité résolution', 'nullite resolution', 'contestation ag', 'attaquer décision', 'attaquer decision', 'annuler vote copropriété', 'recours ag copropriété'],
  subThemes: ['copropriete'],
  forcedArticles: [
    { law: 'loi 65-557', artNum: '42', label: 'Art. 42 loi 65-557 — délai de contestation' },
  ],
  requiredKeywords: ['2 mois', 'forclusion', 'contestation', 'intérêt à agir'],
  keywordSynonyms: {
    '2 mois': ['deux mois'],
    'forclusion': ['forclose', 'prescrit', 'delai expire'],
    'intérêt à agir': ['interet a agir', 'qualite pour agir'],
  },
  curatedCaseIds: ['curated-ag-copropriete-contestation-2mois'],
  answerNote: 'Délai de contestation d\'une résolution d\'AG : 2 mois à compter de la notification du procès-verbal (art. 42 loi 65-557). Forclusion irrémédiable après ce délai, sauf action en nullité absolue (très rare). Seuls les copropriétaires opposants ou défaillants peuvent contester.',
}

const CHARGES_COPROPRIETE: Playbook = {
  id: 'charges_copropriete',
  name: 'Copropriété — charges et répartition',
  triggers: ['charges copropriété', 'charges copropriete', 'charges récupérables', 'charges recuperables', 'tantièmes', 'tantiemes', 'quote-part charges', 'repartition charges copropriete', 'provisions charges', 'appel de fonds'],
  subThemes: ['copropriete'],
  forcedArticles: [
    { law: 'loi 65-557', artNum: '10', label: 'Art. 10 loi 65-557 — répartition des charges' },
    { law: 'décret 67-223', artNum: '23', label: 'Décret 67-223 Art. 23 — charges locatives' },
  ],
  requiredKeywords: ['tantièmes', 'charges communes générales', 'règlement de copropriété'],
  keywordSynonyms: {
    'tantièmes': ['tantiemes', 'millièmes', 'milliemes', 'quote-part'],
    'charges communes générales': ['charges generales', 'charges communes'],
    'règlement de copropriété': ['reglement de copropriete', 'etat descriptif'],
  },
  curatedCaseIds: [],
  answerNote: 'Les charges se répartissent selon les tantièmes définis dans le règlement de copropriété (art. 10 loi 65-557). Deux catégories : charges communes générales (selon tantièmes) et charges spéciales (selon utilité pour chaque lot). Le syndic ne peut pas modifier la clé de répartition sans vote AG.',
}

const SYNDIC_COPROPRIETE: Playbook = {
  id: 'syndic_copropriete',
  name: 'Copropriété — obligations du syndic',
  triggers: ['obligations syndic', 'contrat syndic', 'fonds travaux', 'fonds de travaux', 'gestion syndicat', 'compte bancaire syndic', 'syndic professionnel', 'renouvellement syndic', 'responsabilité syndic'],
  subThemes: ['copropriete'],
  forcedArticles: [
    { law: 'loi 65-557', artNum: '17', label: 'Art. 17 loi 65-557 — administration de la copropriété' },
    { law: 'loi 65-557', artNum: '17-1', label: 'Art. 17-1 loi 65-557 — syndicat coopératif' },
    { law: 'loi 65-557', artNum: '18', label: 'Art. 18 loi 65-557 — missions du syndic' },
  ],
  requiredKeywords: ['syndic', 'syndicat coopératif', 'pas d\'obligation'],
  keywordSynonyms: {
    'syndicat coopératif': ['syndicat cooperatif', 'syndic cooperatif', 'syndic benevole'],
    'pas d\'obligation': ['pas d obligation', 'aucune obligation', 'n\'est pas obligatoire', 'n est pas obligatoire', 'pas obligatoire'],
    'syndic': ['le syndic', 'un syndic'],
  },
  curatedCaseIds: ['curated-elan-coproprietes-difficulte'],
  answerNote: 'Il n\'y a pas d\'obligation légale générale de recourir à un syndic professionnel (art. 17 loi 65-557). La copropriété peut opter pour un syndicat coopératif autogéré (art. 17-1) : le président du conseil syndical fait alors office de syndic bénévole. Le syndic professionnel est recommandé pour les copropriétés de plus de 15 lots mais reste optionnel. Seule la carence (absence de candidat syndic) impose une désignation judiciaire. Le syndic professionnel doit être titulaire de la carte professionnelle G (gestion) et justifier d\'une assurance RC professionnelle (art. 18 loi 65-557).',
}

// ---------------------------------------------------------------------------
// CLUSTER 4 — VENTE & CONDITIONS SUSPENSIVES (5 playbooks)
// ---------------------------------------------------------------------------

const RETRACTATION_SRU: Playbook = {
  id: 'retractation_sru',
  name: 'Vente — droit de rétractation SRU (10 jours)',
  triggers: ['rétractation', 'retractation', 'délai rétractation', 'delai retractation', '10 jours', 'dix jours', 'se rétracter', 'se retracter', 'revenir sur la vente', 'annuler le compromis', 'droit de repentir', 'SRU'],
  excludeTriggers: ['crédit', 'prêt', 'financement'],
  subThemes: ['vente_immobiliere'],
  forcedArticles: [
    { law: 'CCH', artNum: 'L271-1', label: 'Art. L271-1 CCH — délai de rétractation' },
  ],
  requiredKeywords: ['10 jours', 'rétractation', 'L271-1', 'lettre recommandée'],
  keywordSynonyms: {
    '10 jours': ['dix jours'],
    'rétractation': ['retractation', 'droit de se retracter'],
    'L271-1': ['l 271-1', 'l.271-1', 'l271-1', 'cch art. l271', 'l271'],
    'lettre recommandée': ['lrar', 'lettre recommandee', 'courrier recommande', 'recommandé avec accusé'],
  },
  curatedCaseIds: ['curated-retractation-acquereur-compromis-sru'],
  answerNote: 'Référence : Art. L271-1 CCH (loi SRU). L\'acquéreur dispose de 10 jours pour se rétracter après signature du compromis ou de la promesse. Ce délai est incompressible, aucune clause ne peut le réduire. Rétractation par lettre recommandée (LRAR) ou remise en main propre, sans motif ni pénalité. Le délai court à partir du lendemain de la première présentation de la notification.',
}

const CONDITION_SUSPENSIVE_PRET: Playbook = {
  id: 'condition_suspensive_pret',
  name: 'Vente — condition suspensive de financement',
  triggers: ['condition suspensive prêt', 'condition suspensive pret', 'refus de prêt', 'refus de pret', 'crédit refusé', 'credit refuse', 'financement non obtenu', 'banque refuse', 'banque a refusé', 'pas obtenu son prêt', 'pas obtenu son pret', 'condition suspensive de financement'],
  subThemes: ['condition_suspensive_pret'],
  forcedArticles: [
    { law: 'code civil', artNum: '1304-3', label: 'Art. 1304-3 C. civ. — condition réputée accomplie' },
    { law: 'code de la consommation', artNum: 'L313-41', label: 'Art. L313-41 C. conso — condition suspensive légale' },
  ],
  requiredKeywords: ['condition suspensive', 'bonne foi', 'diligences sérieuses', 'condition réputée accomplie'],
  keywordSynonyms: {
    'condition suspensive': ['condition suspensive de financement', 'clause de financement'],
    'diligences sérieuses': ['diligences serieuses', 'demarches necessaires', 'demarches bancaires'],
    'condition réputée accomplie': ['condition reputee accomplie', 'reputee realisee'],
  },
  curatedCaseIds: ['curated-condition-suspensive-bonne-foi'],
  answerNote: 'Si l\'acheteur ne fait pas les démarches de bonne foi (≥2 banques, dans le délai), la condition suspensive est réputée accomplie et il perd son dépôt de garantie (art. 1304-3 C. civ.). La condition légale dure 1 mois minimum (art. L313-41 C. conso).',
}

const CONDITION_SUSPENSIVE_PERMIS: Playbook = {
  id: 'condition_suspensive_permis',
  name: 'Vente — condition suspensive de permis de construire',
  triggers: ['condition suspensive permis', 'permis de construire obtention', 'sous condition d\'obtention du permis', 'condition permis construire', 'obtenir le permis avant'],
  subThemes: ['condition_suspensive_permis'],
  forcedArticles: [
    { law: 'code civil', artNum: '1304', label: 'Art. 1304 C. civ. — conditions suspensives' },
    { law: 'code de l\'urbanisme', artNum: 'L421-1', label: 'Art. L421-1 C. urb. — permis de construire' },
  ],
  requiredKeywords: ['condition suspensive', 'délai raisonnable', 'dépôt demande'],
  keywordSynonyms: {
    'délai raisonnable': ['delai raisonnable', 'dans un delai suffisant'],
    'dépôt demande': ['depot de la demande', 'depose la demande', 'depot en mairie'],
  },
  curatedCaseIds: ['curated-condition-suspensive-bonne-foi'],
  answerNote: 'L\'acquéreur doit déposer la demande de permis dans un délai raisonnable après la signature (art. 1304 C. civ.). L\'inaction ou le dépôt tardif peut être assimilé à une renonciation à la condition, rendant la vente définitive malgré le refus de permis.',
}

const VICES_CACHES: Playbook = {
  id: 'vices_caches',
  name: 'Vente — vices cachés et délai d\'action',
  triggers: ['vice caché', 'vice cache', 'vices cachés', 'vices caches', 'défaut caché', 'defaut cache', 'vendeur savait', 'défaut non apparent', 'defaut non apparent', 'malfaçon', 'malfacon', 'désordre caché', 'desordre cache'],
  subThemes: ['vente_immobiliere'],
  forcedArticles: [
    { law: 'code civil', artNum: '1641', label: 'Art. 1641 C. civ. — garantie des vices cachés' },
    { law: 'code civil', artNum: '1648', label: 'Art. 1648 C. civ. — délai d\'action 2 ans' },
  ],
  requiredKeywords: ['vice caché', '2 ans', 'découverte', 'garantie des vices'],
  keywordSynonyms: {
    '2 ans': ['deux ans', 'delai biennal', 'biennal'],
    'découverte': ['decouverte', 'a compter de la decouverte'],
    'garantie des vices': ['garantie des vices caches', 'action en garantie'],
  },
  curatedCaseIds: ['curated-vices-caches-delai-2ans'],
  answerNote: 'Délai d\'action : 2 ans à compter de la découverte du vice (art. 1648 C. civ.), dans la limite de 20 ans depuis la vente. La clause d\'exclusion de garantie est inopposable si le vendeur connaissait le vice. Le professionnel de l\'immobilier est présumé connaître les vices.',
}

const CADUCITE_COMPROMIS: Playbook = {
  id: 'caducite_compromis',
  name: 'Vente — caducité du compromis',
  triggers: ['compromis caduc', 'caducité compromis', 'caducite compromis', 'réitération dépassée', 'reiteration depassee', 'délai acte authentique', 'delai acte authentique', 'compromis non réitéré', 'compromis non reitere', 'date butoir dépassée'],
  subThemes: ['compromis_caducite'],
  forcedArticles: [
    { law: 'code civil', artNum: '1304-2', label: 'Art. 1304-2 C. civ. — renonciation à la condition' },
  ],
  requiredKeywords: ['caducité', 'clause expresse', 'mise en demeure', 'non automatiquement'],
  keywordSynonyms: {
    'caducité': ['caducite', 'caduc'],
    'clause expresse': ['clause de caducite', 'clause expresse de caducite'],
    'non automatiquement': ['pas automatiquement', 'n\'est pas automatique'],
  },
  curatedCaseIds: ['curated-annulation-vente-vendeur-apres-compromis'],
  answerNote: 'La caducité d\'un compromis n\'est pas automatique au dépassement de la date de réitération. Elle doit être prévue par une clause expresse, et une mise en demeure restée sans effet est généralement requise (art. 1304-2 C. civ.). En l\'absence de clause, la vente peut être poursuivie.',
}

// ---------------------------------------------------------------------------
// CLUSTER 5 — DIAGNOSTICS & DPE (3 playbooks)
// ---------------------------------------------------------------------------

const DPE_VALIDITE_OPPOSABILITE: Playbook = {
  id: 'dpe_validite_opposabilite',
  name: 'DPE — opposabilité et audit énergétique',
  triggers: ['dpe', 'diagnostic énergétique', 'diagnostic energetique', 'étiquette énergétique', 'etiquette energetique', 'classe énergétique', 'classe energetique', 'performance énergétique', 'performance energetique', 'audit énergétique', 'audit energetique'],
  excludeTriggers: ['interdit louer', 'interdiction location', 'ne peut plus louer', 'logement interdit', 'classé f ou g', 'classe f ou g', 'dpe f ou g', 'conséquences dpe', 'consequences dpe', 'classé f', 'classé g', 'gel des loyers'],
  subThemes: ['diagnostics'],
  forcedArticles: [
    { law: 'CCH', artNum: 'L126-26', label: 'Art. L126-26 CCH — DPE collectif' },
    { law: 'CCH', artNum: 'L271-4', label: 'Art. L271-4 CCH — DDT et DPE en vente' },
  ],
  requiredKeywords: ['DPE opposable', 'audit énergétique', 'classe énergétique', 'passoire thermique'],
  keywordSynonyms: {
    'DPE opposable': ['dpe est opposable', 'opposabilite du dpe', 'dpe engage'],
    'audit énergétique': ['audit energetique', 'audit obligatoire'],
    'passoire thermique': ['passoire thermique', 'logement tres energivore', 'classe f', 'classe g'],
  },
  curatedCaseIds: ['curated-dpe-opposabilite-diagnostiqueur'],
  answerNote: 'Depuis le 1er juillet 2021, le DPE est opposable et engage la responsabilité du diagnostiqueur (loi Climat-Résilience). L\'audit énergétique est obligatoire pour les classes F et G en vente depuis le 1er avril 2023. Validité du DPE : 10 ans (sauf exceptions pour anciens DPE).',
}

const DPE_INTERDIT_LOCATION_FG: Playbook = {
  id: 'dpe_interdit_location_fg',
  name: 'DPE — interdiction de location des passoires thermiques',
  triggers: [
    'interdit louer', 'ne peut plus louer', 'interdiction location', 'logement énergivore', 'logement energivore',
    'classe g interdite', 'classe f interdite', 'passoire interdite', 'gel des loyers', 'augmenter loyer classe',
    // Conséquences DPE F/G pour le propriétaire
    'conséquences dpe', 'consequences dpe', 'classé f ou g', 'classe f ou g', 'dpe f ou g',
    'conséquences d\'un dpe', 'consequences d\'un dpe', 'classé f', 'classé g',
  ],
  subThemes: ['diagnostics'],
  forcedArticles: [
    { law: 'CCH', artNum: 'L173-2', label: 'Art. L173-2 CCH — décence énergétique' },
    { law: 'loi 2021-1104', artNum: '159', label: 'Loi Climat et Résilience 2021 — calendrier interdictions location' },
    { law: 'décret 2021-19', artNum: '1', label: 'Décret 2021-19 — gel des loyers passoires thermiques' },
  ],
  requiredKeywords: ['interdit à la location', 'passoire thermique', 'gel des loyers', '2025'],
  keywordSynonyms: {
    'interdit à la location': ['interdit a la location', 'ne peut pas etre loue', 'interdit de louer', 'interdiction de louer'],
    'passoire thermique': ['logement energivore', 'logement énergivore', 'classe f', 'classe g', 'etiquette f', 'etiquette g'],
    'gel des loyers': ['gel loyer', 'gel des augmentations de loyer', 'gel du loyer', 'augmentation interdite'],
    '2025': ['1er janvier 2025', 'janvier 2025', 'en 2025'],
  },
  curatedCaseIds: ['curated-dpe-opposabilite-diagnostiqueur'],
  answerNote: 'Conséquences pour un propriétaire d\'un logement classé F ou G (passoire thermique) — loi Climat et Résilience 2021 (loi n° 2021-1104) : (1) gel des loyers depuis le 24 août 2022 : interdiction de louer plus cher entre deux locataires ou au renouvellement (décret 2021-19) ; (2) calendrier des interdictions de louer : classe G interdite à la location dès le 1er janvier 2025 (nouveaux contrats), classe F dès le 1er janvier 2028, classe E dès le 1er janvier 2034 (CCH art. L173-2) ; (3) audit énergétique obligatoire avant vente depuis le 1er avril 2023 pour les classes F/G en monopropriété.',
}

const DIAGNOSTICS_DDT: Playbook = {
  id: 'diagnostics_ddt',
  name: 'DDT — diagnostics techniques obligatoires',
  triggers: ['amiante', 'plomb', 'carrez', 'termites', 'crep', 'dapp', 'diagnostics obligatoires', 'dossier de diagnostic', 'diagnostic avant vente', 'electricite diagnostic', 'gaz diagnostic'],
  excludeTriggers: ['construit en 1998', 'construit en 1999', 'construit en 200', 'apres 1997', 'après 1997', 'apres juillet 1997', 'après juillet 1997'],
  subThemes: ['diagnostics'],
  forcedArticles: [
    { law: 'CCH', artNum: 'L271-4', label: 'Art. L271-4 CCH — DDT obligatoire en vente' },
  ],
  requiredKeywords: ['DDT', 'dossier de diagnostic technique', 'diagnostic obligatoire'],
  keywordSynonyms: {
    'DDT': ['ddt', 'dossier technique'],
    'dossier de diagnostic technique': ['dossier de diagnostics techniques'],
  },
  curatedCaseIds: ['curated-diagnostic-amiante-seuil-1997', 'curated-erp-etat-risques-pollutions', 'curated-dpe-opposabilite-diagnostiqueur'],
  answerNote: 'Le DDT (dossier de diagnostics techniques) doit être annexé au compromis. Diagnostics selon l\'ancienneté et la localisation : amiante (avant 1997), plomb CREP (avant 1949), termites (zones concernées), électricité/gaz (> 15 ans), DPE, Carrez (copropriété). Absence = défaut d\'information du vendeur.',
}

// ---------------------------------------------------------------------------
// CLUSTER 6 — CONSTRUCTION & VEFA (2 playbooks)
// ---------------------------------------------------------------------------

const GARANTIE_DECENNALE: Playbook = {
  id: 'garantie_decennale',
  name: 'Construction — garantie décennale et garanties légales',
  triggers: ['garantie décennale', 'garantie decennale', 'décennale', 'decennale', 'responsabilité constructeur', 'responsabilite constructeur', 'dommages ouvrage', 'dommage ouvrage', 'parfait achèvement', 'parfait achevement', 'biennale', 'réception travaux', 'reception travaux'],
  subThemes: ['construction'],
  forcedArticles: [
    { law: 'code civil', artNum: '1792', label: 'Art. 1792 C. civ. — garantie décennale' },
    { law: 'code civil', artNum: '1792-2', label: 'Art. 1792-2 C. civ. — éléments d\'équipement' },
    { law: 'code civil', artNum: '1792-3', label: 'Art. 1792-3 C. civ. — garantie biennale' },
  ],
  requiredKeywords: ['garantie décennale', '10 ans', 'réception', 'constructeur'],
  keywordSynonyms: {
    'garantie décennale': ['garantie decennale', 'responsabilite decennale'],
    '10 ans': ['dix ans', 'pendant dix ans'],
    'réception': ['reception', 'proces verbal de reception'],
  },
  curatedCaseIds: ['curated-garantie-decennale-1792'],
  answerNote: 'Garantie décennale (art. 1792 C. civ.) : 10 ans depuis la réception, couvre les désordres compromettant la solidité ou rendant impropre à la destination. Parfait achèvement : 1 an (réserves de réception). Biennale (art. 1792-3) : 2 ans pour les éléments d\'équipement dissociables.',
}

const VEFA_ACQUEREUR: Playbook = {
  id: 'vefa_acquereur',
  name: 'VEFA — garantie d\'achèvement et droits de l\'acquéreur',
  triggers: ['vefa', 'vente en l\'état futur d\'achèvement', 'vente en etat futur', 'promoteur', 'livraison appartement neuf', 'appartement sur plan', 'appels de fonds vefa', 'retard livraison', 'promoteur en difficulté'],
  subThemes: ['construction'],
  forcedArticles: [
    { law: 'CCH', artNum: 'L261-10', label: 'Art. L261-10 CCH — contrat VEFA' },
    { law: 'CCH', artNum: 'L261-10-1', label: 'Art. L261-10-1 CCH — garantie financière d\'achèvement' },
  ],
  requiredKeywords: ['VEFA', 'garantie financière d\'achèvement', 'promoteur', 'appels de fonds'],
  keywordSynonyms: {
    'VEFA': ['vente en etat futur d\'achevement', 'vente sur plan'],
    'garantie financière d\'achèvement': ['gfa', 'garantie d\'achevement', 'garantie financiere'],
    'appels de fonds': ['appel de fonds', 'versements par etapes'],
  },
  curatedCaseIds: ['curated-vefa-garantie-achevement'],
  answerNote: 'En VEFA, le promoteur doit fournir une GFA (garantie financière d\'achèvement) avant tout appel de fonds. Les versements sont plafonnés par stade : 35% à achèvement fondations, 70% hors d\'eau, 95% achèvement (CCH art. L261-10). En cas de défaillance, la GFA garantit la livraison.',
}

// ---------------------------------------------------------------------------
// CLUSTER 7 — FISCALITÉ (2 playbooks)
// ---------------------------------------------------------------------------

const PLUS_VALUE_IMMOBILIERE: Playbook = {
  id: 'plus_value_immobiliere',
  name: 'Fiscalité — plus-value immobilière',
  triggers: ['plus-value immobilière', 'plus-value immobiliere', 'plus value immobilière', 'impôt sur la cession', 'impot sur la cession', 'exonération résidence principale', 'exoneration residence principale', 'taxe cession immobilier', 'imposition vente immobilier', 'abattement durée détention'],
  subThemes: ['fiscalite'],
  forcedArticles: [
    { law: 'CGI', artNum: '150 U', label: 'Art. 150 U CGI — plus-values immobilières' },
    { law: 'CGI', artNum: '150 VC', label: 'Art. 150 VC CGI — abattements pour durée de détention' },
  ],
  requiredKeywords: ['plus-value immobilière', 'résidence principale', 'exonération', 'abattement', 'durée de détention'],
  keywordSynonyms: {
    'plus-value immobilière': ['plus-value immobiliere', 'plus value'],
    'résidence principale': ['residence principale'],
    'durée de détention': ['duree de detention', 'anciennete', 'nombre d\'annees'],
  },
  curatedCaseIds: ['curated-plus-value-residence-principale'],
  answerNote: 'Exonération totale pour la résidence principale. Pour les autres biens : abattements progressifs pour durée de détention (CGI art. 150 VC). Exonération totale IR après 22 ans, exonération prélèvements sociaux après 30 ans. Taux global : 36,2% (19% IR + 17,2% PS) avant abattements.',
}

const LMNP_BIC_FISCAL: Playbook = {
  id: 'lmnp_bic_fiscal',
  name: 'Fiscalité — LMNP, BIC et revenus fonciers',
  triggers: ['lmnp', 'bic immobilier', 'meublé non professionnel', 'meuble non professionnel', 'revenus fonciers', 'impôt sur la fortune', 'fortune immobilière', 'fortune immobiliere', 'sci fiscalité', 'sci fiscalite', 'déficit foncier', 'deficit foncier', 'micro foncier', 'micro-bic', 'pinel', 'denormandie'],
  subThemes: ['fiscalite'],
  forcedArticles: [
    { law: 'CGI', artNum: '35', label: 'Art. 35 CGI — BIC location meublée' },
    { law: 'CGI', artNum: '885 I', label: 'Art. 885 I CGI — IFI et immobilier' },
  ],
  requiredKeywords: ['LMNP', 'BIC', 'revenus fonciers', 'régime micro', 'abattement'],
  keywordSynonyms: {
    'LMNP': ['loueur meuble non professionnel'],
    'régime micro': ['micro-bic', 'micro bic', 'regime micro'],
    'abattement': ['abattement forfaitaire', 'abattement de 50%'],
  },
  curatedCaseIds: ['curated-plus-value-residence-secondaire', 'curated-dispositif-denormandie'],
  answerNote: 'Location meublée = BIC (pas revenus fonciers). LMNP : micro-BIC (abattement 50%, plafond 77 700€) ou réel (amortissement possible). Location nue = revenus fonciers (micro-foncier 30% si < 15 000€ ou réel). SCI à l\'IR : revenus fonciers. SCI à l\'IS : impôt société.',
}

// ---------------------------------------------------------------------------
// CLUSTER 8 — URBANISME (2 playbooks)
// ---------------------------------------------------------------------------

const PERMIS_CONSTRUIRE: Playbook = {
  id: 'permis_construire',
  name: 'Urbanisme — permis de construire et déclaration préalable',
  triggers: ['permis de construire', 'déclaration préalable', 'declaration prealable', 'dp travaux', 'autorisation travaux', 'surface plancher', 'extension maison', 'construction nouvelle'],
  subThemes: ['urbanisme'],
  forcedArticles: [
    { law: 'code de l\'urbanisme', artNum: 'L421-1', label: 'Art. L421-1 C. urb. — permis de construire' },
    { law: 'code de l\'urbanisme', artNum: 'L421-2', label: 'Art. L421-2 C. urb. — déclaration préalable' },
  ],
  requiredKeywords: ['permis de construire', 'déclaration préalable', 'surface plancher'],
  keywordSynonyms: {
    'déclaration préalable': ['declaration prealable', 'dp'],
    'surface plancher': ['surface de plancher', 'surface habitable'],
  },
  curatedCaseIds: [],
  answerNote: 'Permis de construire requis au-delà de 20 m² de surface plancher (5 m² en zone protégée). Déclaration préalable entre 5 et 20 m². En zone urbaine avec PLU : seuil PC relevé à 40 m² pour les extensions. Délai d\'instruction : 2 mois (PC) ou 1 mois (DP).',
}

const DROIT_PREEMPTION_DPU: Playbook = {
  id: 'droit_preemption_dpu',
  name: 'Urbanisme — droit de préemption urbain',
  triggers: ['droit de préemption', 'droit de preemption', 'dpu', 'dia', 'préemption commune', 'preemption commune', 'purge préemption', 'purge preemption', 'mairie préempte', 'collectivité préempte'],
  subThemes: ['urbanisme'],
  forcedArticles: [
    { law: 'code de l\'urbanisme', artNum: 'L211-1', label: 'Art. L211-1 C. urb. — DPU' },
    { law: 'code de l\'urbanisme', artNum: 'L213-2', label: 'Art. L213-2 C. urb. — délai d\'exercice' },
  ],
  requiredKeywords: ['droit de préemption', 'DIA', '2 mois', 'collectivité'],
  keywordSynonyms: {
    'droit de préemption': ['droit de preemption', 'dpu'],
    'DIA': ['dia', 'declaration d\'intention d\'aliener'],
    '2 mois': ['deux mois'],
  },
  curatedCaseIds: ['curated-dpu-purge-delais'],
  answerNote: 'La commune a 2 mois pour exercer son DPU après réception de la DIA (déclaration d\'intention d\'aliéner) par le notaire (C. urb. art. L213-2). Sans réponse dans ce délai = renonciation implicite à la préemption. La DIA doit mentionner le prix de vente.',
}

// ---------------------------------------------------------------------------
// CLUSTER 9 — VIAGER & DÉMEMBREMENT (1 playbook)
// ---------------------------------------------------------------------------

const VIAGER_RENTE_VIAGERE: Playbook = {
  id: 'viager_rente_viagere',
  name: 'Viager — rente viagère et bouquet',
  triggers: ['viager', 'rente viagère', 'rente viagere', 'bouquet', 'crédirentier', 'creditentier', 'débirentier', 'debirentier', 'vente en viager', 'viager occupé', 'viager libre'],
  subThemes: ['viager_demembrement'],
  forcedArticles: [
    { law: 'code civil', artNum: '1968', label: 'Art. 1968 C. civ. — constitution de la rente' },
    { law: 'code civil', artNum: '1976', label: 'Art. 1976 C. civ. — durée de la rente' },
    { law: 'code civil', artNum: '1983', label: 'Art. 1983 C. civ. — défaut de paiement' },
  ],
  requiredKeywords: ['rente viagère', 'bouquet', 'espérance de vie', 'clause résolutoire', 'paiement à vie'],
  keywordSynonyms: {
    'rente viagère': ['rente viagere', 'rente mensuelle', 'versements viagers'],
    'bouquet': ['capital initial', 'versement initial'],
    'espérance de vie': ['esperance de vie', 'tables de mortalite', 'statistiques insee'],
    'paiement à vie': ['paiement a vie', 'jusqu\'au deces', 'jusqu\'a son deces'],
  },
  curatedCaseIds: ['curated-rente-viagere-calcul-obligations'],
  answerNote: 'Le viager comporte un bouquet (versé comptant) et une rente viagère jusqu\'au décès du crédirentier. La rente est calculée sur l\'espérance de vie (tables INSEE) et la valeur du bien. En cas de défaut de paiement, la clause résolutoire permet au crédirentier de récupérer le bien (art. 1983 C. civ.).',
}

// ---------------------------------------------------------------------------
// CLUSTER 10 — ALUR & TEXTES RÉCENTS (2 playbooks)
// ---------------------------------------------------------------------------

const ALUR_GARANTIES_LOCATIVES: Playbook = {
  id: 'alur_garanties_locatives',
  name: 'ALUR — GUL, Visale et garantie locative',
  triggers: ['gul', 'visale', 'garantie loyers impayés', 'garantie loyers impayes', 'action logement', 'garantie locative alur', 'garantie universelle loyers', 'garantie impayés', 'garantie impayes'],
  subThemes: ['bail'],
  forcedArticles: [
    { law: 'loi 2014-366', artNum: '23', label: 'Art. 23 loi ALUR — garantie universelle des loyers' },
  ],
  requiredKeywords: ['Visale', 'Action Logement', 'garantie des loyers', 'encadrement loyers'],
  keywordSynonyms: {
    'Visale': ['visale', 'visa pour le logement et l\'emploi'],
    'Action Logement': ['action logement', 'ex-1% logement'],
    'garantie des loyers': ['garantie loyers impayes', 'gli', 'couverture impayés'],
  },
  curatedCaseIds: ['curated-gul-abandonnee-visale', 'curated-encadrement-loyers-villes-2024'],
  answerNote: 'La GUL (Garantie Universelle des Loyers, loi ALUR art. 23) n\'a jamais été mise en place. Son remplaçant opérationnel est Visale (Action Logement), gratuit pour bailleur et locataire. Il existe aussi la GLI (Garantie Loyers Impayés) privée, souscrite par le bailleur.',
}

const ZAN_URBANISME_RECENTS: Playbook = {
  id: 'zan_urbanisme_recents',
  name: 'ZAN, BRS et textes d\'urbanisme récents',
  triggers: ['zan', 'zéro artificialisation nette', 'zero artificialisation nette', 'artificialisation des sols', 'brs', 'bail réel solidaire', 'bail reel solidaire', 'loi climat urbanisme', 'objectifs zéro artificialisation'],
  subThemes: ['urbanisme'],
  forcedArticles: [
    { law: 'loi 2021-1104', artNum: 'L141-8', label: 'Art. L141-8 — objectif ZAN dans les SRADDET' },
    { law: 'code de l\'urbanisme', artNum: 'L211-3', label: 'Art. L211-3 C. urb. — bail réel solidaire' },
  ],
  requiredKeywords: ['zéro artificialisation nette', '2050', 'artificialisation', 'PLU'],
  keywordSynonyms: {
    'zéro artificialisation nette': ['zero artificialisation nette', 'zan'],
    '2050': ['en 2050', 'horizon 2050'],
    'PLU': ['plan local d\'urbanisme', 'scot'],
  },
  curatedCaseIds: ['curated-bail-reel-solidaire-brs'],
  answerNote: 'Objectif ZAN (loi Climat-Résilience, art. L141-8) : réduction de 50% de l\'artificialisation à horizon 2031 par rapport à 2011-2021, puis zéro nette en 2050. Les PLU et SCOT doivent intégrer ces objectifs. Le BRS (bail réel solidaire) est un outil de dissociation foncier/bâti pour l\'accession sociale.',
}

// ---------------------------------------------------------------------------
// CLUSTER 11 — BAIL COMMERCIAL (1 playbook)
// ---------------------------------------------------------------------------

const BAIL_COMMERCIAL_3_6_9: Playbook = {
  id: 'bail_commercial_3_6_9',
  name: 'Bail commercial — statut 3-6-9 et renouvellement',
  triggers: ['bail commercial', 'bail 3-6-9', '3 6 9', 'renouvellement bail commercial', 'indemnité d\'éviction', 'indemnite d eviction', 'révision loyer commercial', 'revision loyer commercial', 'droit au bail', 'pas de porte', 'résiliation bail commercial', 'resiliation bail commercial', 'déspécialisation', 'despecialisation', 'cession bail commercial'],
  excludeTriggers: ['bail habitation', 'loi 89-462', 'dépôt de garantie locataire'],
  subThemes: ['bail_commercial'],
  forcedArticles: [
    { law: 'code de commerce', artNum: 'L145-1', label: 'Art. L145-1 C. com. — champ d\'application' },
    { law: 'code de commerce', artNum: 'L145-4', label: 'Art. L145-4 C. com. — durée minimale 9 ans' },
    { law: 'code de commerce', artNum: 'L145-14', label: 'Art. L145-14 C. com. — droit au renouvellement' },
    { law: 'code de commerce', artNum: 'L145-33', label: 'Art. L145-33 C. com. — fixation loyer renouvelé' },
  ],
  requiredKeywords: ['bail commercial', '9 ans', 'renouvellement', 'indemnité d\'éviction'],
  keywordSynonyms: {
    'bail commercial': ['bail professionnel', 'statut des baux commerciaux'],
    '9 ans': ['neuf ans', 'durée minimale'],
    'renouvellement': ['droit au renouvellement', 'renouvellement du bail'],
    'indemnité d\'éviction': ['indemnite d eviction', 'indemnite eviction'],
  },
  curatedCaseIds: ['curated-bail-commercial-renouvellement'],
  answerNote: 'Le bail commercial (statut des baux commerciaux, art. L145-1 et s. C. com.) a une durée minimale de 9 ans (art. L145-4), résiliable par le preneur tous les 3 ans. Le locataire bénéficie d\'un droit au renouvellement (art. L145-14). En cas de refus, le bailleur doit une indemnité d\'éviction. Le loyer du bail renouvelé est plafonné à l\'ILC (art. L145-33).',
}

// ---------------------------------------------------------------------------
// Registre complet des 31 playbooks
// ---------------------------------------------------------------------------

export const PLAYBOOKS: Playbook[] = [
  // Mandat & Commission
  COMMISSION_ACTE_OBLIGATOIRE,
  COMMISSION_PARTAGE_INTER_AGENCES,
  MANDAT_EXPIRE_COMMISSION,
  DEVOIR_CONSEIL_AGENT,
  // Bail d'habitation
  CLAUSE_RESOLUTOIRE_COMMANDEMENT,
  DEPOT_GARANTIE_RESTITUTION,
  TREVE_HIVERNALE,
  ENCADREMENT_LOYERS_ZONES,
  CONGE_LOCATAIRE_BAILLEUR,
  BAIL_MEUBLE_MOBILITE,
  // Copropriété
  AG_COPROPRIETE_VOTES,
  CONTESTATION_AG_COPROPRIETE,
  CHARGES_COPROPRIETE,
  SYNDIC_COPROPRIETE,
  // Vente & Conditions suspensives
  RETRACTATION_SRU,
  CONDITION_SUSPENSIVE_PRET,
  CONDITION_SUSPENSIVE_PERMIS,
  VICES_CACHES,
  CADUCITE_COMPROMIS,
  // Diagnostics & DPE
  DPE_VALIDITE_OPPOSABILITE,
  DPE_INTERDIT_LOCATION_FG,
  DIAGNOSTICS_DDT,
  // Construction & VEFA
  GARANTIE_DECENNALE,
  VEFA_ACQUEREUR,
  // Fiscalité
  PLUS_VALUE_IMMOBILIERE,
  LMNP_BIC_FISCAL,
  // Urbanisme
  PERMIS_CONSTRUIRE,
  DROIT_PREEMPTION_DPU,
  // Viager
  VIAGER_RENTE_VIAGERE,
  // ALUR & Textes récents
  ALUR_GARANTIES_LOCATIVES,
  ZAN_URBANISME_RECENTS,
  // Bail commercial
  BAIL_COMMERCIAL_3_6_9,
]

// ---------------------------------------------------------------------------
// Détection — même pattern que detectSubTheme() dans judilibre.ts
// ---------------------------------------------------------------------------

/**
 * Détecte le playbook applicable à une question.
 * Retourne le premier playbook dont un trigger est présent dans la question,
 * sauf si un excludeTrigger est aussi présent.
 */
export function detectPlaybook(question: string): Playbook | null {
  const lower = question.toLowerCase()

  for (const playbook of PLAYBOOKS) {
    // Vérifier d'abord les excludeTriggers
    if (playbook.excludeTriggers?.some(ex => lower.includes(ex))) {
      continue
    }
    // Vérifier si au moins un trigger matche
    if (playbook.triggers.some(trigger => lower.includes(trigger))) {
      return playbook
    }
  }

  return null
}

/**
 * Récupère un playbook par son id.
 */
export function getPlaybookById(id: string): Playbook | undefined {
  return PLAYBOOKS.find(p => p.id === id)
}
