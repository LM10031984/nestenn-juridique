// scripts/benchmark-smoke.ts
// Smoke test local : poste 10 questions au endpoint /api/chat et affiche les résultats.
//
// Prérequis :
//   - Serveur Next.js en cours (`npm run dev`)
//   - Cookie de session Supabase dans BENCHMARK_COOKIE
//
// Usage :
//   BENCHMARK_COOKIE="sb-xxx-auth-token=..." npx tsx scripts/benchmark-smoke.ts
//   BENCHMARK_COOKIE="..." BASE_URL=http://localhost:3000 npx tsx scripts/benchmark-smoke.ts
//   BENCHMARK_COOKIE="..." npx tsx scripts/benchmark-smoke.ts --json   → sortie JSON brute

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Charger .env.local
try {
  const envPath = resolve(__dirname, '../.env.local')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* .env.local absent, on continue */ }

// ── Config ──────────────────────────────────────────────────────────────────

const BASE_URL    = process.env.BASE_URL ?? 'http://localhost:3000'
const COOKIE      = process.env.BENCHMARK_COOKIE ?? ''
const JSON_OUTPUT = process.argv.includes('--json')

if (!COOKIE) {
  console.error('❌  BENCHMARK_COOKIE manquant.')
  console.error('    Copiez le cookie sb-xxx-auth-token depuis votre navigateur (DevTools → Application → Cookies).')
  console.error('    Usage : BENCHMARK_COOKIE="sb-xxx-auth-token=eyJ..." npx tsx scripts/benchmark-smoke.ts')
  process.exit(1)
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
  index:       number
  question:    string
  response:    string
  wordCount:   number
  durationMs:  number
  sources:     number
  juriCount:   number
  domain:      string
  model:       string
  responseMode: string
  error:       string | null
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

async function runQuestion(index: number, question: string): Promise<SmokeResult> {
  const start = Date.now()
  const result: SmokeResult = {
    index, question, response: '', wordCount: 0, durationMs: 0,
    sources: 0, juriCount: 0, domain: '', model: '', responseMode: '', error: null,
  }

  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie':        COOKIE,
      },
      body: JSON.stringify({ message: question }),
    })

    if (!res.ok) {
      const body = await res.text()
      result.error = `HTTP ${res.status} — ${body.slice(0, 200)}`
      result.durationMs = Date.now() - start
      return result
    }

    result.sources      = parseInt(res.headers.get('X-Sources-Count') ?? '0', 10)
    result.juriCount    = parseInt(res.headers.get('X-Juri-Count')    ?? '0', 10)
    result.domain       = res.headers.get('X-Domain')       ?? ''
    result.model        = res.headers.get('X-Model-Used')   ?? ''
    result.responseMode = res.headers.get('X-Response-Mode') ?? ''

    result.response  = await consumeSSE(res.body!)
    result.wordCount = result.response.split(/\s+/).filter(Boolean).length
    result.durationMs = Date.now() - start
  } catch (err) {
    result.error      = String(err)
    result.durationMs = Date.now() - start
  }

  return result
}

// ── Affichage console ────────────────────────────────────────────────────────

function printResult(r: SmokeResult): void {
  const status = r.error ? '❌' : '✅'
  const dur    = (r.durationMs / 1000).toFixed(1)
  console.log(`\n${'─'.repeat(72)}`)
  console.log(`${status}  [${r.index + 1}/10] ${r.question}`)
  console.log(`    Durée : ${dur}s  |  Mots : ${r.wordCount}  |  Sources : ${r.sources}  |  Juri : ${r.juriCount}`)
  console.log(`    Domaine : ${r.domain || '—'}  |  Modèle : ${r.model || '—'}  |  Mode : ${r.responseMode || '—'}`)

  if (r.error) {
    console.log(`    ERREUR : ${r.error}`)
  } else {
    const preview = r.response.replace(/\n+/g, ' ').slice(0, 220)
    console.log(`    Aperçu : ${preview}${r.response.length > 220 ? '…' : ''}`)
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!JSON_OUTPUT) {
    console.log(`\n🔥  Benchmark smoke — ${QUESTIONS.length} questions → ${BASE_URL}/api/chat`)
    console.log(`    Modèle par défaut, réponses en streaming.\n`)
  }

  const results: SmokeResult[] = []

  for (let i = 0; i < QUESTIONS.length; i++) {
    if (!JSON_OUTPUT) process.stdout.write(`⏳  [${i + 1}/10] en cours…\r`)
    const r = await runQuestion(i, QUESTIONS[i])
    results.push(r)
    if (!JSON_OUTPUT) printResult(r)
  }

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(results, null, 2))
    return
  }

  // Récap
  const ok      = results.filter(r => !r.error)
  const errors  = results.filter(r => r.error)
  const avgMs   = ok.reduce((s, r) => s + r.durationMs, 0) / (ok.length || 1)
  const avgWords = ok.reduce((s, r) => s + r.wordCount, 0) / (ok.length || 1)
  const tooLong = ok.filter(r => r.wordCount > 800).length

  console.log(`\n${'═'.repeat(72)}`)
  console.log(`📊  RÉCAP`)
  console.log(`    Succès : ${ok.length}/10  |  Erreurs : ${errors.length}/10`)
  console.log(`    Durée moyenne : ${(avgMs / 1000).toFixed(1)}s`)
  console.log(`    Mots moyens   : ${Math.round(avgWords)}`)
  console.log(`    TROP_LONG (>800 mots) : ${tooLong}/10`)
  console.log(`${'═'.repeat(72)}\n`)
}

main().catch(err => { console.error(err); process.exit(1) })
