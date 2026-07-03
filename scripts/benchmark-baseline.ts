// scripts/benchmark-baseline.ts
// Baseline SANS RAG : pose les 60 questions du benchmark directement au LLM
// via OpenRouter, sans pipeline (pas de pgvector, pas de Légifrance/Judilibre live,
// pas de post-traitement des citations).
//
// Objectif : objectiver l'écart entre le pipeline Nestenn et un « ChatGPT brut ».
// Le scoring de couverture est identique au benchmark v2. Les métriques de
// citations montrent en plus le risque du modèle brut : articles cités sans lien
// vérifiable, numéros d'arrêts invérifiables.
//
// Usage :
//   BASELINE_MODEL=openai/gpt-4o npx tsx scripts/benchmark-baseline.ts [--limit=N]
//   BASELINE_MODEL=mistralai/mistral-large-2512 npx tsx scripts/benchmark-baseline.ts

import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  loadEnvLocal, filterQuestions, scoreCoverage, analyzeCitations,
  type QuestionEntry, type BenchmarkFile, type CitationMetrics,
} from './benchmark-lib'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnvLocal(resolve(__dirname, '../.env.local'))

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ''
const MODEL = process.env.BASELINE_MODEL ?? 'openai/gpt-4o'

if (!OPENROUTER_API_KEY) {
  console.error('❌  OPENROUTER_API_KEY manquant dans .env.local')
  process.exit(1)
}

// Prompt système générique — volontairement proche de ce qu'un agent taperait
// dans ChatGPT, sans le harnais Nestenn.
const BASELINE_SYSTEM = `Tu es un assistant juridique spécialisé en droit immobilier français.
Tu réponds aux questions d'agents immobiliers de façon claire, structurée et opérationnelle.
Cite les articles de loi et jurisprudences pertinents.`

interface BaselineResult extends QuestionEntry {
  response:      string
  wordCount:     number
  durationMs:    number
  error:         string | null
  coverageHits:  number
  coverageTotal: number
  coverageRatio: number
  focusMisses:   string[]
  citations:     CitationMetrics
  usage:         { prompt_tokens?: number; completion_tokens?: number } | null
}

async function askRaw(question: string): Promise<{ text: string; usage: BaselineResult['usage'] }> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: BASELINE_SYSTEM },
        { role: 'user', content: question },
      ],
      max_tokens: 2048,
      temperature: 0.1,
    }),
  })
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`)
  const data = await res.json() as any
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    usage: data.usage ?? null,
  }
}

async function main(): Promise<void> {
  const benchPath = resolve(__dirname, '../benchmarks/nestenn-benchmark-v1.json')
  const bench     = JSON.parse(readFileSync(benchPath, 'utf-8')) as BenchmarkFile
  const questions = filterQuestions(bench.questions)

  console.log(`\n📘  Baseline SANS RAG : ${MODEL} — ${questions.length} question(s)\n`)

  const results: BaselineResult[] = []
  const t0 = Date.now()

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    const start = Date.now()
    const base: BaselineResult = {
      ...q,
      response: '', wordCount: 0, durationMs: 0, error: null,
      coverageHits: 0, coverageTotal: q.expected_focus.length, coverageRatio: 0, focusMisses: [],
      citations: {
        articleRefsCount: 0, caseNumbersCount: 0, legifranceLinks: 0,
        judilibreLinks: 0, linkedArticleRatio: 1, brokenLinks: [], checkedLinks: 0,
      },
      usage: null,
    }
    try {
      const { text, usage } = await askRaw(q.question)
      base.response   = text
      base.usage      = usage
      base.wordCount  = text.split(/\s+/).filter(Boolean).length
      base.durationMs = Date.now() - start

      const cov = scoreCoverage(q.expected_focus, text)
      base.coverageHits  = cov.hits
      base.coverageTotal = cov.total
      base.coverageRatio = cov.ratio
      base.focusMisses   = cov.misses
      base.citations     = await analyzeCitations(text, false)
    } catch (err) {
      base.error      = String(err)
      base.durationMs = Date.now() - start
    }
    results.push(base)

    const status = base.error ? '❌' : (base.coverageRatio >= 0.7 ? '✅' : base.coverageRatio >= 0.5 ? '🟡' : '🔴')
    const covPct = (base.coverageRatio * 100).toFixed(0).padStart(3)
    console.log(
      `${status}  [${String(i + 1).padStart(2)}/${questions.length}] ${q.id} ${q.domain.padEnd(22)} `
      + `cov=${covPct}% (${base.coverageHits}/${base.coverageTotal})  `
      + `arts=${base.citations.articleRefsCount} arrêts=${base.citations.caseNumbersCount} liens=${base.citations.legifranceLinks + base.citations.judilibreLinks}  `
      + `${base.wordCount}w  ${(base.durationMs / 1000).toFixed(0)}s`
    )
  }

  const totalMs = Date.now() - t0
  const ok = results.filter(r => !r.error)
  const avg = (f: (r: BaselineResult) => number) => ok.length ? ok.reduce((s, r) => s + f(r), 0) / ok.length : 0

  const summary = {
    model:            MODEL,
    mode:             'baseline-no-rag',
    questions:        results.length,
    errors:           results.length - ok.length,
    avgCoverage:      avg(r => r.coverageRatio),
    perfectCoverage:  ok.filter(r => r.coverageRatio === 1).length,
    avgArticleRefs:   avg(r => r.citations.articleRefsCount),
    avgCaseNumbers:   avg(r => r.citations.caseNumbersCount),
    avgLinks:         avg(r => r.citations.legifranceLinks + r.citations.judilibreLinks),
    // Un numéro d'arrêt cité sans pipeline = invérifiable par l'agent → risque
    unverifiableCaseCitations: ok.reduce((s, r) => s + r.citations.caseNumbersCount, 0),
    totalPromptTokens:     ok.reduce((s, r) => s + (r.usage?.prompt_tokens ?? 0), 0),
    totalCompletionTokens: ok.reduce((s, r) => s + (r.usage?.completion_tokens ?? 0), 0),
    avgDurationMs:    avg(r => r.durationMs),
    runDurationMs:    totalMs,
  }

  console.log('\n📊  SYNTHÈSE BASELINE (sans RAG)')
  console.log(`    Coverage moyenne     : ${(summary.avgCoverage * 100).toFixed(1)}%  (${summary.perfectCoverage}/${ok.length} à 100%)`)
  console.log(`    Articles cités/rép.  : ${summary.avgArticleRefs.toFixed(1)} — liens vérifiables/rép. : ${summary.avgLinks.toFixed(1)}`)
  console.log(`    Numéros d'arrêts invérifiables au total : ${summary.unverifiableCaseCitations}`)
  console.log(`    Tokens : ${summary.totalPromptTokens} in / ${summary.totalCompletionTokens} out`)

  const outDir = resolve(__dirname, 'benchmark-results')
  mkdirSync(outDir, { recursive: true })
  const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', 'h')
  const modelSlug = MODEL.replace(/[^a-z0-9.-]/gi, '_')
  const jsonPath = resolve(outDir, `baseline_${modelSlug}_${ts}.json`)
  writeFileSync(jsonPath, JSON.stringify({ benchmark: bench.name, summary, results }, null, 2), 'utf-8')
  console.log(`\n💾  JSON : ${jsonPath}\n`)
}

main().catch(err => { console.error(err); process.exit(1) })
