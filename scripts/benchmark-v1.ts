// scripts/benchmark-v1.ts
// Benchmark scoré Nestenn v1 — 60 questions.
//
// Pour chaque question du benchmark :
//   1. poste la question à /api/chat
//   2. récupère la réponse + headers (sources, mode, model, etc.)
//   3. calcule un coverageRatio à partir de expected_focus
//   4. détecte des risk mentions textuelles (article incorrect, phrase trompeuse)
//   5. écrit JSON détaillé + CSV synthèse
//
// Prérequis :
//   - npm run dev (serveur Next.js)
//   - BENCHMARK_EMAIL + BENCHMARK_PASSWORD dans .env.local
//   - BENCHMARK_MODEL (optionnel) pour forcer le modèle
//
// Usage :
//   npx tsx scripts/benchmark-v1.ts

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

const BASE_URL     = process.env.BASE_URL    ?? 'http://localhost:3000'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const ANON_KEY     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const EMAIL        = process.env.BENCHMARK_EMAIL    ?? ''
const PASSWORD     = process.env.BENCHMARK_PASSWORD ?? ''
const FORCE_MODEL  = process.env.BENCHMARK_MODEL    ?? ''

if (!SUPABASE_URL || !ANON_KEY || !EMAIL || !PASSWORD) {
  console.error('❌  NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / BENCHMARK_EMAIL / BENCHMARK_PASSWORD manquants dans .env.local')
  process.exit(1)
}

// ── Filtres CLI ──────────────────────────────────────────────────────────────
// Usage :
//   --ids=Q32,Q33      → ne lance que les IDs listés (séparateur virgule)
//   --domain=xxx       → filtre par domaine (ex. vente_immobiliere)
//   --level=xxx        → filtre par niveau (facile, moyen, piege)
//   --limit=N          → limite au N premiers résultats après filtrage
// Sans aucun filtre : benchmark complet 60 questions.

function parseCliArg(name: string): string | null {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`))
  return arg ? arg.slice(`--${name}=`.length) : null
}

const FILTER_IDS     = parseCliArg('ids')?.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) ?? null
const FILTER_DOMAIN  = parseCliArg('domain')
const FILTER_LEVEL   = parseCliArg('level')
const FILTER_LIMIT   = (() => {
  const raw = parseCliArg('limit')
  if (!raw) return null
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : null
})()

// ── Types ────────────────────────────────────────────────────────────────────

interface QuestionEntry {
  id:             string
  domain:         string
  level:          string
  question:       string
  expected_focus: string[]
  risk_type:      string
}

interface BenchmarkFile {
  name:        string
  description: string
  version:     string
  created:     string
  questions:   QuestionEntry[]
}

interface QuestionResult extends QuestionEntry {
  response:       string
  wordCount:      number
  durationMs:     number
  sources:        number
  juriCount:      number
  domainDetected: string
  responseMode:   string
  model:          string
  tooLong:        boolean
  error:          string | null
  coverageHits:   number
  coverageTotal:  number
  coverageRatio:  number
  focusMisses:    string[]
  riskHits:       string[]
}

// ── Auth ─────────────────────────────────────────────────────────────────────

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

// ── SSE parser ───────────────────────────────────────────────────────────────

async function consumeSSE(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader  = stream.getReader()
  const decoder = new TextDecoder()
  const parts: string[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    for (const line of decoder.decode(value, { stream: true }).split('\n')) {
      if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
      try {
        const json = JSON.parse(line.slice(6))
        const delta = json.choices?.[0]?.delta?.content
        if (delta) parts.push(delta)
      } catch { /* ligne SSE malformée */ }
    }
  }
  return parts.join('')
}

// ── Scoring : couverture expected_focus ──────────────────────────────────────

const STOPWORDS = new Set([
  'pour', 'avec', 'sans', 'dans', 'sur', 'sous', 'par', 'les', 'des', 'une',
  'aux', 'que', 'qui', 'est', 'sont', 'être', 'avoir', 'fait', 'tout', 'tous',
  'cette', 'ces', 'leur', 'leurs', 'cas', 'entre', 'plus', 'moins', 'encore',
])

function normalizeArticleRef(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '').replace(/[^\w\-\.]/g, '')
}

function extractArticleRefs(text: string): string[] {
  const refs: string[] = []
  const pattern = /\bart(?:icle)?\.?\s*([LRDA]?\.?\s*\d[\d\-\.]*(?:\s+[IVX]+)?(?:\s+bis|\s+ter)?)/gi
  for (const m of text.matchAll(pattern)) refs.push(normalizeArticleRef(m[1]))
  return refs
}

function extractLawNumbers(text: string): string[] {
  return [...text.matchAll(/\b(\d{2,4}-\d{1,4})\b/g)].map(m => m[1])
}

function extractKeywords(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^\w\sàâäéèêëîïôùûüç\-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w))
}

// ── Équivalences sémantiques juridiques (vague scoring, correctif A) ────────
// Chaque groupe regroupe des expressions considérées comme équivalentes lors
// du fallback keyword matching. Si un keyword du focus est absent de la
// réponse mais qu'un de ses équivalents y figure, le keyword est compté comme
// trouvé. Liste fermée validée sur Q19/Q39/Q40 — ne pas élargir sans dry-run.
const SEMANTIC_EQUIVALENTS: string[][] = [
  ['interdiction', 'nullité', 'nul', 'exercice illégal'],
  ['pratiquer', 'exercer', 'agir', 'faire visiter'],
  ['déchéance', 'perd', 'perte', 'condition réputée accomplie'],
  ['multiples', 'plusieurs', 'nombreux'],
  ['automatique', "d'office", 'systématique'],
  ['in concreto', 'au cas par cas', 'selon les circonstances'],
  ['diligence', 'démarches sérieuses', 'bonne foi', 'sincérité'],
  ['silence', 'absence de précision', 'ne le précise pas'],
  // Softening v2 — équivalences ajoutées pour les focus trop littéraux
  // identifiés sur 3 runs stabilisés (Q17, Q22, Q47).
  ['absence', 'perte du droit', 'privation du droit', 'pas de droit', 'privé de'],
  ['limitée', 'fixe', 'déterminée', 'maximale', 'terme'],
  ['démolition', 'remise en état', 'rétablir', 'condamnation au rétablissement'],
]

function hasKeywordOrEquivalent(keyword: string, respLower: string): boolean {
  if (respLower.includes(keyword)) return true
  for (const group of SEMANTIC_EQUIVALENTS) {
    if (!group.includes(keyword)) continue
    for (const eq of group) {
      if (eq !== keyword && respLower.includes(eq)) return true
    }
  }
  return false
}

function focusIsHit(focus: string, response: string): boolean {
  const respLower = response.toLowerCase()
  const respArticles = new Set(extractArticleRefs(response))
  const respLaws     = new Set(extractLawNumbers(response))

  const focusArticles = extractArticleRefs(focus)
  const focusLaws     = extractLawNumbers(focus)

  // Si le focus mentionne un article ET une loi, les deux doivent être présents
  if (focusArticles.length > 0) {
    const anyArtHit = focusArticles.some(a => respArticles.has(a))
    if (!anyArtHit) return false
  }
  if (focusLaws.length > 0) {
    const anyLawHit = focusLaws.some(l => respLaws.has(l))
    if (!anyLawHit) return false
  }
  // Si le focus contenait article et/ou loi, et qu'ils sont présents, on valide
  if (focusArticles.length > 0 || focusLaws.length > 0) return true

  // Pas de ref structurée → fallback keyword matching (≥ 50% des mots > 3 chars)
  // avec équivalences sémantiques (SEMANTIC_EQUIVALENTS).
  const keywords = extractKeywords(focus)
  if (keywords.length === 0) return respLower.includes(focus.toLowerCase())
  const hits = keywords.filter(k => hasKeywordOrEquivalent(k, respLower)).length
  return hits / keywords.length >= 0.5
}

function scoreCoverage(
  expectedFocus: string[],
  response:      string,
): { hits: number; total: number; ratio: number; misses: string[] } {
  const misses: string[] = []
  let hits = 0
  for (const f of expectedFocus) {
    if (focusIsHit(f, response)) hits++
    else misses.push(f)
  }
  return {
    hits,
    total: expectedFocus.length,
    ratio: expectedFocus.length === 0 ? 0 : hits / expectedFocus.length,
    misses,
  }
}

// ── Scoring : détection simple de risk mentions ──────────────────────────────
// Heuristique : extrait les refs d'articles du risk_type, et signale si la
// réponse cite un de ces articles ALORS qu'il n'est PAS dans expected_focus.

const RISK_KEYWORDS: string[] = [
  'travail dissimulé', 'travail dissimule',
  'prescription 3 mois', "prescription d'un an", 'prescription d\'1 an',
  'amende 30 000', 'amende de 30 000', '30 000 euros',
  'L.121-1', 'L. 121-1',
  'L.8221-5', 'L. 8221-5',
  '313-1', '314-1',
  'annulation automatique',
]

function detectRiskHits(
  riskType:      string,
  response:      string,
  expectedFocus: string[],
): string[] {
  const hits: string[] = []
  const respLower = response.toLowerCase()

  // 1. Articles cités comme risques mais absents de expected_focus
  const riskArticles     = new Set(extractArticleRefs(riskType))
  const expectedArticles = new Set(expectedFocus.flatMap(f => extractArticleRefs(f)))
  const respArticles     = new Set(extractArticleRefs(response))
  for (const a of riskArticles) {
    if (!expectedArticles.has(a) && respArticles.has(a)) {
      hits.push(`article risqué détecté : art. ${a}`)
    }
  }

  // 2. Phrases-type risquées codées en dur
  for (const kw of RISK_KEYWORDS) {
    if (respLower.includes(kw.toLowerCase())) {
      // Éviter les faux positifs : ne flag que si le kw figure aussi dans le risk_type
      if (riskType.toLowerCase().includes(kw.slice(0, 8).toLowerCase())) {
        hits.push(`phrase risquée : "${kw}"`)
      }
    }
  }

  return [...new Set(hits)]
}

// ── Runner d'une question ────────────────────────────────────────────────────

async function runQuestion(q: QuestionEntry, cookie: string): Promise<QuestionResult> {
  const start = Date.now()
  const base: QuestionResult = {
    ...q,
    response:       '',
    wordCount:      0,
    durationMs:     0,
    sources:        0,
    juriCount:      0,
    domainDetected: '',
    responseMode:   '',
    model:          '',
    tooLong:        false,
    error:          null,
    coverageHits:   0,
    coverageTotal:  q.expected_focus.length,
    coverageRatio:  0,
    focusMisses:    [],
    riskHits:       [],
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

    base.sources        = parseInt(res.headers.get('X-Sources-Count') ?? '0', 10)
    base.juriCount      = parseInt(res.headers.get('X-Juri-Count')    ?? '0', 10)
    base.domainDetected = res.headers.get('X-Domain')        ?? ''
    base.model          = res.headers.get('X-Model-Used')    ?? ''
    base.responseMode   = res.headers.get('X-Response-Mode') ?? ''

    base.response   = await consumeSSE(res.body!)
    base.wordCount  = base.response.split(/\s+/).filter(Boolean).length
    base.tooLong    = base.wordCount > 800
    base.durationMs = Date.now() - start

    const cov = scoreCoverage(q.expected_focus, base.response)
    base.coverageHits  = cov.hits
    base.coverageTotal = cov.total
    base.coverageRatio = cov.ratio
    base.focusMisses   = cov.misses
    base.riskHits      = detectRiskHits(q.risk_type, base.response, q.expected_focus)
  } catch (err) {
    base.error      = String(err)
    base.durationMs = Date.now() - start
  }

  return base
}

// ── Agrégation par domaine ───────────────────────────────────────────────────

interface DomainStats {
  domain:         string
  count:          number
  avgCoverage:    number
  avgWordCount:   number
  freeRate:       number
  tooLongRate:    number
  errorRate:      number
  anyRiskHitRate: number
}

function aggregateByDomain(results: QuestionResult[]): DomainStats[] {
  const map = new Map<string, QuestionResult[]>()
  for (const r of results) {
    const list = map.get(r.domain) ?? []
    list.push(r)
    map.set(r.domain, list)
  }
  const stats: DomainStats[] = []
  for (const [domain, rs] of map) {
    const ok = rs.filter(r => !r.error)
    stats.push({
      domain,
      count:          rs.length,
      avgCoverage:    ok.length ? ok.reduce((s, r) => s + r.coverageRatio, 0) / ok.length : 0,
      avgWordCount:   ok.length ? ok.reduce((s, r) => s + r.wordCount,     0) / ok.length : 0,
      freeRate:       ok.length ? ok.filter(r => r.responseMode === 'free').length / ok.length : 0,
      tooLongRate:    ok.length ? ok.filter(r => r.tooLong).length / ok.length : 0,
      errorRate:      rs.length ? rs.filter(r => r.error).length / rs.length : 0,
      anyRiskHitRate: ok.length ? ok.filter(r => r.riskHits.length > 0).length / ok.length : 0,
    })
  }
  return stats.sort((a, b) => a.domain.localeCompare(b.domain))
}

// ── Écriture CSV ─────────────────────────────────────────────────────────────

function escapeCsv(v: string | number | boolean): string {
  const s = String(v)
  if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

function writeCSV(outPath: string, results: QuestionResult[], stats: DomainStats[]): void {
  const header = [
    'id', 'domain', 'level', 'question',
    'wordCount', 'durationMs', 'sources', 'juriCount',
    'domainDetected', 'responseMode', 'model',
    'coverageHits', 'coverageTotal', 'coverageRatio',
    'tooLong', 'riskHitsCount', 'riskHits', 'error',
  ].join(';')

  const rows = results.map(r => [
    r.id, r.domain, r.level, r.question.slice(0, 120),
    r.wordCount, r.durationMs, r.sources, r.juriCount,
    r.domainDetected, r.responseMode, r.model,
    r.coverageHits, r.coverageTotal, r.coverageRatio.toFixed(3),
    r.tooLong ? 'true' : 'false',
    r.riskHits.length, r.riskHits.join(' | '),
    r.error ?? '',
  ].map(escapeCsv).join(';'))

  // Agrégats par domaine en pied de CSV
  const statsHeader = '\n\n# Synthèse par domaine'
  const statsColumns = 'domain;count;avgCoverage;avgWordCount;freeRate;tooLongRate;errorRate;anyRiskHitRate'
  const statsRows = stats.map(s => [
    s.domain, s.count,
    s.avgCoverage.toFixed(3), s.avgWordCount.toFixed(0),
    s.freeRate.toFixed(3), s.tooLongRate.toFixed(3),
    s.errorRate.toFixed(3), s.anyRiskHitRate.toFixed(3),
  ].map(escapeCsv).join(';'))

  writeFileSync(outPath, [header, ...rows, statsHeader, statsColumns, ...statsRows].join('\n'), 'utf-8')
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const benchPath = resolve(__dirname, '../benchmarks/nestenn-benchmark-v1.json')
  const bench     = JSON.parse(readFileSync(benchPath, 'utf-8')) as BenchmarkFile
  console.log(`\n📘  Benchmark : ${bench.name} (${bench.questions.length} questions)\n`)

  // Filtres CLI (appliqués après chargement du JSON)
  let questions = bench.questions
  if (FILTER_IDS)    questions = questions.filter(q => FILTER_IDS.includes(q.id.toUpperCase()))
  if (FILTER_DOMAIN) questions = questions.filter(q => q.domain === FILTER_DOMAIN)
  if (FILTER_LEVEL)  questions = questions.filter(q => q.level  === FILTER_LEVEL)
  if (FILTER_LIMIT)  questions = questions.slice(0, FILTER_LIMIT)

  const filtersApplied: string[] = []
  if (FILTER_IDS)    filtersApplied.push(`ids=${FILTER_IDS.join(',')}`)
  if (FILTER_DOMAIN) filtersApplied.push(`domain=${FILTER_DOMAIN}`)
  if (FILTER_LEVEL)  filtersApplied.push(`level=${FILTER_LEVEL}`)
  if (FILTER_LIMIT)  filtersApplied.push(`limit=${FILTER_LIMIT}`)
  if (filtersApplied.length > 0) {
    console.log(`🎛️   Filtres : ${filtersApplied.join(' | ')}`)
    console.log(`    ${questions.length} question(s) retenue(s) sur ${bench.questions.length}\n`)
  }

  if (questions.length === 0) {
    console.error('❌  Aucune question après filtrage. Vérifiez vos options --ids / --domain / --level.')
    process.exit(1)
  }

  console.log(`🔐  Connexion Supabase (${EMAIL})…`)
  const cookie = await getAuthCookie()
  console.log('    ✅ session obtenue\n')

  if (FORCE_MODEL) console.log(`🎯  Modèle forcé : ${FORCE_MODEL}\n`)

  const results: QuestionResult[] = []
  const t0 = Date.now()

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]
    process.stdout.write(`⏳  [${String(i + 1).padStart(2)}/${questions.length}] ${q.id} ${q.domain.padEnd(24)} ${q.level.padEnd(7)} …\r`)
    const r = await runQuestion(q, cookie)
    results.push(r)

    const status = r.error ? '❌' : (r.coverageRatio >= 0.7 ? '✅' : r.coverageRatio >= 0.5 ? '🟡' : '🔴')
    const longTag = r.tooLong ? ' ⚠️ TROP_LONG' : ''
    const riskTag = r.riskHits.length > 0 ? ` ⚠️ risk×${r.riskHits.length}` : ''
    const covPct  = (r.coverageRatio * 100).toFixed(0).padStart(3)
    console.log(`${status}  [${String(i + 1).padStart(2)}/${questions.length}] ${q.id} ${q.domain.padEnd(24)} ${q.level.padEnd(7)} cov=${covPct}%  (${r.coverageHits}/${r.coverageTotal})  ${r.wordCount}w${longTag}${riskTag}`)
  }

  const totalMs = Date.now() - t0
  console.log(`\n⏱️   Durée totale : ${(totalMs / 1000).toFixed(0)}s (${(totalMs / 60000).toFixed(1)} min)\n`)

  // Agrégats
  const stats = aggregateByDomain(results)
  console.log('📊  Synthèse par domaine :')
  console.log('    ' + ['domain', 'n', 'cov', 'mots', 'free%', 'long%', 'err%', 'risk%'].map(s => s.padEnd(7)).join(''))
  console.log('    ' + '─'.repeat(70))
  for (const s of stats) {
    console.log('    ' + [
      s.domain.slice(0, 22).padEnd(24),
      s.count.toString().padEnd(3),
      (s.avgCoverage * 100).toFixed(0) + '%',
      s.avgWordCount.toFixed(0).padEnd(5),
      (s.freeRate * 100).toFixed(0) + '%',
      (s.tooLongRate * 100).toFixed(0) + '%',
      (s.errorRate * 100).toFixed(0) + '%',
      (s.anyRiskHitRate * 100).toFixed(0) + '%',
    ].join(' '))
  }

  // Sauvegarde JSON + CSV
  const outDir = resolve(__dirname, 'benchmark-results')
  mkdirSync(outDir, { recursive: true })
  const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', 'h')
  const jsonPath = resolve(outDir, `benchmark-v1_${ts}.json`)
  const csvPath  = resolve(outDir, `benchmark-v1_${ts}.csv`)

  writeFileSync(jsonPath, JSON.stringify({
    benchmark: bench.name,
    version:   bench.version,
    model:     FORCE_MODEL || 'default',
    runStartedAt: new Date(t0).toISOString(),
    runDurationMs: totalMs,
    stats,
    results,
  }, null, 2), 'utf-8')

  writeCSV(csvPath, results, stats)

  console.log(`\n💾  JSON : ${jsonPath}`)
  console.log(`💾  CSV  : ${csvPath}\n`)
}

main().catch(err => { console.error(err); process.exit(1) })
