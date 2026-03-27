/**
 * scripts/index-legifrance.ts
 * Indexation Légifrance → Supabase pgvector (table legal_articles)
 *
 * Sources indexées :
 *   - Loi 89-462    (baux habitation)          — LODA — tous les articles en vigueur
 *   - Loi 65-557    (copropriété)               — LODA — tous les articles en vigueur
 *   - Loi 70-9      (Hoguet — agents)           — LODA — tous les articles en vigueur
 *   - Décret 67-223 (copropriété)               — LODA — tous les articles en vigueur
 *   - Loi 2014-366  (ALUR)                      — LODA — tous les articles en vigueur
 *   - Loi 2018-1021 (ELAN)                      — LODA — tous les articles en vigueur
 *   - Loi 2021-1104 (Climat-Résilience)         — LODA — tous les articles en vigueur
 *   - Code civil    (sections immobilières)     — CODE — /search par domaine
 *   - Code CCH      (construction & habitation) — CODE — /search par domaine
 *   - Code urbanisme                            — CODE — /search par domaine
 *   - Code conso    (crédit immobilier)         — CODE — /search par domaine
 *   - Code commerce (bail commercial)           — CODE — /search par domaine
 *   - Code tourisme (meublé de tourisme)        — CODE — /search par domaine
 *   - Code civil    (servitudes, baux profess.) — CODE — /search par domaine
 *   - CGI           (fiscalité immobilière)     — CODE — /search par domaine
 *   - Code rural    (SAFER, préemption agric.)  — CODE — /search par domaine
 *
 * Usage :
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/index-legifrance.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/index-legifrance.ts --law 89-462
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/index-legifrance.ts --dry-run
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/index-legifrance.ts --reindex
 */

import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const TARGET_LAW  = args.includes('--law')     ? args[args.indexOf('--law') + 1]   : null
const DRY_RUN     = args.includes('--dry-run')
const REINDEX     = args.includes('--reindex')
const CONCURRENCY = 3
const MAX_PER_LAW = 0      // 0 = pas de limite (indexe tous les articles en vigueur)

console.log(`Config : law=${TARGET_LAW ?? 'all'} dry-run=${DRY_RUN} reindex=${REINDEX}`)

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const TOKEN_URL    = 'https://oauth.piste.gouv.fr/api/oauth/token'
const API_BASE     = process.env.PISTE_API_URL ?? 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const SUMMARY_MODEL  = 'openai/gpt-4o-mini'

const TODAY = new Date().toISOString().split('T')[0]   // 'YYYY-MM-DD'

// ---------------------------------------------------------------------------
// Définition des lois à indexer
// ---------------------------------------------------------------------------

interface LawConfig {
  id: string           // clé courte ex: '89-462'
  label: string        // nom humain
  legitext: string     // LEGITEXT ID
  domain: string       // domaine principal Nestenn
  subThemes: string[]  // sous-thèmes possibles pour ce texte
  strategy: 'full' | 'search'
  searchKeywords?: string  // pour strategy='search'
  sctCid?: string          // pour strategy='full' : cibler une section (LEGISCTA...)
  fond?: 'CODE_DATE' | 'LODA_DATE'
  maxArticles?: number     // limite articles pour les grandes lois
}

const LAWS: LawConfig[] = [
  // ── Lois thématiques complètes ──────────────────────────────────────────────
  {
    id: '89-462',
    label: 'Loi 89-462 — Baux d\'habitation',
    legitext: 'LEGITEXT000006069108',
    domain: 'baux_habitation',
    subThemes: ['loyer', 'irl', 'depot_garantie', 'conge', 'impaye', 'clause_resolutoire', 'expulsion', 'decence', 'vetuste', 'edl', 'treve_hivernale', 'bail_meuble', 'bail_mobilite', 'encadrement_loyers'],
    strategy: 'full',
    fond: 'LODA_DATE',
  },
  {
    id: '65-557',
    label: 'Loi 65-557 — Copropriété',
    legitext: 'LEGITEXT000006068256',
    domain: 'copropriete',
    subThemes: ['ag', 'charges', 'syndic', 'travaux', 'parties_communes', 'reglement', 'tantiemes', 'contestation_ag'],
    strategy: 'full',
    fond: 'LODA_DATE',
  },
  {
    id: '67-223',
    label: 'Décret 67-223 — Copropriété (application)',
    legitext: 'LEGITEXT000006061423',
    domain: 'copropriete',
    subThemes: ['ag', 'charges', 'syndic', 'travaux', 'parties_communes', 'reglement'],
    strategy: 'full',
    fond: 'LODA_DATE',
  },
  {
    id: '70-9',
    label: 'Loi 70-9 — Hoguet (agents immobiliers)',
    legitext: 'LEGITEXT000006068387',
    domain: 'agent_immobilier',
    subThemes: ['mandat', 'commission', 'honoraires', 'devoir_conseil', 'responsabilite', 'carte_t'],
    strategy: 'full',
    fond: 'LODA_DATE',
  },

  // ── Grandes lois (toutes indexées — pas de limite artificielle) ─────────────
  {
    id: '2014-366',
    label: 'Loi ALUR 2014-366',
    legitext: 'LEGITEXT000028775733',
    domain: 'baux_habitation',
    subThemes: ['loyer', 'encadrement_loyers', 'depot_garantie', 'conge', 'decence', 'bail_meuble'],
    strategy: 'full',
    fond: 'LODA_DATE',
  },
  {
    id: '2018-1021',
    label: 'Loi ELAN 2018-1021',
    legitext: 'LEGITEXT000037642121',
    domain: 'baux_habitation',
    subThemes: ['bail_mobilite', 'decence', 'expulsion', 'treve_hivernale'],
    strategy: 'full',
    fond: 'LODA_DATE',
  },
  {
    id: '2021-1104',
    label: 'Loi Climat-Résilience 2021-1104',
    legitext: 'LEGITEXT000043957598',
    domain: 'diagnostics',
    subThemes: ['dpe', 'decence', 'vetuste'],
    strategy: 'full',
    fond: 'LODA_DATE',
  },

  // ── Codes (recherche par mots-clés) ──────────────────────────────────────
  {
    id: 'civil-baux',
    label: 'Code civil — Bail et louage',
    legitext: 'LEGITEXT000006070721',
    domain: 'baux_habitation',
    subThemes: ['loyer', 'conge', 'depot_garantie', 'clause_resolutoire'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006136387',  // Chapitre II : Du louage des choses (65 arts, Art. 1709-1778)
    fond: 'CODE_DATE',
    maxArticles: 40,
  },
  {
    id: 'civil-vente',
    label: 'Code civil — Vente immobilière',
    legitext: 'LEGITEXT000006070721',
    domain: 'vente_immobiliere',
    subThemes: ['compromis', 'promesse', 'condition_suspensive', 'retractation', 'vice_cache', 'garanties'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006118107',  // Titre VI : De la vente (124 arts, Art. 1582-1701)
    fond: 'CODE_DATE',
    maxArticles: 40,
  },
  {
    id: 'civil-sci',
    label: 'Code civil — SCI et sociétés civiles',
    legitext: 'LEGITEXT000006070721',
    domain: 'sci_societes',
    subThemes: ['creation_sci', 'statuts', 'gerance', 'cession_parts', 'dissolution', 'demembrement'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006136391',  // Chapitre II : De la société civile (31 arts, Art. 1845-1870)
    fond: 'CODE_DATE',
    maxArticles: 30,
  },
  {
    id: 'civil-viager',
    label: 'Code civil — Usufruit et viager',
    legitext: 'LEGITEXT000006070721',
    domain: 'viager_demembrement',
    subThemes: ['usufruit', 'nue_propriete', 'rente_viagere', 'bouquet', 'reversion'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006117905',  // Titre III : De l'usufruit, de l'usage et de l'habitation (59 arts, Art. 578-624)
    fond: 'CODE_DATE',
    maxArticles: 25,
  },
  {
    id: 'cch-construction',
    label: 'Code CCH — CCMI et garanties construction',
    legitext: 'LEGITEXT000006074096',
    domain: 'construction',
    subThemes: ['decennale', 'biennale', 'parfait_achevement', 'vefa', 'reception', 'reserves'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006159020',  // Chapitre Ier : Contrat de construction d'une maison individuelle avec fourniture du plan (13 arts, L231)
    fond: 'CODE_DATE',
  },
  {
    id: 'cch-diagnostics',
    label: 'Code CCH — Diagnostic de performance énergétique (DPE)',
    legitext: 'LEGITEXT000006074096',
    domain: 'diagnostics',
    subThemes: ['dpe', 'amiante', 'plomb', 'termites', 'electricite', 'gaz', 'carrez', 'responsabilite_diagnostiqueur'],
    strategy: 'full',
    sctCid: 'LEGISCTA000043967326',  // Sous-section 2 : Diagnostic de performance énergétique (10 arts, L126-26 et s.)
    fond: 'CODE_DATE',
  },
  {
    id: 'cch-ddt-vente',
    label: 'Code CCH — Dossier de diagnostic technique (DDT avant vente)',
    legitext: 'LEGITEXT000006074096',
    domain: 'diagnostics',
    subThemes: ['dpe', 'amiante', 'plomb', 'termites', 'carrez', 'responsabilite_diagnostiqueur'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006176358',  // Section 2 : Dossier de diagnostic technique (3 arts, L271-4 et s.)
    fond: 'CODE_DATE',
  },
  {
    id: 'urbanisme-preemption',
    label: 'Code de l\'urbanisme — Droit de préemption urbain (DPU)',
    legitext: 'LEGITEXT000006074075',
    domain: 'urbanisme',
    subThemes: ['preemption', 'droit_preference', 'recours_tiers'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006158884',  // Chapitre Ier : Droit de préemption urbain (7 arts, L211-1 et s.)
    fond: 'CODE_DATE',
  },
  {
    id: 'urbanisme-permis',
    label: 'Code de l\'urbanisme — Permis de construire (champ d\'application)',
    legitext: 'LEGITEXT000006074075',
    domain: 'urbanisme',
    subThemes: ['permis_construire', 'plu', 'recours_tiers'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006158675',  // Chapitre Ier : Champ d'application permis construire (14 arts, L421-1 et s.)
    fond: 'CODE_DATE',
    maxArticles: 15,
  },
  {
    id: 'conso',
    label: 'Code de la consommation — Crédit immobilier',
    legitext: 'LEGITEXT000006069565',
    domain: 'consommation',
    subThemes: ['scrivener', 'retractation', 'taeg', 'pret_immobilier', 'clauses_abusives'],
    strategy: 'full',
    sctCid: 'LEGISCTA000032222201',  // Chapitre III : Crédit immobilier (66 arts, L313-1 et s.)
    fond: 'CODE_DATE',
    maxArticles: 30,
  },

  // ── Sources complémentaires (couverture complète profession) ──────────────
  {
    id: 'commerce-bail',
    label: 'Code de commerce — Bail commercial (L145)',
    legitext: 'LEGITEXT000005634379',
    domain: 'bail_commercial',
    subThemes: ['duree_369', 'renouvellement', 'revision_loyer', 'resiliation', 'droit_au_bail', 'indemnite_eviction', 'despecialisation'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006146040',  // Chapitre V : Du bail commercial (~50 arts L145-x)
    fond: 'CODE_DATE',
    maxArticles: 60,
  },
  {
    id: 'tourisme-meuble-legi',
    label: 'Code du tourisme — Meublé de tourisme (L324, législatif)',
    legitext: 'LEGITEXT000006074073',
    domain: 'location_saisonniere',
    subThemes: ['declaration_mairie', 'enregistrement', 'changement_usage', 'compensation', 'classement', 'taxe_sejour'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006143189',  // Chapitre 4 : Meublés de tourisme — partie législative (8 arts L324)
    fond: 'CODE_DATE',
  },
  {
    id: 'tourisme-meuble-reg',
    label: 'Code du tourisme — Meublé de tourisme (R324, réglementaire)',
    legitext: 'LEGITEXT000006074073',
    domain: 'location_saisonniere',
    subThemes: ['declaration_mairie', 'enregistrement', 'changement_usage', 'compensation', 'classement', 'taxe_sejour'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006158429',  // Section 1 : Meublés de tourisme — partie réglementaire (29 arts R324)
    fond: 'CODE_DATE',
    maxArticles: 30,
  },
  {
    id: 'civil-servitudes',
    label: 'Code civil — Servitudes et mitoyenneté',
    legitext: 'LEGITEXT000006070721',
    domain: 'vente_immobiliere',
    subThemes: ['servitude_passage', 'mitoyennete', 'troubles_voisinage', 'servitude_vue', 'non_aedificandi'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006117907',  // Titre IV : Des servitudes ou services fonciers (74 arts, Art. 637-710)
    fond: 'CODE_DATE',
    maxArticles: 30,
  },
  {
    id: 'cgi-plus-values',
    label: 'CGI — Plus-values immobilières (Art. 150U-VH)',
    legitext: 'LEGITEXT000006069577',
    domain: 'fiscalite',
    subThemes: ['plus_values', 'exoneration_residence_principale', 'abattement_duree', 'sci_fiscal'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006197216',  // 2. Biens et droits mobiliers ou immobiliers — Art. 150A bis à 150VH (15 arts)
    fond: 'CODE_DATE',
    maxArticles: 20,
  },
  {
    id: 'cgi-revenus-fonciers',
    label: 'CGI — Revenus fonciers et LMNP/LMP',
    legitext: 'LEGITEXT000006069577',
    domain: 'fiscalite',
    subThemes: ['revenus_fonciers', 'lmnp', 'lmp', 'deficit_foncier', 'pinel', 'denormandie'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006191572',  // Section revenus fonciers (16 arts 14-33 et s.)
    fond: 'CODE_DATE',
    maxArticles: 20,
  },
  {
    id: 'cgi-ifi',
    label: 'CGI — Impôt sur la fortune immobilière (IFI)',
    legitext: 'LEGITEXT000006069577',
    domain: 'fiscalite',
    subThemes: ['ifi', 'patrimoine_immobilier', 'sci_fiscal'],
    strategy: 'full',
    sctCid: 'LEGISCTA000036384995',  // Chapitre II bis : Impôt sur la fortune immobilière (23 arts)
    fond: 'CODE_DATE',
    maxArticles: 25,
  },
  {
    id: 'rural-safer',
    label: 'Code rural — SAFER et préemption agricole',
    legitext: 'LEGITEXT000022197698',  // Code rural et pêche maritime (corrigé — ancien: LEGITEXT000006071366)
    domain: 'urbanisme',
    subThemes: ['preemption', 'safer', 'zone_agricole', 'droit_preference'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006138310',  // Titre IV : Les sociétés d'aménagement foncier et d'établissement rural (CRPM)
    fond: 'CODE_DATE',
    maxArticles: 25,
  },
  {
    id: 'civil-baux-pro',
    label: 'Code civil — Baux professionnels (règles générales louage)',
    legitext: 'LEGITEXT000006070721',
    domain: 'bail_commercial',
    subThemes: ['bail_professionnel', 'duree_6ans', 'resiliation', 'renouvellement'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006136387',  // Chapitre II : Du louage des choses (65 arts) — règles générales supplétives
    fond: 'CODE_DATE',
    maxArticles: 15,
  },

  // ── Obligations professionnelles agents ────────────────────────────────────
  {
    id: 'deontologie-agents',
    label: 'Décret 2015-1090 — Code de déontologie agents immobiliers',
    legitext: 'JORFTEXT000031113441',  // JORFTEXT (pas de LEGITEXT propre) — 4 arts + annexe
    domain: 'agent_immobilier',
    subThemes: ['deontologie', 'devoir_conseil', 'responsabilite', 'conflit_interets', 'confidentialite', 'formation_continue'],
    strategy: 'full',
    fond: 'LODA_DATE',
  },
  {
    id: 'hoguet-application',
    label: 'Décret 72-678 — Application loi Hoguet (mandats, gestion)',
    legitext: 'JORFTEXT000000855024',  // JORFTEXT décret 72-678 — 128 articles
    domain: 'agent_immobilier',
    subThemes: ['mandat', 'carte_t', 'commission', 'honoraires', 'gestion_locative', 'garantie_financiere', 'RCP'],
    strategy: 'full',
    fond: 'LODA_DATE',
    maxArticles: 130,
  },
  {
    id: 'tracfin-cmf',
    label: 'CMF — TRACFIN / LAB-FT (L561-1 à L561-50)',
    legitext: 'LEGITEXT000006072026',
    domain: 'agent_immobilier',
    subThemes: ['tracfin', 'LAB_FT', 'declaration_soupcon', 'vigilance_client', 'PPE', 'gel_avoirs'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006154830',  // Chapitre Ier LAB-FT — L561-1 à L561-50 (82 arts)
    fond: 'CODE_DATE',
    maxArticles: 60,
  },
  {
    id: 'non-discrimination',
    label: 'Code pénal — Non-discrimination (Art. 225-1 et s.)',
    legitext: 'LEGITEXT000006070719',
    domain: 'agent_immobilier',
    subThemes: ['non_discrimination', 'egalite_traitement', 'refus_location', 'sanctions_penales'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006165298',  // Section 1 : Des discriminations — Art. 225-1 et s. (7 arts)
    fond: 'CODE_DATE',
    maxArticles: 20,
  },

  // ── Fiscalité complémentaire ───────────────────────────────────────────────
  {
    id: 'cgi-droits-mutation',
    label: 'CGI — Droits de mutation (DMTO, frais de notaire)',
    legitext: 'LEGITEXT000006069577',
    domain: 'vente_immobiliere',
    subThemes: ['dmto', 'frais_notaire', 'droits_enregistrement', 'tpe'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006179720',  // II : Mutations de propriété à titre onéreux d'immeubles — Art. 683 et s. (17 arts)
    fond: 'CODE_DATE',
    maxArticles: 20,
  },

  // ── VEFA et garanties construction ────────────────────────────────────────
  {
    id: 'cch-vefa',
    label: 'Code CCH — VEFA (L261-1 et s.)',
    legitext: 'LEGITEXT000006074096',
    domain: 'construction',
    subThemes: ['vefa', 'contrat_reservation', 'appel_fonds', 'garantie_achevement', 'livraison', 'promoteur'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006159128',  // Chapitre Ier : Vente d'immeuble à construire (19 arts, L261-1 et s.)
    fond: 'CODE_DATE',
  },
  {
    id: 'civil-decennale',
    label: 'Code civil — Garantie décennale (Art. 1792 et s.)',
    legitext: 'LEGITEXT000006070721',
    domain: 'construction',
    subThemes: ['decennale', 'biennale', 'parfait_achevement', 'responsabilite_constructeur', 'dommage_ouvrage'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006150293',  // Section III : Constructeurs (Art. 1787-1799) — contient 1792-1792-7
    fond: 'CODE_DATE',
  },

  // ── Fiscalité BIC/LMNP ─────────────────────────────────────────────────────
  {
    id: 'cgi-lmnp-bic',
    label: 'CGI — BIC / LMNP (Art. 34 et s.)',
    legitext: 'LEGITEXT000006069577',
    domain: 'fiscalite',
    subThemes: ['lmnp', 'lmp', 'bic', 'location_meublee', 'amortissement', 'regime_micro_bic', 'cfe'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006191573',  // II : Bénéfices industriels et commerciaux (~109 arts, Art. 34 et s.)
    fond: 'CODE_DATE',
    maxArticles: 30,
  },

  // ── Hypothèques et sûretés ─────────────────────────────────────────────────
  {
    id: 'civil-hypotheque',
    label: 'Code civil — Hypothèques (Art. 2393 et s.)',
    legitext: 'LEGITEXT000006070721',
    domain: 'vente_immobiliere',
    subThemes: ['hypotheque', 'privilege_preteur', 'caution', 'mainlevee', 'purge', 'surenchere', 'saisie_immobiliere'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006150396',  // Chapitre III : Des hypothèques (~90 arts, Art. 2393 et s.)
    fond: 'CODE_DATE',
    maxArticles: 30,
  },

  // ── Droit du logement complémentaire ──────────────────────────────────────
  {
    id: 'cch-permis-louer',
    label: 'CCH — Permis de louer (L635-1 et s.)',
    legitext: 'LEGITEXT000006074096',
    domain: 'baux_habitation',
    subThemes: ['permis_louer', 'autorisation_prealable', 'declaration_mise_location', 'decence'],
    strategy: 'full',
    sctCid: 'LEGISCTA000028781374',  // Chapitre V : Autorisation préalable de mise en location (11 arts, L635-1 et s.)
    fond: 'CODE_DATE',
  },
  {
    id: 'civil-indivision',
    label: 'Code civil — Indivision (Art. 815 et s.)',
    legitext: 'LEGITEXT000006070721',
    domain: 'vente_immobiliere',
    subThemes: ['indivision', 'partage', 'licitation', 'droit_attribution', 'succession_immo'],
    strategy: 'full',
    sctCid: 'LEGISCTA000006136538',  // Chapitre VII : Du régime légal de l'indivision (21 arts, Art. 815 et s.)
    fond: 'CODE_DATE',
    maxArticles: 20,
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelay = 1000,
  label = ''
): Promise<T | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      if (attempt === retries) {
        console.error(`  [RETRY EXHAUSTED] ${label} — ${err.message}`)
        return null
      }
      const delay = baseDelay * Math.pow(2, attempt - 1)
      await sleep(delay)
    }
  }
  return null
}

function createSemaphore(limit: number) {
  let active = 0
  const queue: Array<() => void> = []
  return async function acquire(): Promise<() => void> {
    if (active < limit) {
      active++
      return () => { active--; queue.shift()?.() }
    }
    await new Promise<void>(resolve => queue.push(resolve))
    active++
    return () => { active--; queue.shift()?.() }
  }
}

// ---------------------------------------------------------------------------
// Auth Légifrance (même PISTE OAuth)
// ---------------------------------------------------------------------------

let _token: string | null = null
let _tokenExpiry = 0

async function getToken(): Promise<string> {
  if (_token && Date.now() < _tokenExpiry) return _token
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.PISTE_CLIENT_ID!,
      client_secret: process.env.PISTE_CLIENT_SECRET!,
      scope: 'openid',
    }),
  })
  if (!res.ok) throw new Error(`Token PISTE échoué : ${res.status}`)
  const data = await res.json() as { access_token: string; expires_in: number }
  _token = data.access_token
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
  return _token
}

// ---------------------------------------------------------------------------
// Légifrance — legiPart : récupère la structure complète d'un texte
// ---------------------------------------------------------------------------

async function fetchLegiPart(token: string, textId: string): Promise<any | null> {
  return withRetry(async () => {
    const res = await fetch(`${API_BASE}/consult/legiPart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ textId, date: TODAY }),
    })
    if (!res.ok) throw new Error(`legiPart ${textId} → HTTP ${res.status}`)
    return res.json()
  }, 3, 1000, `legiPart(${textId})`)
}

// ---------------------------------------------------------------------------
// Traversée récursive — cherche une section par son CID
// ---------------------------------------------------------------------------

function findSectionByCid(node: any, cid: string): any | null {
  const nodeCid = node?.cid ?? node?.id ?? ''
  if (nodeCid === cid) return node
  for (const section of (node?.sections ?? [])) {
    const found = findSectionByCid(section, cid)
    if (found) return found
  }
  return null
}

// ---------------------------------------------------------------------------
// Traversée récursive de l'arbre legiPart — collecte tous les articles VIGUEUR
// ---------------------------------------------------------------------------

interface ArticleRef {
  id: string      // LEGIARTI...
  num: string
  etat: string
}

function collectArticles(node: any, out: ArticleRef[] = []): ArticleRef[] {
  for (const art of (node?.articles ?? [])) {
    const etat = (art.etat ?? '').toUpperCase()
    if ((etat === 'VIGUEUR' || etat === 'VIGUEUR_ETEN') && art.id) {
      out.push({ id: art.id, num: art.num ?? '', etat })
    }
  }
  for (const section of (node?.sections ?? [])) {
    collectArticles(section, out)
  }
  return out
}

function normalizeLegiPartRoot(data: any): any {
  // LODA : data.texte ou data.texteConsolide
  // CODE : data.legi ou data.code ou data.texte
  return data?.texteConsolide ?? data?.texte ?? data?.legi ?? data?.code ?? data
}

// ---------------------------------------------------------------------------
// Légifrance — getArticle : texte complet + métadonnées
// ---------------------------------------------------------------------------

interface FullArticle {
  id:                string
  texte:             string
  fullSectionsTitre: string
  etat:              string
  dateDebut:         string | null
  comporteLiensSP:   boolean
}

async function fetchArticleById(token: string, legiartiId: string): Promise<FullArticle | null> {
  return withRetry(async () => {
    const res = await fetch(`${API_BASE}/consult/getArticle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: legiartiId }),
    })
    if (!res.ok) throw new Error(`getArticle ${legiartiId} → HTTP ${res.status}`)
    const data = await res.json() as any
    const art = data?.article ?? data
    return {
      id:                art.id ?? legiartiId,
      texte:             art.texte ?? '',
      fullSectionsTitre: art.fullSectionsTitre ?? '',
      etat:              art.etat ?? '',
      dateDebut:         art.dateDebut ?? null,
      comporteLiensSP:   art.comporteLiensSP === true,
    }
  }, 3, 800, `getArticle(${legiartiId})`)
}

// ---------------------------------------------------------------------------
// Mapping LEGITEXT → nom officiel du code (requis par le filtre NOM_CODE)
// ---------------------------------------------------------------------------

const LEGITEXT_TO_CODE_NAME: Record<string, string> = {
  'LEGITEXT000006070721': 'Code civil',
  'LEGITEXT000006074096': "Code de la construction et de l'habitation",
  'LEGITEXT000006074075': "Code de l'urbanisme",
  'LEGITEXT000006069565': 'Code de la consommation',
}

// ---------------------------------------------------------------------------
// Légifrance — /search pour les codes (CODE_DATE / LODA_DATE)
// ---------------------------------------------------------------------------

async function searchArticles(
  token: string,
  fond: 'CODE_DATE' | 'LODA_DATE',
  keywords: string,
  legitext: string,
  page: number,
  pageSize = 15
): Promise<any[]> {
  const codeName = LEGITEXT_TO_CODE_NAME[legitext]
  const body = {
    fond,
    recherche: {
      champs: [{
        typeChamp: 'ALL',
        criteres: [{ typeRecherche: 'UN_DES_MOTS', valeur: keywords, operateur: 'ET' }],
        operateur: 'ET',
      }],
      filtres: [
        { facette: 'TEXT_LEGAL_STATUS', valeur: 'VIGUEUR' },
        ...(codeName ? [{ facette: 'NOM_CODE', valeur: codeName }] : []),
      ],
      pageNumber: page,
      pageSize,
      sort: 'PERTINENCE',
      typePagination: 'DEFAUT',
      operateur: 'ET',
      fromAdvancedRecherche: false,
    },
  }

  try {
    const res = await fetch(`${API_BASE}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) return []
    const data = await res.json() as any
    return data?.results ?? []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// OpenRouter — Résumé expert + classification sub-thèmes
// ---------------------------------------------------------------------------

interface LLMSummary {
  situation:   string
  principe:    string
  consequence: string
  sub_themes:  string[]
}

const SYSTEM_PROMPT = `Tu es un juriste expert en droit immobilier français.
Tu expliques des articles de loi pour des agents immobiliers.
Tes explications sont précises juridiquement, accessibles et immédiatement actionnables.`

function buildArticlePrompt(articleNum: string, lawLabel: string, articleText: string, subThemesAvailable: string[]): string {
  return `Explique cet article de loi en JSON strict (sans aucun texte avant ou après) :

{
  "situation": "Dans quel cas concret cet article s'applique pour un agent immobilier (2-3 phrases, contexte d'utilisation)",
  "principe": "Ce que dit l'article : la règle de droit exacte, en termes clairs. Formuler comme une règle, pas une description.",
  "consequence": "Ce que l'agent immobilier doit faire ou retenir en pratique (conseil direct, actionnable, 2 phrases max)",
  "sub_themes": ["choisir 1 à 2 valeurs parmi : ${subThemesAvailable.join(', ')}"]
}

ARTICLE ${articleNum} — ${lawLabel} :
${articleText.slice(0, 4000)}`
}

async function summarizeArticle(
  articleNum: string,
  lawLabel: string,
  articleText: string,
  law: LawConfig
): Promise<LLMSummary | null> {
  return withRetry(async () => {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://nestenn.com',
        'X-Title': 'Nestenn Juridique - Indexation',
      },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: buildArticlePrompt(articleNum, lawLabel, articleText, law.subThemes) },
        ],
        max_tokens: 500,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`OpenRouter ${res.status}: ${err.slice(0, 200)}`)
    }

    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) throw new Error('Reponse OpenRouter vide')

    const parsed = JSON.parse(content) as LLMSummary
    if (!parsed.situation || parsed.situation.length < 15) throw new Error('situation trop courte')
    if (!parsed.principe   || parsed.principe.length   < 15) throw new Error('principe trop court')
    if (!parsed.consequence || parsed.consequence.length < 15) throw new Error('consequence trop courte')

    const validThemes = new Set(law.subThemes)
    parsed.sub_themes = (parsed.sub_themes ?? []).filter((t: string) => validThemes.has(t))
    if (parsed.sub_themes.length === 0) parsed.sub_themes = [law.subThemes[0]]

    return parsed
  }, 3, 1500, `summarizeArticle(${articleNum})`)
}

// ---------------------------------------------------------------------------
// Nomic API — Embedding nomic-embed-text-v1.5 (hosted)
// ---------------------------------------------------------------------------

const NOMIC_API_KEY = process.env.NOMIC_API_KEY ?? ''

async function embedWithNomic(text: string): Promise<number[] | null> {
  return withRetry(async () => {
    const res = await fetch('https://api-atlas.nomic.ai/v1/embedding/text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NOMIC_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'nomic-embed-text-v1.5',
        texts: [text],
      }),
    })
    if (!res.ok) throw new Error(`Nomic API embed HTTP ${res.status}`)
    const data = await res.json() as { embeddings: number[][] }
    if (!data.embeddings?.[0]?.length) throw new Error('Embedding vide')
    return data.embeddings[0]
  }, 3, 500, 'embedWithNomic')
}

// ---------------------------------------------------------------------------
// Supabase — Upsert legal_articles
// ---------------------------------------------------------------------------

async function upsertArticle(record: {
  law_id:          string
  article_num:     string
  title:           string
  content:         string
  content_summary: string   // JSON stringifié
  date_version:    string | null
  url:             string
  domain:          string
  sub_themes:      string[]
  in_force:        boolean
  embedding:       number[]
}) {
  if (DRY_RUN) return { error: null }
  const { error } = await supabase
    .from('legal_articles')
    .upsert(record, { onConflict: 'law_id,article_num' })
  return { error }
}

// ---------------------------------------------------------------------------
// Construction URL Légifrance depuis LEGIARTI
// ---------------------------------------------------------------------------

function buildUrl(legiartiId: string, fond: 'CODE_DATE' | 'LODA_DATE'): string {
  const type = fond === 'CODE_DATE' ? 'codes' : 'loda'
  return `https://www.legifrance.gouv.fr/${type}/article_lc/${legiartiId}`
}

// ---------------------------------------------------------------------------
// Traitement d'un article (pipeline complet)
// ---------------------------------------------------------------------------

async function processArticle(
  token:   string,
  law:     LawConfig,
  artRef:  ArticleRef,
  stats:   { indexed: number; skipped: number; errors: number },
  showExample: () => boolean
): Promise<void> {
  const sourceKey = `${law.legitext}:${artRef.num || artRef.id}`

  // Skip si déjà indexé (sauf --reindex)
  if (!REINDEX && !DRY_RUN) {
    const { data: existing } = await supabase
      .from('legal_articles')
      .select('id')
      .eq('law_id', law.legitext)
      .eq('article_num', artRef.num || artRef.id)
      .single()
    if (existing) { stats.skipped++; return }
  }

  // Fetch texte complet
  const article = await fetchArticleById(token, artRef.id)
  if (!article || !article.texte || article.texte.length < 20) {
    stats.skipped++
    return
  }

  // Résumé expert GPT-4o-mini
  const summary = await summarizeArticle(artRef.num, law.label, article.texte, law)
  if (!summary) {
    console.log(`  [SKIP] Art. ${artRef.num} — résumé LLM invalide`)
    stats.skipped++
    return
  }

  // Embedding
  const embeddingText = `${summary.situation} ${summary.principe} ${summary.consequence}`
  const embedding = await embedWithNomic(embeddingText)
  if (!embedding) {
    console.log(`  [SKIP] Art. ${artRef.num} — embedding échoué`)
    stats.skipped++
    return
  }

  const title = article.fullSectionsTitre
    ? `Art. ${artRef.num} — ${article.fullSectionsTitre}`
    : `Art. ${artRef.num} — ${law.label}`

  const { error } = await upsertArticle({
    law_id:          law.legitext,
    article_num:     artRef.num || artRef.id,
    title,
    content:         article.texte,
    content_summary: JSON.stringify({
      situation:   summary.situation,
      principe:    summary.principe,
      consequence: summary.consequence,
    }),
    date_version:    article.dateDebut ? new Date(article.dateDebut).toISOString().split('T')[0] : null,
    url:             buildUrl(article.id, law.fond ?? 'LODA_DATE'),
    domain:          law.domain,
    sub_themes:      summary.sub_themes,
    in_force:        true,
    embedding,
  })

  if (error) {
    console.log(`  [ERROR] Art. ${artRef.num} — ${error.message}`)
    stats.errors++
  } else {
    stats.indexed++
    if (showExample()) {
      console.log(`\n  [EXEMPLE] Art. ${artRef.num} — ${law.label}`)
      console.log(`    Situation  : ${summary.situation}`)
      console.log(`    Principe   : ${summary.principe}`)
      console.log(`    Consequence: ${summary.consequence}`)
      console.log(`    Sub-themes : ${summary.sub_themes.join(', ')}`)
      console.log()
    }
  }
}

// ---------------------------------------------------------------------------
// Indexation d'une loi — stratégie 'full' (legiPart complet)
// ---------------------------------------------------------------------------

async function indexLawFull(token: string, law: LawConfig): Promise<{ indexed: number; skipped: number; errors: number }> {
  const stats = { indexed: 0, skipped: 0, errors: 0 }
  const sem = createSemaphore(CONCURRENCY)
  let exampleShown = 0

  const legiData = await fetchLegiPart(token, law.legitext)
  if (!legiData) {
    console.log(`  [ERREUR] legiPart introuvable pour ${law.id}`)
    return stats
  }

  const root = normalizeLegiPartRoot(legiData)

  // Si sctCid défini, naviguer jusqu'à cette section uniquement
  let targetNode = root
  if (law.sctCid) {
    const section = findSectionByCid(root, law.sctCid)
    if (!section) {
      console.log(`  [ERREUR] Section ${law.sctCid} introuvable dans ${law.id}`)
      return stats
    }
    targetNode = section
    const titre = section?.titre ?? section?.intitule ?? section?.title ?? ''
    console.log(`  Section cible : ${titre} (${law.sctCid})`)
  }

  const articles = collectArticles(targetNode)

  const limit = law.maxArticles ?? Infinity
  const toProcess = articles.slice(0, limit)

  console.log(`  ${toProcess.length} articles VIGUEUR trouvés (total: ${articles.length})`)

  const jobs = toProcess.map(artRef => async () => {
    const release = await sem()
    try {
      await processArticle(token, law, artRef, stats, () => {
        if (exampleShown < 1) { exampleShown++; return true }
        return false
      })
    } finally {
      release()
    }
  })

  await Promise.all(jobs.map(j => j()))
  return stats
}

// ---------------------------------------------------------------------------
// Indexation d'une loi — stratégie 'search' (CODE_DATE / LODA_DATE)
// ---------------------------------------------------------------------------

async function indexLawSearch(token: string, law: LawConfig): Promise<{ indexed: number; skipped: number; errors: number }> {
  const stats = { indexed: 0, skipped: 0, errors: 0 }
  const sem = createSemaphore(CONCURRENCY)
  let exampleShown = 0
  const seenIds = new Set<string>()
  const limit = law.maxArticles ?? 50

  let page = 1
  while (stats.indexed + stats.skipped < limit) {
    const results = await searchArticles(
      token,
      law.fond ?? 'CODE_DATE',
      law.searchKeywords!,
      law.legitext,
      page,
      15
    )
    if (!results.length) break

    const artRefs: ArticleRef[] = results
      .filter((r: any) => r.id && !seenIds.has(r.id))
      .map((r: any) => {
        seenIds.add(r.id)
        return { id: r.id, num: r.num ?? r.article ?? r.id, etat: 'VIGUEUR' }
      })

    if (!artRefs.length) break

    const jobs = artRefs.map(artRef => async () => {
      const release = await sem()
      try {
        await processArticle(token, law, artRef, stats, () => {
          if (exampleShown < 1) { exampleShown++; return true }
          return false
        })
      } finally {
        release()
      }
    })

    await Promise.all(jobs.map(j => j()))
    page++
    if (page > 5) break
    await sleep(300)
  }

  return stats
}

// ---------------------------------------------------------------------------
// Entrée principale pour une loi
// ---------------------------------------------------------------------------

async function indexLaw(law: LawConfig): Promise<void> {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`${law.label}`)
  console.log(`LEGITEXT: ${law.legitext} | Domaine: ${law.domain} | Stratégie: ${law.strategy}`)
  console.log('='.repeat(60))

  const token = await getToken()

  let syncLogId: string | null = null
  if (!DRY_RUN) {
    const { data } = await supabase.from('sync_log').insert({
      sync_type: 'initial',
      source:    'legifrance',
      domain:    law.domain,
      status:    'running',
    }).select('id').single()
    syncLogId = data?.id ?? null
  }

  const stats = law.strategy === 'full'
    ? await indexLawFull(token, law)
    : await indexLawSearch(token, law)

  console.log(`Résultat : ${stats.indexed} indexés | ${stats.skipped} skippés | ${stats.errors} erreurs`)

  if (syncLogId) {
    await supabase.from('sync_log').update({
      completed_at:  new Date().toISOString(),
      items_indexed: stats.indexed,
      items_skipped: stats.skipped,
      status:        stats.errors > 0 ? 'partial' : 'success',
    }).eq('id', syncLogId)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const laws = TARGET_LAW
    ? LAWS.filter(l => l.id === TARGET_LAW)
    : LAWS

  if (!laws.length) {
    console.error(`Loi "${TARGET_LAW}" introuvable. Valeurs : ${LAWS.map(l => l.id).join(', ')}`)
    process.exit(1)
  }

  console.log(`\nIndexation Légifrance v1 — ${laws.length} loi(s) — GPT-4o-mini + nomic-embed-text`)
  if (DRY_RUN) console.log('MODE DRY-RUN — aucune ecriture Supabase')
  if (REINDEX)  console.log('MODE REINDEX — re-traitement des articles existants')

  const startTime = Date.now()
  let totalIndexed = 0

  for (const law of laws) {
    await indexLaw(law)
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n${'='.repeat(60)}`)
  console.log(`TERMINE — articles indexes en ${elapsed}s`)
  console.log('='.repeat(60))
}

main().catch(err => {
  console.error('Erreur fatale :', err)
  process.exit(1)
})
