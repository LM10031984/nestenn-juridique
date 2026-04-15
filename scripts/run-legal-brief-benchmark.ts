// scripts/run-legal-brief-benchmark.ts
// Benchmark V2 — teste les 3 questions pilotes du moteur legal-brief
// Usage :
//   npx tsx scripts/run-legal-brief-benchmark.ts              → affichage lisible
//   npx tsx scripts/run-legal-brief-benchmark.ts --json       → JSON sur stdout
//   npx tsx scripts/run-legal-brief-benchmark.ts --save-json  → JSON sauvegardé dans un fichier

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
import type { OrchestratorResult } from '../lib/pipeline/legal-brief-orchestrator'
import { scoreAnswer } from '../lib/legal-benchmark-score'
import type { BenchmarkScore } from '../lib/legal-benchmark-score'

// ─────────────────────────────────────────────────────────────────────────────
// Questions benchmark exactes
// ─────────────────────────────────────────────────────────────────────────────

const BENCHMARK_QUESTIONS = [
  {
    id: 'Q1',
    playbook: 'vente_offre_contre_signee',
    question: "Une offre d'achat contresignée par le vendeur oblige-t-elle l'acquéreur à acheter ?",
  },
  {
    id: 'Q2',
    playbook: 'gestion_locative_depot_garantie',
    question:
      "Le propriétaire me demande de retenir une partie du dépôt de garantie pour des dégradations, mais l'état des lieux de sortie est incomplet. Que peut faire l'agence de gestion ?",
  },
  {
    id: 'Q3',
    playbook: 'environnement_immo_spanc',
    question: "Que faire si ma fosse septique n'est pas aux normes et que mon voisin m'a dénoncé ?",
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Type de sortie JSON stable
// ─────────────────────────────────────────────────────────────────────────────

type BenchmarkEntry = {
  questionId: string
  playbookId: string | null
  precisionBudget: string | null
  legalBrief: unknown | null
  initialAnswer: string | null
  finalAnswer: string | null
  validationReportInitial: unknown | null
  validationReportFinal: unknown | null
  benchmarkScore: BenchmarkScore | null
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

function printScore(score: BenchmarkScore) {
  printSection('Score Benchmark /20')
  console.log(`  Précision juridique   : ${score.legalAccuracy.toFixed(1)}/5`)
  console.log(`  Nuances obligatoires  : ${score.mandatoryNuances.toFixed(1)}/5`)
  console.log(`  Utilité pratique      : ${score.practicalUsefulness.toFixed(1)}/5`)
  console.log(`  Sécurité              : ${score.safety.toFixed(1)}/5`)
  console.log(`  ${hr('─', 35)}`)
  const icon = score.total >= 16 ? '✅' : score.total >= 12 ? '🟡' : '🔴'
  console.log(`  ${icon} TOTAL                 : ${score.total.toFixed(1)}/20`)
  if (score.comments.length > 0) {
    console.log('\n  Commentaires :')
    for (const c of score.comments) {
      console.log(`    - ${c}`)
    }
  }
}

function printResult(result: OrchestratorResult, questionId: string, question: string) {
  printHeader(`${questionId} — ${question.slice(0, 70)}...`)

  if (result.status === 'no_playbook_match') {
    console.log('\n  ❌ Aucun playbook matché')
    console.log(`  Domaine détecté : ${result.domain ?? 'inconnu'}`)
    return
  }

  // Playbook + budget
  printSection('Playbook & Précision')
  console.log(`  Playbook : ${result.playbookId}`)
  console.log(`  Precision budget : ${result.precisionBudget}`)
  console.log(`  Modèle : ${result.debugMetadata.modelUsed}`)
  console.log(`  Durée : ${result.debugMetadata.durationMs}ms`)

  if (result.debugMetadata.errors.length > 0) {
    console.log('\n  ⚠️  Erreurs pipeline :')
    for (const err of result.debugMetadata.errors) {
      console.log(`     - ${err}`)
    }
  }

  // Authority cards
  printSection('Authority Cards')
  if (result.legalBrief.authorityCards.length === 0) {
    console.log("  (aucune carte d'autorité résolue)")
  } else {
    for (const card of result.legalBrief.authorityCards) {
      const kind = card.kind === 'article' ? '📄' : '⚖️'
      console.log(`  ${kind} [${card.tag}] ${card.source}`)
      console.log(`     Règle : ${card.rule.slice(0, 120)}${card.rule.length > 120 ? '…' : ''}`)
      if (card.caveat) {
        console.log(`     Réserve : ${card.caveat.slice(0, 100)}${card.caveat.length > 100 ? '…' : ''}`)
      }
    }
  }

  // Legal brief (pièces manquantes)
  printSection('Legal Brief — Pièces manquantes')
  if (result.legalBrief.missingPieces.length === 0) {
    console.log('  (aucune pièce manquante)')
  } else {
    for (const m of result.legalBrief.missingPieces) {
      console.log(`  ⚠️  ${m}`)
    }
  }

  // Réponse initiale (si retry)
  if (result.retried) {
    printSection('Réponse initiale (avant retry)')
    const initialLines = result.initialAnswer.split('\n')
    for (const line of initialLines) {
      if (line.trim()) console.log(`  ${line}`)
    }

    printSection('Validation initiale')
    const { ok: initOk, issues: initIssues } = result.validationReportInitial
    console.log(`  Status : ${initOk ? '✅ OK' : '❌ Issues détectées'}`)
    for (const issue of initIssues) {
      const icon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢'
      console.log(`  ${icon} [${issue.severity.toUpperCase()}] ${issue.code}`)
      console.log(`     ${issue.message.slice(0, 150)}${issue.message.length > 150 ? '…' : ''}`)
    }
  }

  // Réponse finale générée
  printSection(result.retried ? 'Réponse finale (après retry)' : 'Réponse générée')
  const answerLines = result.finalAnswer.split('\n')
  for (const line of answerLines) {
    if (line.trim()) console.log(`  ${line}`)
  }

  // Retry info
  printSection('Retry')
  console.log(`  Retry déclenché : ${result.retried ? 'oui' : 'non'}`)

  // Rapport de validation finale
  printSection('Validation Report (finale)')
  const { ok, issues } = result.validationReportFinal
  console.log(`  Status : ${ok ? '✅ OK' : '❌ Issues détectées'}`)

  if (issues.length === 0) {
    console.log('  (aucun problème détecté)')
  } else {
    for (const issue of issues) {
      const icon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢'
      console.log(`  ${icon} [${issue.severity.toUpperCase()}] ${issue.code}`)
      console.log(`     ${issue.message.slice(0, 150)}${issue.message.length > 150 ? '…' : ''}`)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const jsonOutput = process.argv.includes('--json')
  const saveJson = process.argv.includes('--save-json')

  const results: Array<{ questionId: string; question: string; result: OrchestratorResult }> = []
  const benchmarkEntries: BenchmarkEntry[] = []

  if (!jsonOutput) {
    console.log('\n🏛️  BENCHMARK LEGAL-BRIEF V2 — Nestenn Juridique')
    console.log(`   ${BENCHMARK_QUESTIONS.length} questions pilotes | Modèle : mistralai/mistral-large-2512`)
    console.log(`   Date : ${new Date().toISOString()}`)
  }

  for (const benchmark of BENCHMARK_QUESTIONS) {
    if (!jsonOutput) {
      process.stdout.write(`\n⏳ ${benchmark.id} — traitement en cours…`)
    }

    let result: OrchestratorResult
    try {
      result = await runLegalBriefOrchestrator(benchmark.question)
      results.push({ questionId: benchmark.id, question: benchmark.question, result })

      if (!jsonOutput) {
        process.stdout.write(' ✓\n')
        printResult(result, benchmark.id, benchmark.question)
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      if (!jsonOutput) {
        process.stdout.write(` ❌ Erreur : ${errorMsg}\n`)
      }
      result = { status: 'no_playbook_match', domain: null }
      results.push({
        questionId: benchmark.id,
        question: benchmark.question,
        result,
      })
    }

    // Calcul du score si la question a été traitée
    if (result.status === 'ok') {
      const score = scoreAnswer(
        benchmark.id,
        result.finalAnswer,
        result.validationReportFinal,
        result.legalBrief
      )

      if (!jsonOutput) {
        printScore(score)
      }

      benchmarkEntries.push({
        questionId: benchmark.id,
        playbookId: result.playbookId,
        precisionBudget: result.precisionBudget,
        legalBrief: result.legalBrief,
        initialAnswer: result.initialAnswer,
        finalAnswer: result.finalAnswer,
        validationReportInitial: result.validationReportInitial,
        validationReportFinal: result.validationReportFinal,
        benchmarkScore: score,
      })
    } else {
      benchmarkEntries.push({
        questionId: benchmark.id,
        playbookId: null,
        precisionBudget: null,
        legalBrief: null,
        initialAnswer: null,
        finalAnswer: null,
        validationReportInitial: null,
        validationReportFinal: null,
        benchmarkScore: null,
      })
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify(benchmarkEntries, null, 2))
    return
  }

  if (saveJson) {
    const outPath = resolve(
      __dirname,
      `../benchmark-results-${new Date().toISOString().slice(0, 10)}.json`
    )
    writeFileSync(outPath, JSON.stringify(benchmarkEntries, null, 2), 'utf-8')
    console.log(`\n  💾 JSON sauvegardé : ${outPath}`)
  }

  // Résumé final
  printHeader('RÉSUMÉ BENCHMARK')
  let matched = 0
  let validated = 0
  let totalDuration = 0
  let totalScore = 0
  let scoredCount = 0
  let retriedCount = 0

  for (const { result } of results) {
    if (result.status === 'ok') {
      matched++
      if (result.validationReport.ok) validated++
      totalDuration += result.debugMetadata.durationMs
      if (result.retried) retriedCount++
    }
  }

  for (const entry of benchmarkEntries) {
    if (entry.benchmarkScore) {
      totalScore += entry.benchmarkScore.total
      scoredCount++
    }
  }

  console.log(`\n  Playbooks matchés : ${matched}/${results.length}`)
  console.log(`  Réponses validées : ${validated}/${matched} (validation finale)`)
  console.log(`  Retries déclenchés : ${retriedCount}/${matched}`)
  if (scoredCount > 0) {
    console.log(`  Score moyen : ${(totalScore / scoredCount).toFixed(1)}/20`)
  }
  console.log(
    `  Durée totale : ${totalDuration}ms (moyenne : ${Math.round(totalDuration / Math.max(matched, 1))}ms/question)`
  )
  console.log('')
}

main().catch((err) => {
  console.error('Erreur fatale du benchmark :', err)
  process.exit(1)
})
