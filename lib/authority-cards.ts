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
  },
  'code de la construction et de l\'habitation': {
    'L271-1': "L'acquéreur non professionnel d'un immeuble à usage d'habitation bénéficie d'un délai de rétractation de 10 jours à compter de la notification ou remise de l'avant-contrat.",
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
  'code de la santé publique': {
    'L1331-1-1': "Les immeubles non raccordés au réseau d'assainissement collectif doivent être équipés d'une installation d'assainissement non collectif entretenue et contrôlée par la commune.",
    'L1331-11-1': "Le SPANC contrôle les installations d'assainissement non collectif. En cas de non-conformité présentant un risque sanitaire ou environnemental, le propriétaire est mis en demeure de réaliser les travaux.",
  },
}

const KNOWN_ARTICLE_SCOPES: Record<string, Record<string, string>> = {
  'code civil': {
    '1113': 'Droit commun des contrats — applicable à toutes les ventes, dont immobilières.',
    '1114': 'Droit commun des contrats — définit la notion d\'offre ferme et précise.',
    '1589': 'Droit immobilier — vente d\'immeubles, promesses synallagmatiques.',
    '1304': 'Droit commun des obligations — applicable aux avant-contrats immobiliers avec condition de prêt.',
    '1731': 'Droit du bail — s\'applique à l\'état des lieux de sortie.',
  },
  'code de la construction et de l\'habitation': {
    'L271-1': "Applicable uniquement aux biens immobiliers à usage d'habitation acquis par un non-professionnel. Ne s'applique pas aux ventes en état futur d'achèvement ni aux locaux professionnels.",
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
  'code de la santé publique': {
    'L1331-1-1': "Applicable à tous les immeubles non raccordés à l'assainissement collectif sur l'ensemble du territoire.",
    'L1331-11-1': "La mise en conformité suit un contrôle SPANC. Le délai de travaux est fixé par arrêté municipal ou intercommunal — variable selon la commune.",
  },
}

const KNOWN_ARTICLE_CAVEATS: Record<string, Record<string, string>> = {
  'code de la construction et de l\'habitation': {
    'L271-1': "Le délai de 10 jours court à compter de la notification ou remise en main propre de l'acte — conditions formelles de déclenchement à vérifier.",
  },
  'code de la santé publique': {
    'L1331-11-1': "L'effectivité des sanctions dépend de la politique locale du SPANC et de la commune — les textes définissent le cadre, pas la pratique systématique.",
  },
  'loi 89-462': {
    '22': "Des retenues sur le dépôt sont possibles mais doivent être justifiées par des pièces probantes (état des lieux, devis, factures). Un état des lieux incomplet fragilise ces retenues.",
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
    ],
    reason:
      "L271-1 CCH est le droit de rétractation de l'acquéreur non professionnel lors d'une vente immobilière — inapplicable comme fondement du contrôle SPANC ou de l'assainissement non collectif.",
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
