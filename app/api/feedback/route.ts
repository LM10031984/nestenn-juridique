// app/api/feedback/route.ts
// Enregistre le feedback (👍/👎) sur une réponse dans Supabase

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface FeedbackBody {
  question: string
  response: string
  feedback: 1 | -1
  reason?: string
  sessionId?: string
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: FeedbackBody
  try {
    body = await req.json() as FeedbackBody
  } catch {
    return Response.json({ error: 'JSON invalide' }, { status: 400 })
  }

  const { question, response: aiResponse, feedback, reason, sessionId } = body

  if (!question || !aiResponse || (feedback !== 1 && feedback !== -1)) {
    return Response.json({ error: 'Champs requis : question, response, feedback (1 ou -1)' }, { status: 400 })
  }

  try {
    const supabase = createClient()

    // Récupérer l'utilisateur connecté si disponible
    const { data: { user } } = await supabase.auth.getUser()

    const { error } = await supabase
      .from('feedback_reviews')
      .insert({
        question: question.slice(0, 2000),
        response: aiResponse.slice(0, 10000),
        feedback,
        reason: reason?.slice(0, 500),
        agent_id: user?.id ?? null,
        session_id: sessionId ?? null,
      })

    if (error) {
      console.error('[feedback] Supabase insert error:', error)
      return Response.json({ error: 'Erreur enregistrement feedback' }, { status: 500 })
    }

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[feedback] Unexpected error:', err)
    return Response.json({ error: 'Erreur interne' }, { status: 500 })
  }
}
