// app/api/admin/analytics/inactive-agencies/route.ts
// Liste détaillée des agences inactives — super_admin uniquement

export const dynamic = 'force-dynamic'

import { getApiUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const result = await getApiUser()
  if ('error' in result) return result.error

  const { user } = result
  if (user.role !== 'super_admin') {
    return Response.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const supabase = createClient()
  const { data, error } = await supabase.rpc('get_inactive_agencies')

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json(data ?? [])
}
