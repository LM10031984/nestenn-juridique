// app/api/admin/analytics/route.ts
// Dashboard analytics — questions par domaine, par agence, top questions

export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { getApiUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const result = await getApiUser()
  if ('error' in result) return result.error

  const { user } = result
  if (user.role !== 'super_admin' && user.role !== 'responsable_agence') {
    return Response.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const supabase = createClient()
  const isAdmin = user.role === 'super_admin'
  const agencyId = isAdmin ? null : user.agency_id

  const period = req.nextUrl.searchParams.get('period') ?? '30'
  const since = new Date()
  since.setDate(since.getDate() - parseInt(period))

  // Filtre agence pour responsable_agence
  function withAgencyFilter<T extends object>(query: T): T {
    if (!agencyId) return query
    // @ts-expect-error dynamic filter
    return (query as any).eq('conversations.agency_id', agencyId)
  }

  const baseMessages = supabase
    .from('messages')
    .select('domain, conversations!inner(agency_id)')
    .eq('role', 'user')
    .not('domain', 'is', null)
    .gte('created_at', since.toISOString())

  const [byDomainRes, byAgencyRes, topQuestionsRes, totalsRes] = await Promise.all([
    agencyId
      ? baseMessages.eq('conversations.agency_id', agencyId)
      : baseMessages,

    // Par agence (super_admin uniquement)
    isAdmin
      ? supabase.from('analytics_by_agency').select('agency_name, question_count').limit(50)
      : Promise.resolve({ data: [] }),

    // Top questions
    agencyId
      ? supabase.from('top_questions').select('domain, question_preview, ask_count').eq('agency_id', agencyId).limit(30)
      : supabase.from('top_questions').select('domain, question_preview, ask_count').limit(30),

    // Total
    agencyId
      ? supabase.from('messages').select('*, conversations!inner(agency_id)', { count: 'exact', head: true }).eq('role', 'user').eq('conversations.agency_id', agencyId).gte('created_at', since.toISOString())
      : supabase.from('messages').select('*', { count: 'exact', head: true }).eq('role', 'user').gte('created_at', since.toISOString()),
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
