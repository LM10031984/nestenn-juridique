// lib/domain-policies.ts
// Policy runtime par domaine — source de vérité unique pour le comportement de réponse
//
// Principe d'architecture :
//   DOMAIN_CORPUS (domain-reference-corpus.ts) = source métier / indexation / couverture
//   DOMAIN_POLICIES (ce fichier)               = comportement runtime de réponse
//
// Consommateurs :
//   - lib/system-prompt.ts          → FORCE_JURISPRUDENCE_DOMAINS (dérivé)
//   - lib/legifrance-*.ts           → safetyLevel
//   - lib/topic-articles.ts         → shortlistStrategy
//   - __tests__/domain-policies.test.ts → cohérence

export interface DomainPolicy {
  /** Code domaine — doit correspondre exactement à VALID_DOMAINS */
  code: string
  /** true = jurisprudence live obligatoire quand des arrêts sont disponibles */
  forceJurisprudence: boolean
  /** true = déclencher legifrance-sync live pour compléter le corpus */
  useLiveArticleSync: boolean
  /** Niveau de précaution dans la formulation de la réponse */
  safetyLevel: 'medium' | 'high' | 'critical'
  /** Identifiant de la shortlist métier dans topic-articles.ts (optionnel) */
  shortlistStrategy?: string
  /** Nombre max d'articles live injectés dans le prompt */
  maxLiveArticles: number
  /** Note d'implémentation — pour les domaines legacy ou en cours */
  notes?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Policies — 22 entrées (18 domaines actifs + 3 legacy + 1 historique)
// ─────────────────────────────────────────────────────────────────────────────

export const DOMAIN_POLICIES: Record<string, DomainPolicy> = {

  // ── DOMAINES EXISTANTS ────────────────────────────────────────────────────

  baux_habitation: {
    code: 'baux_habitation',
    forceJurisprudence: true,
    useLiveArticleSync: true,
    safetyLevel: 'critical',
    shortlistStrategy: 'loyers_impayes_procedure',
    maxLiveArticles: 3,
  },

  gestion_locative: {
    code: 'gestion_locative',
    forceJurisprudence: false,
    useLiveArticleSync: true,
    safetyLevel: 'high',
    shortlistStrategy: 'gestion_locative_mandat',
    maxLiveArticles: 3,
  },

  copropriete: {
    code: 'copropriete',
    forceJurisprudence: true,
    useLiveArticleSync: true,
    safetyLevel: 'critical',
    shortlistStrategy: 'copropriete_ag_charges',
    maxLiveArticles: 3,
  },

  syndic_copropriete: {
    code: 'syndic_copropriete',
    forceJurisprudence: false,
    useLiveArticleSync: true,
    safetyLevel: 'high',
    shortlistStrategy: 'syndic_mandat_recouvrement',
    maxLiveArticles: 3,
  },

  agent_immobilier: {
    code: 'agent_immobilier',
    forceJurisprudence: true,
    useLiveArticleSync: true,
    safetyLevel: 'critical',
    shortlistStrategy: 'agent_hoguet_mandat',
    maxLiveArticles: 3,
  },

  vente_immobiliere: {
    code: 'vente_immobiliere',
    forceJurisprudence: true,
    useLiveArticleSync: true,
    safetyLevel: 'critical',
    shortlistStrategy: 'vente_compromis_retractation',
    maxLiveArticles: 3,
  },

  diagnostics: {
    code: 'diagnostics',
    forceJurisprudence: false,
    useLiveArticleSync: true,
    safetyLevel: 'high',
    shortlistStrategy: 'diagnostics_dpe_amiante',
    maxLiveArticles: 3,
  },

  construction: {
    code: 'construction',
    forceJurisprudence: true,
    useLiveArticleSync: true,
    safetyLevel: 'high',
    shortlistStrategy: 'construction_decennale_vefa',
    maxLiveArticles: 3,
  },

  urbanisme: {
    code: 'urbanisme',
    forceJurisprudence: false,
    useLiveArticleSync: true,
    safetyLevel: 'high',
    shortlistStrategy: 'urbanisme_permis_plu',
    maxLiveArticles: 3,
  },

  bail_commercial: {
    code: 'bail_commercial',
    forceJurisprudence: true,
    useLiveArticleSync: true,
    safetyLevel: 'high',
    shortlistStrategy: 'bail_commercial_renouvellement',
    maxLiveArticles: 3,
  },

  viager_demembrement: {
    code: 'viager_demembrement',
    forceJurisprudence: false,
    useLiveArticleSync: true,
    safetyLevel: 'high',
    maxLiveArticles: 3,
  },

  // ── DOMAINES V1 ───────────────────────────────────────────────────────────

  droit_social_immo: {
    code: 'droit_social_immo',
    forceJurisprudence: false,
    useLiveArticleSync: true,
    safetyLevel: 'critical',
    maxLiveArticles: 3,
  },

  fiscalite_investisseurs: {
    code: 'fiscalite_investisseurs',
    forceJurisprudence: false,
    useLiveArticleSync: true,
    safetyLevel: 'critical',
    maxLiveArticles: 3,
  },

  sci_patrimoine: {
    code: 'sci_patrimoine',
    forceJurisprudence: false,
    useLiveArticleSync: true,
    safetyLevel: 'high',
    maxLiveArticles: 3,
  },

  // ── DOMAINES V2 ───────────────────────────────────────────────────────────

  responsabilite_agent: {
    code: 'responsabilite_agent',
    forceJurisprudence: true,
    useLiveArticleSync: true,
    safetyLevel: 'critical',
    maxLiveArticles: 3,
  },

  location_touristique: {
    code: 'location_touristique',
    forceJurisprudence: false,
    useLiveArticleSync: true,
    safetyLevel: 'high',
    maxLiveArticles: 3,
  },

  environnement_immo: {
    code: 'environnement_immo',
    forceJurisprudence: false,
    useLiveArticleSync: true,
    safetyLevel: 'critical',
    shortlistStrategy: 'spanc_anc_fosse',
    maxLiveArticles: 3,
  },

  // ── DOMAINES V3 ───────────────────────────────────────────────────────────

  conformite_lcb_ft: {
    code: 'conformite_lcb_ft',
    forceJurisprudence: false,
    useLiveArticleSync: true,
    safetyLevel: 'critical',
    maxLiveArticles: 2,
  },

  rgpd_agence: {
    code: 'rgpd_agence',
    forceJurisprudence: false,
    useLiveArticleSync: true,
    safetyLevel: 'critical',
    shortlistStrategy: 'rgpd_agence_prospection',
    maxLiveArticles: 3,
  },

  // ── DOMAINES LEGACY (rétro-compatibilité avec articles déjà indexés) ──────

  fiscalite: {
    code: 'fiscalite',
    forceJurisprudence: false,
    useLiveArticleSync: false,      // ne pas enrichir — orienter vers fiscalite_investisseurs
    safetyLevel: 'critical',
    maxLiveArticles: 2,
    notes: 'Legacy — nouveaux articles dans fiscalite_investisseurs',
  },

  servitudes: {
    code: 'servitudes',
    forceJurisprudence: true,
    useLiveArticleSync: true,
    safetyLevel: 'high',
    shortlistStrategy: 'servitudes_mitoyennete',
    maxLiveArticles: 3,
  },

  litiges: {
    code: 'litiges',
    forceJurisprudence: false,
    useLiveArticleSync: false,      // cas par cas — pas de sync automatique
    safetyLevel: 'high',
    maxLiveArticles: 2,
    notes: 'Legacy — domaine transversal, pas de sync automatique',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retourne la policy pour un domaine.
 * Lève une erreur en dev si le domaine est inconnu — pour détecter les orphelins tôt.
 */
export function getDomainPolicy(domain: string): DomainPolicy | undefined {
  return DOMAIN_POLICIES[domain]
}

/**
 * Dérive l'ensemble des domaines où la jurisprudence live est obligatoire.
 * Remplace FORCE_JURISPRUDENCE_DOMAINS dans system-prompt.ts.
 */
export const FORCE_JURISPRUDENCE_DOMAINS: ReadonlySet<string> = new Set(
  Object.values(DOMAIN_POLICIES)
    .filter(p => p.forceJurisprudence)
    .map(p => p.code),
)

/**
 * Retourne true si le domaine doit déclencher un sync Légifrance live.
 */
export function requiresLiveSync(domain: string): boolean {
  return DOMAIN_POLICIES[domain]?.useLiveArticleSync ?? false
}

/**
 * Retourne true si le domaine est critique (jurisprudence obligatoire ET
 * niveau de sécurité critical ou domaine à risque élevé).
 */
export function isCriticalDomain(domain: string): boolean {
  const p = DOMAIN_POLICIES[domain]
  if (!p) return false
  return p.safetyLevel === 'critical' || p.forceJurisprudence
}
