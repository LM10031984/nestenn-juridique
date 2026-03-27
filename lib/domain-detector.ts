// lib/domain-detector.ts
// Détection simple par keywords — remplace le LEGAL_SUBTHEME_MAP complet (600+ lignes)
// Retourne 0, 1 ou 2 domaines pour booster pgvector — pas de routing fin

export interface DomainMatch {
  name: string          // nom DB (ex: 'baux_habitation')
  judilibreTheme?: string
  judilibreChamber?: string
}

const DOMAIN_KEYWORDS: Array<{
  keywords: string[]
  domain: DomainMatch
}> = [
  {
    keywords: ['bail', 'loyer', 'locataire', 'bailleur', 'location', 'congé',
               'dépôt de garantie', 'impayé', 'expulsion', 'trêve', 'clause résolutoire',
               'irl', 'préavis', 'décence', 'bail meublé', 'bail mobilité'],
    domain: { name: 'baux_habitation', judilibreTheme: "bail d'habitation", judilibreChamber: 'civ3' },
  },
  {
    keywords: ['copropriété', 'syndic', 'assemblée générale', 'charges de copropriété',
               'tantièmes', 'parties communes', 'règlement de copropriété', 'ag '],
    domain: { name: 'copropriete', judilibreTheme: 'copropriété', judilibreChamber: 'civ3' },
  },
  {
    keywords: ['agent immobilier', 'mandat', 'honoraires', 'hoguet', 'carte t',
               'commission', 'devoir de conseil', 'agence immobilière', 'négociateur'],
    domain: { name: 'agent_immobilier', judilibreTheme: 'agent immobilier', judilibreChamber: 'civ1' },
  },
  {
    keywords: ['vente', 'compromis', 'promesse de vente', 'acte authentique',
               'vice caché', 'rétractation', 'condition suspensive', 'avant-contrat',
               'acheteur', 'vendeur', 'notaire', 'frais de notaire', 'sru'],
    domain: { name: 'vente_immobiliere', judilibreTheme: 'vente immobilière', judilibreChamber: 'civ3' },
  },
  {
    keywords: ['diagnostic', 'dpe', 'amiante', 'plomb', 'termites', 'erp',
               'carrez', 'audit énergétique', 'passoire thermique'],
    domain: { name: 'diagnostics', judilibreTheme: 'vente immobilière', judilibreChamber: 'civ3' },
  },
  {
    keywords: ['urbanisme', 'permis de construire', 'plu', 'zan', 'préemption',
               'certificat d\'urbanisme', 'zone agricole'],
    domain: { name: 'urbanisme', judilibreTheme: 'urbanisme', judilibreChamber: 'civ3' },
  },
  {
    keywords: ['bail commercial', 'fonds de commerce', '3-6-9', 'loyer commercial',
               'droit au bail', 'indemnité d\'éviction', 'l145'],
    domain: { name: 'bail_commercial', judilibreTheme: 'bail commercial', judilibreChamber: 'comm' },
  },
  {
    keywords: ['usufruit', 'démembrement', 'nue-propriété', 'viager', 'rente viagère',
               'bouquet', 'débirentier'],
    domain: { name: 'viager_demembrement', judilibreTheme: 'vente immobilière', judilibreChamber: 'civ3' },
  },
  {
    keywords: ['construction', 'vefa', 'décennale', 'biennale', 'malfaçon',
               'parfait achèvement', 'réception des travaux', 'dommage ouvrage'],
    domain: { name: 'construction', judilibreTheme: 'construction immobilière', judilibreChamber: 'civ3' },
  },
  {
    keywords: ['sci', 'plus-value', 'taxe foncière', 'ifi', 'pinel', 'denormandie',
               'déficit foncier', 'lmnp', 'revenus fonciers'],
    domain: { name: 'fiscalite', judilibreTheme: 'vente immobilière', judilibreChamber: 'civ3' },
  },
  {
    keywords: ['servitude', 'mitoyenneté', 'voisinage', 'droit de passage'],
    domain: { name: 'vente_immobiliere', judilibreTheme: 'vente immobilière', judilibreChamber: 'civ3' },
  },
  {
    keywords: ['crédit immobilier', 'prêt immobilier', 'taeg', 'condition suspensive de financement',
               'refus de prêt', 'scrivener'],
    domain: { name: 'consommation', judilibreTheme: 'vente immobilière', judilibreChamber: 'civ3' },
  },
  {
    keywords: ['meublé de tourisme', 'airbnb', 'location saisonnière', 'changement d\'usage',
               'taxe de séjour', 'numéro d\'enregistrement'],
    domain: { name: 'location_saisonniere', judilibreTheme: "bail d'habitation", judilibreChamber: 'civ3' },
  },
]

/**
 * Retourne le domaine le plus probable (ou null) + un second si proche.
 * Les noms retournés correspondent aux valeurs `domain` dans la DB.
 */
export function detectDomains(question: string): string[] {
  const lower = question.toLowerCase()
  const scores: Array<{ domain: DomainMatch; score: number }> = []

  for (const entry of DOMAIN_KEYWORDS) {
    const score = entry.keywords.filter(kw => lower.includes(kw.toLowerCase())).length
    if (score > 0) scores.push({ domain: entry.domain, score })
  }

  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(s => s.domain.name)
}

/**
 * Retourne le premier DomainMatch (avec metadata Judilibre) ou null.
 */
export function detectDomain(question: string): DomainMatch | null {
  const lower = question.toLowerCase()
  let bestMatch: DomainMatch | null = null
  let bestScore = 0

  for (const entry of DOMAIN_KEYWORDS) {
    const score = entry.keywords.filter(kw => lower.includes(kw.toLowerCase())).length
    if (score > bestScore) {
      bestScore = score
      bestMatch = entry.domain
    }
  }

  return bestMatch
}
