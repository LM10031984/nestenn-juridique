import { NextRequest } from 'next/server'
import { getApiUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const result = await getApiUser()
  if ('error' in result) return result.error
  if (result.user.role !== 'super_admin') {
    return Response.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const { id } = await req.json()
  if (!id) return Response.json({ error: 'Paramètre id manquant' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('pending_domains')
    .update({
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
      reviewed_by: result.user.id,
    })
    .eq('id', id)
    .eq('status', 'pending')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
