/**
 * scripts/index-judilibre.ts
 * Indexation Judilibre → Supabase pgvector (production-grade)
 *
 * Améliorations v2 :
 *   - Texte intégral via /decision pour CC ET CA
 *   - Toutes les zones texte (introduction + moyens + motivations + dispositif)
 *   - OpenRouter GPT-4o-mini pour résumés experts (vs Llama 3.2:3b)
 *   - Prompt juridique riche : situation 2-3 phrases, principe avec articles, conséquence actionnable
 *   - Sub-themes classifiés depuis le contenu (1 seul appel LLM)
 *   - visa_refs extraits de la décision complète (CC + CA)
 *   - Concurrence x3 + retry backoff pour robustesse
 *
 * Usage :
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/index-judilibre.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/index-judilibre.ts --limit 7 --domain baux_habitation
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/index-judilibre.ts --dry-run
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/index-judilibre.ts --reindex   # réindexe même les existants
 */

import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const LIMIT_PER_DOMAIN = args.includes('--limit')   ? parseInt(args[args.indexOf('--limit') + 1])   : 50
const TARGET_DOMAIN    = args.includes('--domain')  ? args[args.indexOf('--domain') + 1]             : null
const DRY_RUN          = args.includes('--dry-run')
const REINDEX          = args.includes('--reindex')  // force re-traitement des déjà indexés
const CONCURRENCY      = 3                           // décisions traitées en parallèle

console.log(`Config : limit=${LIMIT_PER_DOMAIN} domain=${TARGET_DOMAIN ?? 'all'} dry-run=${DRY_RUN} reindex=${REINDEX} model=gpt-4o-mini (OpenRouter)`)

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const JUDILIBRE_URL = 'https://api.piste.gouv.fr/cassation/judilibre/v1.0'
const TOKEN_URL     = 'https://oauth.piste.gouv.fr/api/oauth/token'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const SUMMARY_MODEL  = 'openai/gpt-4o-mini'

// ---------------------------------------------------------------------------
// Taxonomie — 14 domaines
// ---------------------------------------------------------------------------

interface DomainConfig {
  id: string
  label: string
  ccQuery: string
  ccChamber?: string
  caQuery: string
  subThemes: string[]
}

const DOMAINS: DomainConfig[] = [
  {
    id: 'baux_habitation',
    label: 'Baux d\'habitation',
    ccQuery: 'bail habitation loyer impayé dépôt garantie expulsion congé clause résolutoire',
    ccChamber: 'civ3',
    caQuery: 'bail habitation loyer dépôt garantie expulsion congé',
    subThemes: ['loyer', 'irl', 'depot_garantie', 'conge', 'impaye', 'clause_resolutoire', 'expulsion', 'decence', 'vetuste', 'edl', 'treve_hivernale', 'bail_meuble', 'bail_mobilite', 'encadrement_loyers'],
  },
  {
    id: 'copropriete',
    label: 'Copropriété',
    ccQuery: 'copropriété syndic assemblée générale charges travaux parties communes règlement',
    ccChamber: 'civ3',
    caQuery: 'copropriété syndic assemblée générale charges travaux parties communes',
    subThemes: ['ag', 'charges', 'syndic', 'travaux', 'parties_communes', 'reglement', 'tantiemes', 'contestation_ag'],
  },
  {
    id: 'agent_immobilier',
    label: 'Agent immobilier',
    ccQuery: 'agent immobilier mandat commission honoraires devoir conseil responsabilité carte T',
    ccChamber: 'civ1',
    caQuery: 'agent immobilier mandat commission honoraires devoir conseil responsabilité',
    subThemes: ['mandat', 'commission', 'honoraires', 'devoir_conseil', 'responsabilite', 'carte_t'],
  },
  {
    id: 'vente_immobiliere',
    label: 'Vente immobilière',
    ccQuery: 'vente immobilière compromis promesse condition suspensive vice caché garantie rétractation',
    ccChamber: 'civ3',
    caQuery: 'vente immobilière compromis promesse condition suspensive vice caché garantie',
    subThemes: ['compromis', 'promesse', 'condition_suspensive', 'retractation', 'vice_cache', 'vefa', 'garanties'],
  },
  {
    id: 'diagnostics',
    label: 'Diagnostics immobiliers',
    ccQuery: 'diagnostic immobilier DPE amiante plomb Carrez responsabilité diagnostiqueur',
    caQuery: 'diagnostiqueur DPE responsabilité diagnostic immobilier',
    subThemes: ['dpe', 'amiante', 'plomb', 'termites', 'electricite', 'gaz', 'carrez', 'responsabilite_diagnostiqueur'],
  },
  {
    id: 'urbanisme',
    label: 'Urbanisme',
    ccQuery: 'permis construire PLU préemption droit préférence urbanisme recours',
    ccChamber: 'civ3',
    caQuery: 'permis construire PLU préemption droit préférence urbanisme',
    subThemes: ['permis_construire', 'plu', 'preemption', 'droit_preference', 'recours_tiers'],
  },
  {
    id: 'construction',
    label: 'Construction',
    ccQuery: 'garantie décennale biennale parfait achèvement réception réserves maître ouvrage VEFA',
    ccChamber: 'civ3',
    caQuery: 'garantie décennale biennale parfait achèvement réception réserves maître ouvrage',
    subThemes: ['decennale', 'biennale', 'parfait_achevement', 'vefa', 'reception', 'reserves'],
  },
  {
    id: 'consommation',
    label: 'Droit de la consommation',
    ccQuery: 'crédit immobilier TAEG prêt rétractation clause abusive Scrivener SRU',
    ccChamber: 'civ1',
    caQuery: 'crédit immobilier TAEG prêt rétractation clause abusive Scrivener',
    subThemes: ['scrivener', 'retractation', 'taeg', 'pret_immobilier', 'clauses_abusives'],
  },
  {
    id: 'fiscalite',
    label: 'Fiscalité immobilière',
    ccQuery: 'plus-value immobilière droits mutation IFI revenus fonciers SCI TVA immobilière LMNP',
    caQuery: 'plus-value immobilière droits mutation fiscalité immobilière SCI',
    subThemes: ['plus_values', 'droits_mutation', 'ifi', 'revenus_fonciers', 'lmnp', 'sci_fiscal', 'tva_immo'],
  },
  {
    id: 'sci_societes',
    label: 'SCI / Sociétés',
    ccQuery: 'SCI société civile immobilière gérance statuts cession parts dissolution démembrement',
    ccChamber: 'comm',
    caQuery: 'SCI société civile immobilière gérance statuts cession parts dissolution',
    subThemes: ['creation_sci', 'statuts', 'gerance', 'cession_parts', 'dissolution', 'sci_familiale', 'demembrement'],
  },
  {
    id: 'droit_social',
    label: 'Droit social agents',
    ccQuery: 'agent commercial immobilier rupture contrat indemnité compensatrice VRP clause non-concurrence',
    caQuery: 'agent commercial immobilier statut rupture indemnité clause non-concurrence',
    subThemes: ['statut_agent_commercial', 'rupture_contrat', 'indemnite_compensatrice', 'vrp', 'clause_non_concurrence'],
  },
  {
    id: 'responsabilite_civile',
    label: 'Responsabilité civile',
    ccQuery: 'responsabilité agent immobilier réticence dolosive défaut information préjudice faute',
    ccChamber: 'civ1',
    caQuery: 'responsabilité agent immobilier réticence dolosive défaut information préjudice',
    subThemes: ['faute_agent', 'reticence_dolosive', 'defaut_conseil', 'manquement_information', 'prejudice'],
  },
  {
    id: 'rgpd_prospection',
    label: 'RGPD / Prospection',
    ccQuery: 'Bloctel prospection téléphonique RGPD consentement fichier client CNIL',
    caQuery: 'Bloctel prospection téléphonique consentement CNIL données personnelles',
    subThemes: ['bloctel', 'prospection', 'consentement', 'cnil', 'opt_in'],
  },
  {
    id: 'viager_demembrement',
    label: 'Viager / Démembrement',
    ccQuery: 'viager rente viagère bouquet usufruit nue-propriété démembrement réversion',
    ccChamber: 'civ3',
    caQuery: 'viager rente viagère bouquet usufruit nue-propriété démembrement réversion',
    subThemes: ['usufruit', 'nue_propriete', 'rente_viagere', 'bouquet', 'clause_resolutoire_viager', 'reversion'],
  },
  {
    id: 'bail_commercial',
    label: 'Bail commercial',
    ccQuery: 'bail commercial loyer renouvellement résiliation droit au bail indemnité éviction déspécialisation',
    ccChamber: 'comm',
    caQuery: 'bail commercial loyer renouvellement résiliation droit au bail indemnité éviction',
    subThemes: ['duree_369', 'renouvellement', 'revision_loyer', 'resiliation', 'droit_au_bail', 'indemnite_eviction', 'despecialisation'],
  },
  {
    id: 'location_saisonniere',
    label: 'Location saisonnière',
    ccQuery: 'meublé tourisme location saisonnière Airbnb changement usage compensation enregistrement',
    caQuery: 'meublé tourisme location saisonnière changement usage compensation numéro enregistrement',
    subThemes: ['declaration_mairie', 'enregistrement', 'changement_usage', 'compensation', 'classement', 'taxe_sejour'],
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
      console.warn(`  [RETRY ${attempt}/${retries}] ${label} — attente ${delay}ms`)
      await sleep(delay)
    }
  }
  return null
}

// Semaphore simple pour limiter la concurrence
function createSemaphore(limit: number) {
  let active = 0
  const queue: Array<() => void> = []
  return async function acquire(): Promise<() => void> {
    if (active < limit) {
      active++
      return () => {
        active--
        queue.shift()?.()
      }
    }
    await new Promise<void>(resolve => queue.push(resolve))
    active++
    return () => {
      active--
      queue.shift()?.()
    }
  }
}

// ---------------------------------------------------------------------------
// Auth Judilibre
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
  if (!res.ok) throw new Error(`Token OAuth échoué : ${res.status}`)
  const data = await res.json() as { access_token: string; expires_in: number }
  _token = data.access_token
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
  return _token
}

// ---------------------------------------------------------------------------
// Judilibre — Search
// ---------------------------------------------------------------------------

async function searchCC(token: string, domain: DomainConfig, page: number): Promise<any[]> {
  const params = new URLSearchParams({
    query: domain.ccQuery,
    page_size: '10',
    page_number: String(page),
    operator: 'or',
    sort: 'scorepub',
    resolve_references: 'false',
  })
  if (domain.ccChamber) params.append('chamber', domain.ccChamber)
  params.append('publication', 'b')
  params.append('publication', 'r')
  params.append('field', 'summary')
  params.append('field', 'motivations')
  params.append('type', 'arret')

  const res = await fetch(`${JUDILIBRE_URL}/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return []
  const data = await res.json() as { results?: any[] }
  return data.results ?? []
}

async function searchCA(token: string, domain: DomainConfig, page: number): Promise<any[]> {
  const params = new URLSearchParams({
    query: domain.caQuery,
    jurisdiction: 'ca',
    operator: 'and',
    page_size: '10',
    page_number: String(page),
    sort: 'score',
    resolve_references: 'false',
  })
  params.append('field', 'summary')
  params.append('field', 'motivations')

  const res = await fetch(`${JUDILIBRE_URL}/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return []
  const data = await res.json() as { results?: any[] }
  return data.results ?? []
}

// ---------------------------------------------------------------------------
// Judilibre — Décision complète (CC + CA)
// ---------------------------------------------------------------------------

async function getDecision(token: string, id: string): Promise<any | null> {
  return withRetry(async () => {
    const res = await fetch(
      `${JUDILIBRE_URL}/decision?id=${encodeURIComponent(id)}&resolve_references=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) throw new Error(`/decision ${id} → HTTP ${res.status}`)
    return res.json()
  }, 3, 800, `getDecision(${id})`)
}

// ---------------------------------------------------------------------------
// Judilibre — Extraction de texte intégral depuis toutes les zones
// ---------------------------------------------------------------------------

function extractFullText(decision: any, highlightFallback: string): { text: string; visaRefs: string[] } {
  const zones = decision?.zones ?? {}
  const rawText: string = decision?.text ?? ''   // texte intégral de la décision

  // Zones pertinentes dans l'ordre de lecture logique
  const zoneOrder = ['introduction', 'expose', 'expose_litige', 'moyens', 'motivations', 'dispositif', 'texte', 'resume']
  const parts: string[] = []

  for (const zoneName of zoneOrder) {
    const zone = zones[zoneName]
    if (!zone) continue
    const entries = Array.isArray(zone) ? zone : [zone]
    for (const entry of entries) {
      // Cas 1 : la zone contient directement du texte (ancien format)
      const directText = entry?.texte ?? entry?.text ?? (typeof entry === 'string' ? entry : null)
      if (directText && directText.length > 20) {
        parts.push(directText.trim())
        continue
      }
      // Cas 2 : la zone contient des ranges {start, end} dans decision.text (format actuel API)
      if (typeof entry?.start === 'number' && typeof entry?.end === 'number' && rawText) {
        const slice = rawText.slice(entry.start, entry.end).trim()
        if (slice.length > 20) parts.push(slice)
      }
    }
  }

  // Fallback : titlesAndSummaries ou highlights
  if (parts.length === 0) {
    const ts = decision?.titlesAndSummaries
    if (ts) {
      const summaryText = [ts.introduction, ts.decision].filter(Boolean).join('\n')
      if (summaryText.length > 50) parts.push(summaryText)
    }
  }

  // Dernier fallback : utiliser rawText directement (sans annexes)
  if (parts.length === 0 && rawText.length > 100) {
    const annexeStart = zones.annexes?.[0]?.start ?? rawText.length
    parts.push(rawText.slice(0, Math.min(annexeStart, 6000)).trim())
  }

  const fullText = parts.join('\n\n').trim() || highlightFallback

  // Extraction visa_refs depuis la décision
  const visaRefs: string[] = []
  if (Array.isArray(decision?.visa)) {
    for (const v of decision.visa) {
      const ref = [v.titre ?? v.code ?? '', v.article ?? v.num ?? ''].filter(Boolean).join(' art. ').trim()
      if (ref && ref.length > 3) visaRefs.push(ref)
    }
  }
  // Aussi dans zones.visa si présent
  if (Array.isArray(zones.visa)) {
    for (const entry of zones.visa) {
      const text = entry?.texte ?? entry?.text ?? ''
      if (text && text.length > 3 && !visaRefs.includes(text)) visaRefs.push(text.trim())
    }
  }

  return { text: fullText, visaRefs: [...new Set(visaRefs)] }
}

// ---------------------------------------------------------------------------
// OpenRouter — Résumé expert juridique + classification sub-thèmes
// ---------------------------------------------------------------------------

interface LLMSummary {
  situation:  string
  principe:   string
  consequence: string
  sub_themes: string[]
}

const SYSTEM_PROMPT = `Tu es un juriste expert en droit immobilier français.
Tu analyses des décisions de justice pour produire des fiches synthétiques destinées aux agents immobiliers.
Tes fiches sont précises juridiquement, accessibles et immédiatement actionnables.`

function buildUserPrompt(text: string, subThemesAvailable: string[]): string {
  return `Analyse cette décision de justice et réponds UNIQUEMENT avec un JSON valide, sans aucun texte avant ou après :

{
  "situation": "Contexte factuel en 2-3 phrases : les parties, les faits essentiels et le litige. Précis mais sans jargon inutile.",
  "principe": "La règle de droit posée ou confirmée par cette décision, en 1-2 phrases. Mentionner l'article de loi si cité. Formulation rigoureuse.",
  "consequence": "Ce que l'agent immobilier doit retenir et faire en pratique. Formulé en mode conseil direct, actionnable, 2-3 phrases.",
  "sub_themes": ["choisir 1 à 3 valeurs parmi : ${subThemesAvailable.join(', ')}"]
}

DÉCISION :
${text.slice(0, 6000)}`
}

// ---------------------------------------------------------------------------
// OpenRouter — Résumé expert juridique + classification sub-thèmes
// ---------------------------------------------------------------------------

async function summarizeWithOpenRouter(text: string, domain: DomainConfig): Promise<LLMSummary | null> {
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
          { role: 'user',   content: buildUserPrompt(text, domain.subThemes) },
        ],
        max_tokens: 600,
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
    if (!content) throw new Error('Réponse OpenRouter vide')

    const parsed = JSON.parse(content) as LLMSummary

    // Validation
    if (!parsed.situation || parsed.situation.length < 20) throw new Error('situation trop courte')
    if (!parsed.principe   || parsed.principe.length   < 20) throw new Error('principe trop court')
    if (!parsed.consequence || parsed.consequence.length < 20) throw new Error('consequence trop courte')

    // S'assurer que les sub_themes sont dans la liste autorisée
    const validThemes = new Set(domain.subThemes)
    parsed.sub_themes = (parsed.sub_themes ?? []).filter((t: string) => validThemes.has(t))
    // Fallback : au moins le premier sous-thème du domaine si rien de valide
    if (parsed.sub_themes.length === 0) parsed.sub_themes = [domain.subThemes[0]]

    return parsed
  }, 3, 1500, 'summarizeWithOpenRouter')
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
// Supabase — Upsert
// ---------------------------------------------------------------------------

async function upsertDecision(record: {
  source_id:       string
  court:           'cc' | 'ca'
  chamber:         string | null
  date:            string | null
  number:          string | null
  solution:        string | null
  situation:       string
  principle:       string
  consequence:     string
  visa_refs:       string[]
  domain:          string
  sub_themes:      string[]
  url:             string | null
  motivations_raw: string | null
  embedding:       number[]
}) {
  if (DRY_RUN) return { error: null }
  const { error } = await supabase
    .from('jurisprudence')
    .upsert(record, { onConflict: 'source_id' })
  return { error }
}

// ---------------------------------------------------------------------------
// Traitement d'un arrêt (pipeline complet)
// ---------------------------------------------------------------------------

async function processResult(
  token:  string,
  result: any,
  domain: DomainConfig,
  court:  'cc' | 'ca',
  stats:  { indexed: number; skipped: number; errors: number }
): Promise<void> {
  const sourceId = result.id
  if (!sourceId) { stats.skipped++; return }

  // Skip si déjà indexé (sauf --reindex)
  if (!REINDEX && !DRY_RUN) {
    const { data: existing } = await supabase
      .from('jurisprudence')
      .select('id')
      .eq('source_id', sourceId)
      .single()
    if (existing) { stats.skipped++; return }
  }

  // Highlights comme fallback si /decision échoue
  const highlightFallback = (result.highlights?.motivations ?? [])
    .map((h: string) => h.replace(/<\/?em>/g, ''))
    .join(' ')
    .trim()

  // Fetch décision complète (CC + CA)
  const decision = await getDecision(token, sourceId)

  let fullText: string
  let visaRefs: string[]
  let motivationsRaw: string | null = null

  if (decision) {
    const extracted = extractFullText(decision, highlightFallback)
    fullText = extracted.text
    visaRefs = extracted.visaRefs
    // Stocker les motivations brutes pour re-traitement éventuel
    const motivParts = (decision?.zones?.motivations ?? [])
      .map((z: any) => z?.texte ?? z?.text ?? '')
      .filter(Boolean)
      .join('\n')
    motivationsRaw = motivParts || null
  } else {
    // Fallback highlights seulement
    fullText = highlightFallback
    visaRefs = []
  }

  if (!fullText || fullText.length < 50) {
    console.log(`  [SKIP] ${sourceId} — texte insuffisant (${fullText.length} chars)`)
    stats.skipped++
    return
  }

  // Résumé expert (GPT-4o-mini via OpenRouter)
  const summary = await summarizeWithOpenRouter(fullText, domain)
  if (!summary) {
    console.log(`  [SKIP] ${sourceId} — résumé LLM invalide`)
    stats.skipped++
    return
  }

  // Embedding du résumé (ce qui sera cherché à query-time)
  const embeddingText = `${summary.situation} ${summary.principe} ${summary.consequence}`
  const embedding = await embedWithNomic(embeddingText)
  if (!embedding) {
    console.log(`  [SKIP] ${sourceId} — embedding échoué`)
    stats.skipped++
    return
  }

  // URL source
  const url = court === 'cc'
    ? `https://www.courdecassation.fr/decision/${sourceId}`
    : (decision?.portalis ? `https://www.courdappel.fr/${decision.portalis}` : null)

  const { error } = await upsertDecision({
    source_id:       sourceId,
    court,
    chamber:         result.chamber ?? decision?.chamber ?? null,
    date:            result.decision_date ?? result.date ?? null,
    number:          result.number ?? null,
    solution:        result.solution ?? null,
    situation:       summary.situation,
    principle:       summary.principe,
    consequence:     summary.consequence,
    visa_refs:       visaRefs,
    domain:          domain.id,
    sub_themes:      summary.sub_themes,
    url,
    motivations_raw: motivationsRaw,
    embedding,
  })

  if (error) {
    console.log(`  [ERROR] ${sourceId} — ${error.message}`)
    stats.errors++
  } else {
    stats.indexed++
    // Afficher les 2 premiers résumés pour validation visuelle
    if (stats.indexed <= 2) {
      console.log(`\n  [EXEMPLE ${stats.indexed}] ${result.number ?? sourceId} (${court.toUpperCase()}, ${result.decision_date ?? '?'})`)
      console.log(`    Situation  : ${summary.situation}`)
      console.log(`    Principe   : ${summary.principe}`)
      console.log(`    Consequence: ${summary.consequence}`)
      console.log(`    Sub-themes : ${summary.sub_themes.join(', ')}`)
      console.log(`    Visa refs  : ${visaRefs.length ? visaRefs.join(' | ') : '—'}`)
      console.log()
    }
  }
}

// ---------------------------------------------------------------------------
// Indexation d'un domaine avec concurrence
// ---------------------------------------------------------------------------

async function indexDomain(domain: DomainConfig) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Domaine : ${domain.label} (${domain.id})`)
  console.log('='.repeat(60))

  const token = await getToken()
  const stats = { indexed: 0, skipped: 0, errors: 0 }
  const target = LIMIT_PER_DOMAIN
  const sem = createSemaphore(CONCURRENCY)

  let syncLogId: string | null = null
  if (!DRY_RUN) {
    const { data } = await supabase.from('sync_log').insert({
      sync_type: 'initial',
      source:    'judilibre',
      domain:    domain.id,
      status:    'running',
    }).select('id').single()
    syncLogId = data?.id ?? null
  }

  // --- CC (60% de la cible) ---
  console.log(`[CC] Recherche...`)
  const ccTarget = Math.ceil(target * 0.6)
  let page = 1
  outerCC: while (stats.indexed < ccTarget) {
    const results = await withRetry(() => searchCC(token, domain, page), 3, 1000, `searchCC p${page}`) ?? []
    if (!results.length) break
    const jobs = results.map(r => async () => {
      const release = await sem()
      try { await processResult(token, r, domain, 'cc', stats) }
      finally { release() }
    })
    await Promise.all(jobs.map(j => j()))
    if (stats.indexed >= ccTarget) break outerCC
    page++
    if (page > 10) break
    await sleep(300)
  }
  const ccIndexed = stats.indexed
  console.log(`[CC] ${ccIndexed} indexés`)

  // --- CA (reste de la cible) ---
  console.log(`[CA] Recherche...`)
  page = 1
  while (stats.indexed < target) {
    const results = await withRetry(() => searchCA(token, domain, page), 3, 1000, `searchCA p${page}`) ?? []
    if (!results.length) break
    const jobs = results.map(r => async () => {
      const release = await sem()
      try { await processResult(token, r, domain, 'ca', stats) }
      finally { release() }
    })
    await Promise.all(jobs.map(j => j()))
    page++
    if (page > 5) break
    await sleep(200)
  }
  console.log(`[CA] ${stats.indexed - ccIndexed} indexés`)

  console.log(`Résultat : ${stats.indexed} indexés | ${stats.skipped} skippés | ${stats.errors} erreurs`)

  if (syncLogId) {
    await supabase.from('sync_log').update({
      completed_at:  new Date().toISOString(),
      items_indexed: stats.indexed,
      items_skipped: stats.skipped,
      status:        stats.errors > 0 ? 'partial' : 'success',
    }).eq('id', syncLogId)
  }

  return stats
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const domains = TARGET_DOMAIN
    ? DOMAINS.filter(d => d.id === TARGET_DOMAIN)
    : DOMAINS

  if (!domains.length) {
    console.error(`Domaine "${TARGET_DOMAIN}" introuvable. Valeurs : ${DOMAINS.map(d => d.id).join(', ')}`)
    process.exit(1)
  }

  console.log(`\nIndexation Judilibre v2 — ${domains.length} domaine(s) — ${LIMIT_PER_DOMAIN} arrêts/domaine — concurrence x${CONCURRENCY}`)
  console.log(`Modèle résumé : ${SUMMARY_MODEL} | Embedding : nomic-embed-text (local)`)
  if (DRY_RUN) console.log('MODE DRY-RUN — aucune écriture Supabase')
  if (REINDEX)  console.log('MODE REINDEX — re-traitement des arrêts existants')

  const startTime = Date.now()
  let totalIndexed = 0

  for (const domain of domains) {
    const stats = await indexDomain(domain)
    totalIndexed += stats.indexed
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n${'='.repeat(60)}`)
  console.log(`TERMINÉ — ${totalIndexed} arrêts indexés en ${elapsed}s`)
  console.log('='.repeat(60))
}

main().catch(err => {
  console.error('Erreur fatale :', err)
  process.exit(1)
})
