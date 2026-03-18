// lib/judilibre.ts
// Client PISTE — API JUDILIBRE (jurisprudences judiciaires)
// Cour de cassation, cours d'appel — spécialisé droit immobilier

const isSandbox = process.env.PISTE_ENV === 'sandbox'
const TOKEN_URL = isSandbox
  ? 'https://sandbox-oauth.piste.gouv.fr/api/oauth/token'
  : 'https://oauth.piste.gouv.fr/api/oauth/token'
const API_URL = isSandbox
  ? 'https://sandbox-api.piste.gouv.fr/cassation/judilibre/v1.0'
  : 'https://api.piste.gouv.fr/cassation/judilibre/v1.0'

let cachedToken: string | null = null
let tokenExpiry = 0

async function getJudilibreToken(): Promise<string | null> {
  const { PISTE_CLIENT_ID, PISTE_CLIENT_SECRET } = process.env
  if (!PISTE_CLIENT_ID || !PISTE_CLIENT_SECRET) return null

  if (cachedToken && Date.now() < tokenExpiry) return cachedToken

  try {
    const res = await fetch(TOKEN_URL, {
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
    console.error('[judilibre] getJudilibreToken — erreur :', err)
    return null
  }
}

// Mots-clés immobiliers → termes de recherche jurisprudentielle
const LEGAL_TRIGGERS: Array<{ triggers: string[]; query: string }> = [
  { triggers: ['bail', 'loyer', 'locataire', 'location'], query: 'bail habitation' },
  { triggers: ['copropriété', 'syndic', 'syndicat', 'assemblée générale'], query: 'copropriété syndic' },
  { triggers: ['agent immobilier', 'mandat', 'commission', 'hoguet', 'carte t'], query: 'agent immobilier mandat' },
  { triggers: ['vente', 'compromis', 'promesse', 'acheteur', 'vendeur'], query: 'vente immobilière' },
  { triggers: ['garantie', 'vices cachés', 'défaut'], query: 'vices cachés immeuble' },
  { triggers: ['expulsion', 'impayé', 'congé'], query: 'expulsion locataire' },
  { triggers: ['servitude', 'mitoyenneté', 'voisinage'], query: 'servitude voisinage' },
  { triggers: ['diagnostic', 'dpe', 'amiante', 'plomb'], query: 'diagnostic immobilier obligation' },
  { triggers: ['urbanisme', 'permis', 'plu', 'préemption'], query: 'permis construire urbanisme' },
]

function extractJuriQuery(question: string): string | null {
  const lower = question.toLowerCase()
  for (const { triggers, query } of LEGAL_TRIGGERS) {
    if (triggers.some(t => lower.includes(t))) return query
  }
  return null
}

export interface JudilibreDecision {
  id?: string
  title?: string
  summary?: string
  solution?: string
  jurisdiction?: string
  chamber?: string
  decision_date?: string
  number?: string
}

export interface JudilibreContext {
  available: boolean
  text: string
  decisions: JudilibreDecision[]
}

/**
 * Recherche des décisions de jurisprudence pertinentes pour la question.
 * Retourne un contexte structuré — mode dégradé si indisponible.
 */
export async function fetchJurisprudence(question: string): Promise<JudilibreContext> {
  const token = await getJudilibreToken()
  if (!token) {
    return { available: false, text: '', decisions: [] }
  }

  const query = extractJuriQuery(question)
  if (!query) {
    return { available: true, text: '', decisions: [] }
  }

  try {
    // Fetch 3, use 2 — hedge against partially empty results
    const params = new URLSearchParams({
      query,
      batch_size: '3',
      batch: '0',
      resolve_references: 'false',
    })

    const res = await fetch(`${API_URL}/search?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })

    if (!res.ok) {
      console.error(`[judilibre] fetchJurisprudence — HTTP ${res.status}`)
      return { available: false, text: '', decisions: [] }
    }

    const data = await res.json() as { results?: JudilibreDecision[] }
    const results = (data.results ?? []).slice(0, 2)

    const snippets: string[] = []
    for (const decision of results) {
      const parts: string[] = []
      if (decision.jurisdiction) parts.push(decision.jurisdiction)
      if (decision.chamber) parts.push(decision.chamber)
      if (decision.decision_date) parts.push(decision.decision_date.slice(0, 10))
      if (decision.number) parts.push(`n° ${decision.number}`)
      const header = parts.join(', ')
      const summary = decision.summary ?? decision.solution ?? ''
      if (header || summary) {
        snippets.push([header, summary].filter(Boolean).join(' — '))
      }
    }

    const text = snippets.length > 0
      ? `Jurisprudences pertinentes (JUDILIBRE) :\n${snippets.join('\n')}`
      : ''

    return { available: true, text, decisions: results }
  } catch (err) {
    console.error('[judilibre] fetchJurisprudence — exception :', err)
    return { available: false, text: '', decisions: [] }
  }
}
