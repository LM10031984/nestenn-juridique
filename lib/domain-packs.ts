// lib/domain-packs.ts
// Domain packs : couverture juridique de domaine — niveau supérieur aux playbooks
// Un domain pack couvre un domaine entier (ex: baux_habitation) et produit un cadre
// juridique utile même sans playbook matché.
// Le domain pack est enrichi par un playbook overlay lorsqu'un playbook correspond à la question.

import type { PlaybookAuthorityHint } from './legal-playbooks'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type DomainPackArchetype = {
  /** Identifiant snake_case de l'archétype question */
  id: string
  /** Description lisible du type de question couvert */
  description: string
  /** Si un playbook V2 couvre cet archétype, son id */
  linkedPlaybookId?: string
  /** Niveau de couverture actuel */
  status: 'covered' | 'candidate' | 'not_covered'
}

export type DomainPackFallbackRule = {
  /** Mots-clés normalisés (minuscules, sans accents) qui déclenchent cette règle */
  triggerKeywords: string[]
  /** IDs de pivotArticles à forcer si cette règle se déclenche */
  forcedPivotArticleIds: string[]
  /** Distinctions obligatoires supplémentaires pour cet archétype */
  mandatoryDistinctions: string[]
  /** Archétype logique couvert par cette règle */
  archetypeId: string
  note?: string
}

export type DomainPackAuthorityConstraint = {
  /** Loi ou code concerné (normalisé minuscules) */
  authority: string
  /** Portée d'application de cette autorité */
  scope: string
  /** Exceptions ou cas d'exclusion */
  exceptions?: string[]
}

export type DomainPackPivotCase = {
  court: 'cass' | 'ca'
  holding: string
  /** Archétypes pour lesquels cette jurisprudence est pertinente */
  relevantForArchetypes: string[]
}

export type DomainPack = {
  id: string
  domain: string
  summary: string
  /** Articles toujours pertinents dans ce domaine, indépendamment de la question */
  pivotArticles: PlaybookAuthorityHint[]
  /** Jurisprudence de référence du domaine */
  pivotCases: DomainPackPivotCase[]
  /** Distinctions juridiques récurrentes dans tout le domaine */
  recurringDistinctions: string[]
  /** Assertions interdites dans tout le domaine */
  forbiddenAssertions: string[]
  /** Actions pratiques toujours pertinentes dans ce domaine */
  practicalActions: string[]
  /** Contraintes de portée par autorité */
  authorityScopeConstraints: DomainPackAuthorityConstraint[]
  /** Types de questions couverts par ce domain pack */
  archetypesCovered: DomainPackArchetype[]
  /** Règles de repli si aucun playbook ne matche */
  fallbackRules: DomainPackFallbackRule[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain pack : baux_habitation
// Couvre les baux d'habitation principale régis par la loi n° 89-462 du 6 juillet 1989
// ─────────────────────────────────────────────────────────────────────────────

export const BAUX_HABITATION_PACK: DomainPack = {
  id: 'baux_habitation_v1',
  domain: 'baux_habitation',
  summary:
    "Domain pack couvrant les baux d'habitation principale régis par la loi n° 89-462 du 6 juillet 1989 (loyers impayés/expulsion, dépôt de garantie, congés, trêve hivernale, décence, sous-location, colocation).",

  // ── Articles pivot ──────────────────────────────────────────────────────────
  // Présents quel que soit l'archétype détecté
  pivotArticles: [
    {
      law: 'loi 89-462',
      artNum: '22',
      label:
        "Art. 22 loi 89-462 — dépôt de garantie : montant maximal (1 mois loyer hors charges pour bail nu, 2 mois pour meublé), délai de restitution (1 mois si pas de retenues, 2 mois sinon)",
      required: false,
    },
    {
      law: 'loi 89-462',
      artNum: '24',
      label:
        "Art. 24 loi 89-462 — clause résolutoire : commandement de payer par commissaire de justice, délai de 2 mois, rôle du juge, suspension possible",
      required: false,
    },
    {
      law: 'loi 89-462',
      artNum: '15',
      label:
        "Art. 15 loi 89-462 — congé du bailleur : trois cas limitatifs (reprise, vente, motif légitime et sérieux), préavis 6 mois, forme du congé (LRAR ou acte de commissaire de justice)",
      required: false,
    },
    {
      law: 'loi 89-462',
      artNum: '15-I',
      label:
        "Art. 15-I loi 89-462 — congé du locataire : préavis 3 mois réduit à 1 mois en zone tendue, perte d'emploi, mutation, état de santé",
      required: false,
    },
    {
      law: 'code des procédures civiles d\'exécution',
      artNum: 'L412-6',
      label:
        "Art. L412-6 CPCE — trêve hivernale : suspension des expulsions du 1er novembre au 31 mars, exceptions légales",
      required: false,
    },
    {
      law: 'code civil',
      artNum: '1719',
      label:
        "Art. 1719 Code civil — obligation du bailleur de délivrer un logement décent et de l'entretenir",
      required: false,
    },
    {
      law: 'code civil',
      artNum: '1728',
      label:
        "Art. 1728 Code civil — obligation du locataire de payer le loyer et d'user du bien en bon père de famille",
      required: false,
    },
    {
      law: 'loi 89-462',
      artNum: '8',
      label:
        "Art. 8 loi 89-462 — sous-location interdite sans accord écrit préalable du bailleur",
      required: false,
    },
    {
      law: 'décret 2002-120',
      artNum: '1',
      label:
        "Décret n° 2002-120 du 30 janvier 2002 — critères de décence du logement : surface, équipements, sécurité, performance énergétique",
      required: false,
    },
  ],

  // ── Jurisprudence pivot ─────────────────────────────────────────────────────
  pivotCases: [
    {
      court: 'cass',
      holding:
        "La clause résolutoire ne peut jouer qu'après un commandement de payer délivré par commissaire de justice et l'expiration du délai de 2 mois sans régularisation (Cass. 3e civ., application loi 89-462 art. 24).",
      relevantForArchetypes: ['loyers_impayes_expulsion'],
    },
    {
      court: 'cass',
      holding:
        "L'état des lieux de sortie incomplet ou absent renverse la présomption en faveur du locataire : le bailleur ne peut pas justifier des retenues sur dépôt de garantie sans preuves concordantes (Cass. 3e civ., application loi 89-462 art. 22).",
      relevantForArchetypes: ['depot_garantie_restitution'],
    },
    {
      court: 'cass',
      holding:
        "Le congé pour vente doit mentionner les conditions de l'offre de vente adressée au locataire à peine de nullité (Cass. 3e civ., application loi 89-462 art. 15).",
      relevantForArchetypes: ['conge_bailleur'],
    },
  ],

  // ── Distinctions récurrentes ────────────────────────────────────────────────
  // S'appliquent à tout le domaine, enrichissent le brief même sans playbook
  recurringDistinctions: [
    "bail nu (loi 89-462 titre I) ≠ bail meublé (loi 89-462 titre II) : délais de préavis, dépôt de garantie maximal et durée du bail diffèrent",
    "zone tendue (communes listées par décret) ≠ hors zone tendue : impact direct sur le préavis locataire (1 mois vs 3 mois), l'encadrement des loyers et les conditions de congé bailleur",
    "loi 89-462 s'applique uniquement à la résidence principale — location saisonnière, bail commercial, bail code civil ne relèvent pas de ce régime",
    "bailleur personne physique ou SCI familiale ≠ bailleur institutionnel ou personne morale : certains congés pour reprise réservés aux personnes physiques",
    "procédure judiciaire (tribunal judiciaire) ≠ exécution de la décision (commissaire de justice) : deux étapes distinctes, toutes deux obligatoires pour une expulsion légale",
  ],

  // ── Assertions interdites ───────────────────────────────────────────────────
  forbiddenAssertions: [
    'le bailleur peut expulser directement sans décision de justice',
    'le bailleur peut changer les serrures ou couper les fluides lui-même',
    'le dépôt de garantie peut être conservé sans justification ni document probatoire',
    'la trêve hivernale s\'applique sans exception à toute situation d\'expulsion',
    'un préavis de 3 mois s\'applique systématiquement au locataire dans toutes les communes de France',
    'le loyer peut être augmenté librement sans référence à l\'IRL ni respect de l\'encadrement',
    'la sous-location est libre si le bail ne la mentionne pas explicitement',
    'le locataire peut être expulsé immédiatement après un seul impayé',
  ],

  // ── Actions pratiques génériques ────────────────────────────────────────────
  practicalActions: [
    "Vérifier si la commune est en zone tendue (liste fixée par décret annuel) : impact direct sur le préavis locataire, l'encadrement des loyers et les conditions de congé du bailleur.",
    "Conserver systématiquement toutes les pièces écrites : bail signé, états des lieux d'entrée et de sortie, lettres recommandées avec AR, quittances de loyer, photos datées.",
    "Avant toute procédure judiciaire, tenter la commission départementale de conciliation (CDC) — gratuite, rapide (1 à 2 mois), et obligatoire pour certains litiges (révision de loyer, charges).",
    "Pour tout congé ou signification officielle, préférer le recommandé avec AR ou l'acte de commissaire de justice : la preuve de réception est indispensable pour que le délai commence à courir.",
    "Vérifier si le locataire perçoit des aides au logement (APL, ALS, ALF) : signalement à la CAF/MSA permet le tiers-payant — souvent plus rapide que la procédure judiciaire pour régulariser un impayé.",
  ],

  // ── Contraintes de portée par autorité ─────────────────────────────────────
  authorityScopeConstraints: [
    {
      authority: 'loi 89-462',
      scope:
        "S'applique uniquement aux locations à usage d'habitation principale du locataire (art. 2). Les locations saisonnières, bail meublé de courte durée (Airbnb), locaux mixtes professionnels/habitation et baux commerciaux ne relèvent pas de ce régime.",
      exceptions: [
        "Logements foyers et résidences universitaires CROUS — régime spécifique",
        "Bail mobilité (durée 1 à 10 mois, art. 25-12 loi 89-462) — règles allégées",
      ],
    },
    {
      authority: 'code des procédures civiles d\'exécution art. l412-6',
      scope:
        "Trêve hivernale applicable du 1er novembre au 31 mars de chaque année : suspend l'exécution des décisions d'expulsion, pas la procédure judiciaire elle-même.",
      exceptions: [
        "Logements déclarés insalubres ou dangereux par arrêté",
        "Locataire dont le relogement est assuré dans des conditions suffisantes",
        "Squatteurs (n'ayant jamais eu de titre d'occupation valide)",
        "Personnes ayant fait l'objet d'une mesure d'expulsion pour violences au domicile",
      ],
    },
    {
      authority: 'décret 2002-120',
      scope:
        "Critères de décence applicables aux logements loués comme résidence principale. Un logement indécent peut justifier une suspension du loyer ou des travaux imposés au bailleur.",
      exceptions: [
        "Depuis la loi ELAN 2018 et la loi Climat 2021 : les logements classés G sont progressivement interdits à la location (calendrier d'entrée en vigueur 2025–2028)",
      ],
    },
  ],

  // ── Archétypes couverts ─────────────────────────────────────────────────────
  archetypesCovered: [
    {
      id: 'loyers_impayes_expulsion',
      description:
        "Locataire ne payant plus son loyer, procédure de commandement de payer, clause résolutoire et expulsion",
      linkedPlaybookId: 'baux_loyers_impayes_expulsion',
      status: 'covered',
    },
    {
      id: 'depot_garantie_restitution',
      description:
        "Restitution (ou retenue) du dépôt de garantie, état des lieux, preuve des dégradations",
      status: 'candidate',
    },
    {
      id: 'conge_bailleur',
      description:
        "Congé délivré par le bailleur (reprise, vente, motif légitime), conditions de forme et délais",
      status: 'candidate',
    },
    {
      id: 'conge_locataire',
      description:
        "Congé donné par le locataire, préavis (3 mois ou 1 mois en zone tendue), formalités",
      status: 'candidate',
    },
    {
      id: 'treve_hivernale',
      description:
        "Application de la trêve hivernale (1er novembre – 31 mars), exceptions, impact sur l'exécution d'une expulsion",
      status: 'candidate',
    },
    {
      id: 'decence_logement',
      description:
        "Logement indécent ou insalubre, obligations du bailleur, recours du locataire",
      status: 'candidate',
    },
    {
      id: 'sous_location',
      description:
        "Sous-location autorisée ou non, formalités, risques pour le locataire principal",
      status: 'candidate',
    },
    {
      id: 'colocation_solidarite',
      description:
        "Solidarité entre colocataires, sortie d'un colocataire, clause de solidarité et ses limites",
      status: 'candidate',
    },
  ],

  // ── Règles de repli sans playbook ───────────────────────────────────────────
  // Si aucun playbook ne matche, ces règles déterminent quel sous-cadre utiliser
  fallbackRules: [
    {
      archetypeId: 'loyers_impayes_expulsion',
      triggerKeywords: [
        'loyer impaye',
        'loyers impayes',
        'locataire ne paie',
        'locataire ne paye',
        'commandement de payer',
        'clause resolutoire',
        'expulser',
        'expulsion locataire',
        'procedure expulsion',
      ],
      forcedPivotArticleIds: ['loi 89-462|24', 'code des procédures civiles d\'exécution|L412-6', 'code des procédures civiles d\'exécution|L411-1'],
      mandatoryDistinctions: [
        "commandement de payer (acte de commissaire de justice) ≠ mise en demeure amiable : seul le commandement déclenche le délai légal de 2 mois",
        "trêve hivernale suspend l'exécution de l'expulsion, pas la procédure judiciaire",
        "expulsion sans décision de justice : voie de fait, exposant le bailleur à des sanctions pénales",
      ],
    },
    {
      archetypeId: 'depot_garantie_restitution',
      triggerKeywords: [
        'depot de garantie',
        'dépôt de garantie',
        'caution locataire',
        'restitution caution',
        'rendre caution',
        'retenir caution',
        'etat des lieux sortie',
        'état des lieux de sortie',
      ],
      forcedPivotArticleIds: ['loi 89-462|22'],
      mandatoryDistinctions: [
        "bail nu : dépôt de garantie plafonné à 1 mois de loyer hors charges (art. 22 loi 89-462)",
        "délai de restitution : 1 mois si ELS conforme à l'entrée, 2 mois sinon — tout dépassement entraîne une majoration de 10 % par mois",
        "retenues justifiées : uniquement sur présentation de justificatifs (devis, factures) et correspondance avec l'état des lieux",
        "état des lieux absent ou incomplet : présomption de bon état en faveur du locataire (art. 3-2 loi 89-462)",
      ],
    },
    {
      archetypeId: 'conge_bailleur',
      triggerKeywords: [
        'conge bailleur',
        'congé bailleur',
        'congé pour vente',
        'conge pour vente',
        'congé pour reprise',
        'conge pour reprise',
        'donner conge locataire',
        'reprendre logement',
        'reprendre le logement',
        'vendre logement loue',
        'vendre bien loue',
        'donne conge',
        'donner conge',
        'conge pour reprendre',
      ],
      forcedPivotArticleIds: ['loi 89-462|15'],
      mandatoryDistinctions: [
        "congé pour vente : locataire bénéficie d'un droit de préemption (art. 15-II loi 89-462) — offre de vente obligatoire dans le congé",
        "congé pour reprise : réservé au bailleur personne physique pour lui-même, son conjoint, partenaire PACS, ascendants ou descendants",
        "congé pour motif légitime et sérieux : caractère légitime apprécié strictement par les tribunaux",
        "préavis de 6 mois minimum avant l'échéance du bail, sous peine de nullité du congé",
        "en zone tendue : conditions supplémentaires de forme et de fond pour le congé pour vente",
      ],
    },
    {
      archetypeId: 'conge_locataire',
      triggerKeywords: [
        'conge locataire',
        'congé locataire',
        'partir logement',
        'quitter logement',
        'preavis locataire',
        'préavis locataire',
        'donner son preavis',
        'reduire preavis',
        'preavis 1 mois',
        'preavis reduit',
        'delai de preavis',
        'quitter mon logement',
        'quitter mon appartement',
      ],
      forcedPivotArticleIds: ['loi 89-462|15-I'],
      mandatoryDistinctions: [
        "préavis de droit commun : 3 mois pour un bail nu, 1 mois pour un bail meublé",
        "préavis réduit à 1 mois : zone tendue, perte d'emploi involontaire, mutation professionnelle, état de santé justifiant un changement de logement, bénéficiaire du RSA ou d'une allocation adulte handicapé",
        "le préavis court à compter de la réception du congé par le bailleur (pas de la date d'envoi)",
        "forme obligatoire : lettre recommandée avec AR, acte de commissaire de justice ou remise en main propre contre récépissé",
      ],
    },
    {
      archetypeId: 'treve_hivernale',
      triggerKeywords: [
        'treve hivernale',
        'trêve hivernale',
        'expulsion hiver',
        'expulsion novembre',
        'expulsion mars',
        'expulsion periode hivernale',
        'protection hiver locataire',
      ],
      forcedPivotArticleIds: ['code des procédures civiles d\'exécution|L412-6'],
      mandatoryDistinctions: [
        "la trêve hivernale (1er novembre – 31 mars) suspend uniquement l'exécution de l'expulsion, pas la procédure judiciaire ni l'obtention du jugement",
        "exceptions à la trêve : logements dangereux, relogement assuré, squatteurs (personnes sans titre)",
        "la procédure peut donc être initiée et le jugement obtenu pendant la trêve pour exécution dès le 1er avril",
      ],
    },
    {
      archetypeId: 'decence_logement',
      triggerKeywords: [
        'logement indecent',
        'logement indigne',
        'décence',
        'decence',
        'insalubre',
        'humidité',
        'humidite',
        'manque de chauffage',
        'surface minimale',
        'logement trop petit',
        'normes logement',
      ],
      forcedPivotArticleIds: ['code civil|1719', 'décret 2002-120|1'],
      mandatoryDistinctions: [
        "logement indécent (décret 2002-120) ≠ logement insalubre (CSP art. L1331-26) : régimes et recours différents",
        "recours du locataire : mise en demeure du bailleur, commission départementale de conciliation, tribunal judiciaire, ADIL",
        "le locataire ne peut pas suspendre unilatéralement le paiement du loyer sans décision judiciaire",
        "depuis la loi Climat 2021 : logements classés G progressivement interdits à la location (calendrier 2025–2028)",
      ],
    },
    {
      archetypeId: 'sous_location',
      triggerKeywords: [
        'sous-location',
        'sous location',
        'sous-louer',
        'sous louer',
        'sous-loue',
        'sous loue',
        'airbnb locataire',
        'locataire airbnb',
        'locataire sous-loue',
        'locataire sous loue',
        'louer son logement',
        'louer appartement loue',
        'heberger quelquun',
        'accord bailleur sous-location',
      ],
      forcedPivotArticleIds: ['loi 89-462|8'],
      mandatoryDistinctions: [
        "sous-location sans accord écrit du bailleur : résiliation du bail possible et condamnation du locataire à restituer les profits perçus",
        "accord du bailleur requis : doit être préalable, exprès et écrit — un accord tacite ne suffit pas",
        "le loyer de sous-location ne peut excéder le loyer principal (art. 8 loi 89-462)",
        "location Airbnb de courte durée : réglementation spécifique (autorisation mairie dans certaines communes), fiscalité propre",
      ],
    },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
// Registre des domain packs disponibles
// ─────────────────────────────────────────────────────────────────────────────

export const DOMAIN_PACKS: DomainPack[] = [BAUX_HABITATION_PACK]

/**
 * Retourne le domain pack correspondant à un domaine, ou null si non couvert.
 */
export function getDomainPack(domain: string): DomainPack | null {
  return DOMAIN_PACKS.find((p) => p.domain === domain) ?? null
}

/**
 * Retourne la fallback rule la mieux adaptée à la question, ou null.
 * Normalise la question (minuscules, sans accents) avant de comparer.
 */
export function matchFallbackRule(
  domainPack: DomainPack,
  question: string,
): DomainPackFallbackRule | null {
  const normalized = normalizeForMatching(question)

  let bestRule: DomainPackFallbackRule | null = null
  let bestScore = 0

  for (const rule of domainPack.fallbackRules) {
    let score = 0
    for (const kw of rule.triggerKeywords) {
      // Normaliser aussi le keyword pour uniformiser la comparaison
      if (normalized.includes(normalizeForMatching(kw))) {
        score += 1
      }
    }
    if (score > bestScore) {
      bestScore = score
      bestRule = rule
    }
  }

  return bestRule
}

function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['']/g, ' ')
    .replace(/[-]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
