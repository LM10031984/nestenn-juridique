// app/api/admin/feedback-report/route.ts
// Rapport analytics des feedbacks — accessible aux admins seulement

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

    // 20 derniers feedbacks négatifs
    const { data: negatives } = await supabase
      .from('feedback_reviews')
      .select('question, response, reason, created_at')
      .eq('feedback', -1)
      .order('created_at', { ascending: false })
      .limit(20)

    // Taux de satisfaction sur 30 jours
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const { data: allFeedbacks } = await supabase
      .from('feedback_reviews')
      .select('feedback')
      .gte('created_at', thirtyDaysAgo.toISOString())

    const total = allFeedbacks?.length ?? 0
    const positives = allFeedbacks?.filter(f => f.feedback === 1).length ?? 0
    const satisfactionRate = total > 0 ? Math.round((positives / total) * 100) : null

    // Questions récurrentes mal répondues (≥ 3 fois)
    const questionCount: Record<string, number> = {}
    for (const fb of (negatives ?? [])) {
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
      recurringIssues: recurring,
    })
  } catch (err) {
    console.error('[feedback-report] Error:', err)
    return Response.json({ error: 'Erreur interne' }, { status: 500 })
  }
}
