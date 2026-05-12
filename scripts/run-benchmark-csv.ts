// scripts/run-benchmark-csv.ts
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 1. Charger .env.local
try {
  const envPath = resolve(__dirname, '../.env.local')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
} catch {
  console.warn('⚠️ Fichier .env.local non trouvé. Utilisation des variables système.')
}

const API_BASE = 'http://localhost:3000'
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? ''
const BENCHMARK_SECRET = process.env.BENCHMARK_SECRET ?? ''
const MODEL_ID = 'mistralai/mistral-large-2512'
const JUDGE_MODEL = 'openai/gpt-4o-mini'

interface TestQuestion {
  id: number
  question: string
  expected_refs: string[]
  expected_keywords: string[]
}

// --- NOUVELLE LOGIQUE D'ÉVALUATION (LLM-as-a-Judge) ---
async function judgeResponse(
  question: string,
  response: string,
  expectedRefs: string[],
  expectedKeywords: string[]
): Promise<number> {
  if (!OPENROUTER_KEY) {
    console.warn('⚠️ Pas de OPENROUTER_API_KEY pour le juge, retour à 0.')
    return 0
  }

  const prompt = `Tu es un expert en droit immobilier français. Évalue la réponse d'un assistant IA.

Question posée : "${question}"

Réponse de l'assistant :
"${response.slice(0, 2000)}"

Références légales attendues : ${expectedRefs.join(', ')}
Mots-clés / Concepts attendus : ${expectedKeywords.join(', ')}

Critères de notation :
- Attribue 1 si la réponse est juridiquement correcte, traite le sujet avec précision et mentionne la logique des références attendues (même si la formulation diffère).
- Attribue 0 si la réponse est fausse, incomplète sur un point crucial, ou hors-sujet.

Réponds UNIQUEMENT par un chiffre (0 ou 1).`

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
        max_tokens: 5,
      }),
    })

    if (!res.ok) {
      console.warn(`[Judge] Erreur API OpenRouter: ${res.status}`)
      return 0
    }
    const data = await res.json()
    const result = data.choices[0].message.content.trim()
    return result === '1' ? 1 : 0
  } catch (error) {
    console.error('Erreur Juge:', error)
    return 0
  }
}

// Pour échapper correctement les données dans le CSV
function escapeCsv(text: string): string {
  if (text === null || text === undefined) return ''
  const flatText = text.toString().replace(/\n/g, ' ').replace(/\r/g, '')
  return `"${flatText.replace(/"/g, '""')}"`
}

async function callChatApi(question: string): Promise<{ text: string; durationMs: number }> {
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
  return { text: accumulated, durationMs: Date.now() - start }
}

async function main() {
  console.log(`\n🚀 BENCHMARK PROFESSIONNEL — Mistral Large 3 (Judge: GPT-4o-mini)`)
  
  const questionsPath = resolve(__dirname, 'test-questions.json')
  const allQuestions: TestQuestion[] = JSON.parse(readFileSync(questionsPath, 'utf-8'))
  const questionsToTest = allQuestions.slice(0, 20)
  
  console.log(`📋 ${questionsToTest.length} questions chargées.`)
  console.log(`⏳ Test intelligent en cours (cela prend quelques secondes de plus par question)...\n`)

  const csvRows: string[] = []
  csvRows.push('ID;Question;Reponse_Mistral;Temps_Execution_sec;Score_Precision_IA_Judge')

  let correctCount = 0

  for (const q of questionsToTest) {
    process.stdout.write(`[${q.id}/20] Traitement... `)
    
    try {
      // 1. Appel du modèle à tester (Mistral Large 3)
      const { text, durationMs } = await callChatApi(q.question)
      const durationSec = (durationMs / 1000).toFixed(2)

      // 2. Évaluation intelligente par le Juge LLM (GPT-4o-mini)
      const score = await judgeResponse(q.question, text, q.expected_refs, q.expected_keywords)
      if (score === 1) correctCount++

      // 3. Préparation de la ligne CSV
      const row = [
        q.id,
        escapeCsv(q.question),
        escapeCsv(text),
        durationSec,
        score
      ].join(';')
      
      csvRows.push(row)
      
      console.log(`✅ ${durationSec}s | Score Juge: ${score}/1`)
    } catch (err: any) {
      console.log(`❌ Erreur: ${err.message}`)
      csvRows.push(`${q.id};${escapeCsv(q.question)};"ERREUR";0;0`)
    }
    
    // Délai pour respecter les quotas OpenRouter
    await new Promise(r => setTimeout(r, 500))
  }

  // 5. Génération du fichier CSV
  const csvPath = resolve(__dirname, '../benchmark_mistral_results.csv')
  writeFileSync(csvPath, csvRows.join('\n'), 'utf-8')

  console.log('\n' + '═'.repeat(60))
  console.log(`✅ Benchmark "LLM-as-a-Judge" terminé !`)
  console.log(`📊 Précision réelle estimée : ${Math.round((correctCount / 20) * 100)}% (${correctCount}/20)`)
  console.log(`💾 Rapport généré : ${csvPath}`)
  console.log('═'.repeat(60) + '\n')
}

main().catch(console.error)
