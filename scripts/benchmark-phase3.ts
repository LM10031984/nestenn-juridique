// scripts/benchmark-phase3.ts
// Benchmark ciblé Phase 3 — Q7/Q8/Q9 (V2 uniquement, V1 = N/A si serveur absent)
//
// Usage : npx tsx scripts/benchmark-phase3.ts

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

try {
  const envPath = resolve(__dirname, '../.env.local')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
} catch { /* .env.local absent */ }

import { runLegalBriefOrchestrator } from '../lib/pipeline/legal-brief-orchestrator'
import { scoreAnswer } from '../lib/legal-benchmark-score'
import { scoreAgainstGold } from '../lib/legal-gold-score'
import { getGoldCase } from '../lib/legal-gold-cases'

const PHASE3_IDS = ['Q7', 'Q8', 'Q9']

const PHASE3_QUESTIONS: Record<string, string> = {
  Q7: "Mon locataire ne paie plus son loyer depuis 3 mois. Comment procéder à l'expulsion ?",
  Q8: "Mon logement est classé G au DPE. Puis-je le louer en 2025 ?",
  Q9: "Je veux résilier mon mandat exclusif de vente avant 3 mois, est-ce possible ?",
}

function hr(char = '─', w = 70) { return char.repeat(w) }

async function main() {
  console.log('\n' + hr('═'))
  console.log('  BENCHMARK PHASE 3 — Q7/Q8/Q9 (V2 live)')
  console.log(`  Date : ${new Date().toISOString()}`)
  console.log(hr('═'))

  const results: Array<{
    id: string
    question: string
    v2ScoreGold: number | null
    v2ScoreInternal: number | null
    detail: { mustInclude: number; mustAvoid: number; authority: number; practical: number } | null
    internalDetail: { accuracy: number; nuances: number; practical: number; safety: number } | null
    comments: string[]
    status: 'ok' | 'no_match' | 'error'
  }> = []

  for (const id of PHASE3_IDS) {
    const question = PHASE3_QUESTIONS[id]
    const goldCase = getGoldCase(id)

    if (!goldCase) {
      console.error(`\n[ERROR] Gold case ${id} introuvable`)
      continue
    }

    console.log(`\n⏳ ${id} — ${question.slice(0, 60)}…`)

    try {
      const v2Result = await runLegalBriefOrchestrator(question)

      if (v2Result.status !== 'ok') {
        console.log(`  ❌ Orchestrateur status=${v2Result.status}`)
        results.push({ id, question, v2ScoreGold: null, v2ScoreInternal: null, detail: null, internalDetail: null, comments: [`orchestrator_status=${v2Result.status}`], status: 'no_match' })
        continue
      }

      const goldScore = scoreAgainstGold(v2Result.finalAnswer, goldCase)
      const internalScore = scoreAnswer(id, v2Result.finalAnswer, v2Result.validationReportFinal, v2Result.legalBrief)

      console.log(`  ✓ Score gold : ${goldScore.total.toFixed(1)}/20`)
      console.log(`    mustInclude=${goldScore.mustIncludeScore}/5 | mustAvoid=${goldScore.mustAvoidScore}/5 | authority=${goldScore.authorityScore.toFixed(1)}/5 | practical=${goldScore.practicalScore.toFixed(1)}/5`)
      console.log(`  ✓ Score interne : ${internalScore.total}/20`)
      console.log(`    accuracy=${internalScore.legalAccuracy}/5 | nuances=${internalScore.mandatoryNuances}/5 | practical=${internalScore.practicalUsefulness}/5 | safety=${internalScore.safety}/5`)

      if (goldScore.comments.length > 0) {
        console.log(`  Commentaires :`)
        goldScore.comments.forEach(c => console.log(`    - ${c}`))
      }

      results.push({
        id,
        question,
        v2ScoreGold: goldScore.total,
        v2ScoreInternal: internalScore.total,
        detail: {
          mustInclude: goldScore.mustIncludeScore,
          mustAvoid: goldScore.mustAvoidScore,
          authority: goldScore.authorityScore,
          practical: goldScore.practicalScore,
        },
        internalDetail: {
          accuracy: internalScore.legalAccuracy,
          nuances: internalScore.mandatoryNuances,
          practical: internalScore.practicalUsefulness,
          safety: internalScore.safety,
        },
        comments: goldScore.comments,
        status: 'ok',
      })
    } catch (err) {
      console.error(`  ❌ Erreur : ${(err as Error).message}`)
      results.push({ id, question, v2ScoreGold: null, v2ScoreInternal: null, detail: null, internalDetail: null, comments: [`error: ${(err as Error).message}`], status: 'error' })
    }
  }

  // ── Tableau récapitulatif ──────────────────────────────────────────────────

  console.log('\n' + hr('═'))
  console.log('  TABLEAU RÉCAPITULATIF')
  console.log(hr('═'))
  console.log(`\n  ${'ID'.padEnd(4)} | ${'SCORE V1'.padEnd(10)} | ${'SCORE V2 GOLD'.padEnd(14)} | ${'SCORE V2 INT.'.padEnd(14)} | VERDICT`)
  console.log('  ' + hr('─', 66))

  for (const r of results) {
    const v1    = 'N/A (hors scope)'
    const v2g   = r.v2ScoreGold !== null ? `${r.v2ScoreGold.toFixed(1)}/20` : 'N/A'
    const v2i   = r.v2ScoreInternal !== null ? `${r.v2ScoreInternal}/20` : 'N/A'
    const seuil = (r.v2ScoreGold ?? 0) >= 17 ? '🟢 ACTIVABLE' : (r.v2ScoreGold ?? 0) >= 15 ? '🟡 CANDIDATE' : '🔴 À CORRIGER'
    console.log(`  ${r.id.padEnd(4)} | ${v1.padEnd(10)} | ${v2g.padEnd(14)} | ${v2i.padEnd(14)} | ${seuil}`)
  }

  console.log('\n  Seuil : ≥ 17/20 → ACTIVABLE | 15-16 → CANDIDATE | < 15 → À CORRIGER')

  // ── Verdicts individuels ───────────────────────────────────────────────────

  console.log('\n' + hr('═'))
  console.log('  VERDICTS PAR PLAYBOOK')
  console.log(hr('═'))

  for (const r of results) {
    const gold = r.v2ScoreGold ?? 0
    const internal = r.v2ScoreInternal ?? 0
    let verdict: string
    let action: string

    if (r.status !== 'ok') {
      verdict = '❌ ERREUR — orchestrateur non exécuté'
      action = 'Vérifier la configuration du playbook'
    } else if (gold >= 17 && internal >= 17) {
      verdict = '🟢 ACTIVABLE — seuils gold ET interne atteints'
      action = 'Ajouter à V2_ROLLOUT_PLAYBOOKS dans lib/legal-v2-rollout.ts'
    } else if (gold >= 17) {
      verdict = '🟡 ACTIVABLE (gold ok) — score interne à vérifier'
      action = 'Activer en surveillant score interne sur staging'
    } else if (gold >= 15) {
      verdict = '🟡 CANDIDATE — gold insuffisant pour whitelist immédiate'
      action = 'Améliorer mustInclude ou authority avant activation'
    } else {
      verdict = '🔴 À CORRIGER — score gold trop faible'
      action = 'Revoir playbook (triggers, forcedArticles, requiredDistinctions)'
    }

    console.log(`\n  ${r.id} — ${r.question.slice(0, 55)}`)
    console.log(`  ${verdict}`)
    console.log(`  → ${action}`)
    if (r.comments.length > 0) {
      r.comments.forEach(c => console.log(`     • ${c}`))
    }
  }

  // ── Whitelist proposée ─────────────────────────────────────────────────────

  const activables = results.filter(r => (r.v2ScoreGold ?? 0) >= 17 && r.status === 'ok')
  if (activables.length > 0) {
    console.log('\n' + hr('═'))
    console.log('  WHITELIST ROLLOUT MISE À JOUR (proposition)')
    console.log(hr('═'))
    console.log('\n  // Dans lib/legal-v2-rollout.ts → V2_ROLLOUT_PLAYBOOKS :')
    console.log('  export const V2_ROLLOUT_PLAYBOOKS = [')
    console.log('    // Phase 1')
    console.log("    'vente_offre_contre_signee',")
    console.log("    'gestion_locative_depot_garantie',")
    console.log("    'environnement_immo_spanc',")
    console.log('    // Phase 2')
    console.log("    'syndic_travaux_urgents',")
    console.log("    'vente_dpe_errone',")
    console.log("    'agent_defaut_information',")
    console.log('    // Phase 3 (nouveaux)')

    const PLAYBOOK_MAP: Record<string, string> = {
      Q7: 'baux_loyers_impayes_expulsion',
      Q8: 'diagnostics_dpe_fg_interdits',
      Q9: 'agent_mandat_exclusif_resiliation',
    }
    for (const r of activables) {
      console.log(`    '${PLAYBOOK_MAP[r.id]}',  // ${r.id} gold=${r.v2ScoreGold?.toFixed(1)}/20 interne=${r.v2ScoreInternal}/20`)
    }
    console.log('  ] as const')
  }

  console.log('\n' + hr('═') + '\n')
}

main().catch(console.error)
