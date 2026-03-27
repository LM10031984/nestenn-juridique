// lib/judilibre.ts
// Client PISTE — API JUDILIBRE
import { openRouterChat, MODELS } from '@/lib/openrouter'
// Pipeline double-piste CC+CA :
//   Piste CC → /search (publication=['b','r'], theme, operator='or', field=['summary','motivations']) → /decision top-2
//   Piste CA → /search (jurisdiction='ca', operator='and', field=['summary','motivations']) → summary direct
//   Fusion : CC en priorité, CA en complément

const isSandbox = process.env.PISTE_ENV === 'sandbox'
const TOKEN_URL = isSandbox
  ? 'https://sandbox-oauth.piste.gouv.fr/api/oauth/token'
  : 'https://oauth.piste.gouv.fr/api/oauth/token'
const API_URL = isSandbox
  ? 'https://sandbox-api.piste.gouv.fr/cassation/judilibre/v1.0'
  : 'https://api.piste.gouv.fr/cassation/judilibre/v1.0'

// ---------------------------------------------------------------------------
// Fetch avec timeout AbortController (5s par défaut)
// ---------------------------------------------------------------------------

function fetchWithTimeout(url: string | URL, init: RequestInit = {}, ms = 5000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

// ---------------------------------------------------------------------------
// Token OAuth2 (cache module-level)
// ---------------------------------------------------------------------------

let cachedToken: string | null = null
let tokenExpiry = 0

async function getJudilibreToken(): Promise<string | null> {
  const { PISTE_CLIENT_ID, PISTE_CLIENT_SECRET } = process.env
  if (!PISTE_CLIENT_ID || !PISTE_CLIENT_SECRET) return null
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken

  try {
    const res = await fetchWithTimeout(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: PISTE_CLIENT_ID,
        client_secret: PISTE_CLIENT_SECRET,
        scope: 'openid',
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as { access_token: string; expires_in: number }
    cachedToken = data.access_token
    tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
    return cachedToken
  } catch (err) {
    console.error('[judilibre] getToken — erreur :', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface VisaRef {
  law: string    // ex: '89-462'
  artNum: string // ex: '24'
}

export interface RequiredFact {
  id: string       // identifiant machine ex: 'acte_signe'
  label: string    // question posée à l'utilisateur
  keywords: string[] // mots-clés qui indiquent que ce fait est mentionné
}

export interface NormalizedCase {
  court: 'cass' | 'ca'
  date: string
  number: string
  solution?: string
  holding: string        // premier principe dégagé (1 phrase max)
  authorityRank: number  // 1 = CC publiée, 2 = CC non-publiée, 3 = CA
  formattedText: string  // bloc texte complet pour injection narrative
  url?: string           // lien Judilibre vers la décision
}

export interface JudilibreContext {
  available: boolean
  text: string
  cases: NormalizedCase[]
  decisions: any[]
  visaRefs: VisaRef[]
  isPremium: boolean
  requiredFacts: RequiredFact[]
  subTheme?: string
  expectedLexicon: string[]
  forcedArticles?: Array<{ law: string; artNums: string[] }>
}

// ---------------------------------------------------------------------------
// Détection de thème + sub-queries CC/CA affinées
// ---------------------------------------------------------------------------

interface ThemeEntry {
  triggers: string[]
  theme: string    // valeur exacte taxonomie CC (validée)
  chamber: string  // chambre CC
  caQuery?: string // query CA spécifique (optionnel)
}

// NOTE: "diagnostics immobiliers" supprimé — thème invalide dans la taxonomie CC
const THEME_MAP: ThemeEntry[] = [
  {
    triggers: ['bail', 'loyer', 'locataire', 'location', 'congé', 'dépôt', 'impayé',
               'commandement', 'expulsion', 'trêve', 'clause résolutoire',
               'vétusté', 'décence', 'logement décent'],
    theme: "bail d'habitation",
    chamber: 'civ3',
  },
  {
    triggers: ['copropriété', 'syndic', 'assemblée générale', 'charges', 'tantièmes'],
    theme: 'copropriété',
    chamber: 'civ3',
  },
  {
    triggers: ['agent immobilier', 'mandat', 'honoraires', 'hoguet', 'devoir de conseil'],
    theme: 'agent immobilier',
    chamber: 'civ1',
  },
  {
    triggers: ['vente', 'compromis', 'promesse', 'vices cachés', 'condition suspensive',
               'acheteur', 'vendeur'],
    theme: 'vente immobilière',
    chamber: 'civ3',
  },
  {
    triggers: ['urbanisme', 'permis', 'plu', 'zan', 'préemption'],
    theme: 'urbanisme',
    chamber: 'civ3',
  },
  {
    triggers: ['construction', 'vefa', 'décennale', 'biennale'],
    theme: 'construction immobilière',
    chamber: 'civ3',
  },
  {
    triggers: ['bail commercial', 'fonds de commerce'],
    theme: 'bail commercial',
    chamber: 'comm',
  },
  {
    triggers: ['usufruit', 'démembrement', 'nue-propriété', 'viager', 'rente'],
    theme: 'vente immobilière',
    chamber: 'civ3',
  },
]

interface DetectedTheme {
  theme: string
  chamber: string
  ccQuery?: string
  caQuery?: string
  noDateFilter?: boolean
  publications?: string[]
  dpeSignal?: boolean
  isPremium?: boolean
  requiredFacts?: RequiredFact[]
  subTheme?: string
  expectedLexicon?: string[]
  forcedArticles?: Array<{ law: string; artNums: string[] }>
}

// ---------------------------------------------------------------------------
// Table des faits requis par sous-thème premium
// ---------------------------------------------------------------------------

const FACTS_COMMISSION: RequiredFact[] = [
  {
    id: 'acte_signe',
    label: "L'acte authentique (signature chez le notaire) a-t-il été signé ?",
    keywords: ['acte authentique', 'notaire', 'réitéré', 'réitération', 'signature définitive', 'acte signé'],
  },
  {
    id: 'conditions_suspensives',
    label: 'Les conditions suspensives (notamment le prêt immobilier) ont-elles été levées ?',
    keywords: ['condition suspensive', 'conditions suspensives', 'prêt obtenu', 'levée', 'financement accordé', 'offre de prêt'],
  },
  {
    id: 'debiteur_honoraires',
    label: 'Qui supporte les honoraires selon le mandat et le compromis (acheteur, vendeur ou les deux) ?',
    keywords: ['acheteur', 'vendeur', 'qui paie', 'à la charge', 'débiteur', 'supporté par', 'honoraires à charge'],
  },
  {
    id: 'mandat_regulier',
    label: 'Le mandat est-il signé, enregistré au registre des mandats et en cours de validité ?',
    keywords: ['mandat signé', 'mandat régulier', 'registre des mandats', 'mandat enregistré', 'mandat valide', 'mandat en cours'],
  },
]

const FACTS_CONDITIONS_SUSPENSIVES: RequiredFact[] = [
  {
    id: 'nature_condition',
    label: 'Quelle est la nature exacte de la condition suspensive (prêt, permis de construire, autre) ?',
    keywords: ['condition suspensive', 'prêt', 'permis de construire', 'nature de la condition', 'type de condition'],
  },
  {
    id: 'delai_expire',
    label: 'Le délai prévu pour réaliser la condition suspensive est-il expiré ?',
    keywords: ['délai', 'expiré', 'dépassé', 'échéance', 'date limite', 'date butoir'],
  },
  {
    id: 'renoncement',
    label: "L'une des parties a-t-elle renoncé à se prévaloir de la condition non réalisée ?",
    keywords: ['renoncé', 'renoncement', 'waiver', 'se prévaut', 'invoqué', 'accepté malgré'],
  },
]

// ---------------------------------------------------------------------------
// Tableaux de faits — sous-thèmes fins
// ---------------------------------------------------------------------------

const FACTS_COMMISSION_PARTAGE: RequiredFact[] = [
  {
    id: 'primo_visiteur',
    label: "Quelle agence a présenté le bien à l'acheteur en premier (primo-visiteur) ?",
    keywords: ['primo-visiteur', 'première visite', 'premier contact', 'présenté en premier', 'agence a', 'agence b'],
  },
  {
    id: 'accord_inter_agences',
    label: 'Y a-t-il un accord de partage de commission entre les deux agences ?',
    keywords: ['accord', 'partage', 'inter-agences', 'convention de partage', 'rémunération partagée'],
  },
  {
    id: 'source_client',
    label: "Par quel canal l'acheteur a-t-il finalement signé le compromis ?",
    keywords: ['compromis signé', 'acte signé', 'via quelle agence', 'chez quel agent', 'signé avec', 'signé via', 'compromis via', 'via l\'agence', 'via agence'],
  },
]

const FACTS_CONDITION_PRET: RequiredFact[] = [
  {
    id: 'nb_banques',
    label: "Combien d'établissements bancaires l'acheteur a-t-il sollicités pour son prêt ?",
    keywords: ['une banque', 'plusieurs banques', 'deux banques', 'trois banques', 'plusieurs établissements', 'une seule banque', 'établissements', 'aucune demande', 'aucun établissement', 'pas sollicité', 'n\'a sollicité'],
  },
  {
    id: 'delai_respecte',
    label: "L'acheteur a-t-il déposé sa demande de prêt dans le délai prévu au compromis ?",
    keywords: ['dans le délai', 'avant la date limite', 'déposé à temps', 'demande déposée', 'aucune demande', "n'a pas déposé", 'délai respecté'],
  },
  {
    id: 'preuves_refus',
    label: "L'acheteur peut-il justifier ses demandes (attestations de refus, courriers bancaires) ?",
    keywords: ['justificatif', 'attestation', 'refus écrit', 'courrier bancaire', 'preuve de refus', 'absence de preuve', 'lettre de refus'],
  },
]

const FACTS_CONDITION_PERMIS: RequiredFact[] = [
  {
    id: 'clause_permis',
    label: 'La clause de condition suspensive de permis est-elle précisément rédigée dans le compromis ?',
    keywords: ['clause permis', 'condition suspensive de permis', "condition suspensive d'obtention", "d'obtention de permis", 'compromis mentionne', 'rédaction de la clause', 'précisément rédigée'],
  },
  {
    id: 'depot_demande',
    label: 'La demande de permis de construire a-t-elle été déposée en mairie ?',
    keywords: ['déposé', 'dépôt', 'demande déposée', 'en mairie', 'récépissé', 'pas encore déposé', 'aucun dépôt'],
  },
  {
    id: 'delai_permis',
    label: "Un délai de réalisation est-il précisé dans la clause ou le compromis ?",
    keywords: ['délai', 'date limite', 'échéance', 'aucun délai', 'délai non précisé', 'délai fixé'],
  },
]

const FACTS_COMPROMIS_CADUCITE: RequiredFact[] = [
  {
    id: 'clause_caducite',
    label: "Le compromis contient-il une clause prévoyant la caducité automatique à la date de réitération ?",
    keywords: ['clause expresse', 'caducité automatique', 'caduc de plein droit', 'mention expresse', 'prévu dans le compromis', 'clause caducité', 'automatiquement caduc', 'est-il caduc', 'caduc automatiquement'],
  },
  {
    id: 'nature_delai',
    label: "La date de réitération était-elle une date butoir ferme ou indicative ?",
    keywords: ['date ferme', 'date butoir', 'date indicative', 'au plus tard', 'délai impératif', 'délai de rigueur'],
  },
  {
    id: 'mise_en_demeure',
    label: "L'une des parties a-t-elle envoyé une mise en demeure de signer ?",
    keywords: ['mise en demeure', 'sommation', 'assignation', 'huissier', 'demande formelle', 'courrier recommandé', "aucune des parties n'a réagi", 'aucune réaction', 'sans mise en demeure', "n'a pas réagi", 'refuse de signer chez le notaire', 'refuse de se présenter', 'refuse de réitérer'],
  },
]

const FACTS_RESPONSABILITE_AGENT: RequiredFact[] = [
  {
    id: 'info_connue',
    label: "L'agent avait-il connaissance de l'information non divulguée (servitude, projet d'urbanisme, sinistre) ?",
    keywords: ['agent savait', 'agent connaissait', 'informé', 'connaissance de', 'était au courant', 'avait accès', "n'a pas informé", 'pas informé'],
  },
  {
    id: 'caractere_essentiel',
    label: "Cette information était-elle déterminante pour le consentement de l'acheteur ?",
    keywords: ['déterminant', 'essentiel', "n'aurait pas acheté", 'impacte la valeur', 'aurait refusé', 'information clé',
               'servitude', 'servitude de passage', 'tramway', 'projet d\'urbanisme', 'sinistre', 'nuisance'],
  },
  {
    id: 'preuve_connaissance',
    label: "Dispose-t-on d'une preuve que l'agent avait accès à cette information ?",
    keywords: ['preuve', 'document', 'titre de propriété', 'plu', 'email', 'contrat', 'actes', 'attestation'],
  },
]

const FACTS_DEPOT_DEGRADATION: RequiredFact[] = [
  {
    id: 'edl_contradictoire',
    label: "L'état des lieux de sortie a-t-il été réalisé en présence des deux parties ou de leurs représentants ?",
    keywords: ['contradictoire', 'en présence', 'locataire présent', 'convoqué', 'signé par les deux', 'état des lieux signé', 'état des lieux réalisé'],
  },
  {
    id: 'desordres_precis',
    label: "Les désordres imputés sont-ils listés avec précision dans l'état des lieux de sortie ?",
    keywords: ['listé', 'détaillé', 'état des lieux de sortie', 'désordres constatés', 'dégradations précisées', 'relevé'],
  },
  {
    id: 'devis_travaux',
    label: "Le propriétaire dispose-t-il de devis ou factures justifiant les retenues ?",
    keywords: ['devis', 'facture', 'justificatif', 'estimation', 'montant justifié', 'devis fourni'],
  },
]

// ---------------------------------------------------------------------------
// Taxonomie juridique métier — sous-thèmes fins
// ---------------------------------------------------------------------------

interface LegalSubTheme {
  id: string
  triggerPatterns: string[]
  excludePatterns?: string[]
  requiredFacts: RequiredFact[]
  answerMode: 'direct' | 'premium'
  expectedLexicon: string[]
  ccQuery?: string
  caQuery?: string
  forcedArticles?: Array<{ law: string; artNums: string[] }>
  // Classification → DetectedTheme
  theme: string
  chamber: string
  noDateFilter?: boolean
  publications?: string[]
}

const LEGAL_SUBTEME_MAP: LegalSubTheme[] = [
  {
    id: 'mandat_expire',
    triggerPatterns: [
      'mandat expiré', 'mandat a expiré', 'expiré depuis', 'mandat de vente expiré',
      "après l'expiration du mandat", "après l'expiration", "mandat n'est plus valide",
      'expiration de son mandat', 'mandat arrivé à expiration',
    ],
    requiredFacts: [],
    answerMode: 'direct',
    expectedLexicon: ['mandat expiré', 'commission non due', 'sans mandat valide', "pas d'habilitation", 'loi Hoguet', 'registre des mandats'],
    ccQuery: 'commission agent immobilier mandat expiré absence mandat validité',
    caQuery: 'commission agent immobilier mandat expiré honoraires',
    theme: 'agent immobilier', chamber: 'civ1', noDateFilter: true, publications: ['b', 'r', 'l'],
  },
  {
    id: 'commission_acheteur_defaillant',
    triggerPatterns: [
      'renoncé sans motif', 'renonce après la levée', 'abandonne après les conditions',
      'refuse malgré la levée', 'renoncé alors que', 'renoncé après levée',
      'acheteur a renoncé', 'acheteur renonce',
    ],
    requiredFacts: [],
    answerMode: 'direct',
    expectedLexicon: ['commission due', 'acheteur fautif', 'vente parfaite', 'conditions suspensives levées', 'inexécution fautive', 'loi 70-9'],
    ccQuery: 'commission agent immobilier acheteur défaillant conditions suspensives levées',
    caQuery: 'commission agent immobilier acheteur renonciation fautive',
    theme: 'agent immobilier', chamber: 'civ1', noDateFilter: true, publications: ['b', 'r', 'l'],
  },
  {
    id: 'commission_vs_vice',
    triggerPatterns: [
      'refuser de payer les honoraires en invoquant',
      'invoquer ce défaut',
      'peut-il refuser de payer les honoraires',
      'refus de payer les honoraires',
      'invoquer un défaut non signalé',
      'honoraires en invoquant',
    ],
    requiredFacts: [],
    answerMode: 'direct',
    expectedLexicon: ['honoraires indépendants', 'vice caché', 'action distincte', 'vendeur', 'garantie des vices cachés', 'obligation séparée', 'non'],
    ccQuery: 'commission agent immobilier honoraires garantie vices cachés indépendance',
    caQuery: 'honoraires agent immobilier vice caché refus paiement',
    theme: 'agent immobilier', chamber: 'civ1', noDateFilter: true, publications: ['b', 'r', 'l'],
  },
  {
    id: 'commission_vendeur_defaillant',
    triggerPatterns: [
      "vendeur s'est rétracté", 'rétractation du vendeur',
      'vendeur a refusé de signer', 'le vendeur se rétracte', 'vendeur défaillant',
    ],
    excludePatterns: ['réitération', 'condition suspensive'],
    requiredFacts: [],
    answerMode: 'direct',
    expectedLexicon: ['réitération', 'acte authentique', 'commission non due', 'vente non conclue', 'dommages et intérêts', 'faute du vendeur', 'loi 70-9'],
    ccQuery: 'commission agent immobilier vendeur défaillant rétractation acte authentique non signé',
    caQuery: 'commission honoraires agent immobilier vendeur refus signature acte authentique',
    theme: 'agent immobilier', chamber: 'civ1', noDateFilter: true, publications: ['b', 'r', 'l'],
  },
  {
    id: 'commission_partage',
    triggerPatterns: [
      'deux agences', 'agence a ', 'agence b ',
      'inter-agences', 'primo-visiteur',
      'mandat simple sur le même bien', 'deux mandats simples', 'chacune un mandat',
    ],
    requiredFacts: FACTS_COMMISSION_PARTAGE,
    answerMode: 'premium',
    expectedLexicon: ['primo-visiteur', 'cause efficiente', 'accord inter-agences', 'partage de commission', 'source du client'],
    ccQuery: 'partage commission deux agences mandat simple primo-visiteur cause efficiente',
    caQuery: 'partage commission agent immobilier deux agences mandat',
    theme: 'agent immobilier', chamber: 'civ1', noDateFilter: true, publications: ['b', 'r', 'l'],
  },
  {
    id: 'compromis_caducite',
    triggerPatterns: [
      'compromis est-il caduc', 'caducité du compromis', 'réitération dépassée',
      'date de réitération', 'compromis caduc', "aucune des parties n'a réagi",
      'dépassée depuis', 'date de réitération prévue',
      'refuse de signer chez le notaire', 'réitération au plus tard', 'vendeur refuse de réitérer',
    ],
    requiredFacts: FACTS_COMPROMIS_CADUCITE,
    answerMode: 'premium',
    expectedLexicon: ['non automatiquement', 'clause expresse de caducité', 'mise en demeure', 'délai indicatif', 'exécution forcée', 'résolution judiciaire'],
    ccQuery: 'compromis vente caducité réitération mise en demeure inexécution',
    caQuery: 'compromis vente date réitération caducité inexécution',
    forcedArticles: [{ law: 'code-civil', artNums: ['1589', '1104'] }],
    theme: 'vente immobilière', chamber: 'civ3',
  },
  {
    id: 'responsabilite_agent_info',
    triggerPatterns: [
      "n'a pas informé l'acheteur", "pas informé l'acheteur", "agent a omis",
      "n'a pas signalé", 'agent savait', 'agent connaissait',
      "information non divulguée", "non mentionné dans l'annonce",
      "n'a pas dit à l'acheteur",
    ],
    requiredFacts: FACTS_RESPONSABILITE_AGENT,
    answerMode: 'premium',
    expectedLexicon: ["obligation d'information", 'devoir de conseil', 'réticence dolosive', 'dol par réticence', 'information essentielle', 'responsabilité délictuelle'],
    ccQuery: 'agent immobilier obligation information conseil réticence dolosive responsabilité',
    caQuery: 'agent immobilier information essentielle réticence dol responsabilité',
    theme: 'agent immobilier', chamber: 'civ1', noDateFilter: true, publications: ['b', 'r', 'l'],
  },
  {
    id: 'depot_garantie_vetuste',
    triggerPatterns: [
      'vétusté', 'grille de vétusté', 'usure normale', 'durée de vie',
      'retenue pour vétusté', 'sans grille', 'coefficient de vétusté',
    ],
    excludePatterns: ["n'était pas présent", 'état des lieux unilatéral', 'non convoqué'],
    requiredFacts: [],
    answerMode: 'direct',
    expectedLexicon: ['grille de vétusté', 'décret 2016-382', 'durée de vie', 'appréciation souveraine', 'juge', 'usure normale', 'loi 89-462', 'article 22'],
    ccQuery: 'dépôt de garantie vétusté retenue grille durée de vie bail habitation',
    caQuery: 'dépôt de garantie vétusté retenue bail habitation locataire',
    theme: "bail d'habitation", chamber: 'civ3',
  },
  {
    id: 'depot_garantie_degradation',
    triggerPatterns: [
      "n'était pas présent à l'état des lieux",
      "n'a pas été convoqué",
      "état des lieux réalisé sans le locataire",
      "état des lieux unilatéral",
    ],
    requiredFacts: FACTS_DEPOT_DEGRADATION,
    answerMode: 'premium',
    expectedLexicon: ['état des lieux contradictoire', 'non opposable', 'constat unilatéral', 'convocation', '2 mois', 'délai impératif', 'décompte justifié'],
    ccQuery: 'dépôt de garantie dégradation état des lieux locataire bail',
    caQuery: 'dépôt de garantie état des lieux sortie dégradation locataire',
    theme: "bail d'habitation", chamber: 'civ3',
  },
  {
    id: 'condition_suspensive_permis',
    triggerPatterns: [
      "condition suspensive d'obtention de permis",
      'condition suspensive de permis de construire',
      "condition suspensive obtention permis",
    ],
    excludePatterns: ['prêt', 'financement', 'bancaire', 'refus de prêt'],
    requiredFacts: FACTS_CONDITION_PERMIS,
    answerMode: 'premium',
    expectedLexicon: ['article 1304', 'délai raisonnable', 'dépôt de la demande', 'décision administrative', 'caducité', 'diligence du demandeur', 'instruction'],
    ccQuery: 'condition suspensive permis de construire délai compromis caducité',
    caQuery: 'condition suspensive permis construire compromis vente',
    forcedArticles: [{ law: 'code-civil', artNums: ['1304', '1304-2'] }],
    theme: 'vente immobilière', chamber: 'civ3',
  },
  {
    id: 'condition_suspensive_pret',
    triggerPatterns: [
      'refus de prêt', "obtention du prêt", "demande de prêt",
      "n'a pas obtenu son prêt", 'refus de financement', 'une seule banque',
      'plusieurs banques', "déposé aucune demande de prêt", "n'a pas déposé",
      "aucune demande de prêt", 'bonne foi du prêt',
    ],
    excludePatterns: ['permis de construire'],
    requiredFacts: FACTS_CONDITION_PRET,
    answerMode: 'premium',
    expectedLexicon: ['bonne foi', 'diligences sérieuses', 'plusieurs établissements', 'condition réputée accomplie', 'délai conventionnel', 'défaillance imputable', 'L313-41'],
    ccQuery: 'condition suspensive prêt immobilier bonne foi diligences établissements refus',
    caQuery: 'condition suspensive prêt immobilier acheteur bonne foi refus',
    theme: 'vente immobilière', chamber: 'civ3',
  },
  {
    id: 'copropriete_syndic_contrat',
    triggerPatterns: [
      'contrat du syndic', 'contrat syndic', 'contrat de syndic',
      'renégocier le contrat', 'renégocier le syndic',
      'renégociation contrat syndic', 'révoquer le syndic', 'changement de syndic',
      'mise en concurrence syndic', 'résiliation contrat syndic',
      'mandat du syndic', 'renouvellement syndic', 'renouvellement du syndic',
      'syndic avant son terme', 'non-renouvellement du syndic',
      'révoquer syndic', 'revoquer syndic', 'nouveau syndic',
      'durée du mandat du syndic', 'honoraires du syndic',
      'rémunération du syndic', 'désignation du syndic',
    ],
    requiredFacts: [],
    answerMode: 'premium',
    expectedLexicon: [
      'article 18', 'article 18-1 A', 'loi 65-557',
      'assemblée générale', 'majorité absolue', 'article 25',
      'mise en concurrence', 'contrat type', 'ordre du jour',
      'révocation', 'non-renouvellement',
    ],
    ccQuery: 'syndic copropriété contrat mandat révocation mise en concurrence renouvellement',
    caQuery: 'syndic copropriété contrat renégociation révocation assemblée générale',
    forcedArticles: [
      { law: 'loi 65-557', artNums: ['18', '18-1 A', '25'] },
    ],
    theme: 'copropriété', chamber: 'civ3',
  },
  {
    id: 'diagnostics_vente',
    triggerPatterns: [
      'diagnostics obligatoires', 'diagnostics immobiliers',
      'quels diagnostics', 'DDT', 'dossier de diagnostic',
      'diagnostics pour la vente', 'diagnostics vente',
      'avant 1949', 'avant 1997', 'diagnostic amiante', 'diagnostic plomb', 'CREP',
    ],
    excludePatterns: [],
    requiredFacts: [],
    answerMode: 'direct' as const,
    expectedLexicon: ['DPE', 'amiante', 'plomb', 'CREP', 'termites', 'électricité', 'gaz', 'ERP', 'loi Carrez'],
    ccQuery: 'diagnostics immobiliers vente obligation vendeur',
    caQuery: 'diagnostics immobiliers obligation vente appartement',
    forcedArticles: [{ law: 'cch', artNums: ['L271-4', 'L271-5'] }],
    theme: 'vente immobilière', chamber: 'civ3',
  },
  {
    id: 'clause_substitution',
    triggerPatterns: [
      'clause de substitution', 'substitution compromis',
      'se substituer', 'cessionnaire', 'substituer acheteur',
    ],
    excludePatterns: [],
    requiredFacts: [],
    answerMode: 'direct' as const,
    expectedLexicon: ['substitution', 'cessionnaire', 'SCI', 'avant réitération'],
    ccQuery: 'clause substitution compromis vente immobilier cessionnaire',
    caQuery: 'clause substitution compromis vente acheteur',
    forcedArticles: [{ law: 'code civil', artNums: ['1589', '1216'] }],
    theme: 'vente immobilière', chamber: 'civ3',
  },
  {
    id: 'permis_construire_delai_instruction',
    triggerPatterns: [
      'délai permis de construire', 'instruction permis',
      'délai instruction', 'permis de construire mairie',
      'combien de temps permis', 'déclaration préalable délai',
    ],
    excludePatterns: [],
    requiredFacts: [],
    answerMode: 'direct' as const,
    expectedLexicon: ['2 mois', '3 mois', 'maison individuelle', 'silence vaut acceptation'],
    ccQuery: 'permis construire délai instruction urbanisme',
    caQuery: 'permis construire délai instruction mairie',
    forcedArticles: [{ law: 'code de l\'urbanisme', artNums: ['R423-23'] }],
    theme: 'urbanisme', chamber: 'civ3',
  },
  {
    id: 'promesse_vs_compromis',
    triggerPatterns: [
      'promesse unilatérale', 'promesse de vente',
      'différence promesse compromis', 'promesse vs compromis',
      'promesse ou compromis', 'levée d\'option', 'indemnité d\'immobilisation',
    ],
    excludePatterns: [],
    requiredFacts: [],
    answerMode: 'direct' as const,
    expectedLexicon: ['promesse unilatérale', 'compromis', 'article 1124', 'article 1589', 'levée d\'option'],
    ccQuery: 'promesse unilatérale compromis vente différence immobilier',
    caQuery: 'promesse unilatérale vente compromis levée option',
    forcedArticles: [{ law: 'code civil', artNums: ['1124', '1589'] }],
    theme: 'vente immobilière', chamber: 'civ3',
  },
  {
    id: 'commission_mandat_non_enregistre',
    triggerPatterns: [
      'mandat non enregistré', 'mandat pas enregistré',
      'commission sans mandat', 'registre des mandats',
      'mandat non inscrit', 'défaut d\'enregistrement',
    ],
    excludePatterns: [],
    requiredFacts: [],
    answerMode: 'direct' as const,
    expectedLexicon: ['registre des mandats', 'article 6', 'loi Hoguet', 'nullité'],
    ccQuery: 'commission agent immobilier mandat registre enregistrement nullité',
    caQuery: 'commission agent mandat non enregistré registre',
    forcedArticles: [{ law: 'loi 70-9', artNums: ['6', '7'] }],
    theme: 'agent immobilier', chamber: 'civ1',
    noDateFilter: true, publications: ['b', 'r', 'l'],
  },
  {
    id: 'syndic_travaux_urgents',
    triggerPatterns: [
      'travaux sans vote', 'travaux sans assemblée',
      'travaux urgents syndic', 'syndic engager travaux',
      'travaux d\'urgence copropriété', 'travaux conservatoires',
    ],
    excludePatterns: [],
    requiredFacts: [],
    answerMode: 'direct' as const,
    expectedLexicon: ['urgence', 'travaux conservatoires', 'article 18', 'sans vote', 'sauvegarde'],
    ccQuery: 'syndic copropriété travaux urgence sans vote assemblée',
    caQuery: 'syndic travaux urgents copropriété sans autorisation',
    forcedArticles: [{ law: 'loi 65-557', artNums: ['18', '24'] }],
    theme: 'copropriété', chamber: 'civ3',
  },
]

// ---------------------------------------------------------------------------
// Conversion LegalSubTheme → DetectedTheme (partagé keyword + LLM classifier)
// ---------------------------------------------------------------------------

function buildDetectedThemeFromSubTheme(st: LegalSubTheme): DetectedTheme {
  return {
    theme: st.theme,
    chamber: st.chamber,
    ccQuery: st.ccQuery,
    caQuery: st.caQuery,
    noDateFilter: st.noDateFilter,
    publications: st.publications,
    isPremium: st.answerMode === 'premium',
    requiredFacts: st.requiredFacts,
    subTheme: st.id,
    expectedLexicon: st.expectedLexicon,
    forcedArticles: st.forcedArticles,
  }
}

// ---------------------------------------------------------------------------
// Détection du sous-thème juridique fin (avant détection thème générique)
// ---------------------------------------------------------------------------

function detectSubTheme(question: string): LegalSubTheme | null {
  const lower = question.toLowerCase()
  for (const st of LEGAL_SUBTEME_MAP) {
    const excluded = st.excludePatterns?.some(p => lower.includes(p.toLowerCase()))
    if (excluded) continue
    const matched = st.triggerPatterns.some(p => lower.includes(p.toLowerCase()))
    if (matched) return st
  }
  return null
}

function detectTheme(question: string): DetectedTheme | null {
  if (question.trim().split(/\s+/).length < 5) return null
  const lower = question.toLowerCase()

  // DPE — jurisprudence CC inexistante (trop récent), CA ciblé date>=2022
  if (
    lower.includes('dpe') || lower.includes('diagnostic performance') ||
    lower.includes('diagnostiqueur') || lower.includes('diagnostic immobilier') ||
    lower.includes('opposable')
  ) {
    return { theme: 'vente immobilière', chamber: 'civ3', caQuery: 'responsabilité diagnostiqueur DPE', dpeSignal: true }
  }

  // Détection sous-thème fin — priorité sur tout le reste
  const subTheme = detectSubTheme(question)
  if (subTheme) return buildDetectedThemeFromSubTheme(subTheme)

  // Validité du mandat / mentions honoraires
  if (
    lower.includes('mandat sans honoraires') ||
    lower.includes("à la charge de l'acquéreur") ||
    lower.includes('à la charge du vendeur') ||
    lower.includes('mentions obligatoires') ||
    lower.includes('validité du mandat') ||
    lower.includes('mandat est-il valide') ||
    lower.includes('mandat valide') ||
    (lower.includes('honoraires') && lower.includes('répartition')) ||
    ((lower.includes('loi alur') || lower.includes('alur')) && lower.includes('honoraires') && !lower.includes('conteste') && !lower.includes('contesté') && !lower.includes('compromis'))
  ) {
    return {
      theme: 'agent immobilier', chamber: 'civ1',
      ccQuery: 'validité mandat honoraires répartition vendeur acquéreur loi Hoguet ALUR',
      caQuery: 'mandat honoraires acquéreur validité mentions obligatoires loi ALUR',
      noDateFilter: true, publications: ['b', 'r', 'l'],
      isPremium: false,
    }
  }

  // Commission agent — générique (exigibilité, contestation principe)
  if (
    (lower.includes('commission') || lower.includes('honoraires')) &&
    (lower.includes('agent') || lower.includes('mandat') || lower.includes('compromis') ||
     lower.includes('conteste') || lower.includes('contester') || lower.includes('vente'))
  ) {
    return {
      theme: 'agent immobilier', chamber: 'civ1',
      ccQuery: 'commission agent immobilier exigibilité mandat vente réalisation définitive',
      caQuery: 'commission agent immobilier honoraires contestation mandat compromis',
      noDateFilter: true, publications: ['b', 'r', 'l'],
      isPremium: true, requiredFacts: FACTS_COMMISSION,
    }
  }

  // Agent immobilier — devoir de conseil générique
  if (
    lower.includes('agent immobilier') || lower.includes('devoir de conseil') ||
    lower.includes('responsabilité agent') || lower.includes('conseil agent')
  ) {
    return {
      theme: 'agent immobilier', chamber: 'civ1',
      ccQuery: 'agent immobilier obligation information conseil responsabilité',
      caQuery: 'agent immobilier obligation information conseil',
      noDateFilter: true, publications: ['b', 'r', 'l'],
      isPremium: true,
    }
  }

  // Vente — sub-queries spécialisées
  if (lower.includes('vices cachés') || lower.includes('vice caché') || lower.includes('défaut caché')) {
    return {
      theme: 'vente immobilière', chamber: 'civ3',
      ccQuery: 'vices cachés garantie immeuble acheteur',
      caQuery: 'vice caché immeuble acheteur garantie',
    }
  }
  if (lower.includes('condition suspensive') || lower.includes('refus de prêt') || lower.includes('obtention du prêt')) {
    return {
      theme: 'vente immobilière', chamber: 'civ3',
      ccQuery: 'condition suspensive prêt immobilier refus',
      caQuery: 'condition suspensive prêt immobilier',
      isPremium: true, requiredFacts: FACTS_CONDITIONS_SUSPENSIVES,
    }
  }
  if (lower.includes('rétractation') || lower.includes('délai de réflexion') || lower.includes('se rétracter') || lower.includes('se retracter')) {
    return {
      theme: 'vente immobilière', chamber: 'civ3',
      ccQuery: 'droit rétractation acquéreur vente immobilière délai',
      caQuery: 'rétractation acquéreur délai vente',
    }
  }
  if ((lower.includes('promesse') || lower.includes('compromis')) && !lower.includes('bail')) {
    return {
      theme: 'vente immobilière', chamber: 'civ3',
      ccQuery: 'promesse vente compromis caducité inexécution',
      caQuery: 'promesse vente compromis inexécution',
    }
  }

  // Bail commercial — AVANT bail habitation (sinon "bail" matche "bail d'habitation" en premier)
  if (lower.includes('bail commercial') || lower.includes('fonds de commerce') || lower.includes('l145') ||
      lower.includes('indemnité d\'éviction') || lower.includes('indemnite d\'eviction') ||
      lower.includes('3-6-9') || lower.includes('droit au bail') || lower.includes('pas de porte')) {
    return {
      theme: 'bail commercial', chamber: 'comm',
      ccQuery: 'bail commercial renouvellement indemnité éviction résiliation locataire preneur',
      caQuery: 'bail commercial renouvellement indemnité éviction faute preneur',
      isPremium: true,
    }
  }

  // Bail habitation — sub-queries spécialisées
  if (lower.includes('vétusté') || lower.includes('dégradation') || lower.includes('état des lieux')) {
    return {
      theme: "bail d'habitation", chamber: 'civ3',
      ccQuery: 'vétusté dégradation locataire bail état des lieux',
      caQuery: 'vétusté dégradation locataire',
    }
  }
  if (lower.includes('clause résolutoire') || lower.includes('commandement') || lower.includes('impayé')) {
    return {
      theme: "bail d'habitation", chamber: 'civ3',
      ccQuery: 'clause résolutoire commandement payer loyer impayé',
      caQuery: 'clause résolutoire commandement loyer impayé',
    }
  }
  if (lower.includes('expulsion') || lower.includes('trêve hivernale')) {
    return {
      theme: "bail d'habitation", chamber: 'civ3',
      ccQuery: 'expulsion locataire trêve hivernale',
      caQuery: 'expulsion locataire trêve hivernale',
    }
  }

  // Match général sur THEME_MAP
  for (const entry of THEME_MAP) {
    if (entry.triggers.some(t => lower.includes(t))) {
      return { theme: entry.theme, chamber: entry.chamber, caQuery: entry.caQuery }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// parseVisaRefs : visa[].title → VisaRef[]
// ---------------------------------------------------------------------------

function parseVisaRefs(visaList: Array<{ title?: string }>): VisaRef[] {
  const refs: VisaRef[] = []
  for (const visa of visaList) {
    const title = visa.title ?? ''
    const lawMatch = title.match(/(\d{2,4}-\d{3,4})/)
    const artMatch = title.match(/art(?:icle)?\s*\.?\s*(\d+[\w-]*)/i)
    if (lawMatch && artMatch) {
      refs.push({ law: lawMatch[1], artNum: artMatch[1] })
    }
  }
  return refs
}

// ---------------------------------------------------------------------------
// extractZoneText : découpe le texte brut via les offsets de zones
// ---------------------------------------------------------------------------

function extractZoneText(detail: any, zoneName: string, maxChars: number): string {
  const segments: Array<{ start: number; end: number }> | undefined = detail?.zones?.[zoneName]
  const fullText: string = detail?.text ?? ''

  // Cas 1 : zones structurées avec ranges {start, end}
  if (Array.isArray(segments) && segments.length > 0) {
    const combined = segments.map(seg => fullText.slice(seg.start, seg.end)).join('\n')
    if (combined.length > 20) return combined.slice(0, maxChars)
  }

  // Cas 2 : pas de zones mais texte brut disponible — extraire une portion pertinente
  if (zoneName === 'motivations' && fullText.length > 200) {
    // Chercher "attendu que", "considérant que", "mais attendu" qui marquent les motivations
    const markers = ['attendu que', 'considérant que', 'mais attendu', 'par ces motifs']
    for (const marker of markers) {
      const idx = fullText.toLowerCase().indexOf(marker)
      if (idx > 0) return fullText.slice(idx, idx + maxChars)
    }
    // Sinon prendre la 2e moitié du texte (les motivations sont généralement après les faits)
    const midpoint = Math.floor(fullText.length * 0.4)
    return fullText.slice(midpoint, midpoint + maxChars)
  }

  return ''
}

// ---------------------------------------------------------------------------
// extractHighlights : text_highlight pour décisions pré-2018 sans zones
// ---------------------------------------------------------------------------

function extractHighlights(detail: any): string {
  const hl = detail?.text_highlight
  if (!hl) return ''

  const raw: string[] = []
  if (typeof hl === 'string') raw.push(hl)
  else if (Array.isArray(hl)) raw.push(...hl)
  else if (hl.text) raw.push(...(Array.isArray(hl.text) ? hl.text : [String(hl.text)]))

  const segments: string[] = []
  for (const s of raw) {
    const matches = [...String(s).matchAll(/<em>([\s\S]*?)<\/em>/g)]
    for (const m of matches) {
      const seg = m[1].slice(0, 200).trim()
      if (seg) segments.push(seg)
      if (segments.length >= 3) break
    }
    if (segments.length >= 3) break
  }

  if (segments.length > 0) {
    console.info(`[judilibre] text_highlight → ${segments.length} segments extraits`)
  }
  return segments.join(' … ')
}

// ---------------------------------------------------------------------------
// Piste CC — /search avec filtres publication + theme + field=['summary','motivations']
// operator='or' (validé comme optimal pour CC multi-mots)
// ---------------------------------------------------------------------------

async function searchCC(
  token: string,
  query: string,
  theme: string,
  chamber: string,
  publications: string[],
  noDateFilter: boolean,
): Promise<any[]> {
  const url = new URL(`${API_URL}/search`)
  url.searchParams.set('query', query)
  url.searchParams.set('theme', theme)
  url.searchParams.set('chamber', chamber)
  for (const p of publications) url.searchParams.append('publication', p)
  if (!noDateFilter) url.searchParams.set('date_start', '2018-01-01')
  url.searchParams.set('operator', 'or')
  url.searchParams.append('type', 'arret')
  url.searchParams.append('field', 'summary')
  url.searchParams.append('field', 'motivations')
  url.searchParams.set('page_size', '3')
  url.searchParams.set('resolve_references', 'true')

  const res = await fetchWithTimeout(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  }).catch((err: unknown) => {
    console.error('[judilibre] CC /search timeout :', err)
    return null
  })
  if (!res || !res.ok) {
    if (res) console.error(`[judilibre] CC /search HTTP ${res.status}`)
    return []
  }
  const data = await res.json() as { results?: any[]; total?: number; relaxed?: boolean }
  console.info(
    `[judilibre] CC theme='${theme}' chamber=${chamber} pub=${publications.join(',')} → ${data?.total ?? 0} résultats${data?.relaxed ? ' (relaxed)' : ''}`
  )
  return data.results ?? []
}

// ---------------------------------------------------------------------------
// Piste CC fallback — sans filtres publication/date (si 0 résultats stricts)
// ---------------------------------------------------------------------------

async function searchCCFallback(
  token: string,
  query: string,
  theme: string,
  chamber: string,
): Promise<any[]> {
  const url = new URL(`${API_URL}/search`)
  url.searchParams.set('query', query)
  url.searchParams.set('theme', theme)
  url.searchParams.set('chamber', chamber)
  url.searchParams.set('date_start', '2010-01-01')
  url.searchParams.set('operator', 'or')
  url.searchParams.append('type', 'arret')
  url.searchParams.append('field', 'summary')
  url.searchParams.append('field', 'motivations')
  url.searchParams.set('page_size', '3')
  url.searchParams.set('resolve_references', 'true')

  const res = await fetchWithTimeout(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  }).catch((err: unknown) => {
    console.error('[judilibre] CC fallback /search timeout :', err)
    return null
  })
  if (!res || !res.ok) return []
  const data = await res.json() as { results?: any[]; total?: number }
  console.info(`[judilibre] CC fallback theme='${theme}' → ${data?.total ?? 0} résultats`)
  return data.results ?? []
}

// ---------------------------------------------------------------------------
// Piste CA — /search avec jurisdiction='ca', operator='and'
// Pas de filtre theme ni publication (nomenclature NAC différente)
// ---------------------------------------------------------------------------

async function searchCA(
  token: string,
  query: string,
  dateStart?: string,
): Promise<any[]> {
  const url = new URL(`${API_URL}/search`)
  url.searchParams.set('query', query)
  url.searchParams.set('jurisdiction', 'ca')
  url.searchParams.set('operator', 'and')
  url.searchParams.append('type', 'arret')
  url.searchParams.append('field', 'summary')
  url.searchParams.append('field', 'motivations')
  if (dateStart) url.searchParams.set('date_start', dateStart)
  url.searchParams.set('page_size', '3')

  const res = await fetchWithTimeout(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  }).catch((err: unknown) => {
    console.error('[judilibre] CA /search timeout :', err)
    return null
  })
  if (!res || !res.ok) {
    if (res) console.error(`[judilibre] CA /search HTTP ${res.status}`)
    return []
  }
  const data = await res.json() as { results?: any[]; total?: number }
  console.info(`[judilibre] CA query='${query}'${dateStart ? ` date>=${dateStart}` : ''} → ${data?.total ?? 0} résultats`)
  return data.results ?? []
}

// ---------------------------------------------------------------------------
// /decision?id=xxx — détail complet (zones, visa) pour piste CC
// ---------------------------------------------------------------------------

async function fetchDecisionDetail(token: string, id: string, query?: string): Promise<any | null> {
  const url = new URL(`${API_URL}/decision`)
  url.searchParams.set('id', id)
  url.searchParams.set('resolve_references', 'true')
  if (query) {
    url.searchParams.set('query', query)
    url.searchParams.set('operator', 'or')
  }

  const res = await fetchWithTimeout(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  }).catch((err: unknown) => {
    console.error(`[judilibre] /decision timeout pour id=${id} :`, err)
    return null
  })
  if (!res || !res.ok) {
    if (res) console.error(`[judilibre] /decision HTTP ${res.status} pour id=${id}`)
    return null
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Formatage CC — zones motivations/dispositif depuis /decision
// ---------------------------------------------------------------------------

function formatDecision(detail: any): string {
  const header = [
    detail.number ? `Arrêt n° ${detail.number}` : null,
    detail.decision_date ? detail.decision_date.slice(0, 10) : null,
    'Cour de cassation',
    detail.solution ?? null,
  ].filter(Boolean).join(' · ')

  const themes = (detail.themes ?? []).slice(0, 3).join(', ')
  const themesLine = themes ? `Matières : ${themes}` : null

  const motivations = extractZoneText(detail, 'motivations', 600)
  const dispositif  = extractZoneText(detail, 'dispositif',  200)

  // Fallback : text_highlight pour pré-2018, puis summary
  const body = motivations
    || extractHighlights(detail)
    || (detail.summary ? `Sommaire : ${detail.summary}` : '')

  const visaTitles: string[] = (detail.visa ?? [])
    .map((v: any) => v?.title ?? '')
    .filter(Boolean)
  const visaLine = visaTitles.length ? `Textes appliqués : ${visaTitles.join(' ; ')}` : null

  const urlLine = detail.id ? `Lien : ${judilibreUrl(detail.id)}` : null

  return [header, themesLine, body, dispositif || null, visaLine, urlLine]
    .filter(Boolean)
    .join('\n')
}

// ---------------------------------------------------------------------------
// Formatage CA — summary + highlights depuis searchResult (pas de /decision)
// ---------------------------------------------------------------------------

function formatCAResult(result: any): string {
  const header = [
    result.number ? `Arrêt n° ${result.number}` : null,
    result.decision_date ? result.decision_date.slice(0, 10) : null,
    "Cour d'appel",
    result.solution ?? null,
  ].filter(Boolean).join(' · ')

  // Préférer les highlights (fragments pertinents surlignés par l'API)
  let body = ''
  if (result.highlights) {
    for (const zone of ['motivations', 'summary', 'expose']) {
      const arr = result.highlights[zone]
      if (Array.isArray(arr) && arr.length > 0) {
        body = arr[0].replace(/<\/?em>/g, '').slice(0, 400)
        break
      }
    }
  }
  if (!body && result.summary) {
    body = `Sommaire : ${String(result.summary).slice(0, 400)}`
  }

  const urlLine = result.id ? `Lien : ${judilibreUrl(result.id)}` : null

  return [header, body, urlLine].filter(Boolean).join('\n')
}

// ---------------------------------------------------------------------------
// Builders NormalizedCase
// ---------------------------------------------------------------------------

function extractHolding(detail: any): string {
  const motivations = extractZoneText(detail, 'motivations', 500)
  if (motivations) {
    const first = motivations.split(/\.\s+/)[0]?.trim() ?? ''
    return (first.length >= 20 ? first : motivations.slice(0, 200)).replace(/\s+/g, ' ') + '.'
  }
  const hl = extractHighlights(detail)
  if (hl) return hl.slice(0, 200)
  return detail.summary ? String(detail.summary).slice(0, 200) : ''
}

function judilibreUrl(id: string): string {
  return `https://www.courdecassation.fr/decision/${id}`
}

function buildNormalizedCC(detail: any, publications: string[]): NormalizedCase {
  const rank = publications.includes('b') || publications.includes('r') ? 1 : 2
  return {
    court: 'cass',
    date: detail.decision_date?.slice(0, 10) ?? '?',
    number: detail.number ?? '?',
    solution: detail.solution,
    holding: extractHolding(detail),
    authorityRank: rank,
    formattedText: formatDecision(detail),
    url: detail.id ? judilibreUrl(detail.id) : undefined,
  }
}

function buildNormalizedCAFromDecision(detail: any): NormalizedCase {
  return {
    court: 'ca',
    date: detail.decision_date?.slice(0, 10) ?? '?',
    number: detail.number ?? '?',
    solution: detail.solution,
    holding: extractHolding(detail),
    authorityRank: 3,
    formattedText: formatDecision(detail),
    url: detail.id ? judilibreUrl(detail.id) : undefined,
  }
}

function buildNormalizedCAFromSearch(result: any): NormalizedCase {
  const snippet = (
    (result.highlights?.motivations?.[0] ??
     result.highlights?.summary?.[0] ??
     result.summary ?? '') as string
  ).replace(/<\/?em>/g, '').slice(0, 200)
  return {
    court: 'ca',
    date: result.decision_date?.slice(0, 10) ?? '?',
    number: result.number ?? '?',
    solution: result.solution,
    holding: snippet,
    authorityRank: 3,
    formattedText: formatCAResult(result),
    url: result.id ? judilibreUrl(result.id) : undefined,
  }
}

// ---------------------------------------------------------------------------
// Classifieur LLM — fallback quand le keyword matching ne détecte pas de sous-thème
// Retourne top-2 candidats pour détecter les collisions (delta < 0.15 → fallback générique)
// ---------------------------------------------------------------------------

const SUBTEME_CLASSIFIER_SYSTEM = `Tu es un classificateur de questions juridiques en droit immobilier français.
Identifie les 2 sous-thèmes les plus probables parmi la liste ci-dessous.
Réponds UNIQUEMENT avec ce JSON (sans markdown) :
{"first":{"id":"<id>","score":<0.0-1.0>},"second":{"id":"<id>","score":<0.0-1.0>}}
Si aucun sous-thème ne correspond, utilise null comme id et 0.0 comme score.

SOUS-THÈMES :
- mandat_expire : agent réclame sa commission mais son mandat était expiré au moment de la vente
- commission_acheteur_defaillant : acheteur renonce à la vente après levée des conditions suspensives, commission réclamée
- commission_vs_vice : acheteur refuse de payer les honoraires de l'agent en invoquant un vice caché
- commission_vendeur_defaillant : vendeur se rétracte ou refuse de signer l'acte authentique, commission réclamée
- commission_partage : deux agences sur le même bien, conflit de partage ou attribution de commission
- compromis_caducite : caducité ou validité d'un compromis dont la date de réitération est dépassée
- responsabilite_agent_info : agent n'a pas informé l'acheteur d'une information importante (servitude, urbanisme, sinistre)
- depot_garantie_vetuste : litige sur la vétusté lors de restitution du dépôt de garantie locatif
- depot_garantie_degradation : état des lieux unilatéral ou locataire absent à l'état des lieux de sortie, contestation des retenues
- condition_suspensive_permis : condition suspensive d'obtention de permis de construire dans un compromis de vente
- condition_suspensive_pret : condition suspensive de prêt immobilier, refus de financement, bonne foi de l'acheteur`

async function classifySubThemeLLM(question: string): Promise<LegalSubTheme | null> {
  try {
    const result = await openRouterChat(
      [
        { role: 'system', content: SUBTEME_CLASSIFIER_SYSTEM },
        { role: 'user', content: question.slice(0, 600) },
      ],
      MODELS.FILTER,
      60,
    )
    const parsed = JSON.parse(result.trim()) as {
      first: { id: string | null; score: number }
      second: { id: string | null; score: number }
    }
    const { first, second } = parsed
    if (!first.id || first.score < 0.7) return null

    const delta = first.score - (second.score ?? 0)
    if (delta < 0.15) {
      // Collision : deux sous-thèmes trop proches — fallback thème générique
      console.info(
        `[judilibre] LLM classifier — collision: ${first.id}(${first.score.toFixed(2)}) vs ${second.id ?? 'none'}(${(second.score ?? 0).toFixed(2)}) Δ=${delta.toFixed(2)} → fallback générique`
      )
      return null
    }

    console.info(
      `[judilibre] LLM classifier → ${first.id} (score=${first.score.toFixed(2)}, Δ=${delta.toFixed(2)})`
    )
    return LEGAL_SUBTEME_MAP.find(st => st.id === first.id) ?? null
  } catch {
    return null // fail-open
  }
}

// ---------------------------------------------------------------------------
// Point d'entrée public
// ---------------------------------------------------------------------------

export async function fetchJurisprudence(question: string, reformulatedQuery?: string): Promise<JudilibreContext> {
  // Fast-path synchrone : keyword matching (0ms, couvre ~85% des cas)
  const fastDetected = detectTheme(question)

  // Si le keyword matching n'a pas trouvé de sous-thème fin, lancer le classifieur LLM
  // en parallèle du token fetch pour ne pas ajouter de latence (~100-150ms < ~200-400ms token)
  const needsLLM = !fastDetected?.subTheme
  const [token, llmSubTheme] = await Promise.all([
    getJudilibreToken(),
    needsLLM ? classifySubThemeLLM(question) : Promise.resolve(null),
  ])

  if (!token) return { available: false, text: '', cases: [], decisions: [], visaRefs: [], isPremium: false, requiredFacts: [], expectedLexicon: [] }

  // Préférer le sous-thème LLM quand le keyword matching n'en a pas trouvé
  const detected = (llmSubTheme && !fastDetected?.subTheme)
    ? buildDetectedThemeFromSubTheme(llmSubTheme)
    : fastDetected

  if (!detected) {
    console.info('[judilibre] Aucun thème détecté — pas de jurisprudence')
    return { available: true, text: '', cases: [], decisions: [], visaRefs: [], isPremium: false, requiredFacts: [], expectedLexicon: [] }
  }

  const { theme, chamber, ccQuery, caQuery, noDateFilter, publications, dpeSignal, isPremium, requiredFacts, subTheme, expectedLexicon, forcedArticles } = detected
  // Priorité : ccQuery du sub-theme > query reformulée > question brute
  const ccSearchQuery = ccQuery ?? reformulatedQuery ?? question
  const caSearchQuery = caQuery ?? reformulatedQuery ?? question
  const pubs = publications ?? ['b', 'r']

  try {
    let ccHits: any[] = []
    let caHits: any[] = []

    if (dpeSignal) {
      // DPE : pas de recherche CC (jurisprudence inexistante avant 2025),
      // CA uniquement avec date>=2022 et query très ciblée
      caHits = await searchCA(token, caSearchQuery, '2022-01-01')
    } else {
      // Pistes CC + CA lancées en parallèle
      ;[ccHits, caHits] = await Promise.all([
        searchCC(token, ccSearchQuery, theme, chamber, pubs, noDateFilter ?? false),
        searchCA(token, caSearchQuery),
      ])

      // Fallback CC sans filtres stricts si 0 résultat
      if (ccHits.length === 0) {
        ccHits = await searchCCFallback(token, ccSearchQuery, theme, chamber)
      }
    }

    if (ccHits.length === 0 && caHits.length === 0) {
      return { available: true, text: '', cases: [], decisions: [], visaRefs: [], isPremium: isPremium ?? false, requiredFacts: requiredFacts ?? [], subTheme, expectedLexicon: expectedLexicon ?? [], forcedArticles }
    }

    // /decision pour top 2 CC + top 1 CA en parallèle (zones complètes pour tous)
    const top2CC = ccHits.slice(0, 2)
    const top1CA = caHits.slice(0, 1)
    const caRest = caHits.slice(1, 2)

    const [ccRawDetails, caRawDetails] = await Promise.all([
      Promise.all(top2CC.map(h => fetchDecisionDetail(token, h.id, ccSearchQuery))),
      Promise.all(top1CA.map(h => fetchDecisionDetail(token, h.id, caSearchQuery))),
    ])

    const ccDetails = ccRawDetails.filter(Boolean)
    const caDetails = caRawDetails.filter(Boolean)

    // Log + extraction visaRefs
    const allVisaRefs: VisaRef[] = []
    for (const detail of ccDetails) {
      const visaRefs = parseVisaRefs(detail.visa ?? [])
      const motivationsLen = extractZoneText(detail, 'motivations', 9999).length
      console.info(
        `[judilibre] CC n°${detail.number ?? '?'} ${detail.decision_date?.slice(0, 10) ?? '?'} ${detail.solution ?? '?'} zones=[motivations ${motivationsLen} chars] visa=[${visaRefs.map((v: VisaRef) => `${v.law}/art.${v.artNum}`).join(', ') || '—'}]`
      )
      allVisaRefs.push(...visaRefs)
    }
    for (const detail of caDetails) {
      const motivationsLen = extractZoneText(detail, 'motivations', 9999).length
      console.info(
        `[judilibre] CA /decision n°${detail.number ?? '?'} ${detail.decision_date?.slice(0, 10) ?? '?'} zones=[motivations ${motivationsLen} chars]`
      )
    }

    // Construction NormalizedCase[] : CC enrichis + top CA enrichi + CA restant (searchResult)
    const normalizedCases: NormalizedCase[] = [
      ...ccDetails.map((d: any) => buildNormalizedCC(d, pubs)),
      ...caDetails.map((d: any) => buildNormalizedCAFromDecision(d)),
      ...caRest.map((r: any) => buildNormalizedCAFromSearch(r)),
    ]

    // Assemblage du texte injecté
    const textParts: string[] = []

    // Bloc machine-friendly en tête : holding structuré par arrêt
    if (normalizedCases.length > 0) {
      const holdingLines = normalizedCases.map(c => {
        const courtLabel = c.court === 'cass' ? 'Cass.' : 'CA'
        const authLabel = c.court === 'cass' ? '[CC — autorité maximale]' : '[CA — jurisprudence récente]'
        return `- ${courtLabel} ${c.date} n° ${c.number} ${authLabel} : ${c.holding}`
      })
      textParts.push(
        `ARRÊTS RETENUS — À CITER OBLIGATOIREMENT dans la section 2️⃣ en expliquant en une phrase leur apport à la réponse :\n${holdingLines.join('\n')}`
      )
    }

    if (dpeSignal) {
      textParts.push(
        "Note : La jurisprudence DPE opposable (post-juillet 2021) n'est pas encore disponible à la Cour de cassation (délai normal de traitement judiciaire). Décisions de Cours d'appel récentes :"
      )
    }

    const ccCases = normalizedCases.filter(c => c.court === 'cass')
    const caCases = normalizedCases.filter(c => c.court === 'ca')

    if (ccCases.length > 0) {
      textParts.push(
        `Jurisprudence Cour de cassation (source : JUDILIBRE) :\n\n${ccCases.map(c => c.formattedText).join('\n\n---\n\n')}`
      )
    }

    if (caCases.length > 0) {
      textParts.push(
        `Jurisprudence Cours d'appel (source : JUDILIBRE) :\n\n${caCases.map(c => c.formattedText).join('\n\n---\n\n')}`
      )
    }

    const text = textParts.join('\n\n===\n\n')

    return {
      available: true,
      text,
      cases: normalizedCases,
      decisions: [...ccDetails, ...caDetails, ...caRest],
      visaRefs: allVisaRefs,
      isPremium: isPremium ?? false,
      requiredFacts: requiredFacts ?? [],
      subTheme,
      expectedLexicon: expectedLexicon ?? [],
      forcedArticles,
    }
  } catch (err) {
    console.error('[judilibre] fetchJurisprudence — exception :', err)
    return { available: false, text: '', cases: [], decisions: [], visaRefs: [], isPremium: false, requiredFacts: [], expectedLexicon: [] }
  }
}
