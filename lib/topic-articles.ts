// lib/topic-articles.ts
// Topic-Article Index (T2AI) — injection déterministe d'articles pour TOUT topic,
// indépendamment des playbooks. Couvre les questions sans playbook complet.
//
// Différence avec playbooks.ts :
//   - Les playbooks font la détection + injection + VALIDATION (requiredKeywords, correction)
//   - Le T2AI fait uniquement l'injection d'articles + curated IDs (pas de validation)
//   - Les deux systèmes se combinent : playbook en priorité, T2AI en fallback

import type { ForcedArticle } from './playbooks'

export interface TopicArticleEntry {
  id: string
  triggers: string[]          // lowercase, OR logique — un seul suffit
  excludeTriggers?: string[]  // si présent → ne pas déclencher
  forcedArticles: ForcedArticle[]
  curatedCaseIds: string[]    // source_ids dans table jurisprudence (curated=true)
  answerNote?: string         // hint injecté dans le system prompt pour guider le LLM
}

// ---------------------------------------------------------------------------
// Topic-Article Index
// ---------------------------------------------------------------------------

const TOPIC_ARTICLE_INDEX: TopicArticleEntry[] = [

  // ── DIAGNOSTICS ─────────────────────────────────────────────────────────

  {
    id: 'dpe_fg_consequences',
    triggers: [
      'dpe f', 'dpe g', 'classé f', 'classé g', 'passoire thermique',
      'logement énergivore', 'logement energivore', 'interdiction location',
      'logement g interdit', 'classe energetique', 'classe énergétique',
      'conséquences dpe', 'consequences dpe',
    ],
    forcedArticles: [
      { law: 'loi 2021-1104', artNum: '160', label: 'Art. 160 loi Climat et Résilience — gel loyers logements F/G' },
      { law: 'loi 2021-1104', artNum: '159', label: 'Art. 159 — interdiction location logements très énergivores' },
      { law: 'CCH', artNum: 'L173-2', label: 'Art. L173-2 CCH — calendrier interdictions' },
      { law: 'décret 2021-19', artNum: '1', label: 'Décret 2021-19 — gel des loyers passoires thermiques' },
    ],
    curatedCaseIds: ['curated-logements-g-interdits-location-2025', 'curated-dpe-fg-consequences-proprietaire'],
    answerNote: 'Conséquences pour un logement classé F ou G (passoire thermique) : (1) gel des loyers depuis le 25 août 2022 — interdiction d\'augmenter le loyer entre deux locataires ou au renouvellement (décret 2021-19) ; (2) interdiction de louer les logements G depuis le 1er janvier 2025 pour les nouveaux contrats (loi Climat et Résilience 2021) ; (3) obligation d\'audit énergétique avant vente en monopropriété depuis le 1er avril 2023.',
  },

  {
    id: 'dpe_collectif_calendrier',
    triggers: [
      'dpe collectif', 'dpe de copropriété', 'dpe de copropriete',
      'plan pluriannuel', 'audit energetique copropriete', 'audit énergétique copropriété',
      'calendrier dpe', 'obligation dpe copropriété',
    ],
    forcedArticles: [
      { law: 'loi 2021-1104', artNum: '158', label: 'Art. 158 — DPE collectif obligatoire' },
      { law: 'CCH', artNum: 'L126-31', label: 'Art. L126-31 CCH — DPE collectif copropriétés' },
      { law: 'CCH', artNum: 'L126-32', label: 'Art. L126-32 CCH — plan pluriannuel de travaux' },
    ],
    curatedCaseIds: ['curated-dpe-collectif-calendrier'],
  },

  {
    id: 'amiante_diagnostic',
    triggers: [
      'amiante', 'diagnostic amiante', 'dta', 'dossier technique amiante',
      'construit avant 1997', 'construit avant 1998', 'avant juillet 1997',
    ],
    forcedArticles: [
      { law: 'code de la santé publique', artNum: 'R1334-14', label: 'Art. R1334-14 — repérage amiante avant travaux' },
      { law: 'code de la santé publique', artNum: 'L1334-13', label: 'Art. L1334-13 — dossier technique amiante' },
      { law: 'décret 96-97', artNum: '1', label: 'Décret 96-97 — amiante dans bâtiments' },
    ],
    curatedCaseIds: ['curated-diagnostic-amiante-seuil-1997', 'curated-amiante-seuil-1997-v2'],
  },

  // ── BAIL D'HABITATION ────────────────────────────────────────────────────

  {
    id: 'decence_logement',
    triggers: [
      'décence', 'decence', 'logement décent', 'logement decent',
      'critères de décence', 'normes de décence', 'logement indécent',
      'obligations propriétaire décence', 'obligation décence',
    ],
    forcedArticles: [
      { law: 'loi 89-462', artNum: '6', label: 'Art. 6 — obligation de décence du logement' },
      { law: 'décret 2002-120', artNum: '2', label: 'Décret 2002-120 — critères de décence' },
      { law: 'décret 2002-120', artNum: '3', label: 'Décret 2002-120 — superficie minimale' },
    ],
    curatedCaseIds: ['curated-decence-logement-obligations'],
  },

  {
    id: 'droit_preference_locataire',
    triggers: [
      'droit de préférence', 'droit de preference', 'droit de préemption locataire',
      'congé pour vente', 'vente occupée', 'locataire prioritaire',
      'locataire en place vente', 'priorité achat locataire',
    ],
    forcedArticles: [
      { law: 'loi 89-462', artNum: '15', label: 'Art. 15 — congé pour vente et droit de préférence' },
      { law: 'loi 89-462', artNum: '10-1', label: 'Art. 10-1 — information locataire' },
    ],
    curatedCaseIds: ['curated-droit-preference-locataire-vente'],
  },

  {
    id: 'article_24_bail_modification',
    triggers: [
      'article 24', 'art. 24', 'art 24',
      'commandement de payer modifié', 'commandement de payer elan',
      'loi elan commandement', 'modification article 24',
    ],
    excludeTriggers: ['comment fonctionne article 24'],
    forcedArticles: [
      { law: 'loi 89-462', artNum: '24', label: 'Art. 24 — commandement de payer (version ELAN)' },
      { law: 'loi 2018-1021', artNum: '125', label: 'Art. 125 ELAN — modification art. 24 loi 89-462' },
    ],
    curatedCaseIds: ['curated-article-24-loi-89-462-commandement'],
  },

  // ── AGENT IMMOBILIER & LOI HOGUET ────────────────────────────────────────

  {
    id: 'negociateur_salarie_mandats',
    triggers: [
      'négociateur salarié', 'negociateur salarie', 'salarié agent immobilier',
      'employé agent immobilier', 'collaborateur salarié', 'assistant peut signer',
      'qui peut signer mandat', 'habilitation signature',
    ],
    forcedArticles: [
      { law: 'loi 70-9', artNum: '4', label: 'Art. 4 — habilitation des collaborateurs' },
      { law: 'décret 72-678', artNum: '9', label: 'Décret 72-678 Art. 9 — collaborateurs habilités' },
    ],
    curatedCaseIds: ['curated-negociateur-salarie-mandats'],
  },

  {
    id: 'mandat_honoraires_alur',
    triggers: [
      'mandat sans honoraires acquéreur', 'mandat sans honoraires acquereur',
      'honoraires à la charge vendeur', 'honoraires charge vendeur',
      'loi alur honoraires', 'alur mandat', 'mandat net vendeur',
      'honoraires acquéreur valide', 'honoraires acquereur valide',
    ],
    forcedArticles: [
      { law: 'loi 2014-366', artNum: '74', label: 'Art. 74 ALUR — honoraires à la charge du vendeur uniquement' },
      { law: 'loi 70-9', artNum: '6', label: 'Art. 6 loi Hoguet — conditions de rémunération' },
    ],
    curatedCaseIds: ['curated-mandat-honoraires-alur'],
  },

  {
    id: 'responsabilite_agent_vices',
    triggers: [
      'agent responsable vices cachés', 'agent vices caches',
      'agent savait vice', 'responsabilité agent vice',
      'agent caché information', 'agent n\'a pas informé vice',
      'est-il responsable des vices cachés', 'responsable des vices cachés',
      'agent immobilier est-il responsable',
    ],
    forcedArticles: [
      { law: 'code civil', artNum: '1641', label: 'Art. 1641 — garantie des vices cachés' },
      { law: 'code civil', artNum: '1240', label: 'Art. 1240 — responsabilité délictuelle' },
      { law: 'loi 70-9', artNum: '1', label: 'Art. 1 loi Hoguet — obligations agent' },
    ],
    curatedCaseIds: ['curated-vices-caches-responsabilite-agent', 'curated-devoir-conseil-agent'],
  },

  {
    id: 'devoir_conseil_jurisprudence',
    triggers: [
      'devoir de conseil jurisprudence', 'étendue devoir conseil',
      'jusqu\'où devoir conseil', 'jusqu\'ou devoir conseil',
      'limite devoir conseil', 'portée devoir conseil',
      'jurisprudence devoir conseil agent',
    ],
    forcedArticles: [
      { law: 'loi 70-9', artNum: '1', label: 'Art. 1 loi Hoguet — obligation d\'information' },
      { law: 'code civil', artNum: '1240', label: 'Art. 1240 — responsabilité délictuelle' },
    ],
    curatedCaseIds: ['curated-devoir-conseil-agent', 'curated-devoir-conseil-etat-bien'],
  },

  // ── VENTE IMMOBILIÈRE ────────────────────────────────────────────────────

  {
    id: 'viager_calcul_rente',
    triggers: [
      'viager', 'rente viagère', 'rente viagere', 'calcul rente',
      'débirentier', 'debirentier', 'crédirentier', 'credirentier',
      'bouquet viager', 'occupation viagère', 'vente en viager',
    ],
    forcedArticles: [
      { law: 'code civil', artNum: '1968', label: 'Art. 1968 — définition rente viagère' },
      { law: 'code civil', artNum: '1976', label: 'Art. 1976 — calcul rente viagère' },
      { law: 'code civil', artNum: '1978', label: 'Art. 1978 — résolution vente viager' },
    ],
    curatedCaseIds: ['curated-rente-viagere-calcul-obligations'],
  },

  {
    id: 'responsabilite_notaire_condition_suspensive',
    triggers: [
      'responsabilité notaire', 'responsabilite notaire',
      'notaire condition suspensive', 'faute notaire',
      'notaire prêt', 'notaire clause', 'notaire mal rédigé',
    ],
    forcedArticles: [
      { law: 'code civil', artNum: '1240', label: 'Art. 1240 — responsabilité délictuelle notaire' },
      { law: 'code civil', artNum: '1304-3', label: 'Art. 1304-3 — condition suspensive' },
      { law: 'code de la consommation', artNum: 'L313-41', label: 'Art. L313-41 code conso — condition suspensive prêt obligatoire' },
      { law: 'décret 71-941', artNum: '1', label: 'Décret 71-941 — statut notaire' },
    ],
    curatedCaseIds: ['curated-responsabilite-notaire-condition-suspensive', 'curated-condition-suspensive-bonne-foi'],
  },

  // ── FISCALITÉ IMMOBILIÈRE ────────────────────────────────────────────────

  {
    id: 'denormandie',
    triggers: [
      'denormandie', 'dispositif denormandie',
      'réduction impôt rénovation', 'investissement locatif ancien',
      'loi denormandie',
    ],
    forcedArticles: [
      { law: 'CGI', artNum: '199 novovicies', label: 'Art. 199 novovicies CGI — dispositif Denormandie' },
      { law: 'loi 2018-1021', artNum: '226', label: 'Art. 226 ELAN — création dispositif Denormandie' },
    ],
    curatedCaseIds: ['curated-dispositif-denormandie'],
  },

  // ── COPROPRIÉTÉ ─────────────────────────────────────────────────────────

  {
    id: 'copropriete_majorites_ag',
    triggers: [
      'majorité simple', 'majorité absolue', 'double majorité', 'majorité des présents',
      'majorité des membres du syndicat', 'article 24 copropriété', 'article 25 copropriété',
      'voter en ag', 'vote assemblée générale copropriété', 'différence majorité',
    ],
    forcedArticles: [
      { law: 'loi 65-557', artNum: '24', label: 'Art. 24 — majorité simple (présents + représentés)' },
      { law: 'loi 65-557', artNum: '25', label: 'Art. 25 — majorité absolue (tous les membres)' },
      { law: 'loi 65-557', artNum: '26', label: 'Art. 26 — double majorité (grands travaux)' },
    ],
    curatedCaseIds: ['curated-ag-copropriete-contestation-2mois'],
    answerNote: 'Art. 24 — majorité simple : voix des copropriétaires présents, représentés et ayant voté par correspondance (majorité des présents et représentés). Art. 25 — majorité absolue : voix de tous les membres du syndicat qu\'ils soient présents ou absents (majorité des membres du syndicat). Art. 26 — double majorité : majorité des membres représentant au moins les 2/3 des voix pour les décisions les plus lourdes.',
  },

  {
    id: 'copropriete_syndic_travaux',
    triggers: [
      'syndic travaux sans vote', 'syndic engage travaux', 'travaux urgents copropriété',
      'travaux conservatoires', 'syndic sans assemblée', 'travaux sans ag',
      'peut engager des travaux', 'engager des travaux sans', 'travaux sans vote',
      'syndic peut-il engager', 'syndic peut il engager',
    ],
    forcedArticles: [
      { law: 'loi 65-557', artNum: '18', label: 'Art. 18 — pouvoirs du syndic' },
      { law: 'décret 67-223', artNum: '37', label: 'Décret 67-223 Art. 37 — travaux urgents' },
    ],
    curatedCaseIds: [],
    answerNote: 'Le syndic peut engager des travaux sans vote AG uniquement en cas d\'urgence (travaux conservatoires indispensables à la sauvegarde de l\'immeuble), dans la limite du plafond fixé par l\'assemblée générale ou le règlement de copropriété (art. 18 loi 65-557 + décret 67-223 art. 37). Il doit en informer immédiatement le conseil syndical et convoquer une AG pour ratification a posteriori. Hors urgence, tout travaux nécessite un vote en AG.',
  },

  {
    id: 'copropriete_charges_repartition',
    triggers: [
      'charges de copropriété répartition', 'comment réparties charges',
      'quote-part charges', 'tantièmes charges', 'répartition charges copropriété',
      'comment sont réparties', 'réparties les charges', 'répartition entre copropriétaires',
      'répartition des charges entre',
    ],
    forcedArticles: [
      { law: 'loi 65-557', artNum: '10', label: 'Art. 10 — répartition des charges' },
      { law: 'décret 67-223', artNum: '23', label: 'Décret 67-223 Art. 23 — charges communes' },
    ],
    curatedCaseIds: [],
    answerNote: 'Les charges de copropriété sont réparties entre copropriétaires selon les tantièmes (quote-part) définis dans le règlement de copropriété (art. 10 loi 65-557). Les charges générales (entretien des parties communes, administration) sont réparties proportionnellement aux valeurs relatives des lots. Les charges spéciales (ascenseur, chauffage collectif) peuvent être réparties selon l\'utilité de chaque lot.',
  },

  {
    id: 'copropriete_location_touristique',
    triggers: [
      'location touristique copropriété', 'airbnb copropriété', 'meublé tourisme copropriété',
      'règlement copropriété interdire location', 'clause habitation bourgeoise',
      'règlement interdit airbnb', 'airbnb', 'copropriété airbnb',
      'interdire la location touristique', 'interdire airbnb', 'location saisonnière copropriété',
    ],
    forcedArticles: [
      { law: 'loi 65-557', artNum: '8', label: 'Art. 8 — règlement de copropriété et destination des lots' },
      { law: 'loi 65-557', artNum: '9', label: 'Art. 9 — jouissance des parties privatives' },
    ],
    curatedCaseIds: [],
    answerNote: 'Un règlement de copropriété peut interdire la location touristique type Airbnb si la destination de l\'immeuble est exclusivement bourgeoise ou d\'habitation stricte (clause d\'habitation bourgeoise, art. 8 loi 65-557). En cas d\'usage mixte (habitation + professionnel), la location touristique est généralement tolérée. Les juges vérifient la destination de l\'immeuble et le règlement de copropriété au cas par cas.',
  },

  {
    id: 'copropriete_syndic_professionnel',
    triggers: [
      'syndic professionnel obligatoire', 'obligation syndic professionnel',
      'syndicat coopératif', 'syndicat cooperatif', 'quand syndic professionnel',
      'plus de 15 lots syndic', 'syndic professionnel',
      'faire appel à un syndic', 'faire appel a un syndic',
      'obligatoire de faire appel', 'quand est-il obligatoire',
    ],
    forcedArticles: [
      { law: 'loi 65-557', artNum: '17', label: 'Art. 17 — administration de la copropriété' },
      { law: 'loi 65-557', artNum: '17-1', label: 'Art. 17-1 — syndicat coopératif' },
    ],
    curatedCaseIds: [],
    answerNote: 'Il n\'y a pas d\'obligation légale générale de recourir à un syndic professionnel (art. 17 loi 65-557). Le syndicat peut opter pour un syndicat coopératif autogéré (art. 17-1), où le président du conseil syndical fait office de syndic. Le syndic professionnel est recommandé pour les copropriétés de plus de 15 lots mais reste optionnel. Seuls les cas de carence de syndic (absence de candidature) imposent une désignation judiciaire.',
  },

  // ── DIAGNOSTICS ─────────────────────────────────────────────────────────

  {
    id: 'dpe_validite_duree',
    triggers: [
      'durée validité dpe', 'validité dpe', 'dpe encore valable', 'dpe valide combien',
      'dpe périmé', 'dpe expire', 'durée de validité diagnostic énergétique',
      'durée de validité', 'durée du dpe', 'validité d un dpe', 'valide pour une location',
      'combien de temps le dpe', 'combien de temps un dpe', 'dpe valable',
    ],
    forcedArticles: [
      { law: 'décret 2021-872', artNum: '1', label: 'Décret 2021-872 — durée validité DPE 10 ans' },
      { law: 'loi 2021-1104', artNum: '158', label: 'Art. 158 — DPE opposable et durée' },
    ],
    curatedCaseIds: ['curated-dpe-transitoire-expiration-2024', 'curated-dpe-opposabilite-diagnostiqueur'],
  },

  {
    id: 'dpe_erronne_responsabilite',
    triggers: [
      'dpe erroné', 'dpe faux', 'dpe inexact', 'dpe incorrect',
      'erreur dpe acheteur', 'dpe erroné conséquences', 'diagnostiqueur responsable',
      'dpe est erroné', 'si un dpe est', 'dpe errone', 'dpe était erroné',
    ],
    forcedArticles: [
      { law: 'loi 2021-1104', artNum: '158', label: 'Art. 158 — opposabilité du DPE' },
      { law: 'code civil', artNum: '1240', label: 'Art. 1240 — responsabilité diagnostiqueur' },
    ],
    curatedCaseIds: ['curated-dpe-errone-consequences-acheteur', 'curated-dpe-opposabilite-diagnostiqueur'],
  },

  // ── TRANSACTIONS ────────────────────────────────────────────────────────

  {
    id: 'compromis_vente_general',
    triggers: [
      'qu\'est-ce que le compromis', 'compromis de vente définition',
      'conditions suspensives compromis', 'conditions suspensives habituelles',
      'compromis et conditions', 'promesse synallagmatique',
    ],
    excludeTriggers: ['caducité compromis', 'annuler compromis'],
    forcedArticles: [
      { law: 'code civil', artNum: '1589', label: 'Art. 1589 — promesse de vente vaut vente' },
      { law: 'code civil', artNum: '1304', label: 'Art. 1304 — conditions suspensives' },
    ],
    curatedCaseIds: ['curated-condition-suspensive-bonne-foi'],
    answerNote: 'Le compromis de vente (promesse synallagmatique) vaut vente dès la signature (art. 1589 C. civ.). Conditions suspensives habituelles : (1) obtention du prêt bancaire (délai 45-60 jours, L313-41 code conso) ; (2) obtention du permis de construire si projet de construction ; (3) absence de préemption par la commune (DPU). Délai de rétractation acheteur : 10 jours (art. L271-1 CCH).',
  },

  {
    id: 'sinistre_anterieur_erp',
    triggers: [
      'sinistre antérieur', 'sinistre non déclaré', 'sinistre avant vente',
      'vendeur déclare sinistre', 'etat des risques sinistre', 'erp sinistre',
      'réticence dolosive sinistre',
    ],
    forcedArticles: [
      { law: 'code civil', artNum: '1240', label: 'Art. 1240 — responsabilité délictuelle' },
      { law: 'code des assurances', artNum: 'L125-5', label: 'Art. L125-5 — ERP et sinistres' },
      { law: 'code civil', artNum: '1137', label: 'Art. 1137 — réticence dolosive' },
    ],
    curatedCaseIds: ['curated-sinistre-anterieur-erp-non-declare', 'curated-reticence-dolosive-vendeur'],
    answerNote: 'Il n\'y a pas de délai légal de déclaration pour le vendeur : l\'obligation est pré-contractuelle. L\'ERP (état des risques et pollutions) doit être annexé au compromis AVANT signature (art. L125-5 code des assurances). Si le vendeur omet volontairement un sinistre antérieur qu\'il connaissait, il engage sa responsabilité pour dol/réticence dolosive (art. 1137 et 1240 C. civ.). L\'acheteur dispose ensuite de 5 ans pour agir en nullité pour dol à compter de la découverte du sinistre.',
  },

  // ── URBANISME ────────────────────────────────────────────────────────────

  {
    id: 'permis_construire_delai',
    triggers: [
      'délai permis de construire', 'délai instruction permis', 'mairie instruit permis',
      'délai instruction mairie', '2 mois permis', '3 mois permis',
      'instruit par la mairie', 'délai d instruction', 'permis instruit',
      'combien de temps pour un permis', 'délai de traitement permis',
      'permis de construire est-il instruit', 'permis de construire instruit',
    ],
    forcedArticles: [
      { law: 'code de l\'urbanisme', artNum: 'R423-23', label: 'Art. R423-23 — délai instruction permis construire' },
      { law: 'code de l\'urbanisme', artNum: 'R424-1', label: 'Art. R424-1 — décision sur permis' },
    ],
    curatedCaseIds: [],
    answerNote: 'Délais d\'instruction du permis de construire (art. R423-23 code urbanisme) : 2 mois pour une maison individuelle, 3 mois pour les autres constructions et les ERP (établissements recevant du public). Ces délais courent à compter de la réception du dossier complet. Au-delà, le silence vaut acceptation tacite (sauf exceptions). Des délais spéciaux peuvent s\'appliquer en secteur protégé (ABF, site classé).',
  },

  // ── BAIL — SOUS-LOCATION ─────────────────────────────────────────────────

  {
    id: 'sous_location_bail',
    triggers: [
      'sous-louer', 'sous-location', 'sous louer', 'sous-loc',
      'sous-loue', 'sous-locataire', 'autorisation sous-location',
    ],
    forcedArticles: [
      { law: 'loi 89-462', artNum: '8', label: 'Art. 8 loi 89-462 — sous-location interdite sans accord' },
    ],
    curatedCaseIds: [],
    answerNote: 'La sous-location est interdite sans accord écrit et exprès du propriétaire (art. 8 loi 89-462). Réponse : non, le locataire ne peut pas sous-louer sans obtenir l\'accord écrit du bailleur. De plus, le loyer de sous-location ne peut excéder le loyer principal payé par le locataire principal. En cas de sous-location non autorisée : résiliation du bail et dommages-intérêts possible. L\'accord du propriétaire doit être donné par écrit.',
  },

  // ── URBANISME — CERTIFICAT D'URBANISME ───────────────────────────────────

  {
    id: 'certificat_urbanisme',
    triggers: [
      'certificat d\'urbanisme', 'certificat urbanisme', 'cu informatif', 'cu opérationnel',
      'cu operationnel', 'certificat d urbanisme', 'demande certificat urbanisme',
    ],
    forcedArticles: [
      { law: 'code de l\'urbanisme', artNum: 'L410-1', label: 'Art. L410-1 code de l\'urbanisme — certificat d\'urbanisme' },
    ],
    curatedCaseIds: [],
    answerNote: 'Il existe deux types de certificat d\'urbanisme (art. L410-1 code de l\'urbanisme) : (1) CU informatif (CUa) : renseigne sur les règles d\'urbanisme applicables à la parcelle (PLU, limitations, taxes) — délai instruction : 1 mois ; (2) CU opérationnel (CUb) : indique si le projet de construction envisagé est réalisable sur la parcelle — délai instruction : 2 mois. Durée de validité : 18 mois, prorogeable. Pendant ce délai, les règles d\'urbanisme applicables à la date du certificat sont cristallisées et garantissent au demandeur les règles applicables.',
  },

  // ── COPROPRIÉTÉ — TRAVAUX PARTIES COMMUNES ───────────────────────────────

  {
    id: 'travaux_parties_communes',
    triggers: [
      'travaux dans les parties communes', 'travaux parties communes',
      'réaliser des travaux dans les parties', 'realiser des travaux dans les parties',
      'règles pour travaux copropriété', 'règles travaux parties communes',
      'autorisation travaux parties communes', 'parties communes travaux',
    ],
    forcedArticles: [
      { law: 'loi 65-557', artNum: '25', label: 'Art. 25 loi 65-557 — majorité absolue travaux parties communes' },
      { law: 'loi 65-557', artNum: '24', label: 'Art. 24 loi 65-557 — majorité simple' },
    ],
    curatedCaseIds: [],
    answerNote: 'Les travaux sur les parties communes nécessitent un vote en assemblée générale à la majorité absolue de l\'article 25 (voix de tous les membres du syndicat, présents ou absents). La maîtrise d\'ouvrage des travaux revient au syndic, mandaté par l\'AG. Sans vote AG : les travaux sont irréguliers et peuvent être remis en état aux frais du copropriétaire fautif. Exceptions : travaux urgents engagés par le syndic seul (art. 18 loi 65-557).',
  },

  // ── FISCALITÉ — SCI CESSION DE PARTS ────────────────────────────────────

  {
    id: 'sci_cession_parts_fiscalite',
    triggers: [
      'cession de parts sci', 'cession de parts d\'une sci', 'cession parts sci', 'vente parts sci',
      'vente de parts sci', 'différence fiscale sci', 'difference fiscale sci',
      'cession sci vs vente', 'sci et vente directe', 'parts sociales sci',
      'fiscalité cession sci', 'fiscalite cession sci', 'cession de parts',
    ],
    forcedArticles: [
      { law: 'CGI', artNum: '150 UB', label: 'Art. 150 UB CGI — plus-values cession parts sociétés à prépondérance immobilière' },
      { law: 'CGI', artNum: '726', label: 'Art. 726 CGI — droits d\'enregistrement cession parts sociales' },
    ],
    curatedCaseIds: [],
    answerNote: 'Différence fiscale entre cession de parts de SCI et vente directe du bien : (1) Droits d\'enregistrement : cession de parts sociales = 5% du prix (art. 726 CGI) sur la valeur des parts ; vente directe bien immobilier = env. 7-8% frais de notaire (dont DMTO 5,8%) ; (2) Plus-value : cession de parts SCI à l\'IR = régime des plus-values immobilières (abattement pour durée de détention, art. 150 UB CGI), appliqué au niveau de l\'associé sur la quote-part de la plus-value ; vente directe = même régime, mais taxe directement sur le bien. La cession de parts permet d\'éviter les droits de mutation normaux mais génère des droits d\'enregistrement à 5%.',
  },

  // ── COPROPRIÉTÉ — ACCESSIBILITÉ LOI HANDICAP ─────────────────────────────

  {
    id: 'accessibilite_handicap_copropriete',
    triggers: [
      'travaux accessibilité', 'accessibilité handicap', 'loi handicap copropriété',
      'personnes handicapées copropriété', 'travaux handicap copropriété',
      'accessibilite handicap', 'loi 2005-102', 'accessibilite personnes handicapees',
      'travaux d\'accessibilité', 'coût travaux accessibilité',
    ],
    forcedArticles: [
      { law: 'loi 2005-102', artNum: '45', label: 'Loi 2005-102 — accessibilité des personnes handicapées' },
      { law: 'loi 65-557', artNum: '24', label: 'Art. 24 loi 65-557 — majorité article 24 travaux accessibilité' },
    ],
    curatedCaseIds: [],
    answerNote: 'Les travaux d\'accessibilité imposés par la loi handicap (loi 2005-102) dans les parties communes d\'une copropriété sont votés à la majorité de l\'article 24 (majorité simple des voix des copropriétaires présents et représentés) — et non à la majorité absolue de l\'article 25. Le coût est supporté par l\'ensemble des copropriétaires proportionnellement à leurs tantièmes. Des dérogations peuvent être accordées par la commission d\'accessibilité en cas d\'impossibilité technique ou de disproportion manifeste du coût.',
  },

  // ── URGENCE — ASSIGNATION EN JUSTICE ─────────────────────────────────────

  {
    id: 'assignation_procedure_judiciaire',
    triggers: [
      'assignation en justice', 'j\'ai reçu une assignation', 'assignation d\'un acheteur',
      'reçu une assignation', 'recu une assignation', 'assignation judiciaire',
      'j ai recu une assignation', 'assigné en justice',
    ],
    forcedArticles: [
      { law: 'code de procédure civile', artNum: '56', label: 'Art. 56 CPC — mentions obligatoires assignation' },
      { law: 'code civil', artNum: '1240', label: 'Art. 1240 code civil — responsabilité civile' },
    ],
    curatedCaseIds: [],
    answerNote: '⚡ URGENT — Dès réception d\'une assignation en justice : (1) lire attentivement la date d\'audience et le tribunal désigné ; (2) constituer avocat immédiatement (obligatoire devant TJ si enjeu > 10 000 €) — délai de constitution variable mais souvent 15 jours avant audience ; (3) préparer les conclusions : délai fixé par le juge de la mise en état ou indiqué dans l\'assignation. Ne pas ignorer une assignation sous peine de jugement par défaut. En matière civile, l\'article 1240 du code civil peut fonder une action en responsabilité délictuelle.',
  },

  // ── ANTI-BLANCHIMENT ────────────────────────────────────────────────────

  {
    id: 'anti_blanchiment_agent',
    triggers: [
      'anti-blanchiment', 'anti blanchiment', 'lcb-ft', 'lcbft',
      'tracfin', 'déclaration de soupçon', 'vigilance client',
      'blanchiment immobilier', 'obligations lcb',
      'lutte contre le blanchiment', 'financement terrorisme agent',
    ],
    forcedArticles: [
      { law: 'CMF', artNum: 'L561-2', label: 'Art. L561-2 CMF — assujettis LCB-FT' },
      { law: 'CMF', artNum: 'L561-5', label: 'Art. L561-5 CMF — obligation de vigilance' },
      { law: 'CMF', artNum: 'L561-15', label: 'Art. L561-15 CMF — déclaration de soupçon TRACFIN' },
      { law: 'loi 70-9', artNum: '1', label: 'Art. 1 loi Hoguet — agents immobiliers assujettis' },
    ],
    curatedCaseIds: ['curated-anti-blanchiment-agent-immobilier'],
  },

]

// ---------------------------------------------------------------------------
// Détection du topic
// ---------------------------------------------------------------------------

export function detectTopicArticles(message: string): TopicArticleEntry | null {
  const lower = message.toLowerCase()

  for (const entry of TOPIC_ARTICLE_INDEX) {
    // Vérifier exclusions
    if (entry.excludeTriggers?.some(excl => lower.includes(excl))) {
      continue
    }
    // Vérifier triggers (OR logique)
    if (entry.triggers.some(trigger => lower.includes(trigger))) {
      return entry
    }
  }

  return null
}
