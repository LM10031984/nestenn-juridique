// app/api/admin/analytics/network/route.ts
// KPIs réseau synthétiques — super_admin uniquement

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
  const period = parseInt(req.nextUrl.searchParams.get('period') ?? '30')

  const { data, error } = await supabase.rpc('get_network_kpis', { p_period: period })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json(data)
}
