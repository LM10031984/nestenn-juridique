// scripts/benchmark-smoke.ts
// Smoke test local : poste 10 questions au endpoint /api/chat et affiche les résultats.
//
// Prérequis :
//   - Serveur Next.js en cours (`npm run dev`)
//   - BENCHMARK_EMAIL + BENCHMARK_PASSWORD dans .env.local (compte Nestenn actif)
//
// Usage :
//   npx tsx scripts/benchmark-smoke.ts
//   npx tsx scripts/benchmark-smoke.ts --json > scripts/benchmark-results/smoke.json
//   BASE_URL=http://localhost:3000 npx tsx scripts/benchmark-smoke.ts

import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Charger .env.local ───────────────────────────────────────────────────────

try {
  const envPath = resolve(__dirname, '../.env.local')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* .env.local absent */ }

// ── Config ───────────────────────────────────────────────────────────────────

const BASE_URL     = process.env.BASE_URL    ?? 'http://localhost:3000'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const ANON_KEY     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const EMAIL        = process.env.BENCHMARK_EMAIL    ?? ''
const PASSWORD     = process.env.BENCHMARK_PASSWORD ?? ''
const FORCE_MODEL  = process.env.BENCHMARK_MODEL    ?? ''
const JSON_OUTPUT  = process.argv.includes('--json')

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('❌  NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY manquant dans .env.local')
  process.exit(1)
}

if (!EMAIL || !PASSWORD) {
  console.error('❌  BENCHMARK_EMAIL et BENCHMARK_PASSWORD manquants.')
  console.error('    Ajoutez dans .env.local :')
  console.error('    BENCHMARK_EMAIL=votre@email.com')
  console.error('    BENCHMARK_PASSWORD=votreMotDePasse')
  process.exit(1)
}

// ── Connexion Supabase → cookie de session ───────────────────────────────────
//
// @supabase/ssr 0.5.x lit le cookie "sb-{ref}-auth-token" dont la valeur
// est soit du JSON brut, soit "base64-{base64url(JSON)}" pour les longues sessions.
// On utilise le format base64 pour éviter les problèmes de taille et de caractères.

async function getAuthCookie(): Promise<string> {
  const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0]
  const cookieName = `sb-${projectRef}-auth-token`

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY,
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Connexion Supabase échouée (${res.status}) : ${body.slice(0, 200)}`)
  }

  const session = await res.json()
  // Encode la session en base64url — format attendu par @supabase/ssr 0.5.x
  const encoded = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')
  return `${cookieName}=${encoded}`
}

// ── Questions ────────────────────────────────────────────────────────────────

const QUESTIONS = [
  "Un propriétaire peut-il donner congé pour loger son fils majeur ?",
  "Le bailleur peut-il refuser de rendre le dépôt de garantie pour de simples traces d'usure ?",
  "Un locataire peut-il sous-louer son appartement sans accord écrit du bailleur ?",
  "Que faire si un locataire ne paie plus son loyer depuis 2 mois ?",
  "Un logement classé G peut-il encore être mis en location ?",
  "Un agent immobilier peut-il réclamer sa commission sans mandat signé ?",
  "Une condition suspensive de prêt est-elle remplie si l'acheteur n'a fait qu'une seule demande de prêt ?",
  "Le vendeur est-il responsable d'un vice caché découvert après la vente ?",
  "En copropriété, quels travaux peuvent être votés à la majorité simple ?",
  "Une commune peut-elle préempter à un prix inférieur au prix de vente ?",
]

// ── Types ────────────────────────────────────────────────────────────────────

interface SmokeResult {
  index:        number
  question:     string
  response:     string
  wordCount:    number
  durationMs:   number
  sources:      number
  juriCount:    number
  domain:       string
  model:        string
  responseMode: string
  tooLong:      boolean
  error:        string | null
}

// ── SSE parser ───────────────────────────────────────────────────────────────

async function consumeSSE(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader  = stream.getReader()
  const decoder = new TextDecoder()
  const parts: string[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const raw = decoder.decode(value, { stream: true })
    for (const line of raw.split('\n')) {
      if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
      try {
        const json = JSON.parse(line.slice(6))
        const delta = json.choices?.[0]?.delta?.content
        if (delta) parts.push(delta)
      } catch { /* ligne SSE malformée, ignorée */ }
    }
  }

  return parts.join('')
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function runQuestion(
  index: number,
  question: string,
  cookie: string,
): Promise<SmokeResult> {
  const start = Date.now()
  const result: SmokeResult = {
    index, question, response: '', wordCount: 0, durationMs: 0,
    sources: 0, juriCount: 0, domain: '', model: '', responseMode: '',
    tooLong: false, error: null,
  }

  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ message: question, ...(FORCE_MODEL ? { model: FORCE_MODEL } : {}) }),
    })

    if (!res.ok) {
      const body = await res.text()
      result.error = `HTTP ${res.status} — ${body.slice(0, 200)}`
      result.durationMs = Date.now() - start
      return result
    }

    result.sources      = parseInt(res.headers.get('X-Sources-Count') ?? '0', 10)
    result.juriCount    = parseInt(res.headers.get('X-Juri-Count')    ?? '0', 10)
    result.domain       = res.headers.get('X-Domain')        ?? ''
    result.model        = res.headers.get('X-Model-Used')    ?? ''
    result.responseMode = res.headers.get('X-Response-Mode') ?? ''

    result.response  = await consumeSSE(res.body!)
    result.wordCount = result.response.split(/\s+/).filter(Boolean).length
    result.tooLong   = result.wordCount > 800
    result.durationMs = Date.now() - start
  } catch (err) {
    result.error      = String(err)
    result.durationMs = Date.now() - start
  }

  return result
}

// ── Affichage console ────────────────────────────────────────────────────────

function printResult(r: SmokeResult): void {
  const status  = r.error ? '❌' : '✅'
  const longTag = r.tooLong ? ' ⚠️ TROP_LONG' : ''
  const dur     = (r.durationMs / 1000).toFixed(1)

  console.log(`\n${'─'.repeat(72)}`)
  console.log(`${status}  [${r.index + 1}/10] ${r.question}`)
  console.log(`    Durée : ${dur}s  |  Mots : ${r.wordCount}${longTag}  |  Sources : ${r.sources}  |  Juri : ${r.juriCount}`)
  console.log(`    Domaine : ${r.domain || '—'}  |  Modèle : ${r.model || '—'}  |  Mode : ${r.responseMode || '—'}`)

  if (r.error) {
    console.log(`    ERREUR : ${r.error}`)
  } else {
    const preview = r.response.replace(/\n+/g, ' ').slice(0, 240)
    console.log(`    Aperçu : ${preview}${r.response.length > 240 ? '…' : ''}`)
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!JSON_OUTPUT) {
    console.log(`\n🔐  Connexion Supabase (${EMAIL})…`)
  }

  let cookie: string
  try {
    cookie = await getAuthCookie()
    if (!JSON_OUTPUT) console.log('    ✅ Session obtenue\n')
  } catch (err) {
    console.error(`❌  ${err}`)
    process.exit(1)
  }

  if (!JSON_OUTPUT) {
    console.log(`🔥  Benchmark smoke — ${QUESTIONS.length} questions → ${BASE_URL}/api/chat\n`)
  }

  const results: SmokeResult[] = []

  for (let i = 0; i < QUESTIONS.length; i++) {
    if (!JSON_OUTPUT) process.stdout.write(`⏳  [${i + 1}/10] en cours…\r`)
    const r = await runQuestion(i, QUESTIONS[i], cookie)
    results.push(r)
    if (!JSON_OUTPUT) printResult(r)
  }

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(results, null, 2))
    return
  }

  // Récap
  const ok       = results.filter(r => !r.error)
  const errors   = results.filter(r => r.error)
  const avgMs    = ok.reduce((s, r) => s + r.durationMs, 0) / (ok.length || 1)
  const avgWords = ok.reduce((s, r) => s + r.wordCount,  0) / (ok.length || 1)
  const tooLong  = ok.filter(r => r.tooLong).length

  console.log(`\n${'═'.repeat(72)}`)
  console.log(`📊  RÉCAP`)
  console.log(`    Succès : ${ok.length}/10  |  Erreurs : ${errors.length}/10`)
  console.log(`    Durée moyenne  : ${(avgMs / 1000).toFixed(1)}s`)
  console.log(`    Mots moyens    : ${Math.round(avgWords)}`)
  console.log(`    TROP_LONG (>800 mots) : ${tooLong}/10`)
  if (errors.length > 0) {
    console.log(`\n    Erreurs détaillées :`)
    errors.forEach(r => console.log(`    [${r.index + 1}] ${r.error}`))
  }
  console.log(`${'═'.repeat(72)}\n`)

  // Sauvegarde JSON automatique
  try {
    const outDir = resolve(__dirname, 'benchmark-results')
    mkdirSync(outDir, { recursive: true })
    const ts      = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', 'h')
    const outPath = resolve(outDir, `smoke-${ts}.json`)
    writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8')
    console.log(`💾  Résultats sauvegardés : ${outPath}\n`)
  } catch { /* pas bloquant */ }
}

main().catch(err => { console.error(err); process.exit(1) })
