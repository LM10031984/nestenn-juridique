export const dynamic = 'force-dynamic'

import { getApiUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const result = await getApiUser()
  if ('error' in result) return result.error
  if (result.user.role !== 'super_admin') {
    return Response.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const admin = createAdminClient()

  // Domaines en attente + historique
  const { data: pending, error: pendingError } = await admin
    .from('pending_domains')
    .select('id, suggested_name, suggested_label, confidence_avg, article_count, sample_keywords, status, created_at, merged_into')
    .order('article_count', { ascending: false })

  if (pendingError) return Response.json({ error: pendingError.message }, { status: 500 })

  // Domaines actifs (groupés par domain sur legal_articles)
  const { data: articles, error: articlesError } = await admin
    .from('legal_articles')
    .select('domain')

  if (articlesError) return Response.json({ error: articlesError.message }, { status: 500 })

  const domainCounts: Record<string, number> = {}
  for (const row of articles ?? []) {
    if (row.domain) {
      domainCounts[row.domain] = (domainCounts[row.domain] ?? 0) + 1
    }
  }
  const activeDomains = Object.entries(domainCounts)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)

  // Statistiques par status
  const statusGroups: Record<string, number> = {}
  for (const d of pending ?? []) {
    statusGroups[d.status] = (statusGroups[d.status] ?? 0) + 1
  }

  const oneMonthAgo = new Date()
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)
  const { count: autoCreatedThisMonth } = await admin
    .from('pending_domains')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'auto_created')
    .gte('auto_created_at', oneMonthAgo.toISOString())

  const stats = {
    pending: statusGroups['pending'] ?? 0,
    approved: statusGroups['approved'] ?? 0,
    rejected: statusGroups['rejected'] ?? 0,
    merged: statusGroups['merged'] ?? 0,
    auto_created: statusGroups['auto_created'] ?? 0,
    auto_created_this_month: autoCreatedThisMonth ?? 0,
  }

  return Response.json({ pending, activeDomains, stats })
}
