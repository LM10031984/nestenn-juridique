// scripts/benchmark.ts
// Benchmark de précision — évalue 50 questions juridiques avec juge LLM
// Usage : npx tsx scripts/benchmark.ts

import { readFileSync } from 'fs'
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
}

const API_BASE = process.env.BENCHMARK_API_URL ?? 'http://localhost:3000'
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? ''
const JUDGE_MODEL = 'openai/gpt-4o-mini'
const COST_PER_1K_INPUT = 0.00015  // GPT-4o-mini input en EUR (approx)
const COST_PER_1K_OUTPUT = 0.0006  // GPT-4o-mini output en EUR (approx)

async function callChatApi(question: string): Promise<{ text: string; tokens: number }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: question }),
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
      } catch { /* ignore */ }
    }
  }

  // Flush remaining bytes (important for UTF-8 multi-byte chars like French accents)
  accumulated += decoder.decode()

  return { text: accumulated, tokens: Math.ceil(accumulated.length / 4) }
}

async function judgeResponse(
  question: string,
  response: string,
  expectedRefs: string[],
  expectedKeywords: string[]
): Promise<{ correct: boolean | null; cost: number }> {
  const prompt = `Tu es un expert juridique. Évalue la réponse ci-dessous.

Question : ${question}

Réponse à évaluer :
${response.slice(0, 2000)}

Critères d'évaluation :
1. La réponse cite-t-elle au moins une de ces références légales ? ${expectedRefs.join(', ')}
2. La réponse mentionne-t-elle au moins 2 de ces mots-clés ? ${expectedKeywords.join(', ')}
3. La réponse est-elle cohérente avec le droit français en vigueur ?

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

async function main() {
  const questionsPath = resolve(__dirname, 'test-questions.json')
  const questions: TestQuestion[] = JSON.parse(readFileSync(questionsPath, 'utf-8'))

  console.log(`\n🔬 BENCHMARK NESTENN JURIDIQUE — ${questions.length} questions\n`)
  console.log(`API: ${API_BASE}`)
  console.log(`Juge: ${JUDGE_MODEL}\n`)
  console.log('─'.repeat(60))

  const results: BenchmarkResult[] = []
  let totalCost = 0

  for (const q of questions) {
    process.stdout.write(`[${q.id}/${questions.length}] ${q.theme} — ${q.question.slice(0, 50)}... `)

    try {
      const { text, tokens } = await callChatApi(q.question)

      // Vérification mécanique des références et mots-clés
      const responseLower = text.toLowerCase()
      const refsFound = q.expected_refs.some(ref => responseLower.includes(ref.toLowerCase()))
      const keywordsFound = q.expected_keywords.filter(kw => responseLower.includes(kw.toLowerCase())).length >= 2

      // Juge LLM
      const { correct: judgeScore, cost: judgeCost } = await judgeResponse(
        q.question, text, q.expected_refs, q.expected_keywords
      )

      const responseCost = (tokens / 1000) * COST_PER_1K_OUTPUT
      totalCost += judgeCost + responseCost

      const result: BenchmarkResult = {
        id: q.id,
        theme: q.theme,
        question: q.question,
        response: text,
        refsFound,
        keywordsFound,
        judgeScore,
        tokensUsed: tokens,
        costEur: judgeCost + responseCost,
      }
      results.push(result)

      const status = judgeScore === true ? '✅' : judgeScore === null ? '⚠️' : '❌'
      console.log(`${status} refs=${refsFound ? '✓' : '✗'} kw=${keywordsFound ? '✓' : '✗'}`)
    } catch (err) {
      console.log(`💥 ERREUR: ${err}`)
    }

    // Rate limiting
    await new Promise<void>(r => setTimeout(r, 500))
  }

  // ── Rapport final ─────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60))
  console.log('📊 RAPPORT FINAL\n')

  const total = results.length
  const correct = results.filter(r => r.judgeScore === true).length
  const skipped = results.filter(r => r.judgeScore === null).length
  const evaluated = total - skipped
  const globalRate = evaluated > 0 ? Math.round((correct / evaluated) * 100) : 0

  console.log(`Taux de précision global : ${globalRate}% (${correct}/${evaluated} évaluées)`)
  if (skipped > 0) console.log(`Questions non évaluées (erreur juge) : ${skipped}`)
  console.log(`Coût total benchmark : ${totalCost.toFixed(4)} EUR\n`)

  // Par thème
  const themes = [...new Set(results.map(r => r.theme))]
  console.log('Par thème :')
  for (const theme of themes) {
    const themeResults = results.filter(r => r.theme === theme)
    const themeCorrect = themeResults.filter(r => r.judgeScore === true).length
    const rate = Math.round((themeCorrect / themeResults.length) * 100)
    console.log(`  ${theme.padEnd(15)} ${rate}% (${themeCorrect}/${themeResults.length})`)
  }

  // Questions échouées
  const failed = results.filter(r => r.judgeScore === false)
  if (failed.length > 0) {
    console.log(`\n❌ Questions échouées (${failed.length}) :`)
    for (const f of failed) {
      const q70 = f.question.length > 70 ? f.question.slice(0, 70) + '...' : f.question
      console.log(`  [${f.id}] ${q70}`)
    }
  }

  console.log('\n' + '═'.repeat(60))
}

main().catch(console.error)
