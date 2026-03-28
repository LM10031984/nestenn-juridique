/**
 * scripts/index-new-articles.ts
 * Indexer un batch de nouveaux articles depuis Légifrance
 *
 * Supporte les codes (CODE_DATE — tableMatieres) et les lois LODA (LODA_DATE — legiPart).
 *
 * Usage :
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/index-new-articles.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/index-new-articles.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const PISTE_TOKEN_URL = 'https://oauth.piste.gouv.fr/api/oauth/token'
const PISTE_API_BASE  = process.env.PISTE_API_URL ?? 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app'
const NOMIC_API_URL   = 'https://api-atlas.nomic.ai/v1/embedding/text'
const OPENROUTER_URL  = 'https://openrouter.ai/api/v1/chat/completions'
const TODAY           = new Date().toISOString().split('T')[0]

const DRY_RUN = process.argv.includes('--dry-run')

// =============================================================================
// ÉDITE ICI — articles à indexer
// fond: 'CODE_DATE' pour les codes, 'LODA_DATE' pour les lois
// =============================================================================
interface ArticleEntry {
  law: string
  legitextId: string
  fond: 'CODE_DATE' | 'LODA_DATE'
  articles: string[]
  domain: string
}

const TO_INDEX: ArticleEntry[] = [

  // ═══════════════════════════════════════════════════════════════
  // TUTELLE / CAPACITÉ JURIDIQUE (lacune identifiée en prod)
  // ═══════════════════════════════════════════════════════════════
  // 425=ouverture mesure  440=choix tuteur  473=représentation majeur
  // 475-476=actes tuteur  505=autorisation juge  507=conseil de famille  509=inventaire
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['425', '440', '473', '475', '476', '505', '507', '509'], domain: 'transactions' },

  // Curatelle — 467=simple  468=renforcée  469=actes interdits au curateur seul
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['467', '468', '469'], domain: 'transactions' },

  // Habilitation familiale
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['494-1', '494-6', '494-9'], domain: 'transactions' },

  // Nullité des actes du majeur protégé — 414-1=insanité  465=nullité
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['414-1', '414-2', '465'], domain: 'transactions' },


  // ═══════════════════════════════════════════════════════════════
  // CODE CIVIL — CONTRATS / VENTE / OBLIGATIONS
  // ═══════════════════════════════════════════════════════════════

  // Consentement et vices — 1104=bonne foi  1112-1=obligation info précontractuelle
  // 1130=vices consentement  1131=erreur/dol  1137=dol  1139=violence
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['1104', '1112-1', '1130', '1131', '1137', '1139'], domain: 'transactions' },

  // Promesse et compromis — 1124=promesse unilatérale  1128=conditions validité
  // 1186-1187=caducité  1195=imprévision  1217=inexécution
  // 1231-5=clause pénale  1583=perfection vente  1589=promesse vaut vente
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['1124', '1128', '1186', '1187', '1193', '1195', '1217', '1231-5', '1583', '1589'], domain: 'transactions' },

  // Cession de contrat / substitution
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['1216', '1216-1', '1216-3'], domain: 'transactions' },

  // Responsabilité civile
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['1240', '1241', '1242', '1244'], domain: 'transactions' },

  // Vices cachés
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['1641', '1643', '1644', '1645', '1648'], domain: 'transactions' },

  // Garantie d'éviction
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['1625', '1626', '1630'], domain: 'transactions' },

  // Prescription
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['2224', '2232'], domain: 'litiges' },

  // Mise en demeure
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['1344', '1345'], domain: 'litiges' },

  // Conflit d'intérêts (double mandat)
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['1161'], domain: 'agent_immobilier' },

  // Mandat (droit commun)
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['1984', '1998', '2003', '2004'], domain: 'agent_immobilier' },

  // Lésion
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['1674', '1675', '1681'], domain: 'transactions' },


  // ═══════════════════════════════════════════════════════════════
  // CODE CIVIL — PROPRIÉTÉ / SERVITUDES / VOISINAGE
  // ═══════════════════════════════════════════════════════════════

  // Servitudes — 637=définition  682-685=droit de passage (enclave)
  // 686=servitude conventionnelle  701=étendue
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['637', '682', '683', '685', '686', '701'], domain: 'servitudes' },

  // Vues et distances
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['675', '676', '678', '679'], domain: 'servitudes' },

  // Mitoyenneté
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['653', '654', '655', '657', '661'], domain: 'servitudes' },

  // Usufruit — 578=définition  595=location  596=bail rural/commercial
  // 605-606=réparations (entretien vs grosses)
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['578', '595', '596', '599', '600', '605', '606'], domain: 'viager_demembrement' },

  // Viager
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['1968', '1975', '1976', '1977', '1978', '1983'], domain: 'viager_demembrement' },

  // Indivision — 815=nul ne peut être contraint  815-3=majorité 2/3
  // 815-5=actes conservatoires  815-5-1=vente judiciaire  815-6=autorisation judiciaire
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['815', '815-3', '815-5', '815-5-1', '815-6'], domain: 'transactions' },

  // Construction / garanties
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['1792', '1792-2', '1792-3', '1792-4-1', '1792-6'], domain: 'construction' },

  // SCI
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['1832', '1845', '1852', '1856'], domain: 'fiscalite' },


  // ═══════════════════════════════════════════════════════════════
  // LOI HOGUET + DÉCRET (agent immobilier)
  // ═══════════════════════════════════════════════════════════════
  { law: 'loi 70-9', legitextId: 'LEGITEXT000006068387', fond: 'LODA_DATE', articles: ['1', '3', '4', '6', '6-1', '7', '8', '8-1'], domain: 'agent_immobilier' },
  // 78=durée mandat exclusif (3 mois irrévocable)  79-80=registre des mandats
  { law: 'décret 72-678', legitextId: 'LEGITEXT000006061974', fond: 'LODA_DATE', articles: ['72', '78', '79', '80'], domain: 'agent_immobilier' },


  // ═══════════════════════════════════════════════════════════════
  // LOI 89-462 (baux d'habitation)
  // ═══════════════════════════════════════════════════════════════
  { law: 'loi 89-462', legitextId: 'LEGITEXT000006069108', fond: 'LODA_DATE', articles: [
    '3', '3-2', '3-3',           // contenu bail, état des lieux
    '6', '7',                    // obligations bailleur / locataire
    '8', '8-1',                  // sous-location, colocation
    '10', '11', '12',            // durée, reconduction, résiliation locataire
    '14',                        // décès locataire (transfert bail)
    '15',                        // congé bailleur (vente, reprise, motif)
    '17', '17-1', '17-2',       // fixation loyer, révision IRL, renouvellement
    '22',                        // dépôt de garantie
    '23',                        // charges récupérables
    '24', '24-1',               // clause résolutoire, impayés
    '25-3', '25-7', '25-8',    // bail meublé
    '25-12', '25-13', '25-18', // bail mobilité
  ], domain: 'baux_habitation' },


  // ═══════════════════════════════════════════════════════════════
  // LOI 65-557 (copropriété)
  // ═══════════════════════════════════════════════════════════════
  { law: 'loi 65-557', legitextId: 'LEGITEXT000006068256', fond: 'LODA_DATE', articles: [
    '2', '3', '4',              // parties communes, privatives
    '8',                        // règlement de copropriété
    '10', '10-1',               // charges, fonds travaux
    '14', '14-1', '14-2',      // syndicat, administrateur provisoire
    '17', '17-2',               // décisions AG, syndic bénévole
    '18', '18-1 A',            // syndic (contrat, prestations)
    '21',                       // mise en concurrence
    '24', '25', '25-1', '26', // majorités
    '42',                       // contestation décisions AG
    '46',                       // mesurage Carrez
  ], domain: 'copropriete' },

  // Décret copropriété — 9=délai convocation AG (21j)  11=contenu convocation  13=feuille présence
  { law: 'décret 67-223', legitextId: 'LEGITEXT000006061423', fond: 'LODA_DATE', articles: ['9', '11', '13', '64'], domain: 'copropriete' },


  // ═══════════════════════════════════════════════════════════════
  // CCH (Code de la construction et de l'habitation)
  // ═══════════════════════════════════════════════════════════════
  { law: 'cch', legitextId: 'LEGITEXT000006074096', fond: 'CODE_DATE', articles: [
    'L271-1', 'L271-2',         // rétractation SRU (10 jours)
    'L271-4', 'L271-5', 'L271-6', // DDT (dossier diagnostics)
    'L126-26', 'L126-28',      // DPE
    'L721-2', 'L721-3',        // documents vente copro (pré-état daté)
    'L631-7',                   // changement d'usage (meublé tourisme)
  ], domain: 'diagnostics' },


  // ═══════════════════════════════════════════════════════════════
  // CODE DE L'URBANISME
  // ═══════════════════════════════════════════════════════════════
  { law: "code de l'urbanisme", legitextId: 'LEGITEXT000006074075', fond: 'CODE_DATE', articles: [
    'L210-1',                   // droit de préemption urbain
    'L213-1', 'L213-2', 'L213-4', 'L213-7', 'L213-8', // procédure préemption
    'L410-1',                   // certificat d'urbanisme
    'L151-1',                   // PLU
    'L141-8',                   // ZAN
    'R421-9',                   // déclaration préalable (R421-1 non indexable via tableMatieres)
    'R423-24',                  // délai instruction permis (R423-23/25 idem)
  ], domain: 'urbanisme' },


  // ═══════════════════════════════════════════════════════════════
  // CODE DE COMMERCE (bail commercial)
  // ═══════════════════════════════════════════════════════════════
  { law: 'commerce', legitextId: 'LEGITEXT000005634379', fond: 'CODE_DATE', articles: [
    'L145-1', 'L145-4',        // champ d'application, durée 3-6-9
    'L145-9', 'L145-10',       // renouvellement, droit au maintien
    'L145-14',                  // indemnité d'éviction
    'L145-16',                  // cession du bail
    'L145-33', 'L145-34',     // révision du loyer
    'L145-41',                  // clause résolutoire
    'L145-47',                  // sous-location
  ], domain: 'bail_commercial' },


  // ═══════════════════════════════════════════════════════════════
  // CGI (Code général des impôts)
  // Note : CGI utilise des espaces dans la numérotation (ex: "150 U" pas "150-U")
  // ═══════════════════════════════════════════════════════════════
  { law: 'cgi', legitextId: 'LEGITEXT000006069577', fond: 'CODE_DATE', articles: [
    '150 U', '150 VB', '150 VC', // plus-value immobilière
    '199 novovicies',            // Pinel / Denormandie
    '257',                       // TVA immobilière (neuf)
    '683',                       // droits de mutation
    '1594 D',                    // taux départemental
    '964',                       // IFI
    '1380', '1383',              // taxe foncière
  ], domain: 'fiscalite' },


  // ═══════════════════════════════════════════════════════════════
  // CODE DE LA CONSOMMATION
  // ═══════════════════════════════════════════════════════════════
  { law: 'code de la consommation', legitextId: 'LEGITEXT000006069565', fond: 'CODE_DATE', articles: [
    'L313-40', 'L313-41', 'L313-42', // condition suspensive prêt
  ], domain: 'transactions' },


  // ═══════════════════════════════════════════════════════════════
  // CODE DE PROCÉDURE CIVILE
  // ═══════════════════════════════════════════════════════════════
  { law: 'cpc', legitextId: 'LEGITEXT000006070716', fond: 'CODE_DATE', articles: [
    '750-1',                    // médiation préalable obligatoire
    '755', '756',               // assignation (délai, contenu)
    '817',                      // mise en état
    '834', '835',               // référé
  ], domain: 'litiges' },


  // ═══════════════════════════════════════════════════════════════
  // CPCE (procédures civiles d'exécution)
  // ═══════════════════════════════════════════════════════════════
  { law: 'cpce', legitextId: 'LEGITEXT000025024948', fond: 'CODE_DATE', articles: [
    'L411-1',                   // expulsion (titre exécutoire)
    'L412-1', 'L412-3', 'L412-6', // délais expulsion, trêve hivernale
  ], domain: 'baux_habitation' },


  // ═══════════════════════════════════════════════════════════════
  // CODE DE L'ENVIRONNEMENT
  // ═══════════════════════════════════════════════════════════════
  { law: "code de l'environnement", legitextId: 'LEGITEXT000006074220', fond: 'CODE_DATE', articles: [
    'L125-5',                   // ERP (état des risques)
  ], domain: 'diagnostics' },


  // ═══════════════════════════════════════════════════════════════
  // CODE DE LA SANTÉ PUBLIQUE
  // ═══════════════════════════════════════════════════════════════
  { law: 'code de la santé publique', legitextId: 'LEGITEXT000006072665', fond: 'CODE_DATE', articles: [
    'L1334-5', 'L1334-7',      // plomb / CREP
    'L1334-13',                 // amiante
  ], domain: 'diagnostics' },


  // ═══════════════════════════════════════════════════════════════
  // DÉCRETS SPÉCIFIQUES
  // ═══════════════════════════════════════════════════════════════

  // Liste des charges récupérables
  { law: 'décret 87-713', legitextId: 'LEGITEXT000006063573', fond: 'LODA_DATE', articles: ['1'], domain: 'baux_habitation' },

  // Décence du logement
  { law: 'décret 2002-120', legitextId: 'LEGITEXT000005620810', fond: 'LODA_DATE', articles: ['1', '2', '3'], domain: 'baux_habitation' },

  // Grille de vétusté
  { law: 'décret 2016-382', legitextId: 'LEGITEXT000032324415', fond: 'LODA_DATE', articles: ['1', '2'], domain: 'baux_habitation' },

  // ALUR (articles spécifiques)
  { law: 'loi 2014-366', legitextId: 'LEGITEXT000028775733', fond: 'LODA_DATE', articles: ['1', '24', '25', '68', '149'], domain: 'baux_habitation' },

  // ELAN
  { law: 'loi 2018-1021', legitextId: 'LEGITEXT000037642121', fond: 'LODA_DATE', articles: ['107', '139', '157'], domain: 'baux_habitation' },

  // Climat et Résilience
  { law: 'loi 2021-1104', legitextId: 'LEGITEXT000043957598', fond: 'LODA_DATE', articles: ['148', '158', '160'], domain: 'diagnostics' },
]
// =============================================================================

// ── PISTE OAuth ───────────────────────────────────────────────────────────────

let _cachedToken: { token: string; expiresAt: number } | null = null

async function getPisteToken(): Promise<string> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt) return _cachedToken.token
  const res = await fetch(PISTE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     process.env.PISTE_CLIENT_ID ?? '',
      client_secret: process.env.PISTE_CLIENT_SECRET ?? '',
      scope:         'openid',
    }),
  })
  if (!res.ok) throw new Error(`PISTE token error: ${res.status}`)
  const data = await res.json() as { access_token: string; expires_in: number }
  _cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 }
  return _cachedToken.token
}

// ── Map LEGITEXT → NOM_CODE (pour filtre API /search) ────────────────────────

const CODE_NAMES: Record<string, string> = {
  'LEGITEXT000006070721': 'Code civil',
  'LEGITEXT000006074096': "Code de la construction et de l'habitation",
  'LEGITEXT000006074075': "Code de l'urbanisme",
  'LEGITEXT000006069565': 'Code de la consommation',
  'LEGITEXT000006069577': 'Code général des impôts',
  'LEGITEXT000006070716': 'Code de procédure civile',
  'LEGITEXT000025024948': "Code des procédures civiles d'exécution",
  'LEGITEXT000006069719': 'Code pénal',
  'LEGITEXT000006072026': 'Code monétaire et financier',
  'LEGITEXT000005634379': 'Code de commerce',
  'LEGITEXT000006074220': "Code de l'environnement",
  'LEGITEXT000006072665': 'Code de la santé publique',
}

// ── CODE_DATE : tableMatieres → LEGIARTI ID, fallback /search NUM_ARTICLE ─────

function collectSectionArticles(node: any, out: Array<{ id: string; num: string }> = []): Array<{ id: string; num: string }> {
  for (const art of (node?.articles ?? [])) {
    if (art.id) out.push({ id: art.id, num: art.num ?? '' })
  }
  for (const sub of (node?.sections ?? [])) collectSectionArticles(sub, out)
  return out
}

async function findLegiartiInCode(token: string, legitextId: string, articleNum: string): Promise<string | null> {
  // Tentative 1 : tableMatieres (rapide, couvre la majorité des codes)
  try {
    const res = await fetch(`${PISTE_API_BASE}/consult/code/tableMatieres`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ textId: legitextId, date: TODAY, pageSize: 200, searchArticle: articleNum }),
      signal: AbortSignal.timeout(12000),
    })
    if (res.ok) {
      const data = await res.json() as { sections?: any[] }
      const allArts = collectSectionArticles({ sections: data.sections ?? [] })
      const found = allArts.find(a =>
        a.num === articleNum || a.num === articleNum.toUpperCase()
      )
      if (found) return found.id
    }
  } catch { /* fallback */ }

  // Tentative 2 : /search avec NUM_ARTICLE + NOM_CODE (couvre CGI, CPC, etc.)
  const codeName = CODE_NAMES[legitextId]
  if (codeName) {
    try {
      const res = await fetch(`${PISTE_API_BASE}/search`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fond: 'CODE_DATE',
          recherche: {
            champs: [{
              typeChamp: 'NUM_ARTICLE',
              criteres: [{ typeRecherche: 'EXACTE', valeur: articleNum, operateur: 'ET' }],
              operateur: 'ET',
            }],
            filtres: [
              { facette: 'TEXT_LEGAL_STATUS', valeur: 'VIGUEUR' },
              { facette: 'NOM_CODE', valeur: codeName },
            ],
            pageNumber: 1,
            pageSize: 5,
            operateur: 'ET',
            typePagination: 'DEFAUT',
          },
        }),
        signal: AbortSignal.timeout(12000),
      })
      if (res.ok) {
        const data = await res.json() as { results?: Array<{ id: string; sections?: Array<{ extracts?: Array<{ id: string }> }> }> }
        const firstResult = data.results?.[0]
        // L'id dans results est souvent l'id du texte, pas de l'article
        // On cherche dans sections/extracts
        const artId = firstResult?.sections?.[0]?.extracts?.[0]?.id
        if (artId) return artId
      }
    } catch { /* fallback */ }
  }

  return null
}

// ── LODA_DATE : legiPart → arbre → LEGIARTI ID ────────────────────────────────

function collectArticles(node: any, out: Array<{ id: string; num: string }> = []): Array<{ id: string; num: string }> {
  for (const art of (node?.articles ?? [])) {
    const etat = (art.etat ?? '').toUpperCase()
    if ((etat === 'VIGUEUR' || etat === 'VIGUEUR_ETEN') && art.id) {
      out.push({ id: art.id, num: art.num ?? '' })
    }
  }
  for (const section of (node?.sections ?? [])) collectArticles(section, out)
  return out
}

async function findLegiartiInLoda(token: string, legitextId: string, articleNum: string): Promise<string | null> {
  const res = await fetch(`${PISTE_API_BASE}/consult/legiPart`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ textId: legitextId, date: TODAY }),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) return null
  const data = await res.json()
  const root = data?.texteConsolide ?? data?.texte ?? data
  const articles = collectArticles(root)
  const found = articles.find(
    a => a.num === articleNum || a.num === articleNum.toUpperCase()
  )
  return found?.id ?? null
}

// ── getArticle : texte complet ─────────────────────────────────────────────────

async function fetchArticleText(
  token: string,
  legiartiId: string,
  fond: 'CODE_DATE' | 'LODA_DATE'
): Promise<{ texte: string; url: string } | null> {
  const res = await fetch(`${PISTE_API_BASE}/consult/getArticle`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: legiartiId }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return null
  const data = await res.json() as { article?: { texte?: string; etat?: string } }
  const texte = data.article?.texte?.replace(/<[^>]+>/g, ' ').trim() ?? ''
  if (texte.length < 20 || data.article?.etat === 'ABROGE') return null
  const urlType = fond === 'CODE_DATE' ? 'codes' : 'loda'
  return { texte, url: `https://www.legifrance.gouv.fr/${urlType}/article_lc/${legiartiId}` }
}

// ── LLM summarize ─────────────────────────────────────────────────────────────

async function summarize(articleNum: string, law: string, texte: string): Promise<{
  situation: string; principe: string; consequence: string
} | null> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://nestenn.com',
      'X-Title':      'Nestenn Juridique',
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      max_tokens: 350,
      messages: [
        {
          role: 'system',
          content: `Tu es juriste spécialisé en droit immobilier français.
Résume cet article en 3 champs JSON stricts (pas de markdown) :
- situation : quand cet article s'applique (contexte agent immobilier, locataire, acheteur, etc.)
- principe : la règle ou obligation principale, formulée clairement
- consequence : ce qui se passe si non-respecté ou l'effet pratique
Réponds UNIQUEMENT avec du JSON valide : {"situation":"...","principe":"...","consequence":"..."}`,
        },
        { role: 'user', content: `Article ${articleNum} — ${law}\n\n${texte.slice(0, 2000)}` },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) return null
  const data = await res.json() as { choices?: Array<{ message: { content: string } }> }
  const raw = data.choices?.[0]?.message?.content?.trim() ?? ''
  return JSON.parse(raw)
}

// ── Embedding Nomic ───────────────────────────────────────────────────────────

async function embed(text: string): Promise<number[] | null> {
  const res = await fetch(NOMIC_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.NOMIC_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nomic-embed-text-v1.5', texts: [text] }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) return null
  const data = await res.json() as { embeddings: number[][] }
  return data.embeddings?.[0] ?? null
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== INDEXATION NOUVEAUX ARTICLES${DRY_RUN ? ' (DRY-RUN)' : ''} ===\n`)

  const token = await getPisteToken()
  let indexed = 0
  let skipped = 0
  let errors  = 0
  const total  = TO_INDEX.reduce((s, e) => s + e.articles.length, 0)
  let done     = 0

  for (const entry of TO_INDEX) {
    for (const artNum of entry.articles) {
      done++
      const lawId = entry.legitextId

      // Vérifier si déjà indexé
      const { count } = await supabase
        .from('legal_articles')
        .select('*', { count: 'exact', head: true })
        .eq('law_id', lawId)
        .ilike('article_num', artNum)
        .is('deleted_at', null)

      if ((count ?? 0) > 0) {
        console.log(`[${done}/${total}] ⏭️  ${entry.law} art. ${artNum} — déjà indexé`)
        skipped++
        continue
      }

      process.stdout.write(`[${done}/${total}] 📥 ${entry.law} art. ${artNum}...`)

      if (DRY_RUN) {
        console.log(' (dry-run)')
        indexed++
        continue
      }

      try {
        // Résolution LEGIARTI ID selon le fond
        let legiartiId: string | null
        if (entry.fond === 'LODA_DATE') {
          legiartiId = await findLegiartiInLoda(token, lawId, artNum)
        } else {
          legiartiId = await findLegiartiInCode(token, lawId, artNum)
        }
        if (!legiartiId) { console.log(' ⚠️  LEGIARTI introuvable'); errors++; continue }

        // Fetch texte
        const articleData = await fetchArticleText(token, legiartiId, entry.fond)
        if (!articleData) { console.log(' ⚠️  texte vide ou abrogé'); errors++; continue }

        // Résumé LLM
        const summary = await summarize(artNum, entry.law, articleData.texte)
        if (!summary) { console.log(' ⚠️  résumé LLM échoué'); errors++; continue }

        // Embedding
        const embeddingText = `${summary.situation} ${summary.principe} ${summary.consequence}`
        const embedding = await embed(embeddingText)
        if (!embedding) { console.log(' ⚠️  embedding échoué'); errors++; continue }

        // Upsert
        const { error } = await supabase.from('legal_articles').upsert({
          law_id:          lawId,
          article_num:     artNum,
          title:           `Art. ${artNum} — ${entry.law}`,
          content:         articleData.texte,
          content_summary: JSON.stringify(summary),
          date_version:    TODAY,
          url:             articleData.url,
          domain:          entry.domain,
          sub_themes:      [],
          in_force:        true,
          embedding,
        }, { onConflict: 'law_id,article_num' })

        if (error) { console.log(` ❌ ${error.message}`); errors++ }
        else       { console.log(' ✅ indexé'); indexed++ }

      } catch (err) {
        console.log(` ❌ exception: ${err}`)
        errors++
      }

      // Pause anti-rate-limit
      await new Promise(r => setTimeout(r, 200))
    }
  }

  console.log(`\n=== RÉSULTAT ===`)
  console.log(`Indexés      : ${indexed}${DRY_RUN ? ' (dry-run)' : ''}`)
  console.log(`Déjà en base : ${skipped}`)
  console.log(`Erreurs      : ${errors}`)
  console.log(`Total        : ${total}\n`)
}

main().catch(console.error)
