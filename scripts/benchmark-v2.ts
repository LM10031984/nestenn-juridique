// scripts/benchmark-v2.ts
// Benchmark scoré Nestenn v2 — couverture (identique v1) + précision des citations.
//
// Nouveautés vs v1 :
//   - citationMode  : header X-Article-Citation-Mode (tagged = 100% sourcé)
//   - sanitized     : header X-Sanitized (numéros d'arrêts résiduels supprimés — doit être 0)
//   - métriques citations : liens Légifrance/Judilibre, part des articles liés,
//     vérification HTTP des liens (--verify-links)
//
// Prérequis : npm run dev + BENCHMARK_EMAIL/PASSWORD dans .env.local
// Usage :
//   npx tsx scripts/benchmark-v2.ts [--ids=Q01,Q02] [--domain=x] [--level=x] [--limit=N] [--verify-links]
//   BENCHMARK_MODEL=mistralai/mistral-medium-3.1 npx tsx scripts/benchmark-v2.ts

import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  loadEnvLocal, filterQuestions, consumeSSE, scoreCoverage, analyzeCitations,
  type QuestionEntry, type BenchmarkFile, type CitationMetrics,
} from './benchmark-lib'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnvLocal(resolve(__dirname, '../.env.local'))

const BASE_URL     = process.env.BASE_URL    ?? 'http://localhost:3000'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const ANON_KEY     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const EMAIL        = process.env.BENCHMARK_EMAIL    ?? ''
const PASSWORD     = process.env.BENCHMARK_PASSWORD ?? ''
const FORCE_MODEL  = process.env.BENCHMARK_MODEL    ?? ''
const VERIFY_LINKS = process.argv.includes('--verify-links')

if (!SUPABASE_URL || !ANON_KEY || !EMAIL || !PASSWORD) {
  console.error('❌  NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / BENCHMARK_EMAIL / BENCHMARK_PASSWORD manquants dans .env.local')
  process.exit(1)
}

interface QuestionResult extends QuestionEntry {
  response:       string
  wordCount:      number
  durationMs:     number
  sources:        number
  juriCount:      number
  responseMode:   string
  model:          string
  citationMode:   string      // tagged | free | mixed (header)
  sanitized:      number      // numéros résiduels supprimés (header)
  citations:      CitationMetrics
  error:          string | null
  coverageHits:   number
  coverageTotal:  number
  coverageRatio:  number
  focusMisses:    string[]
}

async function getAuthCookie(): Promise<string> {
  const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0]
  const cookieName = `sb-${projectRef}-auth-token`
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
    body:    JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (!res.ok) throw new Error(`Connexion Supabase échouée (${res.status}) : ${(await res.text()).slice(0, 200)}`)
  const session = await res.json()
  const encoded = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')
  return `${cookieName}=${encoded}`
}

async function runQuestion(q: QuestionEntry, cookie: string): Promise<QuestionResult> {
  const start = Date.now()
  const base: QuestionResult = {
    ...q,
    response: '', wordCount: 0, durationMs: 0, sources: 0, juriCount: 0,
    responseMode: '', model: '', citationMode: '', sanitized: 0,
    citations: {
      articleRefsCount: 0, caseNumbersCount: 0, legifranceLinks: 0,
      judilibreLinks: 0, linkedArticleRatio: 1, brokenLinks: [], checkedLinks: 0,
    },
    error: null,
    coverageHits: 0, coverageTotal: q.expected_focus.length, coverageRatio: 0, focusMisses: [],
  }

  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body:    JSON.stringify({ message: q.question, ...(FORCE_MODEL ? { model: FORCE_MODEL } : {}) }),
    })
    if (!res.ok) {
      base.error = `HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`
      base.durationMs = Date.now() - start
      return base
    }

    base.sources      = parseInt(res.headers.get('X-Sources-Count') ?? '0', 10)
    base.juriCount    = parseInt(res.headers.get('X-Juri-Count')    ?? '0', 10)
    base.model        = res.headers.get('X-Model-Used')    ?? ''
    base.responseMode = res.headers.get('X-Response-Mode') ?? ''
    base.citationMode = res.headers.get('X-Article-Citation-Mode') ?? ''
    base.sanitized    = parseInt(res.headers.get('X-Sanitized') ?? '0', 10)

    base.response   = await consumeSSE(res.body!)
    base.wordCount  = base.response.split(/\s+/).filter(Boolean).length
    base.durationMs = Date.now() - start

    const cov = scoreCoverage(q.expected_focus, base.response)
    base.coverageHits  = cov.hits
    base.coverageTotal = cov.total
    base.coverageRatio = cov.ratio
    base.focusMisses   = cov.misses

    base.citations = await analyzeCitations(base.response, VERIFY_LINKS)
  } catch (err) {
    base.error      = String(err)
    base.durationMs = Date.now() - start
  }
  return base
}

async function main(): Promise<void> {
  const benchPath = resolve(__dirname, '../benchmarks/nestenn-benchmark-v1.json')
  const bench     = JSON.parse(readFileSync(benchPath, 'utf-8')) as BenchmarkFile
  const questions = filterQuestions(bench.questions)
  if (questions.length === 0) {
    console.error('❌  Aucune question après filtrage.')
    process.exit(1)
  }

  console.log(`\n📘  Benchmark v2 : ${bench.name} — ${questions.length} question(s)`)
  if (FORCE_MODEL)  console.log(`🎯  Modèle forcé : ${FORCE_MODEL}`)
  if (VERIFY_LINKS) console.log('🔗  Vérification HTTP des liens activée')

  console.log(`\n🔐  Connexion Supabase (${EMAIL})…`)
  const cookie = await getAuthCookie()
  console.log('    ✅ session obtenue\n')

  const results: QuestionResult[] = []
  const t0 = Date.now()

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    const r = await runQuestion(q, cookie)
    results.push(r)

    const status = r.error ? '❌' : (r.coverageRatio >= 0.7 ? '✅' : r.coverageRatio >= 0.5 ? '🟡' : '🔴')
    const covPct = (r.coverageRatio * 100).toFixed(0).padStart(3)
    const citTag = r.citationMode === 'tagged' ? '🔒' : r.citationMode === 'mixed' ? '⚠️ mixed' : r.citationMode === 'free' ? '🔓 free' : '—'
    const sanTag = r.sanitized > 0 ? ` ✂️×${r.sanitized}` : ''
    const brokenTag = r.citations.brokenLinks.length > 0 ? ` 🔗✗${r.citations.brokenLinks.length}` : ''
    console.log(
      `${status}  [${String(i + 1).padStart(2)}/${questions.length}] ${q.id} ${q.domain.padEnd(22)} `
      + `cov=${covPct}% (${r.coverageHits}/${r.coverageTotal})  cit=${citTag}${sanTag}${brokenTag}  `
      + `links=${r.citations.legifranceLinks}LF/${r.citations.judilibreLinks}JU  ${r.wordCount}w  ${(r.durationMs / 1000).toFixed(0)}s`
    )
  }

  const totalMs = Date.now() - t0
  const ok = results.filter(r => !r.error)

  // ── Synthèse globale ──
  const avg = (f: (r: QuestionResult) => number) => ok.length ? ok.reduce((s, r) => s + f(r), 0) / ok.length : 0
  const summary = {
    model:              FORCE_MODEL || 'default',
    questions:          results.length,
    errors:             results.length - ok.length,
    avgCoverage:        avg(r => r.coverageRatio),
    perfectCoverage:    ok.filter(r => r.coverageRatio === 1).length,
    taggedRate:         ok.filter(r => r.citationMode === 'tagged').length / Math.max(ok.length, 1),
    mixedOrFreeRate:    ok.filter(r => r.citationMode === 'mixed' || r.citationMode === 'free').length / Math.max(ok.length, 1),
    sanitizedTotal:     ok.reduce((s, r) => s + r.sanitized, 0),
    avgLegifranceLinks: avg(r => r.citations.legifranceLinks),
    avgJudilibreLinks:  avg(r => r.citations.judilibreLinks),
    avgLinkedArticleRatio: avg(r => r.citations.linkedArticleRatio),
    brokenLinksTotal:   ok.reduce((s, r) => s + r.citations.brokenLinks.length, 0),
    checkedLinksTotal:  ok.reduce((s, r) => s + r.citations.checkedLinks, 0),
    freeModeRate:       ok.filter(r => r.responseMode === 'free').length / Math.max(ok.length, 1),
    avgDurationMs:      avg(r => r.durationMs),
    runDurationMs:      totalMs,
  }

  console.log('\n📊  SYNTHÈSE v2')
  console.log(`    Coverage moyenne        : ${(summary.avgCoverage * 100).toFixed(1)}%  (${summary.perfectCoverage}/${ok.length} à 100%)`)
  console.log(`    Citations 100% sourcées : ${(summary.taggedRate * 100).toFixed(1)}% des réponses (mode tagged)`)
  console.log(`    Numéros résiduels ✂️     : ${summary.sanitizedTotal} (objectif : 0)`)
  console.log(`    Liens/réponse           : ${summary.avgLegifranceLinks.toFixed(1)} Légifrance + ${summary.avgJudilibreLinks.toFixed(1)} Judilibre`)
  console.log(`    Articles liés           : ${(summary.avgLinkedArticleRatio * 100).toFixed(1)}%`)
  if (VERIFY_LINKS) {
    console.log(`    Liens cassés            : ${summary.brokenLinksTotal}/${summary.checkedLinksTotal} vérifiés`)
  }
  console.log(`    Mode free (peu sourcé)  : ${(summary.freeModeRate * 100).toFixed(1)}%`)
  console.log(`    Durée moyenne / question: ${(summary.avgDurationMs / 1000).toFixed(1)}s`)

  const outDir = resolve(__dirname, 'benchmark-results')
  mkdirSync(outDir, { recursive: true })
  const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', 'h')
  const modelSlug = (FORCE_MODEL || 'default').replace(/[^a-z0-9.-]/gi, '_')
  const jsonPath = resolve(outDir, `benchmark-v2_${modelSlug}_${ts}.json`)
  writeFileSync(jsonPath, JSON.stringify({ benchmark: bench.name, version: 'v2', summary, results }, null, 2), 'utf-8')
  console.log(`\n💾  JSON : ${jsonPath}\n`)
}

main().catch(err => { console.error(err); process.exit(1) })
