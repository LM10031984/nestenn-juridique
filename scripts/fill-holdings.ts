/**
 * scripts/fill-holdings.ts
 * Remplit le champ `holding` pour tous les arrêts sans holding.
 * Utilise le source_id Judilibre pour fetcher la décision complète,
 * extrait les motivations, résume via GPT-4o-mini.
 *
 * Skips :
 *   - source_id commençant par "curated-" (arrêts manuels, pas dans Judilibre)
 *   - arrêts avec holding déjà non null
 *
 * Usage :
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/fill-holdings.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/fill-holdings.ts --dry-run
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/fill-holdings.ts --limit 50
 */

import { createClient } from '@supabase/supabase-js'

const args    = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const LIMIT   = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : Infinity

const JUDILIBRE_URL  = 'https://api.piste.gouv.fr/cassation/judilibre/v1.0'
const TOKEN_URL      = 'https://oauth.piste.gouv.fr/api/oauth/token'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const SUMMARY_MODEL  = 'openai/gpt-4o-mini'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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
      grant_type:    'client_credentials',
      client_id:     process.env.PISTE_CLIENT_ID!,
      client_secret: process.env.PISTE_CLIENT_SECRET!,
      scope:         'openid',
    }),
  })
  if (!res.ok) throw new Error(`Token OAuth échoué : ${res.status}`)
  const data = await res.json() as { access_token: string; expires_in: number }
  _token = data.access_token
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
  return _token
}

// ---------------------------------------------------------------------------
// Judilibre — décision complète
// ---------------------------------------------------------------------------

async function getDecision(id: string): Promise<any | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const token = await getToken()
      const res = await fetch(
        `${JUDILIBRE_URL}/decision?id=${encodeURIComponent(id)}&resolve_references=false`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err: any) {
      if (attempt === 3) { console.warn(`    [skip] getDecision(${id}) : ${err.message}`); return null }
      await new Promise(r => setTimeout(r, 800 * attempt))
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Extraction des motivations
// ---------------------------------------------------------------------------

function extractMotivations(decision: any): string | null {
  if (!decision) return null

  // 1. Résumé officiel (Cour de cassation publiée) — plus concis et citable
  const summary = decision?.summary?.trim()
  if (summary && summary.length > 30) return summary

  // 2. Zones motivations
  const zones = decision?.zones ?? {}
  const parts: string[] = []
  for (const zone of (zones.motivations ?? [])) {
    const text = zone?.texte ?? zone?.text ?? ''
    if (text.length > 20) parts.push(text.trim())
  }
  if (parts.length > 0) return parts.join('\n').slice(0, 3000)

  // 3. Texte brut en fallback
  const raw = decision?.text ?? ''
  if (raw.length > 100) return raw.slice(0, 3000)

  return null
}

// ---------------------------------------------------------------------------
// LLM — résumé 1-2 phrases
// ---------------------------------------------------------------------------

async function summarizeHolding(text: string, number: string): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer':  'https://nestenn.com',
      'X-Title':       'Nestenn Juridique - Fill Holdings',
    },
    body: JSON.stringify({
      model:      SUMMARY_MODEL,
      messages:   [{
        role:    'user',
        content: `Résume en 1-2 phrases le principe juridique de cet arrêt n° ${number}. Donne uniquement le principe retenu, sans introduction.\n\nTexte : ${text.slice(0, 2000)}\n\nRésumé :`,
      }],
      max_tokens:  100,
      temperature: 0.1,
    }),
  })
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const summary = (data?.choices?.[0]?.message?.content ?? '').trim()
  if (summary.length < 20) throw new Error('Résumé trop court')
  return summary
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Config : dry-run=${DRY_RUN} limit=${LIMIT === Infinity ? '∞' : LIMIT}\n`)

  // Charger les arrêts sans holding, hors curated
  const { data: arrets, error } = await supabase
    .from('jurisprudence')
    .select('id, source_id, number')
    .is('holding', null)
    .not('source_id', 'like', 'curated-%')
    .order('indexed_at' as any, { ascending: false })

  if (error) { console.error('Erreur Supabase :', error.message); process.exit(1) }

  const todo = (arrets ?? []).slice(0, LIMIT === Infinity ? undefined : LIMIT)
  console.log(`${todo.length} arrêts à traiter (holding NULL, non curated)\n`)

  let updated = 0
  let skipped = 0
  let errors  = 0

  for (const arret of todo) {
    const label = `n° ${arret.number ?? arret.source_id}`
    process.stdout.write(`  ${label}... `)

    // Fetch Judilibre
    const decision = await getDecision(arret.source_id)
    if (!decision) { console.log('[skip] décision introuvable'); skipped++; continue }

    const motivations = extractMotivations(decision)
    if (!motivations) { console.log('[skip] aucune motivation'); skipped++; continue }

    // Résumé LLM
    let summary: string
    try {
      summary = await summarizeHolding(motivations, arret.number ?? arret.source_id)
    } catch (err: any) {
      console.log(`[erreur LLM] ${err.message}`)
      errors++
      continue
    }

    if (DRY_RUN) {
      console.log(`[DRY] ${summary.slice(0, 100)}`)
    } else {
      const { error: updateError } = await supabase
        .from('jurisprudence')
        .update({ holding: summary } as any)
        .eq('id', arret.id)

      if (updateError) {
        console.log(`[erreur DB] ${updateError.message}`)
        errors++
      } else {
        console.log(summary.slice(0, 100))
        updated++
      }
    }

    // Rate limiting : Judilibre + OpenRouter
    await new Promise(r => setTimeout(r, 400))
  }

  console.log(`\n${DRY_RUN ? '[DRY-RUN] ' : ''}✅ ${updated} mis à jour | ${skipped} ignorés | ${errors} erreurs`)
}

main().catch(err => { console.error(err); process.exit(1) })
