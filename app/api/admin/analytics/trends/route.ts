// app/api/admin/analytics/trends/route.ts
// Activité hebdomadaire sur 5 semaines — super_admin uniquement

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
  const weeks = parseInt(req.nextUrl.searchParams.get('weeks') ?? '5')

  const { data, error } = await supabase.rpc('get_weekly_activity', { p_weeks: Math.min(weeks, 12) })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ weeks: data ?? [] })
}
