// app/api/admin/analytics/agency/[slug]/route.ts
// Détail d'une agence — super_admin uniquement

export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { getApiUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  const result = await getApiUser()
  if ('error' in result) return result.error

  const { user } = result
  if (user.role !== 'super_admin') {
    return Response.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const supabase = createClient()
  const period = parseInt(req.nextUrl.searchParams.get('period') ?? '30')

  const { data, error } = await supabase.rpc('get_agency_detail', {
    p_slug:   params.slug,
    p_period: period,
  })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data || !(data as any).agency) {
    return Response.json({ error: 'Agence introuvable' }, { status: 404 })
  }

  return Response.json(data)
}
