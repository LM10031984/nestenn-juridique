// app/api/chat-v2/route.ts
// Route parallèle de test V2 — NE PAS MODIFIER /api/chat
// Phase 1 : outil de validation, pas route prod
// Accepte { message } — retourne JSON complet avec brief, answer, validation

import { NextRequest, NextResponse } from 'next/server'
import { runLegalBriefOrchestrator } from '@/lib/pipeline/legal-brief-orchestrator'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const message = (body.message ?? '').trim()

    if (!message) {
      return NextResponse.json(
        { error: 'Le champ "message" est requis.' },
        { status: 400 }
      )
    }

    if (message.length > 2000) {
      return NextResponse.json(
        { error: 'Message trop long (max 2000 caractères).' },
        { status: 400 }
      )
    }

    const result = await runLegalBriefOrchestrator(message)

    if (result.status === 'no_playbook_match') {
      return NextResponse.json({
        status: 'no_playbook_match',
        domain: result.domain,
        message: 'Aucun playbook V2 ne correspond à cette question. Phase 1 couvre 3 cas benchmark uniquement.',
      })
    }

    return NextResponse.json({
      status: 'ok',
      playbookId: result.playbookId,
      precisionBudget: result.precisionBudget,
      legalBrief: result.legalBrief,
      answer: result.answer,
      validationReport: result.validationReport,
      debugMetadata: result.debugMetadata,
    })
  } catch (err) {
    console.error('[chat-v2] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Erreur interne du moteur V2.', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
