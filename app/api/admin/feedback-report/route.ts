// app/api/admin/feedback-report/route.ts
// Rapport analytics des feedbacks — accessible aux admins seulement

export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(_req: NextRequest): Promise<Response> {
  try {
    const supabase = createClient()

    // Vérifier que l'utilisateur est admin
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return Response.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const { data: userProfile } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!userProfile || userProfile.role !== 'admin') {
      return Response.json({ error: 'Accès refusé' }, { status: 403 })
    }

    // Toutes les requêtes sont indépendantes — on les parallélise
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const [
      { data: negatives, error: negativesError },
      { data: negativesForRecurring, error: recurringError },
      { count: totalNegatives, error: countError },
      { data: allFeedbacks, error: allFeedbacksError },
    ] = await Promise.all([
      supabase
        .from('feedback_reviews')
        .select('id, question, response, reason, created_at')
        .eq('feedback', -1)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('feedback_reviews')
        .select('question')
        .eq('feedback', -1)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('feedback_reviews')
        .select('*', { count: 'exact', head: true })
        .eq('feedback', -1),
      supabase
        .from('feedback_reviews')
        .select('feedback')
        .gte('created_at', thirtyDaysAgo.toISOString()),
    ])

    if (negativesError || recurringError || countError || allFeedbacksError) {
      const err = negativesError ?? recurringError ?? countError ?? allFeedbacksError
      console.error('[feedback-report] Query error:', err)
      return Response.json({ error: 'Erreur base de données' }, { status: 500 })
    }

    const total = allFeedbacks?.length ?? 0
    const positives = allFeedbacks?.filter(f => f.feedback === 1).length ?? 0
    const satisfactionRate = total > 0 ? Math.round((positives / total) * 100) : null

    // Questions récurrentes mal répondues (≥ 3 fois) — calculé sur les 100 derniers
    const questionCount: Record<string, number> = {}
    for (const fb of (negativesForRecurring ?? [])) {
      const key = fb.question.slice(0, 100).toLowerCase()
      questionCount[key] = (questionCount[key] ?? 0) + 1
    }
    const recurring = Object.entries(questionCount)
      .filter(([, count]) => count >= 3)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([question, count]) => ({ question, count }))

    return Response.json({
      negatives: negatives ?? [],
      satisfactionRate,
      totalFeedbacks: total,
      totalNegatives: totalNegatives ?? 0,
      recurringIssues: recurring,
    })
  } catch (err) {
    console.error('[feedback-report] Error:', err)
    return Response.json({ error: 'Erreur interne' }, { status: 500 })
  }
}
