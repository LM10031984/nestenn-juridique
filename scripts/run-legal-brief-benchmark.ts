// scripts/run-legal-brief-benchmark.ts
// Benchmark V2 — teste les 3 questions pilotes du moteur legal-brief
// Usage :
//   npx tsx scripts/run-legal-brief-benchmark.ts
//   npx tsx scripts/run-legal-brief-benchmark.ts --json   → sortie JSON brute

import { readFileSync } from 'fs'
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

function printResult(result: OrchestratorResult, questionId: string, question: string) {
  printHeader(`${questionId} — ${question.slice(0, 70)}...`)

  if (result.status === 'no_playbook_match') {
    console.log(`\n  ❌ Aucun playbook matché`)
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
    console.log(`\n  ⚠️  Erreurs pipeline :`)
    for (const err of result.debugMetadata.errors) {
      console.log(`     - ${err}`)
    }
  }

  // Authority cards
  printSection('Authority Cards')
  if (result.legalBrief.authorityCards.length === 0) {
    console.log('  (aucune carte d\'autorité résolue)')
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

  // Réponse générée
  printSection('Réponse générée')
  const answerLines = result.answer.split('\n')
  for (const line of answerLines) {
    if (line.trim()) console.log(`  ${line}`)
  }

  // Rapport de validation
  printSection('Validation Report')
  const { ok, issues } = result.validationReport
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
  const results: Array<{ questionId: string; question: string; result: OrchestratorResult }> = []

  if (!jsonOutput) {
    console.log('\n🏛️  BENCHMARK LEGAL-BRIEF V2 — Nestenn Juridique')
    console.log(`   ${BENCHMARK_QUESTIONS.length} questions pilotes | Modèle : mistralai/mistral-large-2512`)
    console.log(`   Date : ${new Date().toISOString()}`)
  }

  for (const benchmark of BENCHMARK_QUESTIONS) {
    if (!jsonOutput) {
      process.stdout.write(`\n⏳ ${benchmark.id} — traitement en cours…`)
    }

    try {
      const result = await runLegalBriefOrchestrator(benchmark.question)
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
      results.push({
        questionId: benchmark.id,
        question: benchmark.question,
        result: { status: 'no_playbook_match', domain: null },
      })
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2))
    return
  }

  // Résumé final
  printHeader('RÉSUMÉ BENCHMARK')
  let matched = 0
  let validated = 0
  let totalDuration = 0

  for (const { result } of results) {
    if (result.status === 'ok') {
      matched++
      if (result.validationReport.ok) validated++
      totalDuration += result.debugMetadata.durationMs
    }
  }

  console.log(`\n  Playbooks matchés : ${matched}/${results.length}`)
  console.log(`  Réponses validées : ${validated}/${matched}`)
  console.log(`  Durée totale : ${totalDuration}ms (moyenne : ${Math.round(totalDuration / Math.max(matched, 1))}ms/question)`)
  console.log('')
}

main().catch((err) => {
  console.error('Erreur fatale du benchmark :', err)
  process.exit(1)
})
