// lib/domain-reference-corpus.ts
// Source de vérité des 18 domaines top-level Nestenn Juridique
//
// Utilisé par :
//   - scripts/audit-coverage.ts    → comparer DB vs seuils cibles
//   - scripts/enrich-corpus.ts     → enrichissement idempotent par domaine
//   - lib/domain-detector.ts       → DOMAIN_KEYWORDS (importé séparément)
//   - lib/auto-indexer.ts          → VALID_DOMAINS
//   - lib/query-reformulator.ts    → liste des domaines valides
//   - app/(app)/analytics/page.tsx → DOMAIN_LABELS
//
// Vagues d'implémentation :
//   V1 → demandes Nestenn explicites (engagement pris au RDV)
//   V2 → couverture POV réseau
//   V3 → conformité long terme

export interface DomainSource {
  /** Identifiant unique — correspond aux LAWS[].id dans index-legifrance.ts */
  id: string
  label: string
  legitext: string
  sctCid?: string
  fond?: 'CODE_DATE' | 'LODA_DATE'
  maxArticles?: number
  /** Remarque d'implémentation (LEGISCTA à vérifier, accès KALI, etc.) */
  notes?: string
}

export interface DomainSpec {
  /** Nom stocké en DB dans legal_articles.domain / jurisprudence.domain */
  code: string
  /** Libellé français affiché dans l'UI */
  label: string
  /** Description courte du périmètre */
  description: string
  /** Priorité d'implémentation */
  vague: 'existing' | 'V1' | 'V2' | 'V3'
  /** Seuil minimum d'articles indexés */
  minArticles: number
  /** Seuil minimum d'arrêts indexés */
  minJurisprudence: number
  /** Sources Légifrance à indexer */
  sources: DomainSource[]
  /** Mots-clés pour recherche Judilibre */
  judilibreKeywords: string[]
  /** Thème Judilibre (filtre API) */
  judilibreTheme?: string
  /** Chambre principale Judilibre */
  judilibreChamber?: string
  /** Thèmes dans test-questions.json */
  benchmarkThemes: string[]
  /** Domaines avec risque de confusion lexicale — à tester dans le benchmark */
  conflictDomains?: string[]
}

export const DOMAIN_CORPUS: DomainSpec[] = [

  // ── DOMAINES EXISTANTS ENRICHIS ──────────────────────────────────────────

  {
    code: 'baux_habitation',
    label: 'Baux d\'habitation',
    description: 'Bail vide/meublé/mobilité, loyer, congé, expulsion, impayés, trêve, colocation',
    vague: 'existing',
    minArticles: 60,
    minJurisprudence: 50,
    sources: [
      { id: '89-462',         label: 'Loi 89-462 — Baux d\'habitation',  legitext: 'LEGITEXT000006069108', fond: 'LODA_DATE' },
      { id: '2014-366',       label: 'Loi ALUR 2014-366',                 legitext: 'LEGITEXT000028775733', fond: 'LODA_DATE' },
      { id: '2018-1021',      label: 'Loi ELAN 2018-1021',                legitext: 'LEGITEXT000037642121', fond: 'LODA_DATE' },
      { id: 'civil-baux',     label: 'Code civil — Louage (1709-1778)',   legitext: 'LEGITEXT000006070721', sctCid: 'LEGISCTA000006136387', fond: 'CODE_DATE', maxArticles: 40 },
      { id: 'cpce-l4-legi',   label: 'CPCE — Expulsion (L411-1 et s.)',  legitext: 'LEGITEXT000025024948', sctCid: 'LEGISCTA000025026024', fond: 'LODA_DATE', maxArticles: 30 },
      { id: 'cch-permis-louer', label: 'CCH — Permis de louer (L635)',   legitext: 'LEGITEXT000006074096', sctCid: 'LEGISCTA000028781374', fond: 'CODE_DATE' },
    ],
    judilibreKeywords: ['bail habitation', 'loyer impayé', 'expulsion locataire', 'clause résolutoire', 'trêve hivernale', 'congé bailleur'],
    judilibreTheme: "bail d'habitation",
    judilibreChamber: 'civ3',
    benchmarkThemes: ['bail', 'alur', 'elan'],
  },

  {
    code: 'gestion_locative',
    label: 'Gestion locative',
    description: 'EDL, quittance, IRL, dépôt de garantie, caution, gestionnaire mandaté, charges récupérables',
    vague: 'V1',
    minArticles: 20,
    minJurisprudence: 15,
    sources: [
      { id: '89-462',             label: 'Loi 89-462 — Gestion locative',  legitext: 'LEGITEXT000006069108', fond: 'LODA_DATE' },
      { id: 'hoguet-application', label: 'Décret 72-678 — Gestion locative', legitext: 'JORFTEXT000000855024', fond: 'LODA_DATE', maxArticles: 130 },
    ],
    judilibreKeywords: ['gestion locative', 'mandataire gestion', 'état des lieux', 'dépôt de garantie', 'charges locataires', 'quittance loyer', 'IRL'],
    judilibreTheme: "bail d'habitation",
    judilibreChamber: 'civ3',
    benchmarkThemes: ['gestion-locative'],
    conflictDomains: ['baux_habitation'],
  },

  {
    code: 'copropriete',
    label: 'Copropriété',
    description: 'Parties communes/privatives, règlement de copropriété, charges, travaux, copropriété dégradée',
    vague: 'existing',
    minArticles: 40,
    minJurisprudence: 30,
    sources: [
      { id: '65-557', label: 'Loi 65-557 — Copropriété',    legitext: 'LEGITEXT000006068256', fond: 'LODA_DATE' },
      { id: '67-223', label: 'Décret 67-223 — Copropriété', legitext: 'LEGITEXT000006061423', fond: 'LODA_DATE' },
    ],
    judilibreKeywords: ['copropriété', 'parties communes', 'charges copropriété', 'lot copropriété', 'règlement copropriété'],
    judilibreTheme: 'copropriété',
    judilibreChamber: 'civ3',
    benchmarkThemes: ['copropriete'],
  },

  {
    code: 'syndic_copropriete',
    label: 'Syndic & AG copropriété',
    description: 'AG copropriété, appels de fonds, pré-état daté, fonds travaux ALUR/ELAN, syndic professionnel/bénévole',
    vague: 'V1',
    minArticles: 25,
    minJurisprudence: 20,
    sources: [
      { id: '65-557', label: 'Loi 65-557 — Syndic',    legitext: 'LEGITEXT000006068256', fond: 'LODA_DATE' },
      { id: '67-223', label: 'Décret 67-223 — AG',     legitext: 'LEGITEXT000006061423', fond: 'LODA_DATE' },
    ],
    judilibreKeywords: ['syndic copropriété', 'assemblée générale copropriété', 'vote majorité', 'appel de fonds', 'fonds travaux', 'pré-état daté', 'révocation syndic'],
    judilibreTheme: 'copropriété',
    judilibreChamber: 'civ3',
    benchmarkThemes: ['syndic-copro'],
    conflictDomains: ['copropriete'],
  },

  {
    code: 'agent_immobilier',
    label: 'Agent immobilier',
    description: 'Loi Hoguet, carte T, mandat, commission, déontologie, formation continue, TRACFIN, agent commercial',
    vague: 'existing',
    minArticles: 50,
    minJurisprudence: 30,
    sources: [
      { id: '70-9',               label: 'Loi 70-9 — Hoguet',                 legitext: 'LEGITEXT000006068387', fond: 'LODA_DATE' },
      { id: 'hoguet-application', label: 'Décret 72-678',                      legitext: 'JORFTEXT000000855024', fond: 'LODA_DATE', maxArticles: 130 },
      { id: 'deontologie-agents', label: 'Décret 2015-1090 déontologie',       legitext: 'JORFTEXT000031113441', fond: 'LODA_DATE' },
      { id: 'tracfin-cmf',        label: 'CMF — TRACFIN (L561-1 et s.)',       legitext: 'LEGITEXT000006072026', sctCid: 'LEGISCTA000006154830', fond: 'CODE_DATE', maxArticles: 60 },
      { id: 'non-discrimination',  label: 'Code pénal — Non-discrimination',   legitext: 'LEGITEXT000006070719', sctCid: 'LEGISCTA000006165298', fond: 'CODE_DATE', maxArticles: 20 },
    ],
    judilibreKeywords: ['mandat immobilier', 'commission agent', 'loi Hoguet', 'carte professionnelle', 'honoraires agence', 'agent commercial immobilier L134'],
    judilibreTheme: 'agent immobilier',
    judilibreChamber: 'civ1',
    benchmarkThemes: ['hoguet'],
    conflictDomains: ['responsabilite_agent'],
  },

  {
    code: 'vente_immobiliere',
    label: 'Vente immobilière',
    description: 'Compromis, rétractation SRU, vices cachés, conditions suspensives, pacte de préférence, jurisprudence 2022+',
    vague: 'existing',
    minArticles: 60,
    minJurisprudence: 50,
    sources: [
      { id: 'civil-vente',           label: 'Code civil — Vente (1582-1701)',       legitext: 'LEGITEXT000006070721', sctCid: 'LEGISCTA000006118107', fond: 'CODE_DATE', maxArticles: 40 },
      { id: 'cch-sru',               label: 'CCH — SRU rétractation (L271)',        legitext: 'LEGITEXT000006074096', sctCid: 'LEGISCTA000006176357', fond: 'CODE_DATE', maxArticles: 10 },
      { id: 'cch-copro-vente',       label: 'CCH — Vente lot copropriété (L721)',   legitext: 'LEGITEXT000006074096', sctCid: 'LEGISCTA000028778242', fond: 'CODE_DATE', maxArticles: 10 },
      { id: 'civil-indivision',      label: 'Code civil — Indivision (815)',         legitext: 'LEGITEXT000006070721', sctCid: 'LEGISCTA000006136538', fond: 'CODE_DATE', maxArticles: 20 },
      { id: 'civil-hypotheque',      label: 'Code civil — Hypothèques (2393)',      legitext: 'LEGITEXT000006070721', sctCid: 'LEGISCTA000006150396', fond: 'CODE_DATE', maxArticles: 30 },
      { id: 'cgi-droits-mutation',   label: 'CGI — DMTO (art. 683)',                legitext: 'LEGITEXT000006069577', sctCid: 'LEGISCTA000006179720', fond: 'CODE_DATE', maxArticles: 20 },
      { id: 'cgi-droits-mutation-taux', label: 'CGI — Taux DMTO (1594 A et s.)',   legitext: 'LEGITEXT000006069577', sctCid: 'LEGISCTA000006179825', fond: 'CODE_DATE', maxArticles: 10 },
    ],
    judilibreKeywords: ['vente immobilière', 'compromis de vente', 'vice caché', 'rétractation SRU', 'condition suspensive prêt', 'promesse vente'],
    judilibreTheme: 'vente immobilière',
    judilibreChamber: 'civ3',
    benchmarkThemes: ['transactions'],
  },

  {
    code: 'diagnostics',
    label: 'Diagnostics immobiliers',
    description: 'DPE, amiante, plomb, ERP, Carrez, audit énergétique, loi Climat 2025/2028, passoires thermiques',
    vague: 'existing',
    minArticles: 30,
    minJurisprudence: 15,
    sources: [
      { id: 'cch-diagnostics', label: 'CCH — DPE (L126-26 et s.)',     legitext: 'LEGITEXT000006074096', sctCid: 'LEGISCTA000043967326', fond: 'CODE_DATE' },
      { id: 'cch-ddt-vente',   label: 'CCH — DDT vente (L271-4)',       legitext: 'LEGITEXT000006074096', sctCid: 'LEGISCTA000006176358', fond: 'CODE_DATE' },
      { id: '2021-1104',       label: 'Loi Climat-Résilience 2021-1104', legitext: 'LEGITEXT000043957598', fond: 'LODA_DATE' },
    ],
    judilibreKeywords: ['DPE erroné', 'responsabilité diagnostiqueur', 'amiante immeuble', 'passoire thermique', 'audit énergétique', 'diagnostic immobilier'],
    judilibreTheme: 'vente immobilière',
    judilibreChamber: 'civ3',
    benchmarkThemes: ['diagnostics', 'decrets-2024-2025'],
  },

  {
    code: 'construction',
    label: 'Construction & VEFA',
    description: 'VEFA, décennale, biennale, CCMI, parfait achèvement, dommage-ouvrage',
    vague: 'existing',
    minArticles: 25,
    minJurisprudence: 20,
    sources: [
      { id: 'cch-construction', label: 'CCH — CCMI (L231)',             legitext: 'LEGITEXT000006074096', sctCid: 'LEGISCTA000006159020', fond: 'CODE_DATE' },
      { id: 'cch-vefa',         label: 'CCH — VEFA (L261-1 et s.)',    legitext: 'LEGITEXT000006074096', sctCid: 'LEGISCTA000006159128', fond: 'CODE_DATE' },
      { id: 'civil-decennale',  label: 'Code civil — Décennale (1792)', legitext: 'LEGITEXT000006070721', sctCid: 'LEGISCTA000006150293', fond: 'CODE_DATE' },
    ],
    judilibreKeywords: ['garantie décennale', 'VEFA livraison', 'constructeur malfaçon', 'réception travaux réserves', 'dommage ouvrage', 'CCMI'],
    judilibreTheme: 'construction immobilière',
    judilibreChamber: 'civ3',
    benchmarkThemes: [],
  },

  {
    code: 'urbanisme',
    label: 'Urbanisme',
    description: 'DPU/DIA, PLU, servitudes, permis de construire — recentré sur l\'urbanisme bloquant la vente',
    vague: 'existing',
    minArticles: 25,
    minJurisprudence: 15,
    sources: [
      { id: 'urbanisme-preemption',         label: 'Code urbanisme — DPU (L211)',     legitext: 'LEGITEXT000006074075', sctCid: 'LEGISCTA000006158884', fond: 'CODE_DATE' },
      { id: 'urbanisme-preemption-general', label: 'Code urbanisme — L210-1',          legitext: 'LEGITEXT000006074075', sctCid: 'LEGISCTA000006128557', fond: 'CODE_DATE', maxArticles: 5 },
      { id: 'urbanisme-permis',             label: 'Code urbanisme — Permis construire', legitext: 'LEGITEXT000006074075', sctCid: 'LEGISCTA000006158675', fond: 'CODE_DATE', maxArticles: 15 },
      { id: 'urbanisme-zad',                label: 'Code urbanisme — ZAD (L213)',      legitext: 'LEGITEXT000006074075', sctCid: 'LEGISCTA000006158572', fond: 'CODE_DATE', maxArticles: 20 },
    ],
    judilibreKeywords: ['droit de préemption urbain', 'permis de construire refus', 'PLU constructibilité', 'certificat urbanisme', 'ZAN artificialisation'],
    judilibreTheme: 'urbanisme',
    judilibreChamber: 'civ3',
    benchmarkThemes: ['urbanisme'],
  },

  {
    code: 'bail_commercial',
    label: 'Bail commercial',
    description: 'L145 Code de commerce — 3-6-9, renouvellement, révision, indemnité d\'éviction, résiliation, déspécialisation',
    vague: 'existing',
    minArticles: 30,
    minJurisprudence: 25,
    sources: [
      { id: 'commerce-bail', label: 'Code de commerce — Bail commercial (L145)', legitext: 'LEGITEXT000005634379', sctCid: 'LEGISCTA000006146040', fond: 'CODE_DATE', maxArticles: 60 },
    ],
    judilibreKeywords: ['bail commercial 3-6-9', 'indemnité éviction', 'renouvellement bail commercial', 'révision loyer commercial', 'L145 Code de commerce'],
    judilibreTheme: 'bail commercial',
    judilibreChamber: 'comm',
    benchmarkThemes: [],
  },

  {
    code: 'viager_demembrement',
    label: 'Viager & démembrement',
    description: 'Viager occupé/libre, usufruit, nue-propriété, rente viagère, bouquet, démembrement classique',
    vague: 'existing',
    minArticles: 25,
    minJurisprudence: 10,
    sources: [
      { id: 'civil-viager',       label: 'Code civil — Usufruit (578-624)',       legitext: 'LEGITEXT000006070721', sctCid: 'LEGISCTA000006117905', fond: 'CODE_DATE', maxArticles: 60 },
      { id: 'civil-viager-rente', label: 'Code civil — Rente viagère (1968 et s.)', legitext: 'LEGITEXT000006070721', sctCid: 'LEGISCTA000006136403', fond: 'CODE_DATE', maxArticles: 20 },
    ],
    judilibreKeywords: ['viager occupé', 'nue-propriété usufruit', 'rente viagère', 'bouquet viager', 'débirentier', 'démembrement immobilier'],
    judilibreTheme: 'vente immobilière',
    judilibreChamber: 'civ3',
    benchmarkThemes: [],
  },

  // ── NOUVEAUX DOMAINES V1 — Demandes Nestenn explicites ───────────────────

  {
    code: 'droit_social_immo',
    label: 'Droit social immobilier',
    description: 'IDCC 1527 (CCN immobilier), négociateur salarié, licenciement, rupture conventionnelle, préavis, clause non-concurrence',
    vague: 'V1',
    minArticles: 30,
    minJurisprudence: 20,
    sources: [
      {
        id: 'travail-licenciement',
        label: 'Code du travail — Licenciement motif personnel (L1232-1 et s.)',
        legitext: 'LEGITEXT000006072050',
        sctCid: 'LEGISCTA000006177858',
        fond: 'CODE_DATE',
        maxArticles: 40,
      },
      {
        id: 'travail-rupture-conventionnelle',
        label: 'Code du travail — Rupture conventionnelle et autres cas de rupture (L1237-1+)',
        legitext: 'LEGITEXT000006072050',
        sctCid: 'LEGISCTA000006177863',
        fond: 'CODE_DATE',
        maxArticles: 20,
      },
      // Source supprimée le 11/04/2026 : pas d'article dédié au Code du travail
      // Les règles de la clause de non-concurrence sont jurisprudentielles
      // (Cass. soc. 10 juillet 2002 + arrêts suivants sur les conditions cumulatives)
      // → À enrichir en V1.5 via la Convention collective nationale de l'immobilier
      //   (KALICONT000005635413, IDCC 1527) une fois le script adapté au fonds KALI
    ],
    judilibreKeywords: ['licenciement', 'rupture conventionnelle', 'négociateur immobilier', 'agent immobilier salarié', 'clause non-concurrence', 'préavis', 'IDCC 1527'],
    judilibreTheme: 'contrat de travail',
    judilibreChamber: 'soc',
    benchmarkThemes: ['droit-social'],
    conflictDomains: ['agent_immobilier'],
  },

  {
    code: 'fiscalite_investisseurs',
    label: 'Fiscalité des investisseurs',
    description: 'LMNP/LMP, Pinel, Denormandie, Malraux, déficit foncier, plus-values, micro vs réel, CGI art. 14-15, 31, 32, 150U, 151 septies, 155, 199 novovicies/tervicies',
    vague: 'V1',
    minArticles: 40,
    minJurisprudence: 15,
    sources: [
      { id: 'cgi-plus-values',       label: 'CGI — Plus-values immobilières (150U-VH)',  legitext: 'LEGITEXT000006069577', sctCid: 'LEGISCTA000006197216', fond: 'CODE_DATE', maxArticles: 20 },
      { id: 'cgi-revenus-fonciers',  label: 'CGI — Revenus fonciers (14-33 et s.)',      legitext: 'LEGITEXT000006069577', sctCid: 'LEGISCTA000006191572', fond: 'CODE_DATE', maxArticles: 20 },
      { id: 'cgi-lmnp-bic',          label: 'CGI — BIC / LMNP (art. 34 et s.)',         legitext: 'LEGITEXT000006069577', sctCid: 'LEGISCTA000006191573', fond: 'CODE_DATE', maxArticles: 30 },
      { id: 'cgi-ifi',               label: 'CGI — IFI (art. 964 et s.)',               legitext: 'LEGITEXT000006069577', sctCid: 'LEGISCTA000036384995', fond: 'CODE_DATE', maxArticles: 25 },
      {
        id: 'cgi-investissement-locatif',
        label: 'CGI — Pinel (199 novovicies) & Denormandie (199 tervicies)',
        legitext: 'LEGITEXT000006069577',
        sctCid: 'LEGISCTA000022508683',
        fond: 'CODE_DATE',
        maxArticles: 15,
      },
    ],
    judilibreKeywords: ['LMNP location meublée', 'Pinel défiscalisation', 'déficit foncier', 'plus-value immobilière exonération', 'revenus fonciers déduction', 'régime réel'],
    judilibreTheme: 'vente immobilière',
    judilibreChamber: 'civ3',
    benchmarkThemes: ['fiscalite', 'fiscalite-investisseurs'],
    conflictDomains: ['sci_patrimoine'],
  },

  {
    code: 'sci_patrimoine',
    label: 'SCI & patrimoine',
    description: 'SCI IR/IS, parts sociales, démembrement, apport en nature, régime matrimonial — Code civil 1832-1844-17, CGI 8, 206, 669, 746',
    vague: 'V1',
    minArticles: 30,
    minJurisprudence: 15,
    sources: [
      { id: 'civil-sci',        label: 'Code civil — Société civile (1845-1870)', legitext: 'LEGITEXT000006070721', sctCid: 'LEGISCTA000006136391', fond: 'CODE_DATE', maxArticles: 30 },
      { id: 'civil-viager',     label: 'Code civil — Usufruit/NP (578-624)',      legitext: 'LEGITEXT000006070721', sctCid: 'LEGISCTA000006117905', fond: 'CODE_DATE', maxArticles: 60 },
      { id: 'civil-indivision', label: 'Code civil — Indivision (815-1 et s.)',   legitext: 'LEGITEXT000006070721', sctCid: 'LEGISCTA000006136538', fond: 'CODE_DATE', maxArticles: 20 },
      {
        id: 'cgi-sci-transparence',
        label: 'CGI — SCI transparence IR (art. 8)',
        legitext: 'LEGITEXT000006069577',
        sctCid: 'LEGISCTA000006179569',
        fond: 'CODE_DATE',
        maxArticles: 10,
      },
      {
        id: 'cgi-sci-is',
        label: 'CGI — Impôt sur les sociétés — champ d\'application (art. 206)',
        legitext: 'LEGITEXT000006069577',
        sctCid: 'LEGISCTA000006180012',
        fond: 'CODE_DATE',
        maxArticles: 10,
      },
    ],
    judilibreKeywords: ['SCI société civile immobilière', 'parts sociales cession', 'gérant SCI', 'démembrement SCI', 'apport immeuble société', 'SCI familiale'],
    judilibreTheme: 'vente immobilière',
    judilibreChamber: 'civ3',
    benchmarkThemes: ['sci'],
    conflictDomains: ['fiscalite_investisseurs', 'viager_demembrement'],
  },

  // ── NOUVEAUX DOMAINES V2 — Couverture POV réseau ─────────────────────────

  {
    code: 'responsabilite_agent',
    label: 'Responsabilité de l\'agent',
    description: 'Devoir de conseil, obligation d\'information, faute de l\'agent, RC Pro — Cass. civ. 1re et 3e, art. 1240 C.civ., loi Hoguet art. 4',
    vague: 'V2',
    minArticles: 20,
    minJurisprudence: 30,
    sources: [
      { id: '70-9',               label: 'Loi 70-9 — Hoguet (art. 4)',           legitext: 'LEGITEXT000006068387', fond: 'LODA_DATE' },
      { id: 'deontologie-agents', label: 'Décret 2015-1090 — Déontologie',       legitext: 'JORFTEXT000031113441', fond: 'LODA_DATE' },
      {
        id: 'civil-responsabilite-personnelle',
        label: 'Code civil — Responsabilité délictuelle (art. 1240-1242)',
        legitext: 'LEGITEXT000006070721',
        sctCid: 'LEGISCTA000032021508',
        fond: 'CODE_DATE',
        maxArticles: 15,
        notes: 'Art. 1240 (faute), 1241 (imprudence), 1242 (fait autrui). Vérifier LEGISCTA via find-legiscta.ts.',
      },
    ],
    judilibreKeywords: ['devoir de conseil agent immobilier', 'obligation information vendeur', 'faute agent immobilier condamnation', 'responsabilité civile professionnelle', 'manquement devoir conseil'],
    judilibreTheme: 'agent immobilier',
    judilibreChamber: 'civ1',
    benchmarkThemes: ['responsabilite'],
    conflictDomains: ['agent_immobilier'],
  },

  {
    code: 'location_touristique',
    label: 'Location touristique',
    description: 'Changement d\'usage, numéro d\'enregistrement, meublés de tourisme, 120 jours résidence principale, taxe de séjour',
    vague: 'V2',
    minArticles: 25,
    minJurisprudence: 10,
    sources: [
      { id: 'tourisme-meuble-legi', label: 'Code tourisme — L324 (législatif)',     legitext: 'LEGITEXT000006074073', sctCid: 'LEGISCTA000006143189', fond: 'CODE_DATE' },
      { id: 'tourisme-meuble-reg',  label: 'Code tourisme — R324 (réglementaire)',  legitext: 'LEGITEXT000006074073', sctCid: 'LEGISCTA000006158429', fond: 'CODE_DATE', maxArticles: 30 },
      {
        id: 'cch-changement-usage',
        label: 'CCH — Changement d\'usage (L631-7 et s.)',
        legitext: 'LEGITEXT000006074096',
        sctCid: 'LEGISCTA000006159521',
        fond: 'CODE_DATE',
        maxArticles: 15,
        notes: 'Art. L631-7 (autorisation changement usage), L631-7-1 (numéro enregistrement), L631-9 (sanctions). Vérifier LEGISCTA.',
      },
    ],
    judilibreKeywords: ['meublé de tourisme', 'changement usage habitation', 'location saisonnière Airbnb', 'numéro enregistrement', 'taxe de séjour compensation'],
    judilibreTheme: "bail d'habitation",
    judilibreChamber: 'civ3',
    benchmarkThemes: ['location-touristique'],
    conflictDomains: ['baux_habitation'],
  },

  {
    code: 'environnement_immo',
    label: 'Environnement et pollution immobilière',
    description: 'Sols pollués, ICPE, SIS/BASOL/BASIAS, ERP, responsabilité environnementale, dépollution — obligations vendeur, droits acheteur',
    vague: 'V2',
    minArticles: 30,
    minJurisprudence: 15,
    sources: [
      {
        id: 'env-sis',
        label: "Code de l'environnement — Information sur les sols pollués (L.125-6 et s.)",
        legitext: 'LEGITEXT000006074220',
        sctCid: 'LEGISCTA_À_VALIDER',
        fond: 'CODE_DATE',
        notes: 'Section à valider sur Légifrance : art. L.125-6 à L.125-7. URL de départ : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046088499',
      },
      {
        id: 'env-icpe',
        label: "Code de l'environnement — ICPE (L.511-1 et s.)",
        legitext: 'LEGITEXT000006074220',
        sctCid: 'LEGISCTA_À_VALIDER',
        fond: 'CODE_DATE',
        notes: 'Section à valider sur Légifrance : art. L.511-1 à L.517-1. URL de départ : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033023101',
      },
      {
        id: 'env-responsabilite',
        label: "Code de l'environnement — Responsabilité environnementale (L.160-1 et s.)",
        legitext: 'LEGITEXT000006074220',
        sctCid: 'LEGISCTA_À_VALIDER',
        fond: 'CODE_DATE',
        notes: 'Section à valider sur Légifrance : art. L.160-1 à L.165-2. URL de départ : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000022491725',
      },
      {
        id: 'env-sis-travaux',
        label: "Code de l'environnement — Sites et sols pollués (L.556-1 et s.)",
        legitext: 'LEGITEXT000006074220',
        sctCid: 'LEGISCTA_À_VALIDER',
        fond: 'CODE_DATE',
        notes: 'Section à valider sur Légifrance : art. L.556-1 à L.556-3. URL de départ : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000031055057',
      },
    ],
    judilibreKeywords: ['pollution sols vente immobilière', 'ICPE installation classée responsabilité', 'site pollué vendeur obligation information', 'dépollution terrain acquéreur', 'SIS secteur information sols'],
    judilibreTheme: 'vente immobilière',
    judilibreChamber: 'civ3',
    benchmarkThemes: ['environnement'],
    conflictDomains: ['vente_immobiliere', 'diagnostics'],
  },

  // ── NOUVEAUX DOMAINES V3 — Conformité réseau ─────────────────────────────

  {
    code: 'conformite_lcb_ft',
    label: 'Conformité LCB-FT',
    description: 'Lutte anti-blanchiment et financement du terrorisme — obligations agents immo, déclarations TRACFIN, gel d\'avoirs, PPE',
    vague: 'V3',
    minArticles: 25,
    minJurisprudence: 5,
    sources: [
      { id: 'tracfin-cmf',       label: 'CMF — TRACFIN (L561-1 et s.)',     legitext: 'LEGITEXT000006072026', sctCid: 'LEGISCTA000006154830', fond: 'CODE_DATE', maxArticles: 60 },
      { id: 'non-discrimination', label: 'Code pénal — Non-discrimination',  legitext: 'LEGITEXT000006070719', sctCid: 'LEGISCTA000006165298', fond: 'CODE_DATE', maxArticles: 20 },
    ],
    judilibreKeywords: ['blanchiment capitaux immobilier', 'TRACFIN déclaration soupçon', 'gel avoirs agent immobilier', 'LCB-FT agent immobilier', 'vigilance client'],
    judilibreTheme: 'agent immobilier',
    judilibreChamber: 'comm',
    benchmarkThemes: ['conformite'],
    conflictDomains: ['agent_immobilier'],
  },

  {
    code: 'rgpd_agence',
    label: 'RGPD & données personnelles',
    description: 'RGPD en agence immobilière, durée de conservation des dossiers, droits des personnes, DPO, obligations déclaratives CNIL',
    vague: 'V3',
    minArticles: 15,
    minJurisprudence: 3,
    sources: [
      {
        id: 'loi-informatique-libertes',
        label: 'Loi 78-17 — Informatique et Libertés',
        legitext: 'LEGITEXT000006068624',
        fond: 'LODA_DATE',
        maxArticles: 40,
        notes: 'Loi 78-17 modifiée par ordonnance 2018-1125 (transposition RGPD). Art. 4 (définitions), 5 (responsable traitement), 12-22 (droits personnes), 67-90 (sanctions CNIL).',
      },
    ],
    judilibreKeywords: ['RGPD données personnelles', 'CNIL délibération', 'droit oubli', 'conservation données personnelles', 'traitement données immobilier'],
    judilibreTheme: 'vente immobilière',
    judilibreChamber: 'civ3',
    benchmarkThemes: ['rgpd'],
    conflictDomains: ['conformite_lcb_ft'],
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────

/** Lookup par code domaine */
export const DOMAIN_BY_CODE = Object.fromEntries(DOMAIN_CORPUS.map(d => [d.code, d]))

/** Tous les codes valides (utilisé par VALID_DOMAINS dans auto-indexer.ts) */
export const ALL_DOMAIN_CODES: string[] = DOMAIN_CORPUS.map(d => d.code)

/** Labels français pour l'UI dashboard (DOMAIN_LABELS) */
export const DOMAIN_LABELS: Record<string, string> = Object.fromEntries(
  DOMAIN_CORPUS.map(d => [d.code, d.label])
)

/** Domaines existants (déjà indexés en base) */
export const EXISTING_DOMAINS = DOMAIN_CORPUS.filter(d => d.vague === 'existing').map(d => d.code)

/** Nouveaux domaines à créer */
export const NEW_DOMAINS = DOMAIN_CORPUS.filter(d => d.vague !== 'existing').map(d => d.code)

export const V1_DOMAINS = DOMAIN_CORPUS.filter(d => d.vague === 'V1').map(d => d.code)
export const V2_DOMAINS = DOMAIN_CORPUS.filter(d => d.vague === 'V2').map(d => d.code)
export const V3_DOMAINS = DOMAIN_CORPUS.filter(d => d.vague === 'V3').map(d => d.code)
