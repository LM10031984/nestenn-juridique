// scripts/audit-article-citations.ts
// Mesure le comportement du système de tags articles sur des cas réels.
// Usage : npx tsx scripts/audit-article-citations.ts [--model mistral-large]
//
// Pour chaque question : X-Article-Citation-Mode, safety mode, citations libres résiduelles,
// longueur de réponse, lisibilité après neutralisation.

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

try {
  const env = readFileSync(resolve(__dirname, '../.env.local'), 'utf-8')
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
} catch { /* variables système */ }

// ── Questions de test couvrant les cas à risque ────────────────────────────────
// Couvrent : domaine avec articles L. connus, domaines avec peu de jurisprudence,
// questions normatives fortes, questions avec articles R.

const TEST_QUESTIONS = [
  // Cas à forte probabilité de citations libres d'articles
  { id: 1,  domain: 'assainissement',  question: 'Le raccordement au tout-à-l\'égout est-il obligatoire pour une maison individuelle ?' },
  { id: 2,  domain: 'diagnostics',     question: 'Quelles sont les obligations du vendeur concernant le DPE ?' },
  { id: 3,  domain: 'bail',            question: 'Peut-on résilier un bail d\'habitation par email ?' },
  { id: 4,  domain: 'copropriété',     question: 'À quelle majorité vote-t-on des travaux en copropriété ?' },
  { id: 5,  domain: 'vente',           question: 'Quels sont les délais du droit de préemption urbain ?' },
  // Cas à risque normatif élevé (verbes catégoriques probables)
  { id: 6,  domain: 'urbanisme',       question: 'Une construction sans permis est-elle nulle ?' },
  { id: 7,  domain: 'bail',            question: 'Le dépôt de garantie doit-il être restitué sous 1 mois ?' },
  { id: 8,  domain: 'agent',           question: 'Un agent immobilier peut-il percevoir des honoraires sans mandat écrit ?' },
  // Cas difficiles / domaine frontière
  { id: 9,  domain: 'fiscalité',       question: 'Comment calcule-t-on la plus-value immobilière pour un bien détenu 15 ans ?' },
  { id: 10, domain: 'succession',      question: 'Comment vendre un bien immobilier en indivision successorale sans accord unanime ?' },
]

const BASE_URL = process.env.AUDIT_BASE_URL ?? 'http://localhost:3000'
const BENCHMARK_SECRET = process.env.BENCHMARK_SECRET ?? ''

// Modèle optionnel via arg CLI
const args = process.argv.slice(2)
const modelArg = args.indexOf('--model')
const selectedModel = modelArg >= 0 ? args[modelArg + 1] : undefined

// ── Helpers ────────────────────────────────────────────────────────────────────

function countOccurrences(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length
}

function checkReadability(text: string): { repeatedPlaceholder: boolean; placeholderCount: number } {
  const placeholderCount = countOccurrences(text, /la disposition applicable/gi)
  return { repeatedPlaceholder: placeholderCount >= 3, placeholderCount }
}

async function callApi(question: string): Promise<{
  text: string
  citationMode: string
  responseMode: string
  sourcesCount: number
  juriCount: number
  sanitized: number
  domain: string
  model: string
  statusCode: number
  durationMs: number
}> {
  const t0 = Date.now()
  const body: Record<string, unknown> = { message: question }
  if (selectedModel) body.model = selectedModel

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (BENCHMARK_SECRET) headers['X-Benchmark-Secret'] = BENCHMARK_SECRET

  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const citationMode = res.headers.get('X-Article-Citation-Mode') ?? '—'
  const responseMode = res.headers.get('X-Response-Mode') ?? '—'
  const sourcesCount = Number(res.headers.get('X-Sources-Count') ?? 0)
  const juriCount = Number(res.headers.get('X-Juri-Count') ?? 0)
  const sanitized = Number(res.headers.get('X-Sanitized') ?? 0)
  const domain = res.headers.get('X-Domain') ?? '—'
  const model = res.headers.get('X-Model-Used') ?? '—'

  // Lire le SSE et extraire le texte
  const raw = await res.text()
  const text = raw
    .split('\n')
    .filter(l => l.startsWith('data: ') && !l.includes('[DONE]'))
    .map(l => { try { return JSON.parse(l.slice(6)).choices?.[0]?.delta?.content ?? '' } catch { return '' } })
    .join('')

  return {
    text,
    citationMode,
    responseMode,
    sourcesCount,
    juriCount,
    sanitized,
    domain,
    model,
    statusCode: res.status,
    durationMs: Date.now() - t0,
  }
}

// ── Formatage rapport ──────────────────────────────────────────────────────────

const RESET  = '\x1b[0m'
const GREEN  = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED    = '\x1b[31m'
const BOLD   = '\x1b[1m'
const DIM    = '\x1b[2m'

function colorMode(mode: string): string {
  if (mode === 'tagged')  return `${GREEN}tagged${RESET}`
  if (mode === 'free')    return `${RED}free${RESET}`
  if (mode === 'mixed')   return `${YELLOW}mixed${RESET}`
  return mode
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BOLD}=== Audit citations articles — ${TEST_QUESTIONS.length} questions ===${RESET}`)
  console.log(`${DIM}Endpoint : ${BASE_URL}${selectedModel ? ` | model: ${selectedModel}` : ''}${RESET}\n`)

  const results: Array<{
    id: number
    domain: string
    citationMode: string
    responseMode: string
    sourcesCount: number
    juriCount: number
    placeholderCount: number
    repeatedPlaceholder: boolean
    safetyFooter: boolean
    safetyDowngrade: boolean
    responseLength: number
    durationMs: number
    ok: boolean
  }> = []

  for (const q of TEST_QUESTIONS) {
    process.stdout.write(`[${q.id}/10] ${q.domain.padEnd(14)} `)
    try {
      const r = await callApi(q.question)
      const { repeatedPlaceholder, placeholderCount } = checkReadability(r.text)
      const safetyFooter = r.text.includes('Sources limitées')
      const safetyDowngrade = r.text.includes('à vérifier selon la situation') || r.text.includes('pourrait être')

      results.push({
        id: q.id,
        domain: q.domain,
        citationMode: r.citationMode,
        responseMode: r.responseMode,
        sourcesCount: r.sourcesCount,
        juriCount: r.juriCount,
        placeholderCount,
        repeatedPlaceholder,
        safetyFooter,
        safetyDowngrade,
        responseLength: r.text.length,
        durationMs: r.durationMs,
        ok: r.statusCode < 400,
      })

      const modeColor = colorMode(r.citationMode)
      const placeholder = placeholderCount > 0 ? ` ${YELLOW}[placeholder×${placeholderCount}]${RESET}` : ''
      const safety = safetyFooter ? ` ${RED}[safety-mode]${RESET}` : ''
      const repeated = repeatedPlaceholder ? ` ${RED}⚠ répétition${RESET}` : ''
      console.log(`${modeColor} | src=${r.sourcesCount} juri=${r.juriCount} | ${r.responseLength} chars${placeholder}${safety}${repeated}`)
    } catch (err) {
      console.log(`${RED}ERREUR${RESET} : ${err instanceof Error ? err.message : String(err)}`)
      results.push({
        id: q.id, domain: q.domain, citationMode: '—', responseMode: '—',
        sourcesCount: 0, juriCount: 0, placeholderCount: 0,
        repeatedPlaceholder: false, safetyFooter: false, safetyDowngrade: false,
        responseLength: 0, durationMs: 0, ok: false,
      })
    }
  }

  // ── Synthèse ──
  const tagged  = results.filter(r => r.citationMode === 'tagged').length
  const free    = results.filter(r => r.citationMode === 'free').length
  const mixed   = results.filter(r => r.citationMode === 'mixed').length
  const safety  = results.filter(r => r.safetyFooter).length
  const repeated = results.filter(r => r.repeatedPlaceholder).length
  const avgLen  = Math.round(results.reduce((s, r) => s + r.responseLength, 0) / results.length)

  console.log(`\n${BOLD}── Synthèse ─────────────────────────────────────────────${RESET}`)
  console.log(`  Mode citations  : ${GREEN}tagged=${tagged}${RESET}  ${YELLOW}mixed=${mixed}${RESET}  ${RED}free=${free}${RESET}`)
  console.log(`  Safety mode     : ${safety > 0 ? RED : GREEN}${safety} réponse(s)${RESET}`)
  console.log(`  Placeholder ×3+ : ${repeated > 0 ? RED : GREEN}${repeated} réponse(s) — lisibilité à vérifier${RESET}`)
  console.log(`  Longueur moy.   : ${avgLen} chars`)

  if (tagged < 6) {
    console.log(`\n${RED}⚠ Moins de 60% de réponses en mode "tagged" — la couverture des tags articles est insuffisante.${RESET}`)
  }
  if (repeated > 0) {
    console.log(`${YELLOW}→ Revoir le rendu des réponses avec placeholder répété (priorité lisibilité).${RESET}`)
  }
  console.log('')
}

main().catch(err => { console.error(err); process.exit(1) })
