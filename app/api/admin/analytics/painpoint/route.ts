// app/api/admin/analytics/painpoint/route.ts
// Détail d'un pain point cliqué — super_admin uniquement

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

  const params = req.nextUrl.searchParams
  const theme  = params.get('theme')
  const period = parseInt(params.get('period') ?? '30')

  if (!theme) return Response.json({ error: 'Paramètre theme manquant' }, { status: 400 })

  const supabase = createClient()
  const { data, error } = await supabase.rpc('get_pain_point_detail', {
    p_theme:  theme,
    p_period: period,
  })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json(data)
}
