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
  },
  'code de la consommation': {
    'L313-41': "L'obtention du ou des prêts est une condition suspensive de l'avant-contrat immobilier. Le non-obtention entraîne la caducité de la vente sans pénalité pour l'acquéreur.",
  },
  'loi 89-462': {
    '22': "Le dépôt de garantie doit être restitué dans un délai maximal de 1 ou 2 mois selon l'état des lieux de sortie, déduction faite des sommes justifiées retenues pour dégradations.",
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
  },
  'code de la consommation': {
    'L313-41': "S'applique aux avant-contrats de vente immobilière lorsqu'un crédit est nécessaire à l'acquéreur personne physique.",
  },
  'loi 89-462': {
    '22': 'Applicable aux baux d\'habitation régis par la loi du 6 juillet 1989. Le délai est de 1 mois si état des lieux de sortie conforme, 2 mois sinon.',
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
