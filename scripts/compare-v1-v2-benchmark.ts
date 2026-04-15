// scripts/compare-v1-v2-benchmark.ts
// Comparateur V1 vs V2 sur les 3 cas benchmark gold
//
// Prérequis : npm run dev doit être lancé pour la colonne V1
//
// Usage :
//   npx tsx scripts/compare-v1-v2-benchmark.ts              → tableau lisible
//   npx tsx scripts/compare-v1-v2-benchmark.ts --json       → JSON sur stdout
//   npx tsx scripts/compare-v1-v2-benchmark.ts --save-json  → JSON sauvegardé

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Charger .env.local
try {
  const envPath = resolve(__dirname, '../.env.local')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
} catch { /* .env.local absent — variables d'env système utilisées */ }

import { runLegalBriefOrchestrator } from '../lib/pipeline/legal-brief-orchestrator'
import { scoreAnswer } from '../lib/legal-benchmark-score'
import { scoreAgainstGold, determineWinner } from '../lib/legal-gold-score'
import { GOLD_CASES, getGoldCase } from '../lib/legal-gold-cases'
import type { GoldScore } from '../lib/legal-gold-score'
import type { BenchmarkScore } from '../lib/legal-benchmark-score'
import type { WinnerVerdict } from '../lib/legal-gold-score'

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const V1_BASE_URL = process.env.V1_BASE_URL ?? 'http://localhost:3000'
const V1_TIMEOUT_MS = 60_000

// ─────────────────────────────────────────────────────────────────────────────
// Consommateur SSE pour V1
// ─────────────────────────────────────────────────────────────────────────────

/**
 * callV1 — Appelle /api/chat via HTTP et consomme le stream SSE.
 * Retourne le texte complet ou null si le serveur est inaccessible.
 */
async function callV1(question: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), V1_TIMEOUT_MS)

    const response = await fetch(`${V1_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Header minimal pour satisfaire l'auth V1 si nécessaire
        'x-api-key': process.env.API_KEY ?? '',
      },
      body: JSON.stringify({ message: question }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      return null
    }

    if (!response.body) return null

    // Consommer le stream SSE
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // Traiter les lignes complètes
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') break
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>
          }
          const content = parsed.choices?.[0]?.delta?.content ?? ''
          fullText += content
        } catch { /* ignorer les lignes non-JSON */ }
      }
    }

    return fullText.trim() || null
  } catch (err) {
    // Serveur inaccessible ou timeout
    if ((err as Error).name === 'AbortError') {
      return null // timeout
    }
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Types de sortie
// ─────────────────────────────────────────────────────────────────────────────

type ComparisonEntry = {
  questionId: string
  question: string
  v1Answer: string | null
  v2Answer: string | null
  v1ScoreInternal: null  // V1 n'a pas de brief/validationReport — toujours null
  v2ScoreInternal: BenchmarkScore | null
  v1ScoreGold: GoldScore | null
  v2ScoreGold: GoldScore | null
  winner: WinnerVerdict | null
  notes: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers d'affichage
// ─────────────────────────────────────────────────────────────────────────────

function hr(char = '─', width = 80) {
  return char.repeat(width)
}

function printHeader(text: string) {
  console.log('\n' + hr('═'))
  console.log(`  ${text}`)
  console.log(hr('═'))
}

function printSection(title: string) {
  console.log('\n' + hr('─'))
  console.log(`  ${title}`)
  console.log(hr('─'))
}

function winnerIcon(verdict: WinnerVerdict | null): string {
  switch (verdict) {
    case 'V2': return '🟢 V2 gagne'
    case 'V1': return '🔴 V1 gagne'
    case 'TIE': return '🟡 Égalité'
    case 'V2_NO_MATCH': return '⚪ V2 non matché'
    default: return '—'
  }
}

function printComparisonTable(entries: ComparisonEntry[]) {
  printSection('TABLEAU COMPARATIF V1 vs V2')

  // En-tête
  console.log(`\n  ${'CAS'.padEnd(4)} | ${'SCORE V1'.padEnd(10)} | ${'SCORE V2'.padEnd(10)} | ${'V2 INTERNE'.padEnd(10)} | VERDICT`)
  console.log(`  ${hr('─', 70)}`)

  for (const entry of entries) {
    const v1Gold = entry.v1ScoreGold ? `${entry.v1ScoreGold.total.toFixed(1)}/20` : 'N/A      '
    const v2Gold = entry.v2ScoreGold ? `${entry.v2ScoreGold.total.toFixed(1)}/20` : 'N/A      '
    const v2Int  = entry.v2ScoreInternal ? `${entry.v2ScoreInternal.total.toFixed(1)}/20` : 'N/A      '
    const verdict = winnerIcon(entry.winner)
    console.log(`  ${entry.questionId.padEnd(4)} | ${v1Gold.padEnd(10)} | ${v2Gold.padEnd(10)} | ${v2Int.padEnd(10)} | ${verdict}`)
  }

  console.log(`\n  Légende : Score V1/V2 = gold score /20 | V2 Interne = score déterministe brief+validation`)
}

function printDetailedEntry(entry: ComparisonEntry) {
  printHeader(`${entry.questionId} — ${entry.question.slice(0, 65)}...`)

  // V1
  printSection('Réponse V1')
  if (!entry.v1Answer) {
    console.log('  ⚠️  V1 inaccessible (serveur Next.js non démarré ou timeout)')
    console.log('  → Lancer npm run dev puis relancer ce script pour la comparaison complète')
  } else {
    const lines = entry.v1Answer.split('\n').slice(0, 8)
    for (const line of lines) { if (line.trim()) console.log(`  ${line}`) }
    if (entry.v1Answer.split('\n').length > 8) console.log('  [...]')
    if (entry.v1ScoreGold) {
      console.log(`\n  Score gold V1 : ${entry.v1ScoreGold.total.toFixed(1)}/20`)
      console.log(`    mustInclude: ${entry.v1ScoreGold.mustIncludeScore}/5 | mustAvoid: ${entry.v1ScoreGold.mustAvoidScore}/5 | authority: ${entry.v1ScoreGold.authorityScore}/5 | practical: ${entry.v1ScoreGold.practicalScore}/5`)
    }
  }

  // V2
  printSection('Réponse V2')
  if (!entry.v2Answer) {
    console.log('  ⚠️  V2 n\'a pas matché (no_playbook_match)')
  } else {
    const lines = entry.v2Answer.split('\n').slice(0, 8)
    for (const line of lines) { if (line.trim()) console.log(`  ${line}`) }
    if (entry.v2Answer.split('\n').length > 8) console.log('  [...]')
    if (entry.v2ScoreGold) {
      console.log(`\n  Score gold V2 : ${entry.v2ScoreGold.total.toFixed(1)}/20`)
      console.log(`    mustInclude: ${entry.v2ScoreGold.mustIncludeScore}/5 | mustAvoid: ${entry.v2ScoreGold.mustAvoidScore}/5 | authority: ${entry.v2ScoreGold.authorityScore}/5 | practical: ${entry.v2ScoreGold.practicalScore}/5`)
    }
    if (entry.v2ScoreInternal) {
      console.log(`\n  Score interne V2 : ${entry.v2ScoreInternal.total.toFixed(1)}/20`)
      console.log(`    legalAccuracy: ${entry.v2ScoreInternal.legalAccuracy}/5 | nuances: ${entry.v2ScoreInternal.mandatoryNuances}/5 | practical: ${entry.v2ScoreInternal.practicalUsefulness}/5 | safety: ${entry.v2ScoreInternal.safety}/5`)
    }
  }

  // Verdict
  printSection('Verdict')
  console.log(`  ${winnerIcon(entry.winner)}`)
  if (entry.notes.length > 0) {
    console.log('\n  Notes :')
    for (const note of entry.notes) console.log(`    - ${note}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const jsonOutput = process.argv.includes('--json')
  const saveJson = process.argv.includes('--save-json')

  if (!jsonOutput) {
    console.log('\n⚖️  COMPARATEUR V1 vs V2 — Nestenn Juridique')
    console.log(`   Date : ${new Date().toISOString()}`)
    console.log(`   V1 URL : ${V1_BASE_URL}/api/chat (serveur Next.js requis)`)
    console.log(`   V2 : orchestrateur local (Mistral Large 2512)`)
  }

  const entries: ComparisonEntry[] = []

  for (const gold of GOLD_CASES) {
    if (!jsonOutput) {
      process.stdout.write(`\n⏳ ${gold.id} — appel V1 en cours…`)
    }

    // ── Appel V1 ────────────────────────────────────────────────────────────
    const v1Answer = await callV1(gold.question)
    if (!jsonOutput) {
      process.stdout.write(v1Answer ? ' ✓' : ' ⚠️ N/A')
      process.stdout.write('  |  V2 en cours…')
    }

    // ── Appel V2 ────────────────────────────────────────────────────────────
    let v2Answer: string | null = null
    let v2ScoreInternal: BenchmarkScore | null = null
    let v2Matched = false

    try {
      const v2Result = await runLegalBriefOrchestrator(gold.question)

      if (v2Result.status === 'ok') {
        v2Matched = true
        v2Answer = v2Result.finalAnswer

        v2ScoreInternal = scoreAnswer(
          gold.id,
          v2Result.finalAnswer,
          v2Result.validationReportFinal,
          v2Result.legalBrief
        )
      }
    } catch {
      // V2 a planté — on continue avec null
    }

    if (!jsonOutput) {
      process.stdout.write(v2Answer ? ' ✓\n' : ' ❌ N/A\n')
    }

    // ── Scoring gold ─────────────────────────────────────────────────────────
    const goldCase = getGoldCase(gold.id)!
    const v1ScoreGold = v1Answer ? scoreAgainstGold(v1Answer, goldCase) : null
    const v2ScoreGold = v2Answer ? scoreAgainstGold(v2Answer, goldCase) : null

    // ── Winner ───────────────────────────────────────────────────────────────
    const winner: WinnerVerdict | null =
      v1ScoreGold && v2ScoreGold
        ? determineWinner(v1ScoreGold.total, v2ScoreGold.total, v2Matched)
        : v1ScoreGold && !v2Matched
        ? 'V2_NO_MATCH'
        : null

    // ── Notes ────────────────────────────────────────────────────────────────
    const notes: string[] = []
    if (!v1Answer) notes.push('V1 inaccessible — lancer npm run dev')
    if (!v2Matched) notes.push('V2 : aucun playbook matché pour cette question')
    if (v2ScoreGold && v1ScoreGold) {
      const diff = v2ScoreGold.total - v1ScoreGold.total
      if (Math.abs(diff) < 1) notes.push('Scores proches — écart < 1 point')
    }

    entries.push({
      questionId: gold.id,
      question: gold.question,
      v1Answer,
      v2Answer,
      v1ScoreInternal: null,
      v2ScoreInternal,
      v1ScoreGold,
      v2ScoreGold,
      winner,
      notes,
    })
  }

  if (jsonOutput) {
    console.log(JSON.stringify(entries, null, 2))
    return
  }

  // Affichage détaillé
  for (const entry of entries) {
    printDetailedEntry(entry)
  }

  // Tableau récapitulatif
  printComparisonTable(entries)

  // Résumé final
  printHeader('RÉSUMÉ')
  const v2Wins = entries.filter((e) => e.winner === 'V2').length
  const v1Wins = entries.filter((e) => e.winner === 'V1').length
  const ties   = entries.filter((e) => e.winner === 'TIE').length
  const noMatch = entries.filter((e) => e.winner === 'V2_NO_MATCH').length
  const noV1   = entries.filter((e) => !e.v1Answer).length

  console.log(`\n  V2 gagne    : ${v2Wins}/${GOLD_CASES.length}`)
  console.log(`  V1 gagne    : ${v1Wins}/${GOLD_CASES.length}`)
  console.log(`  Égalité     : ${ties}/${GOLD_CASES.length}`)
  console.log(`  V2 no match : ${noMatch}/${GOLD_CASES.length}`)
  if (noV1 > 0) console.log(`  V1 N/A      : ${noV1}/${GOLD_CASES.length} (serveur non démarré)`)

  // Scores moyens
  const v2GoldScores = entries.filter((e) => e.v2ScoreGold).map((e) => e.v2ScoreGold!.total)
  const v1GoldScores = entries.filter((e) => e.v1ScoreGold).map((e) => e.v1ScoreGold!.total)
  if (v2GoldScores.length > 0) {
    console.log(`  Score gold moyen V2 : ${(v2GoldScores.reduce((a, b) => a + b, 0) / v2GoldScores.length).toFixed(1)}/20`)
  }
  if (v1GoldScores.length > 0) {
    console.log(`  Score gold moyen V1 : ${(v1GoldScores.reduce((a, b) => a + b, 0) / v1GoldScores.length).toFixed(1)}/20`)
  }

  console.log('')

  if (saveJson) {
    const outPath = resolve(
      __dirname,
      `../comparison-v1-v2-${new Date().toISOString().slice(0, 10)}.json`
    )
    writeFileSync(outPath, JSON.stringify(entries, null, 2), 'utf-8')
    console.log(`  💾 JSON sauvegardé : ${outPath}`)
  }
}

main().catch((err) => {
  console.error('Erreur fatale du comparateur :', err)
  process.exit(1)
})
