// lib/authority-cards.ts
// Transforme les sources résolues (articles Légifrance, jurisprudence Judilibre)
// en cartes d'autorité structurées — résumé sobre, pas d'injection brute de texte
// Phase 1 : format carte = règle + portée + réserve éventuelle

import type { TaggedArticle } from './post-treatment'
import type { TaggedCase } from './post-treatment'

export type AuthorityCard = {
  tag: string
  kind: 'article' | 'jurisprudence'
  source: string
  rule: string
  scope: string
  caveat?: string
  practicalImpact?: string
  articleNum?: string   // sourceArticle du TaggedArticle — ex: 'L271-1', '1731', 'L1331-11-1'
}

// ─────────────────────────────────────────────────────────────────────────────
// Articles → AuthorityCard[]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transforme les TaggedArticle en AuthorityCard.
 * Le texte brut de l'article n'est pas injecté directement — on extrait
 * une règle principale et une portée à partir du titre et de la source.
 * En phase 1 : résumé sobre basé sur les métadonnées disponibles.
 */
export function articlesToAuthorityCards(articles: TaggedArticle[]): AuthorityCard[] {
  return articles.map((article) => {
    const rule = deriveArticleRule(article.sourceLaw, article.sourceArticle, article.title)
    const scope = deriveArticleScope(article.sourceLaw, article.sourceArticle)
    const caveat = deriveArticleCaveat(article.sourceLaw, article.sourceArticle)

    return {
      tag: article.tag,
      kind: 'article' as const,
      source: article.title,
      rule,
      scope,
      caveat,
      practicalImpact: undefined,
      articleNum: article.sourceArticle,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Jurisprudence → AuthorityCard[]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transforme les TaggedCase en AuthorityCard.
 * Le holding est utilisé comme règle — pas d'invention de portée excessive.
 * En l'absence de holding suffisant, la carte reste sobre.
 */
export function jurisprudenceToAuthorityCards(cases: TaggedCase[]): AuthorityCard[] {
  return cases.map((c) => {
    const court = c.court === 'cass' ? 'Cour de cassation' : "Cour d'appel"
    const source = `${court}, ${c.date}, n° ${c.number}`

    return {
      tag: c.tag,
      kind: 'jurisprudence' as const,
      source,
      rule: c.holding || '(holding non disponible)',
      scope: deriveJuriScope(c.court),
      caveat: c.court === 'ca' ? "Décision de cour d'appel : portée locale, non générale." : undefined,
      practicalImpact: undefined,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de dérivation sémantique
// Basés sur les identifiants de source connus — sobre, pas d'invention
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_ARTICLE_RULES: Record<string, Record<string, string>> = {
  'code civil': {
    '1113': "Le contrat est formé par la rencontre d'une offre et d'une acceptation.",
    '1114': "Est une offre la manifestation de volonté de son auteur d'être lié en cas d'acceptation.",
    '1589': 'La promesse de vente vaut vente lorsqu\'il y a consentement réciproque des deux parties sur la chose et sur le prix.',
    '1304': "La condition suspensive suspend l'exigibilité de l'obligation jusqu'à la réalisation d'un événement futur et incertain.",
    '1731': "S'il n'a pas été fait d'état des lieux, le preneur est présumé les avoir reçus en bon état.",
    '1240': "Tout fait quelconque de l'homme qui cause à autrui un dommage oblige celui par la faute duquel il est arrivé à le réparer.",
    '1231-1': "Le débiteur est condamné, s'il y a lieu, au paiement de dommages et intérêts, soit à raison de l'inexécution de l'obligation, soit à raison du retard dans l'exécution.",
    '1641': "Le vendeur est tenu de la garantie à raison des défauts cachés de la chose vendue qui la rendent impropre à l'usage auquel on la destine, ou qui diminuent tellement cet usage, que l'acheteur ne l'aurait pas acquise s'il les avait connus.",
    '1604': "La délivrance est le transport de la chose vendue en la puissance et possession de l'acheteur.",
    '2224': "Les actions personnelles ou mobilières se prescrivent par cinq ans à compter du jour où le titulaire d'un droit a connu ou aurait dû connaître les faits lui permettant de l'exercer.",
  },
  'code de la construction et de l\'habitation': {
    'L271-1': "L'acquéreur non professionnel d'un immeuble à usage d'habitation bénéficie d'un délai de rétractation de 10 jours à compter de la notification ou remise de l'avant-contrat.",
    'L271-4': "L'avant-contrat de vente d'un immeuble à usage d'habitation doit être accompagné d'un dossier de diagnostic technique (DDT) comprenant notamment le DPE, l'état des risques et pollutions, et le constat amiante selon la date de construction.",
    'L173-2': "À compter du 1er janvier 2025, tout logement dont le niveau de performance énergétique dépasse le seuil maximal de consommation (classe G, soit > 450 kWh/m²/an) ne peut plus faire l'objet d'un nouveau contrat de location à usage de résidence principale, ni d'un renouvellement ou d'une reconduction tacite de bail.",
  },
  'code de la consommation': {
    'L313-41': "L'obtention du ou des prêts est une condition suspensive de l'avant-contrat immobilier. Le non-obtention entraîne la caducité de la vente sans pénalité pour l'acquéreur.",
  },
  'loi 89-462': {
    '22': "Le dépôt de garantie doit être restitué dans un délai maximal de 1 ou 2 mois selon l'état des lieux de sortie, déduction faite des sommes justifiées retenues pour dégradations.",
    '24': "En cas d'impayé de loyer, le bailleur doit faire délivrer par un commissaire de justice un commandement de payer. Si le locataire ne régularise pas dans un délai de 2 mois, le bailleur peut saisir le tribunal judiciaire pour faire constater la résiliation du bail par la clause résolutoire. Toute expulsion nécessite une décision de justice.",
    '17': "Le logement loué doit répondre aux critères de décence, incluant depuis la loi Climat-Résilience un seuil de performance énergétique. Les logements classés G (> 450 kWh/m²/an) ne peuvent plus être loués à compter du 1er janvier 2025.",
    '17-1': "Les logements dont le niveau de performance énergétique est classé F ou G ne peuvent pas faire l'objet d'une augmentation de loyer, ni en cours de bail, ni lors d'un renouvellement ou d'une nouvelle mise en location.",
  },
  'loi hoguet': {
    '6': "Le mandataire immobilier ne peut percevoir une rémunération qu'après avoir justifié avoir exécuté sa mission et obtenu une signature des parties.",
  },
  'loi 70-9': {
    '6': "L'agent immobilier titulaire d'une carte professionnelle est soumis à un devoir d'information et de conseil envers toutes les parties à la transaction. Il doit signaler tout élément susceptible d'influer sur leur consentement.",
  },
  'code de la santé publique': {
    'L1331-1-1': "Les immeubles non raccordés au réseau d'assainissement collectif doivent être équipés d'une installation d'assainissement non collectif entretenue et contrôlée par la commune.",
    'L1331-11-1': "Selon le Code de la Santé Publique, le SPANC (Service Public d'Assainissement Non Collectif) contrôle les installations d'assainissement non collectif. En cas de non-conformité présentant un risque sanitaire ou environnemental, le propriétaire est mis en demeure de réaliser les travaux.",
  },
  'loi 65-557': {
    '18': "Le syndic de copropriété est habilité à engager les travaux nécessaires à la conservation de l'immeuble et à la sécurité des personnes sans vote préalable en assemblée générale, à condition que l'urgence soit réelle et documentée. Il doit en informer l'assemblée générale dans les meilleurs délais.",
    '14': "Les charges de copropriété sont réparties entre les copropriétaires en proportion de leurs tantièmes. Les décisions prises régulièrement (y compris les travaux urgents engagés par le syndic) s'imposent à l'ensemble des copropriétaires.",
  },
  'décret 67-223': {
    '37': "Après exécution de travaux urgents, le syndic a l'obligation d'en informer l'assemblée générale des copropriétaires dans les meilleurs délais et de lui en rendre compte. À défaut, il engage sa responsabilité envers les copropriétaires.",
  },
  'code des procédures civiles d\'exécution': {
    'L411-1': "Sauf disposition légale contraire, nul ne peut expulser une personne occupant un logement sans une décision de justice. L'expulsion forcée est réservée aux commissaires de justice mandatés à cet effet.",
    'L412-6': "La trêve hivernale interdit l'exécution des mesures d'expulsion du 1er novembre au 31 mars de chaque année. Cette suspension s'applique même en cas de décision de justice définitive.",
  },
  'décret 72-678': {
    '78': "Le mandat exclusif de vente ne peut être conclu pour une durée inférieure à 3 mois. Pendant cette période initiale incompressible, le mandant ne peut résilier unilatéralement le mandat. Passée cette période, le mandat peut être dénoncé par lettre recommandée avec avis de réception, moyennant un préavis de 15 jours avant chaque date d'échéance.",
  },
}

const KNOWN_ARTICLE_SCOPES: Record<string, Record<string, string>> = {
  'code civil': {
    '1113': 'Droit commun des contrats — applicable à toutes les ventes, dont immobilières.',
    '1114': 'Droit commun des contrats — définit la notion d\'offre ferme et précise.',
    '1589': 'Droit immobilier — vente d\'immeubles, promesses synallagmatiques.',
    '1304': 'Droit commun des obligations — applicable aux avant-contrats immobiliers avec condition de prêt.',
    '1731': 'Droit du bail — s\'applique à l\'état des lieux de sortie.',
    '1240': "Droit commun de la responsabilité délictuelle — applicable à toute faute causant un dommage à autrui, y compris celles des professionnels de l'immobilier et des diagnostiqueurs.",
    '1231-1': "Droit commun des obligations contractuelles — applicable en cas d'inexécution d'un contrat (mandat, mission de conseil).",
    '1641': "Droit de la vente — la garantie des vices cachés s'applique au vendeur, y compris en matière immobilière. Délai d'action : 2 ans à compter de la découverte.",
    '1604': "Droit de la vente — obligation de délivrance s'applique à toutes les ventes mobilières et immobilières.",
    '2224': "Prescription de droit commun — 5 ans. S'applique aux actions personnelles et mobilières, sauf disposition spéciale (ex : 2 ans pour garantie des vices cachés).",
  },
  'code de la construction et de l\'habitation': {
    'L271-1': "Applicable uniquement aux biens immobiliers à usage d'habitation acquis par un non-professionnel. Ne s'applique pas aux ventes en état futur d'achèvement ni aux locaux professionnels.",
    'L271-4': "Applicable à toutes les ventes d'immeubles bâtis à usage d'habitation et à usage mixte. Le DDT doit être annexé à la promesse de vente ou à l'acte authentique si pas de promesse.",
    'L173-2': "S'applique à tous les logements à usage de résidence principale, y compris les meublés. Vise les nouveaux baux, les renouvellements et les reconductions tacites — pas les baux en cours conclus avant 2025.",
  },
  'code de la consommation': {
    'L313-41': "S'applique aux avant-contrats de vente immobilière lorsqu'un crédit est nécessaire à l'acquéreur personne physique.",
  },
  'loi 89-462': {
    '22': 'Applicable aux baux d\'habitation régis par la loi du 6 juillet 1989. Le délai est de 1 mois si état des lieux de sortie conforme, 2 mois sinon.',
    '24': "Applicable à tous les baux d'habitation soumis à la loi du 6 juillet 1989. La clause résolutoire doit être stipulée dans le bail. En l'absence de clause résolutoire, seule la résiliation judiciaire est possible.",
    '17': "Applicable à tous les logements loués à usage de résidence principale. Le seuil de décence énergétique est progressif : classe G depuis 2025, classe F dès 2028, classe E dès 2034.",
    '17-1': "Applicable depuis le 24 août 2022. Le gel vise toutes les augmentations de loyer (IRL, travaux d'amélioration, relocation) pour les logements F et G sur l'ensemble du territoire.",
  },
  'loi hoguet': {
    '6': 'Applicable aux professionnels de l\'immobilier (agents immobiliers, gestionnaires) titulaires d\'une carte professionnelle.',
  },
  'loi 70-9': {
    '6': "Applicable à tous les agents immobiliers, administrateurs de biens et marchands de listes titulaires d'une carte professionnelle délivrée par la CCI.",
  },
  'code de la santé publique': {
    'L1331-1-1': "Applicable à tous les immeubles non raccordés à l'assainissement collectif sur l'ensemble du territoire.",
    'L1331-11-1': "La mise en conformité suit un contrôle SPANC. Le délai de travaux est fixé par arrêté municipal ou intercommunal — variable selon la commune.",
  },
  'loi 65-557': {
    '18': "Applicable à toutes les copropriétés régies par la loi du 10 juillet 1965. Le syndic professionnel ou bénévole bénéficie de ce pouvoir d'urgence dans les mêmes conditions.",
    '14': "Applicable à toutes les copropriétés. Les tantièmes sont définis dans le règlement de copropriété. Les copropriétaires ne peuvent s'exonérer des charges légalement approuvées ou décidées dans le cadre des urgences.",
  },
  'décret 67-223': {
    '37': "Applicable dans toutes les copropriétés relevant de la loi du 10 juillet 1965. L'obligation d'information ne dispense pas le syndic de convoquer une assemblée générale extraordinaire si les travaux dépassent un certain montant ou ont un impact durable sur les parties communes.",
  },
  'code des procédures civiles d\'exécution': {
    'L411-1': "Applicable à toutes les expulsions : locataires, occupants sans titre, squatteurs — avec des procédures distinctes selon la qualité de l'occupant.",
    'L412-6': "La trêve hivernale court du 1er novembre au 31 mars. Elle ne s'applique pas aux locaux commerciaux ni aux résidences secondaires. Certaines exceptions sont prévues pour les squatteurs et les relogements.",
  },
  'décret 72-678': {
    '78': "Applicable à tous les mandats exclusifs conclus par des agents immobiliers titulaires d'une carte professionnelle T (transaction). Le mandat simple n'est pas soumis à la durée minimale de 3 mois.",
  },
}

const KNOWN_ARTICLE_CAVEATS: Record<string, Record<string, string>> = {
  'code de la construction et de l\'habitation': {
    'L271-1': "Le délai de 10 jours court à compter de la notification ou remise en main propre de l'acte — conditions formelles de déclenchement à vérifier.",
    'L271-4': "L'absence de DDT ou d'un diagnostic requis n'entraîne pas la nullité automatique de la vente, mais peut engager la responsabilité du vendeur et permettre une action en dommages-intérêts.",
  },
  'code de la santé publique': {
    'L1331-11-1': "L'effectivité des sanctions dépend de la politique locale du SPANC et de la commune — les textes définissent le cadre, pas la pratique systématique.",
  },
  'loi 89-462': {
    '22': "Des retenues sur le dépôt sont possibles mais doivent être justifiées par des pièces probantes (état des lieux, devis, factures). Un état des lieux incomplet fragilise ces retenues.",
    '24': "Le délai de 2 mois court à compter de la délivrance du commandement de payer. La CCAPEX est automatiquement alertée pour les locataires bénéficiaires d'aides au logement ou en situation de surendettement. Ce délai peut être suspendu par le juge.",
    '17-1': "Le gel ne s'applique pas aux travaux de mise aux normes imposés par l'administration. Certaines exceptions existent pour les logements ayant fait l'objet d'une rénovation significative entre deux baux.",
  },
  'code civil': {
    '1641': "Le vendeur professionnel est présumé connaître les vices — la clause d'exclusion de garantie est sans effet contre lui. Pour le vendeur non professionnel, la clause est valable sauf mauvaise foi prouvée.",
    '1240': "La responsabilité délictuelle exige la preuve d'une faute, d'un préjudice et d'un lien de causalité. La faute de l'agent ou du diagnostiqueur doit être démontrée, elle ne se présume pas.",
  },
  'loi 65-557': {
    '18': "Le caractère 'urgent' des travaux est apprécié strictement. Des travaux de confort ou d'amélioration planifiables ne constituent pas une urgence au sens de cet article. En cas de contestation, c'est au syndic de prouver l'urgence.",
  },
  'décret 67-223': {
    '37': "L'obligation d'information est de moyens, non de résultat. Le syndic doit agir 'dans les meilleurs délais' — notion appréciée selon les circonstances. Une convocation d'AG extraordinaire peut être nécessaire si les travaux ont une ampleur significative.",
  },
  'loi 70-9': {
    '6': "Le devoir d'information de l'agent porte sur les éléments qu'il connaissait ou aurait dû connaître dans l'exercice de sa mission. Il ne s'étend pas aux vices que l'agent ne pouvait pas détecter sans expertise spécifique.",
  },
  'code des procédures civiles d\'exécution': {
    'L411-1': "La voie de fait (expulsion par ses propres moyens : changement de serrures, coupure des fluides) est constitutive d'une infraction pénale. La sanction est lourde pour le bailleur.",
    'L412-6': "La trêve hivernale ne s'applique pas à certaines situations : squatteurs (non-titulaires d'un bail), personnes relogées dans un logement décent, occupants condamnés pour violences.",
  },
  'décret 72-678': {
    '78': "Le délai de 15 jours se calcule avant la date d'échéance, pas avant la date de fin de reconduction. La lettre recommandée doit être reçue (avis de réception signé) avant l'expiration du délai — anticiper les délais postaux.",
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTHORITY_SCOPE_CONSTRAINTS
// Contraintes de portée par numéro d'article (sourceArticle exact).
// Utilisé par answer-validator.ts pour détecter les citations hors portée.
// ─────────────────────────────────────────────────────────────────────────────

export type AuthorityScopeConstraint = {
  forbiddenContextKeywords: string[]
  reason: string
}

export const AUTHORITY_SCOPE_CONSTRAINTS: Record<string, AuthorityScopeConstraint> = {
  'L271-1': {
    forbiddenContextKeywords: [
      'spanc',
      'assainissement',
      'fosse septique',
      'contrôle administratif',
      'non collectif',
      'dpe',
      'diagnostiqueur',
      'syndic',
      'copropriété',
      'travaux urgents',
    ],
    reason:
      "L271-1 CCH est le droit de rétractation de l'acquéreur non professionnel lors d'une vente immobilière — inapplicable comme fondement du contrôle SPANC, du DPE, ou des travaux en copropriété.",
  },
  'L1331-1-1': {
    forbiddenContextKeywords: [
      'droit de rétractation',
      'délai de rétractation',
      'avant-contrat',
      'compromis de vente',
    ],
    reason:
      "L1331-1-1 CSP concerne l'obligation d'équipement en assainissement non collectif — pas le droit de rétractation de l'acquéreur lors d'une vente.",
  },
  'L271-4': {
    forbiddenContextKeywords: [
      'spanc',
      'assainissement non collectif',
      'fosse septique',
      'copropriété',
      'syndic',
      'travaux urgents',
    ],
    reason:
      "L271-4 CCH concerne le dossier de diagnostic technique (DDT) annexé à l'avant-contrat de vente — inapplicable au contrôle SPANC ou aux travaux en copropriété.",
  },
}

function deriveArticleRule(sourceLaw: string, sourceArticle: string, title: string): string {
  const lawRules = KNOWN_ARTICLE_RULES[sourceLaw.toLowerCase()]
  if (lawRules && lawRules[sourceArticle]) return lawRules[sourceArticle]

  // Fallback sobre : ne pas inventer
  return `Disposition prévue par ${title}. Consulter le texte officiel pour la règle exacte.`
}

function deriveArticleScope(sourceLaw: string, sourceArticle: string): string {
  const lawScopes = KNOWN_ARTICLE_SCOPES[sourceLaw.toLowerCase()]
  if (lawScopes && lawScopes[sourceArticle]) return lawScopes[sourceArticle]
  return `Champ d'application défini par ${sourceLaw}, art. ${sourceArticle}.`
}

function deriveArticleCaveat(sourceLaw: string, sourceArticle: string): string | undefined {
  const lawCaveats = KNOWN_ARTICLE_CAVEATS[sourceLaw.toLowerCase()]
  if (lawCaveats && lawCaveats[sourceArticle]) return lawCaveats[sourceArticle]
  return undefined
}

function deriveJuriScope(court: 'cass' | 'ca'): string {
  if (court === 'cass') {
    return "Arrêt de la Cour de cassation : valeur de principe, applicable nationalement (sauf revirement)."
  }
  return "Arrêt de cour d'appel : valeur d'illustration, non contraignante pour d'autres juridictions."
}
