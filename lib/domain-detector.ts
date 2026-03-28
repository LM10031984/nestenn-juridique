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
               'irl', 'préavis', 'décence', 'bail meublé', 'bail mobilité',
               'décès locataire', 'abandon de logement', 'logement abandonné',
               'squat', 'squatteur', 'occupation illicite',
               'colocation', 'solidarité', 'caution', 'garant', 'garantie visale',
               'gli', 'assurance loyers impayés', 'quittance',
               'régularisation charges', 'trouble de jouissance', 'nuisance',
               'insalubrité', 'logement indigne', 'habitat indigne', 'passoire thermique',
               'meublé tourisme', 'airbnb', 'location saisonnière'],
    domain: { name: 'baux_habitation', judilibreTheme: "bail d'habitation", judilibreChamber: 'civ3' },
  },
  {
    keywords: ['copropriété', 'syndic', 'assemblée générale', 'charges de copropriété',
               'tantièmes', 'parties communes', 'règlement de copropriété', 'ag ',
               'parties privatives', 'lot', 'tantième', 'millième',
               'fonds de travaux', 'appel de fonds', 'impayé charges copro',
               'copropriété dégradée', 'plan de sauvegarde', 'administration provisoire',
               'administrateur judiciaire', 'modification règlement'],
    domain: { name: 'copropriete', judilibreTheme: 'copropriété', judilibreChamber: 'civ3' },
  },
  {
    keywords: ['agent immobilier', 'mandat', 'honoraires', 'hoguet', 'carte t',
               'commission', 'devoir de conseil', 'agence immobilière', 'négociateur',
               'responsabilité agent', 'faute agent', 'devoir information',
               'anti-blanchiment', 'tracfin', 'formation continue',
               'attestation collaborateur', 'cci', 'chambre commerce'],
    domain: { name: 'agent_immobilier', judilibreTheme: 'agent immobilier', judilibreChamber: 'civ1' },
  },
  {
    keywords: ['vente', 'compromis', 'promesse de vente', 'acte authentique',
               'vice caché', 'rétractation', 'condition suspensive', 'avant-contrat',
               'acheteur', 'vendeur', 'notaire', 'frais de notaire', 'sru',
               'tutelle', 'curatelle', 'majeur protégé', 'incapacité',
               'indivision', 'succession', 'donation', 'héritage', 'héritier',
               'partage', 'procuration', 'mandat de protection future',
               'divorce', 'liquidation communauté', 'séparation de biens',
               'bien propre', 'bien commun', 'indivision successorale',
               'pacte de famille', 'donation-partage'],
    domain: { name: 'vente_immobiliere', judilibreTheme: 'vente immobilière', judilibreChamber: 'civ3' },
  },
  {
    keywords: ['diagnostic', 'dpe', 'amiante', 'plomb', 'termites', 'erp',
               'carrez', 'audit énergétique', 'passoire thermique',
               'mérule', 'radon', 'bruit', 'électricité', 'gaz', 'assainissement',
               'surface habitable', 'mesurage', 'erreur diagnostic', 'diagnostiqueur',
               'responsabilité diagnostiqueur', 'dpe erroné', 'dpe opposable',
               'passoire énergétique', 'classe f', 'classe g'],
    domain: { name: 'diagnostics', judilibreTheme: 'vente immobilière', judilibreChamber: 'civ3' },
  },
  {
    keywords: ['urbanisme', 'permis de construire', 'plu', 'zan', 'préemption',
               "certificat d'urbanisme", 'zone agricole',
               'déclaration préalable', 'division parcellaire', 'lotissement',
               'cu opérationnel', 'cu informatif', 'abf',
               'architecte bâtiments france', 'secteur protégé', 'monument historique',
               'ppri', 'zone inondable', 'zone constructible',
               'changement destination', 'local commercial en habitation'],
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
    keywords: ['assignation', 'tribunal', 'juge', 'procédure', 'référé',
               'mise en demeure', 'huissier', 'commissaire de justice',
               'délai prescription', 'prescription', 'forclusion',
               'conciliation', 'médiation', 'expertise judiciaire',
               'responsabilité civile', 'dommages intérêts', 'préjudice',
               'astreinte', 'exécution forcée', 'saisie', 'hypothèque judiciaire'],
    domain: { name: 'litiges', judilibreTheme: 'vente immobilière', judilibreChamber: 'civ3' },
  },
  {
    keywords: ['construction', 'vefa', 'décennale', 'biennale', 'malfaçon',
               'parfait achèvement', 'réception des travaux', 'dommage ouvrage'],
    domain: { name: 'construction', judilibreTheme: 'construction immobilière', judilibreChamber: 'civ3' },
  },
  {
    keywords: ['sci', 'plus-value', 'taxe foncière', 'ifi', 'pinel', 'denormandie',
               'déficit foncier', 'lmnp', 'revenus fonciers',
               'droits de mutation', 'émoluments', 'droits enregistrement',
               'taxe habitation', 'cfe', 'location meublée', 'lmp',
               'amortissement', 'micro-foncier', 'régime réel'],
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
 * Matching tolérant aux fautes d'orthographe et variantes.
 * - Match exact en priorité
 * - Pour les mots de 5+ caractères, match sur la racine (premiers 6 chars max)
 *   "locatire" → racine "locata" → matche "locataire"
 *   "expulser" → racine "expuls" → matche "expulsion"
 */
function matchesKeyword(text: string, keyword: string): boolean {
  const kw = keyword.toLowerCase()
  if (text.includes(kw)) return true
  if (kw.length >= 5) {
    const stem = kw.slice(0, Math.min(kw.length - 1, 6))
    if (text.includes(stem)) return true
  }
  return false
}

/**
 * Retourne le domaine le plus probable (ou null) + un second si proche.
 * Les noms retournés correspondent aux valeurs `domain` dans la DB.
 */
export function detectDomains(question: string): string[] {
  const lower = question.toLowerCase()
  const scores: Array<{ domain: DomainMatch; score: number }> = []

  for (const entry of DOMAIN_KEYWORDS) {
    const score = entry.keywords.filter(kw => matchesKeyword(lower, kw)).length
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
    const score = entry.keywords.filter(kw => matchesKeyword(lower, kw)).length
    if (score > bestScore) {
      bestScore = score
      bestMatch = entry.domain
    }
  }

  return bestMatch
}
