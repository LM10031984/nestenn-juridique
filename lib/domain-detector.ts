// lib/domain-detector.ts
// Détection pondérée par keywords — taxonomy alignée sur VALID_DOMAINS (auto-indexer.ts)
// Retourne 0, 1 ou 2 domaines pour booster pgvector — pas de routing fin

export interface DomainMatch {
  name: string           // nom DB — doit exister dans VALID_DOMAINS
  judilibreTheme?: string
  judilibreChamber?: string
}

interface WeightedKeyword {
  term: string
  weight: number
  fuzzy?: boolean  // si true : correspondance par racine (stem) en complément du match exact
}

interface DomainEntry {
  keywords: WeightedKeyword[]
  domain: DomainMatch
}

// ─────────────────────────────────────────────────────────────────────────────
// Taxonomie pondérée
//   weight 2.0 → terme très discriminant, quasi-exclusif au domaine
//   weight 1.5 → terme fort mais partageable
//   weight 1.0 → terme pertinent sans être discriminant
//   weight 0.5 → terme générique utile en combinaison uniquement
//   weight 0.3 → terme très générique — ne doit jamais déclencher seul
//
// fuzzy:true → tolère les variantes orthographiques (fautes de frappe, conjugaisons)
//              UNIQUEMENT sur les termes explicitement marqués
// ─────────────────────────────────────────────────────────────────────────────

const DOMAIN_KEYWORDS: DomainEntry[] = [

  // ── 1. Baux d'habitation ─────────────────────────────────────────────────
  {
    keywords: [
      { term: 'loyers impayés',           weight: 2.0 },
      { term: 'impayé de loyer',           weight: 2.0 },
      { term: 'clause résolutoire',        weight: 2.0 },
      { term: 'expulsion locataire',       weight: 2.0, fuzzy: true },
      { term: 'trêve hivernale',           weight: 2.0 },
      { term: 'dépôt de garantie',         weight: 1.5 },
      { term: 'préavis locataire',         weight: 1.5 },
      { term: 'congé pour vendre',         weight: 1.5 },
      { term: 'congé pour reprise',        weight: 1.5 },
      { term: 'logement décent',           weight: 1.5 },
      { term: 'bail meublé',               weight: 1.5 },
      { term: 'bail mobilité',             weight: 1.5 },
      { term: 'décès locataire',           weight: 1.5 },
      { term: 'abandon de logement',       weight: 1.5 },
      { term: 'occupation illicite',       weight: 1.5 },
      { term: 'squat',                     weight: 1.5, fuzzy: true },
      { term: 'quittance de loyer',        weight: 1.5 },
      { term: 'régularisation des charges', weight: 1.5 },
      { term: 'insalubrité',               weight: 1.5, fuzzy: true },
      { term: 'logement indigne',          weight: 1.5 },
      { term: 'habitat indigne',           weight: 1.5 },
      { term: 'passoire thermique',        weight: 1.0 },
      { term: 'locataire',                 weight: 1.0, fuzzy: true },
      { term: 'bailleur',                  weight: 1.0 },
      { term: 'colocation',                weight: 1.0 },
      { term: 'caution solidaire',         weight: 1.0 },
      { term: 'garant locatif',            weight: 1.0 },
      { term: 'garantie visale',           weight: 1.0 },
      { term: 'assurance loyers impayés',  weight: 1.0 },
      { term: 'gli',                       weight: 1.0 },
      { term: 'trouble de jouissance',     weight: 1.0 },
      { term: 'bail',                      weight: 0.5, fuzzy: true },
      { term: 'loyer',                     weight: 0.5, fuzzy: true },
    ],
    domain: { name: 'baux_habitation', judilibreTheme: "bail d'habitation", judilibreChamber: 'civ3' },
  },

  // ── 2. Copropriété ───────────────────────────────────────────────────────
  {
    keywords: [
      { term: 'copropriété',               weight: 2.0, fuzzy: true },
      { term: 'syndic',                    weight: 2.0 },
      { term: 'assemblée générale',        weight: 2.0 },
      { term: 'charges de copropriété',    weight: 2.0 },
      { term: 'tantièmes',                 weight: 2.0 },
      { term: 'parties communes',          weight: 2.0 },
      { term: 'règlement de copropriété',  weight: 2.0 },
      { term: 'appel de fonds',            weight: 1.5 },
      { term: 'fonds de travaux',          weight: 1.5 },
      { term: 'lot de copropriété',        weight: 1.5 },
      { term: 'millième',                  weight: 1.5 },
      { term: 'parties privatives',        weight: 1.5 },
      { term: 'copropriété dégradée',      weight: 1.5 },
      { term: 'plan de sauvegarde copro',  weight: 1.5 },
      { term: 'administration provisoire', weight: 1.0 },
      { term: 'modification règlement',    weight: 1.0 },
    ],
    domain: { name: 'copropriete', judilibreTheme: 'copropriété', judilibreChamber: 'civ3' },
  },

  // ── 3. Agent immobilier ──────────────────────────────────────────────────
  {
    keywords: [
      { term: 'agent immobilier',          weight: 2.0 },
      { term: 'agence immobilière',        weight: 2.0 },
      { term: 'loi hoguet',                weight: 2.0 },
      { term: 'carte t',                   weight: 2.0 },
      { term: 'honoraires agence',         weight: 2.0 },
      { term: 'mandat de vente',           weight: 2.0 },
      { term: 'mandat de recherche',       weight: 2.0 },
      { term: 'commission agence',         weight: 2.0 },
      { term: 'négociateur immobilier',    weight: 1.5 },
      { term: 'responsabilité agent',      weight: 1.5 },
      { term: 'devoir de conseil',         weight: 1.5 },
      { term: 'devoir d\'information',     weight: 1.5 },
      { term: 'faute de l\'agent',         weight: 1.5 },
      { term: 'anti-blanchiment',          weight: 1.0 },
      { term: 'tracfin',                   weight: 1.0 },
      { term: 'formation continue agent',  weight: 1.0 },
      { term: 'attestation collaborateur', weight: 1.0 },
      { term: 'mandat',                    weight: 0.5 },
      { term: 'honoraires',                weight: 0.5 },
    ],
    domain: { name: 'agent_immobilier', judilibreTheme: 'agent immobilier', judilibreChamber: 'civ1' },
  },

  // ── 4. Vente immobilière ─────────────────────────────────────────────────
  //    Inclut les aspects financement (crédit immobilier)
  {
    keywords: [
      { term: 'compromis de vente',          weight: 2.0 },
      { term: 'promesse de vente',           weight: 2.0 },
      { term: 'offre d\'achat contresignée', weight: 2.0 },
      { term: 'acte authentique',            weight: 2.0 },
      { term: 'vice caché',                  weight: 2.0, fuzzy: true },
      { term: 'rétractation acquéreur',      weight: 2.0, fuzzy: true },
      { term: 'condition suspensive de vente', weight: 2.0 },
      { term: 'avant-contrat',               weight: 2.0 },
      { term: 'offre d\'achat',              weight: 1.5 },
      { term: 'loi sru',                     weight: 1.5 },
      { term: 'frais de notaire',            weight: 1.5 },
      { term: 'désengagement',               weight: 1.0 },
      { term: 'indivision',                  weight: 1.0 },
      { term: 'succession immobilière',      weight: 1.0 },
      { term: 'donation immobilière',        weight: 1.0 },
      { term: 'donation-partage',            weight: 1.0 },
      { term: 'liquidation communauté',      weight: 1.0 },
      { term: 'bien propre',                 weight: 1.0 },
      { term: 'bien commun',                 weight: 1.0 },
      { term: 'pacte de famille',            weight: 1.0 },
      { term: 'tutelle',                     weight: 0.5 },
      { term: 'curatelle',                   weight: 0.5 },
      { term: 'majeur protégé',              weight: 0.5 },
      { term: 'notaire',                     weight: 0.5 },
      // Financement immobilier → vente_immobiliere (pas de domaine séparé)
      { term: 'crédit immobilier',           weight: 2.0 },
      { term: 'prêt immobilier',             weight: 2.0 },
      { term: 'loi scrivener',               weight: 2.0 },
      { term: 'refus de prêt',               weight: 2.0 },
      { term: 'condition suspensive de financement', weight: 2.0 },
      { term: 'taeg',                        weight: 1.5 },
      // Termes très génériques — contribution marginale
      { term: 'vente',                       weight: 0.3 },
      { term: 'acheteur',                    weight: 0.3 },
      { term: 'vendeur',                     weight: 0.3 },
    ],
    domain: { name: 'vente_immobiliere', judilibreTheme: 'vente immobilière', judilibreChamber: 'civ3' },
  },

  // ── 5. Diagnostics immobiliers ───────────────────────────────────────────
  {
    keywords: [
      { term: 'dpe',                         weight: 2.0 },
      { term: 'diagnostic immobilier',       weight: 2.0 },
      { term: 'diagnostiqueur',              weight: 2.0, fuzzy: true },
      { term: 'diagnostic carrez',           weight: 2.0 },
      { term: 'dpe erroné',                  weight: 2.0 },
      { term: 'dpe opposable',               weight: 2.0 },
      { term: 'audit énergétique',           weight: 2.0 },
      { term: 'loi carrez',                  weight: 2.0 },
      { term: 'mesurage',                    weight: 1.5 },
      { term: 'surface habitable',           weight: 1.5 },
      { term: 'amiante',                     weight: 1.5 },
      { term: 'plomb',                       weight: 1.5 },
      { term: 'termites',                    weight: 1.5 },
      { term: 'mérule',                      weight: 1.5 },
      { term: 'radon',                       weight: 1.5 },
      { term: 'classe f',                    weight: 1.5 },
      { term: 'classe g',                    weight: 1.5 },
      { term: 'passoire énergétique',        weight: 1.5 },
      { term: 'état des risques',            weight: 1.5 },
      { term: 'responsabilité diagnostiqueur', weight: 1.0 },
      { term: 'erp',                         weight: 1.0 },
    ],
    domain: { name: 'diagnostics' },
  },

  // ── 6. Urbanisme ─────────────────────────────────────────────────────────
  {
    keywords: [
      { term: 'permis de construire',        weight: 2.0 },
      { term: 'plu',                         weight: 2.0 },
      { term: 'zan',                         weight: 2.0 },
      { term: "certificat d'urbanisme",      weight: 2.0 },
      { term: 'déclaration préalable',       weight: 2.0 },
      { term: 'droit de préemption',         weight: 2.0 },
      { term: 'division parcellaire',        weight: 1.5 },
      { term: 'lotissement',                 weight: 1.5 },
      { term: 'zone agricole',               weight: 1.5 },
      { term: 'abf',                         weight: 1.5 },
      { term: 'architecte bâtiments de france', weight: 1.5 },
      { term: 'secteur protégé',             weight: 1.5 },
      { term: 'monument historique',         weight: 1.5 },
      { term: 'ppri',                        weight: 1.5 },
      { term: 'zone inondable',              weight: 1.5 },
      { term: 'zone constructible',          weight: 1.5 },
      { term: 'changement de destination',   weight: 1.5 },
      { term: 'cu opérationnel',             weight: 1.0 },
      { term: 'cu informatif',               weight: 1.0 },
    ],
    domain: { name: 'urbanisme', judilibreTheme: 'urbanisme', judilibreChamber: 'civ3' },
  },

  // ── 7. Bail commercial ───────────────────────────────────────────────────
  {
    keywords: [
      { term: 'bail commercial',             weight: 2.0 },
      { term: 'fonds de commerce',           weight: 2.0 },
      { term: 'indemnité d\'éviction',       weight: 2.0 },
      { term: 'l145',                        weight: 2.0 },
      { term: '3-6-9',                       weight: 2.0 },
      { term: 'loyer commercial',            weight: 2.0 },
      { term: 'droit au bail',               weight: 1.5 },
      { term: 'bail professionnel',          weight: 1.5 },
      { term: 'indice ilat',                 weight: 1.5 },
      { term: 'pas-de-porte',                weight: 1.5 },
      { term: 'déspécialisation',            weight: 1.5, fuzzy: true },
    ],
    domain: { name: 'bail_commercial', judilibreTheme: 'bail commercial', judilibreChamber: 'comm' },
  },

  // ── 8. Viager & démembrement ─────────────────────────────────────────────
  {
    keywords: [
      { term: 'viager',                      weight: 2.0 },
      { term: 'nue-propriété',               weight: 2.0 },
      { term: 'démembrement',                weight: 2.0, fuzzy: true },
      { term: 'usufruit',                    weight: 2.0 },
      { term: 'rente viagère',               weight: 2.0 },
      { term: 'débirentier',                 weight: 2.0 },
      { term: 'bouquet viager',              weight: 2.0 },
      { term: 'quasi-usufruit',              weight: 1.5 },
      { term: 'droit d\'usage et d\'habitation', weight: 1.5 },
    ],
    domain: { name: 'viager_demembrement' },
  },

  // ── 9. Litiges & procédure ───────────────────────────────────────────────
  //    Termes très génériques fortement sous-pondérés
  {
    keywords: [
      { term: 'mise en demeure',             weight: 2.0 },
      { term: 'expertise judiciaire',        weight: 2.0 },
      { term: 'référé',                      weight: 2.0, fuzzy: true },
      { term: 'assignation en justice',      weight: 2.0 },
      { term: 'commissaire de justice',      weight: 1.5 },
      { term: 'huissier',                    weight: 1.5 },
      { term: 'astreinte',                   weight: 1.5 },
      { term: 'exécution forcée',            weight: 1.5 },
      { term: 'saisie immobilière',          weight: 1.5 },
      { term: 'hypothèque judiciaire',       weight: 1.5 },
      { term: 'délai de prescription',       weight: 1.0 },
      { term: 'prescription',                weight: 1.0, fuzzy: true },
      { term: 'forclusion',                  weight: 1.0 },
      { term: 'conciliation',                weight: 1.0 },
      { term: 'médiation',                   weight: 1.0 },
      { term: 'dommages et intérêts',        weight: 1.0 },
      { term: 'préjudice',                   weight: 0.5 },
      { term: 'responsabilité civile',       weight: 0.5 },
      // Termes ultra-génériques : contribuent seulement en combinaison
      { term: 'tribunal',                    weight: 0.3 },
      { term: 'juge',                        weight: 0.3 },
      { term: 'procédure',                   weight: 0.3 },
    ],
    domain: { name: 'litiges' },
  },

  // ── 10. Construction ─────────────────────────────────────────────────────
  {
    keywords: [
      { term: 'vefa',                        weight: 2.0 },
      { term: 'garantie décennale',          weight: 2.0 },
      { term: 'responsabilité décennale',    weight: 2.0 },
      { term: 'malfaçon',                    weight: 2.0, fuzzy: true },
      { term: 'dommage ouvrage',             weight: 2.0 },
      { term: 'parfait achèvement',          weight: 2.0 },
      { term: 'réception des travaux',       weight: 2.0 },
      { term: 'garantie biennale',           weight: 2.0 },
      { term: 'constructeur de maison individuelle', weight: 2.0 },
      { term: 'promoteur immobilier',        weight: 1.5 },
      { term: 'assurance do',               weight: 1.5 },
      { term: 'sinistre construction',       weight: 1.5 },
      { term: 'fissures',                    weight: 1.0, fuzzy: true },
    ],
    domain: { name: 'construction', judilibreTheme: 'construction immobilière', judilibreChamber: 'civ3' },
  },

  // ── 11. Fiscalité investisseurs ──────────────────────────────────────────
  {
    keywords: [
      { term: 'plus-value immobilière',      weight: 2.0 },
      { term: 'ifi',                         weight: 2.0 },
      { term: 'lmnp',                        weight: 2.0 },
      { term: 'déficit foncier',             weight: 2.0 },
      { term: 'dispositif pinel',            weight: 2.0 },
      { term: 'denormandie',                 weight: 2.0 },
      { term: 'taxe foncière',               weight: 1.5 },
      { term: 'revenus fonciers',            weight: 1.5 },
      { term: 'droits de mutation',          weight: 1.5 },
      { term: 'micro-foncier',               weight: 1.5 },
      { term: 'régime réel foncier',         weight: 1.5 },
      { term: 'lmp',                         weight: 1.5 },
      { term: 'amortissement immobilier',    weight: 1.5 },
      { term: 'cfe',                         weight: 1.0 },
      { term: 'location meublée',            weight: 1.0 },
      { term: 'sci',                         weight: 1.0 },
      { term: 'droits d\'enregistrement',    weight: 1.0 },
    ],
    domain: { name: 'fiscalite_investisseurs' },
  },

  // ── 12. Servitudes & voisinage ───────────────────────────────────────────
  //    Ces notions NE SONT PAS routées vers vente_immobiliere
  {
    keywords: [
      { term: 'droit de passage',            weight: 2.0 },
      { term: 'servitude de passage',        weight: 2.0 },
      { term: 'fonds dominant',              weight: 2.0 },
      { term: 'fonds servant',               weight: 2.0 },
      { term: 'mitoyenneté',                 weight: 2.0 },
      { term: 'mur mitoyen',                 weight: 2.0 },
      { term: 'servitude de vue',            weight: 2.0 },
      { term: 'servitude d\'écoulement',     weight: 2.0 },
      { term: 'bornage',                     weight: 1.5 },
      { term: 'empiètement',                 weight: 1.5 },
      { term: 'droit de vue',                weight: 1.5 },
      { term: 'troubles anormaux de voisinage', weight: 1.5 },
      { term: 'servitude',                   weight: 1.0, fuzzy: true },
      { term: 'voisinage',                   weight: 0.5 },
    ],
    domain: { name: 'servitudes' },
  },

  // ── 13. Location touristique ─────────────────────────────────────────────
  //    Anciennement "location_saisonniere" — aligné sur VALID_DOMAINS
  {
    keywords: [
      { term: 'meublé de tourisme',          weight: 2.0 },
      { term: 'location saisonnière',        weight: 2.0 },
      { term: 'changement d\'usage',         weight: 2.0 },
      { term: 'numéro d\'enregistrement',    weight: 2.0 },
      { term: 'airbnb',                      weight: 2.0 },
      { term: 'location courte durée',       weight: 2.0 },
      { term: 'taxe de séjour',              weight: 1.5 },
      { term: 'compensation logement',       weight: 1.5 },
      { term: 'arrêté municipal location',   weight: 1.5 },
      { term: 'plateforme de location',      weight: 1.0 },
    ],
    domain: { name: 'location_touristique' },
  },

  // ── 14. Environnement & assainissement ───────────────────────────────────
  //    Inclut ANC / SPANC / fosse septique — termes critiques manquants
  {
    keywords: [
      // ─ ANC / assainissement non collectif (bloc manquant dans l'ancienne version)
      { term: 'spanc',                       weight: 2.0 },
      { term: 'anc',                         weight: 2.0 },
      { term: 'assainissement non collectif', weight: 2.0 },
      { term: 'fosse septique',              weight: 2.0 },
      { term: 'micro-station',               weight: 2.0 },
      { term: 'filière d\'assainissement',   weight: 2.0 },
      { term: 'contrôle assainissement',     weight: 2.0 },
      { term: 'non-conformité assainissement', weight: 2.0 },
      { term: 'eaux usées',                  weight: 1.5 },
      { term: 'épandage',                    weight: 1.5 },
      { term: 'fosse toutes eaux',           weight: 1.5 },
      // ─ Pollution des sols
      { term: 'dépollution',                 weight: 2.0 },
      { term: 'sol pollué',                  weight: 2.0 },
      { term: 'terrain pollué',              weight: 2.0 },
      { term: 'icpe',                        weight: 1.5 },
      { term: 'installation classée',        weight: 1.5 },
      { term: 'sis',                         weight: 1.5 },
      { term: "secteur d'information sur les sols", weight: 1.5 },
      { term: 'basol',                       weight: 1.5 },
      { term: 'basias',                      weight: 1.5 },
      { term: 'seveso',                      weight: 1.5 },
      { term: 'géorisques',                  weight: 1.5 },
      { term: 'friche industrielle',         weight: 1.5 },
      { term: 'pollueur-payeur',             weight: 1.0 },
      { term: 'responsabilité environnementale', weight: 1.0 },
    ],
    domain: { name: 'environnement_immo' },
  },

]

// ─────────────────────────────────────────────────────────────────────────────
// Matching
// ─────────────────────────────────────────────────────────────────────────────

/** Échappe les caractères spéciaux regex dans une chaîne littérale. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Vérifie si un terme matche dans le texte.
 *
 * RÈGLE TERMES COURTS (≤ 4 caractères — ex : plu, dpe, zan, gli, sci, anc) :
 *   → Frontière de mot stricte (\b...\b) UNIQUEMENT.
 *   → Jamais de substring brut (text.includes) pour éviter que "plu" matche dans "plus".
 *   → Jamais de fuzzy sur ces termes.
 *
 * RÈGLE TERMES LONGS (> 4 caractères) :
 *   → Substring exact (text.includes) — cas normal.
 *   → Si fuzzy:true : teste aussi la racine tronquée (6 premiers chars max).
 */
function matchesKeyword(text: string, kw: WeightedKeyword): boolean {
  const term = kw.term.toLowerCase()

  // Termes courts : word boundary strict, jamais de fuzzy
  if (term.length <= 4) {
    // \b fonctionne sur les caractères ASCII ; suffisant pour nos acronymes (plu, dpe, zan…)
    const re = new RegExp(`\\b${escapeRegex(term)}\\b`, 'i')
    return re.test(text)
  }

  // Termes longs : substring classique
  if (text.includes(term)) return true

  // Fuzzy uniquement sur les termes longs explicitement marqués
  if (kw.fuzzy && term.length >= 5) {
    const stem = term.slice(0, Math.min(term.length - 1, 6))
    return text.includes(stem)
  }

  return false
}

interface DomainScore {
  domain: DomainMatch
  score: number
  matched: string[]
}

/**
 * Calcule les scores pondérés pour chaque domaine.
 * Agrège les entrées multiples vers le même domaine.
 */
function computeScores(question: string): DomainScore[] {
  const lower = question.toLowerCase()
  const scoreMap = new Map<string, DomainScore>()

  for (const entry of DOMAIN_KEYWORDS) {
    let score = 0
    const matched: string[] = []

    for (const kw of entry.keywords) {
      if (matchesKeyword(lower, kw)) {
        score += kw.weight
        matched.push(`${kw.term}(${kw.weight})`)
      }
    }

    if (score > 0) {
      const existing = scoreMap.get(entry.domain.name)
      if (existing) {
        existing.score += score
        existing.matched.push(...matched)
      } else {
        scoreMap.set(entry.domain.name, { domain: entry.domain, score, matched })
      }
    }
  }

  return [...scoreMap.values()].sort((a, b) => b.score - a.score)
}

// ─────────────────────────────────────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retourne les domaines les plus probables (0, 1 ou 2).
 * Le 2e domaine n'est retourné que si son score >= 70 % du score du 1er.
 * Les noms retournés correspondent aux valeurs `domain` dans VALID_DOMAINS.
 */
export function detectDomains(question: string): string[] {
  const sorted = computeScores(question)

  if (sorted.length === 0) return []

  // Log de debug : mots-clés ayant scoré par domaine
  console.debug(
    '[domain-detector]',
    sorted
      .map(s => `${s.domain.name}=${s.score.toFixed(1)} [${s.matched.join(', ')}]`)
      .join(' | '),
  )

  const results: string[] = [sorted[0].domain.name]

  if (sorted.length >= 2 && sorted[1].score >= 0.7 * sorted[0].score) {
    results.push(sorted[1].domain.name)
  }

  return results
}

/**
 * Retourne le DomainMatch principal (avec métadonnées Judilibre) ou null.
 */
export function detectDomain(question: string): DomainMatch | null {
  const sorted = computeScores(question)
  return sorted.length > 0 ? sorted[0].domain : null
}
