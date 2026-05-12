// scripts/run-expert-benchmark.ts
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

try {
  const envPath = resolve(__dirname, '../.env.local')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
} catch {
  console.warn('⚠️ Fichier .env.local non trouvé.')
}

const API_BASE = 'http://localhost:3000'
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? ''
const BENCHMARK_SECRET = process.env.BENCHMARK_SECRET ?? ''
const MODEL_ID = 'mistralai/mistral-large-2512'
const JUDGE_MODEL = 'openai/gpt-4o-mini'

// Prix OpenRouter pour Mistral Large 3
const COST_PER_1M_INPUT = 2.00
const COST_PER_1M_OUTPUT = 6.00

interface ExpertQuestion {
  id: number
  theme: string
  question: string
  expected_refs: string[]
  expected_keywords: string[]
}

interface JudgeResult {
  score: number
  justification: string
}

async function judgeExpertResponse(
  question: string,
  response: string,
  expectedRefs: string[],
  expectedKeywords: string[]
): Promise<JudgeResult> {
  if (!OPENROUTER_KEY) return { score: 0, justification: "Erreur: Clé OpenRouter manquante." }

  const prompt = `Tu es un Lead QA Expert en droit immobilier français. Évalue la robustesse de l'IA sur un cas d'usage "Expert".

Question piège posée : "${question}"
Réponse générée : "${response.slice(0, 2000)}"

Références légales impératives : ${expectedRefs.join(', ')}
Concepts clés attendus : ${expectedKeywords.join(', ')}

Règles d'évaluation strictes :
1. Score = 1 si l'IA a déjoué le piège, appliqué la bonne exception légale et utilisé la jurisprudence ou la loi adéquate.
2. Score = 0 si l'IA a fait une erreur de raisonnement, est restée trop superficielle, a inventé une règle (hallucination) ou a raté l'exception.

Tu dois répondre UNIQUEMENT au format JSON strict :
{"score": 1, "justification": "Une seule phrase expliquant précisément pourquoi l'IA a réussi ou échoué."}`

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        response_format: { type: "json_object" }
      }),
    })

    if (!res.ok) throw new Error(`API Juge erreur ${res.status}`)
    const data = await res.json()
    const content = data.choices[0].message.content
    return JSON.parse(content) as JudgeResult
  } catch (error: any) {
    console.error('Erreur Juge:', error.message)
    return { score: 0, justification: "Erreur technique du Juge." }
  }
}

function escapeCsv(text: string): string {
  if (!text) return '""'
  const flatText = text.toString().replace(/\n/g, ' ').replace(/\r/g, '')
  return `"${flatText.replace(/"/g, '""')}"`
}

async function callChatApi(question: string): Promise<{ text: string; durationMs: number; inputTokens: number; outputTokens: number }> {
  const start = Date.now()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (BENCHMARK_SECRET) headers['x-benchmark-secret'] = BENCHMARK_SECRET

  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: question, model: MODEL_ID }),
  })

  if (!res.ok) throw new Error(`API chat error: ${res.status}`)

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
  accumulated += decoder.decode()
  
  // Estimation fine pour l'API RAG : 
  // ~2500 tokens pour le contexte injecté par le serveur + question
  // text.length / 4 pour l'output
  const inputTokens = 2500 + Math.ceil(question.length / 4)
  const outputTokens = Math.ceil(accumulated.length / 4)

  return { text: accumulated, durationMs: Date.now() - start, inputTokens, outputTokens }
}

async function main() {
  console.log(`\n🏢 STRESS-TEST ENTERPRISE — Mistral Large 3 vs Cas Complexes`)
  
  const questionsPath = resolve(__dirname, 'hard-questions.json')
  const allQuestions: ExpertQuestion[] = JSON.parse(readFileSync(questionsPath, 'utf-8'))
  
  console.log(`📋 ${allQuestions.length} questions expertes chargées.`)
  console.log(`💶 Calcul des coûts sur la base de : Input ${COST_PER_1M_INPUT}$/1M | Output ${COST_PER_1M_OUTPUT}$/1M\n`)

  const csvRows: string[] = []
  csvRows.push('ID;Question;Latence_sec;Tokens_Input;Tokens_Output;Cout_USD;Score_Juge;Justification_Juge')

  let correctCount = 0
  let totalCostUSD = 0

  for (const q of allQuestions) {
    process.stdout.write(`[${q.id}/20] Cas : ${q.theme} ... `)
    
    try {
      // 1. Réponse RAG
      const { text, durationMs, inputTokens, outputTokens } = await callChatApi(q.question)
      const durationSec = (durationMs / 1000).toFixed(2)

      // 2. Coût
      const costInput = (inputTokens / 1_000_000) * COST_PER_1M_INPUT
      const costOutput = (outputTokens / 1_000_000) * COST_PER_1M_OUTPUT
      const requestCost = costInput + costOutput
      totalCostUSD += requestCost

      // 3. Juge
      const judgeRes = await judgeExpertResponse(q.question, text, q.expected_refs, q.expected_keywords)
      if (judgeRes.score === 1) correctCount++

      // 4. CSV
      const row = [
        q.id,
        escapeCsv(q.question),
        durationSec,
        inputTokens,
        outputTokens,
        requestCost.toFixed(5),
        judgeRes.score,
        escapeCsv(judgeRes.justification)
      ].join(';')
      
      csvRows.push(row)
      
      const statusIcon = judgeRes.score === 1 ? '✅' : '❌'
      console.log(`\n   ${statusIcon} ${durationSec}s | Coût: $${requestCost.toFixed(4)} | Cumul: $${totalCostUSD.toFixed(4)}`)
      console.log(`   ⚖️ Juge : ${judgeRes.justification}`)
      
    } catch (err: any) {
      console.log(`\n   ❌ Erreur technique: ${err.message}`)
      csvRows.push(`${q.id};${escapeCsv(q.question)};0;0;0;0;0;"ERREUR TECHNIQUE"`)
    }
    
    await new Promise(r => setTimeout(r, 800))
  }

  const csvPath = resolve(__dirname, '../benchmark_expert_mistral.csv')
  writeFileSync(csvPath, csvRows.join('\n'), 'utf-8')

  console.log('\n' + '═'.repeat(70))
  console.log(`🏆 RÉSULTAT DU STRESS-TEST EXPERT`)
  console.log(`📊 Score de robustesse  : ${Math.round((correctCount / allQuestions.length) * 100)}% (${correctCount}/${allQuestions.length})`)
  console.log(`💸 Coût total de l'op. : $${totalCostUSD.toFixed(4)} USD`)
  console.log(`💾 Rapport exporté      : ${csvPath}`)
  console.log('═'.repeat(70) + '\n')
}

main().catch(console.error)
