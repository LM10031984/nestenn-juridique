// app/api/admin/analytics/agencies/route.ts
// Liste paginée des agences avec recherche et filtres — super_admin uniquement

export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { getApiUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const result = await getApiUser()
  if ('error' in result) return result.error

  const { user } = result
  if (user.role !== 'super_admin') {
    return Response.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const supabase = createClient()
  const params = req.nextUrl.searchParams

  const page   = Math.max(1, parseInt(params.get('page')   ?? '1'))
  const limit  = 20
  const offset = (page - 1) * limit
  const search = params.get('search') || null
  const filter = params.get('filter') || 'all'
  const sort   = params.get('sort')   || 'questions'

  const { data, error } = await supabase.rpc('get_analytics_by_agency', {
    p_limit:  limit,
    p_offset: offset,
    p_search: search,
    p_filter: filter,
    p_sort:   sort,
  })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const totalCount = (data as any[])?.[0]?.total_count ?? 0
  const totalPages = Math.ceil(Number(totalCount) / limit)

  return Response.json({
    agencies: data ?? [],
    pagination: { page, totalPages, totalCount: Number(totalCount), limit },
  })
}
