// app/api/admin/analytics/route.ts
// Dashboard analytics — questions par domaine, par agence, top questions

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = createClient()

  // Auth check (accès admin ou director uniquement)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Non authentifié' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin' && profile?.role !== 'director') {
    return Response.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const period = req.nextUrl.searchParams.get('period') ?? '30'
  const since = new Date()
  since.setDate(since.getDate() - parseInt(period))

  const [byDomainRes, byAgencyRes, topQuestionsRes, totalsRes] = await Promise.all([
    // Questions avec domaine sur la période
    supabase
      .from('messages')
      .select('domain')
      .eq('role', 'user')
      .not('domain', 'is', null)
      .gte('created_at', since.toISOString()),

    // Par agence (via vue)
    supabase
      .from('analytics_by_agency')
      .select('agency_name, question_count')
      .limit(50),

    // Top questions
    supabase
      .from('top_questions')
      .select('domain, question_preview, ask_count')
      .limit(30),

    // Total questions sur la période
    supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'user')
      .gte('created_at', since.toISOString()),
  ])

  // Agréger par domaine côté serveur
  const domainCounts: Record<string, number> = {}
  for (const row of byDomainRes.data ?? []) {
    const d = (row.domain as string) ?? 'autre'
    domainCounts[d] = (domainCounts[d] ?? 0) + 1
  }

  const byDomain = Object.entries(domainCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([domain, count]) => ({ domain, count }))

  // Agréger les agences (vue peut avoir plusieurs lignes par agence si multi-domaine)
  const agencyCounts: Record<string, number> = {}
  for (const row of byAgencyRes.data ?? []) {
    const name = (row.agency_name as string) ?? 'Inconnue'
    agencyCounts[name] = (agencyCounts[name] ?? 0) + (row.question_count as number)
  }

  const byAgency = Object.entries(agencyCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([agency_name, question_count]) => ({ agency_name, question_count }))

  return Response.json({
    period: parseInt(period),
    totalQuestions: totalsRes.count ?? 0,
    byDomain,
    byAgency,
    topQuestions: topQuestionsRes.data ?? [],
  })
}
