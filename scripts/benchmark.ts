// scripts/benchmark.ts
// Benchmark de précision — évalue N questions juridiques avec juge LLM
// Usage :
//   npx tsx scripts/benchmark.ts                        → gpt-4o, 50 questions
//   npx tsx scripts/benchmark.ts --limit 30             → gpt-4o, 30 questions
//   npx tsx scripts/benchmark.ts --model mistral-large  → Mistral Large
//   npx tsx scripts/benchmark.ts --compare              → 3 modèles, rapport comparatif

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Charger .env.local (tsx ne le charge pas automatiquement contrairement à Next.js)
try {
  const envPath = resolve(__dirname, '../.env.local')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
} catch { /* .env.local absent — variables d'env système utilisées */ }

interface TestQuestion {
  id: number
  theme: string
  type?: string
  question: string
  expected_refs: string[]
  expected_keywords: string[]
}

interface BenchmarkResult {
  id: number
  theme: string
  question: string
  response: string
  refsFound: boolean
  keywordsFound: boolean
  judgeScore: boolean | null
  tokensUsed: number
  costEur: number
  durationMs: number
  skipReason?: 'timeout' | 'api_error' | 'judge_error'
}

const API_BASE = process.env.BENCHMARK_API_URL ?? 'http://localhost:3000'
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? ''
const BENCHMARK_SECRET = process.env.BENCHMARK_SECRET ?? ''
const JUDGE_MODEL = 'openai/gpt-4o-mini'
const COST_PER_1K_INPUT = 0.00015  // GPT-4o-mini input en EUR (approx)
const COST_PER_1K_OUTPUT = 0.0006  // GPT-4o-mini output en EUR (approx)

// Modèles supportés via OpenRouter
const SUPPORTED_MODELS: Record<string, { openrouterId: string; label: string }> = {
  'gpt-4o':            { openrouterId: 'openai/gpt-4o',                    label: 'GPT-4o' },
  'claude-sonnet-4-6': { openrouterId: 'anthropic/claude-sonnet-4-6',       label: 'Claude Sonnet 4.6' },
  'mistral-large':     { openrouterId: 'mistralai/mistral-large-2512',      label: 'Mistral Large 3' },
}

async function callChatApi(question: string, openrouterId?: string): Promise<{ text: string; tokens: number; durationMs: number }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 180_000)
  // Increase Node.js default headers timeout for slow Claude responses
  if (typeof globalThis !== 'undefined') {
    (globalThis as any).__headersTimeout = 180_000
  }
  const start = Date.now()

  // Claude génère ~1700 tokens — on lui donne 3000 pour ne pas couper
  const isClaudeModel = openrouterId?.startsWith('anthropic/')
  const body: Record<string, unknown> = { message: question }
  if (openrouterId) body.model = openrouterId
  if (isClaudeModel) body.maxTokens = 3000

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (BENCHMARK_SECRET) headers['x-benchmark-secret'] = BENCHMARK_SECRET

  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: controller.signal,
  })
  clearTimeout(timeout)

  if (!res.ok) {
    throw new Error(`API chat error: ${res.status}`)
  }

  // Lire le stream SSE
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No body')

  const decoder = new TextDecoder()
  let accumulated = ''

  let streamDone = false
  let truncated = false
  while (!streamDone) {
    const { done, value } = await reader.read()
    if (done) break
    const lines = decoder.decode(value, { stream: true }).split('\n')
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (raw === '[DONE]') { streamDone = true; break }
      try {
        const parsed = JSON.parse(raw)
        const token: string = parsed.choices?.[0]?.delta?.content ?? ''
        if (token) accumulated += token
        // Détecter finish_reason "length" = réponse coupée par limite de tokens
        if (parsed.choices?.[0]?.finish_reason === 'length') truncated = true
      } catch { /* ignore */ }
    }
  }

  // Flush remaining bytes (important for UTF-8 multi-byte chars like French accents)
  accumulated += decoder.decode()

  if (truncated) {
    throw new Error('finish_reason:length — réponse tronquée (max_tokens atteint)')
  }

  return { text: accumulated, tokens: Math.ceil(accumulated.length / 4), durationMs: Date.now() - start }
}

async function judgeResponse(
  question: string,
  response: string,
  expectedRefs: string[],
  expectedKeywords: string[]
): Promise<{ correct: boolean | null; cost: number }> {
  const prompt = `Tu es un expert juridique. Évalue la réponse ci-dessous de façon strictement binaire.

Question : ${question}

Réponse à évaluer :
${response.slice(0, 2000)}

Critères — réponds true si AU MOINS 2 des 3 critères sont vrais :
1. [REFS] La réponse cite ou paraphrase au moins une de ces références légales : ${expectedRefs.join(', ')}
2. [MOTS] La réponse mentionne au moins 2 de ces mots-clés (sens exact ou équivalent) : ${expectedKeywords.join(', ')}
3. [FOND] La réponse donne une réponse juridiquement correcte à la question posée (oui/non clair + règle applicable)

Réponds UNIQUEMENT en JSON : {"correct": true} ou {"correct": false}`

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 20,
      temperature: 0,
    }),
  })

  if (!res.ok) {
    console.warn('[judge] OpenRouter error:', res.status)
    return { correct: null, cost: 0 }
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>
    usage: { prompt_tokens: number; completion_tokens: number }
  }

  const inputTokens = data.usage?.prompt_tokens ?? 0
  const outputTokens = data.usage?.completion_tokens ?? 0
  const cost = (inputTokens / 1000) * COST_PER_1K_INPUT + (outputTokens / 1000) * COST_PER_1K_OUTPUT

  try {
    const parsed = JSON.parse(data.choices[0].message.content.trim()) as { correct: boolean }
    return { correct: parsed.correct, cost }
  } catch {
    return { correct: null, cost }
  }
}

async function checkOpenRouterKey(): Promise<boolean> {
  if (!OPENROUTER_KEY) {
    console.error('❌ OPENROUTER_API_KEY manquante dans .env.local — arrêt.')
    return false
  }
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: JUDGE_MODEL, messages: [{ role: 'user', content: 'ok' }], max_tokens: 1 }),
  })
  if (!res.ok) {
    console.error(`❌ Clé OpenRouter invalide (HTTP ${res.status}) — arrêt.`)
    return false
  }
  console.log('✅ Clé OpenRouter valide\n')
  return true
}

/**
 * Normalise une chaîne pour la comparaison souple :
 * - supprime les accents (NFD + strip diacritiques)
 * - minuscules
 * - supprime "n°" (ex: "loi n° 89-462" → "loi 89-462")
 * - normalise les apostrophes et guillemets
 * - réduit les espaces multiples
 * - alias : "art. X" → "article X", abréviations codes (CMF, CCH, CGI, CSP)
 */
function normalize(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // supprime diacritiques
    .toLowerCase()
    .replace(/n°\s*/g, '')             // "n° 89-462" → "89-462"
    .replace(/\bart\.\s*/g, 'article ') // "Art. 24" → "article 24"
    .replace(/\bcmf\b/g, 'code monetaire et financier')
    .replace(/\bcch\b/g, 'code de la construction et de l habitation')
    .replace(/\bcgi\b/g, 'code general des impots')
    .replace(/\bcsp\b/g, 'code de la sante publique')
    .replace(/[''`]/g, "'")            // normalise apostrophes
    .replace(/\s+/g, ' ')             // espaces multiples → un seul
    .trim()
}

/**
 * Retourne true si `haystack` contient `needle` après normalisation des deux.
 * Permet à "loi 89-462" de matcher "loi n° 89-462 du 6 juillet 1989",
 * et à "article 24" de matcher "l'article 24 de la loi".
 */
function normalizedIncludes(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle))
}

async function runBenchmark(questions: TestQuestion[], modelKey: string): Promise<{
  results: BenchmarkResult[]
  totalCost: number
  label: string
  openrouterId: string
}> {
  const modelDef = SUPPORTED_MODELS[modelKey]
  const { openrouterId, label } = modelDef

  console.log(`\n🔬 BENCHMARK — ${label} — ${questions.length} questions`)
  console.log(`API: ${API_BASE} | Modèle: ${openrouterId}`)
  console.log('─'.repeat(60))

  const results: BenchmarkResult[] = []
  let totalCost = 0

  for (const q of questions) {
    process.stdout.write(`[${q.id}/${questions.length}] ${q.theme} — ${q.question.slice(0, 50)}... `)

    // Tentative 1, puis retry automatique si erreur
    let apiResult: { text: string; tokens: number; durationMs: number } | null = null
    let skipReason: BenchmarkResult['skipReason'] = undefined

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        apiResult = await callChatApi(q.question, openrouterId)
        break
      } catch (err) {
        const isTimeout = err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'))
        const reason = isTimeout ? 'timeout' : 'api_error'
        if (attempt === 1) {
          process.stdout.write(`⟳ retry (${reason})... `)
          await new Promise<void>(r => setTimeout(r, 3000))
          skipReason = reason
        } else {
          skipReason = reason
        }
      }
    }

    if (!apiResult) {
      console.log(`⏭️  SKIPPED (${skipReason})`)
      results.push({ id: q.id, theme: q.theme, question: q.question, response: '', refsFound: false, keywordsFound: false, judgeScore: null, tokensUsed: 0, costEur: 0, durationMs: 0, skipReason })
      await new Promise<void>(r => setTimeout(r, 500))
      continue
    }

    const { text, tokens, durationMs } = apiResult
    const refsFound = q.expected_refs.some(ref => normalizedIncludes(text, ref))
    const keywordsFound = q.expected_keywords.filter(kw => normalizedIncludes(text, kw)).length >= 2

    // Questions comportementales : on vérifie les keywords mais on n'appelle pas le juge
    // et on ne les compte pas dans le scoring pass/fail
    const isComportemental = q.type === 'comportemental'
    const responseCost = (tokens / 1000) * COST_PER_1K_OUTPUT

    if (isComportemental) {
      totalCost += responseCost
      results.push({ id: q.id, theme: q.theme, question: q.question, response: text, refsFound, keywordsFound, judgeScore: null, tokensUsed: tokens, costEur: responseCost, durationMs, skipReason: 'comportemental' as any })
      console.log(`🔵 [comportemental] kw=${keywordsFound ? '✓' : '✗'} ${durationMs}ms`)
      await new Promise<void>(r => setTimeout(r, 500))
      continue
    }

    const { correct: judgeScore, cost: judgeCost } = await judgeResponse(
      q.question, text, q.expected_refs, q.expected_keywords
    )

    totalCost += judgeCost + responseCost

    const judgeSkip = judgeScore === null ? 'judge_error' : undefined
    results.push({ id: q.id, theme: q.theme, question: q.question, response: text, refsFound, keywordsFound, judgeScore, tokensUsed: tokens, costEur: judgeCost + responseCost, durationMs, skipReason: judgeSkip })

    const status = judgeScore === true ? '✅' : judgeScore === null ? '⚠️' : '❌'
    console.log(`${status} refs=${refsFound ? '✓' : '✗'} kw=${keywordsFound ? '✓' : '✗'} ${durationMs}ms`)

    await new Promise<void>(r => setTimeout(r, 500))
  }

  return { results, totalCost, label, openrouterId }
}

function printReport(results: BenchmarkResult[], totalCost: number, label: string) {
  console.log('\n' + '═'.repeat(60))
  console.log(`📊 RAPPORT — ${label}\n`)

  const apiSkipped = results.filter(r => r.skipReason === 'timeout' || r.skipReason === 'api_error')
  const judgeSkipped = results.filter(r => r.skipReason === 'judge_error')
  const answered = results.filter(r => !r.skipReason)
  const correct = answered.filter(r => r.judgeScore === true).length
  const failed = answered.filter(r => r.judgeScore === false)
  const evaluated = answered.length
  const globalRate = evaluated > 0 ? Math.round((correct / evaluated) * 100) : 0
  const skipped = apiSkipped.length + judgeSkipped.length
  const avgDuration = answered.length > 0 ? Math.round(answered.reduce((s, r) => s + r.durationMs, 0) / answered.length) : 0

  console.log(`Taux de précision global : ${globalRate}% (${correct}/${evaluated} évaluées)`)
  console.log(`Coût total benchmark : ${totalCost.toFixed(4)} EUR`)
  console.log(`Vitesse moyenne : ${avgDuration}ms/question`)
  if (skipped > 0) {
    console.log(`\n⏭️  Questions skippées (${skipped}) :`)
    for (const s of apiSkipped) {
      const q50 = s.question.length > 50 ? s.question.slice(0, 50) + '...' : s.question
      console.log(`  [${s.id}] ${s.skipReason?.toUpperCase()} — ${q50}`)
    }
    for (const s of judgeSkipped) {
      const q50 = s.question.length > 50 ? s.question.slice(0, 50) + '...' : s.question
      console.log(`  [${s.id}] JUDGE_ERROR — ${q50}`)
    }
  }
  console.log()

  const themes = [...new Set(results.map(r => r.theme))]
  console.log('Par thème :')
  for (const theme of themes) {
    const tr = answered.filter(r => r.theme === theme)
    const tc = tr.filter(r => r.judgeScore === true).length
    const rate = tr.length > 0 ? Math.round((tc / tr.length) * 100) : 0
    const skippedInTheme = results.filter(r => r.theme === theme && r.skipReason && r.skipReason !== 'judge_error').length
    const skipNote = skippedInTheme > 0 ? ` (${skippedInTheme} skipped)` : ''
    console.log(`  ${theme.padEnd(15)} ${rate}% (${tc}/${tr.length})${skipNote}`)
  }

  if (failed.length > 0) {
    console.log(`\n❌ Questions échouées (${failed.length}) :`)
    for (const f of failed) {
      const q70 = f.question.length > 70 ? f.question.slice(0, 70) + '...' : f.question
      console.log(`  [${f.id}] ${q70}`)
    }
  }

  console.log('\n' + '═'.repeat(60))
  return { globalRate, correct, evaluated, skipped, totalCost, avgDuration, apiSkipped: apiSkipped.length, judgeSkipped: judgeSkipped.length }
}

async function main() {
  const fileArg = process.argv.indexOf('--file')
  const questionsFile = fileArg !== -1 && process.argv[fileArg + 1]
    ? process.argv[fileArg + 1]
    : 'test-questions.json'
  const questionsPath = resolve(__dirname, questionsFile)
  let questions: TestQuestion[] = JSON.parse(readFileSync(questionsPath, 'utf-8'))

  // Support --ids 57,60,62,69 (liste d'IDs séparés par virgule)
  const idsArg = process.argv.indexOf('--ids')
  if (idsArg !== -1 && process.argv[idsArg + 1]) {
    const ids = process.argv[idsArg + 1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    if (ids.length > 0) questions = questions.filter(q => ids.includes(q.id))
  }

  // Support --from ID (inclus) et --limit N
  const fromArg = process.argv.indexOf('--from')
  if (fromArg !== -1 && process.argv[fromArg + 1]) {
    const fromId = parseInt(process.argv[fromArg + 1], 10)
    if (!isNaN(fromId)) questions = questions.filter(q => q.id >= fromId)
  }

  const limitArg = process.argv.indexOf('--limit')
  if (limitArg !== -1 && process.argv[limitArg + 1]) {
    const n = parseInt(process.argv[limitArg + 1], 10)
    if (!isNaN(n)) questions = questions.slice(0, n)
  }

  // Support --model <key>
  const modelArg = process.argv.indexOf('--model')
  const modelKey = modelArg !== -1 && process.argv[modelArg + 1]
    ? process.argv[modelArg + 1]
    : 'gpt-4o'

  const isCompare = process.argv.includes('--compare')

  if (!isCompare && !SUPPORTED_MODELS[modelKey]) {
    console.error(`❌ Modèle inconnu : "${modelKey}". Valeurs supportées : ${Object.keys(SUPPORTED_MODELS).join(', ')}`)
    process.exit(1)
  }

  // Vérifier la clé OpenRouter
  const keyOk = await checkOpenRouterKey()
  if (!keyOk) process.exit(1)

  const outDir = resolve(__dirname, 'benchmark-results')
  mkdirSync(outDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

  // ── Mode --compare : 3 modèles en séquence ──────────────────────────────
  if (isCompare) {
    const modelsToTest = Object.keys(SUPPORTED_MODELS)
    const summaries: Array<{ label: string; globalRate: number; totalCost: number; avgDuration: number; evaluated: number; correct: number }> = []

    for (const key of modelsToTest) {
      const { results, totalCost, label } = await runBenchmark(questions, key)
      const stats = printReport(results, totalCost, label)
      summaries.push({ label, ...stats })

      // Sauvegarde individuelle
      const fileLabel = `${timestamp}_${questions.length}q_${key}`
      writeFileSync(resolve(outDir, `${fileLabel}.json`), JSON.stringify({ timestamp, model: key, questions: questions.length, ...stats, results }, null, 2))
    }

    // Rapport comparatif
    console.log('\n' + '╔' + '═'.repeat(68) + '╗')
    console.log('║  📊 RAPPORT COMPARATIF' + ' '.repeat(46) + '║')
    console.log('╠' + '═'.repeat(68) + '╣')
    console.log('║  Modèle              Score    Coût/run    Vitesse moy.          ║')
    console.log('╠' + '═'.repeat(68) + '╣')
    for (const s of summaries) {
      const name = s.label.padEnd(20)
      const score = `${s.globalRate}%`.padEnd(8)
      const cost = `${s.totalCost.toFixed(4)}€`.padEnd(11)
      const speed = `${s.avgDuration}ms`
      console.log(`║  ${name} ${score} ${cost} ${speed.padEnd(22)}║`)
    }
    console.log('╚' + '═'.repeat(68) + '╝')

    // Sauvegarde rapport comparatif
    const comparePath = resolve(outDir, `${timestamp}_${questions.length}q_compare.json`)
    writeFileSync(comparePath, JSON.stringify({ timestamp, questions: questions.length, summaries }, null, 2))
    const compareTxt = resolve(outDir, `${timestamp}_${questions.length}q_compare.txt`)
    writeFileSync(compareTxt, [
      `BENCHMARK COMPARATIF — ${new Date().toLocaleString('fr-FR')}`,
      `Questions : ${questions.length}`,
      '',
      'Modèle               Score    Coût       Vitesse',
      ...summaries.map(s => `${s.label.padEnd(20)} ${String(s.globalRate + '%').padEnd(8)} ${s.totalCost.toFixed(4)}€     ${s.avgDuration}ms`),
    ].join('\n'))
    console.log(`\n💾 Rapport comparatif sauvegardé : ${compareTxt}`)
    return
  }

  // ── Mode normal : 1 modèle ───────────────────────────────────────────────
  const { results, totalCost, label } = await runBenchmark(questions, modelKey)
  const { globalRate, correct, evaluated, skipped } = printReport(results, totalCost, label)

  const themes = [...new Set(results.map(r => r.theme))]
  const failed = results.filter(r => r.judgeScore === false)
  const fileLabel = `${timestamp}_${questions.length}q_${modelKey}`

  const jsonPath = resolve(outDir, `${fileLabel}.json`)
  writeFileSync(jsonPath, JSON.stringify({ timestamp, model: modelKey, questions: questions.length, globalRate, correct, evaluated, skipped, totalCost, results }, null, 2))

  const txtPath = resolve(outDir, `${fileLabel}.txt`)
  writeFileSync(txtPath, [
    `BENCHMARK NESTENN JURIDIQUE — ${label} — ${new Date().toLocaleString('fr-FR')}`,
    `Questions : ${questions.length} | Évaluées : ${evaluated} | Précision : ${globalRate}%`,
    `Coût : ${totalCost.toFixed(4)} EUR`,
    '',
    'Par thème :',
    ...themes.map(theme => {
      const tr = results.filter(r => r.theme === theme)
      const tc = tr.filter(r => r.judgeScore === true).length
      return `  ${theme.padEnd(15)} ${Math.round((tc / tr.length) * 100)}% (${tc}/${tr.length})`
    }),
    '',
    ...(failed.length > 0 ? [`Questions échouées (${failed.length}) :`, ...failed.map(f => `  [${f.id}] ${f.question.slice(0, 80)}`)] : ['Aucune question échouée.']),
  ].join('\n'))

  console.log(`\n💾 Résultats sauvegardés :`)
  console.log(`   ${jsonPath}`)
  console.log(`   ${txtPath}`)
}

main().catch(console.error)
