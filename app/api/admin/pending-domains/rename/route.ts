import { NextRequest } from 'next/server'
import { getApiUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const result = await getApiUser()
  if ('error' in result) return result.error
  if (result.user.role !== 'super_admin') {
    return Response.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const { id, name, label } = await req.json()
  if (!id || !name || !label) {
    return Response.json({ error: 'Paramètres id, name et label requis' }, { status: 400 })
  }

  // Validation snake_case basique
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    return Response.json({ error: 'Le nom doit être en snake_case (lettres minuscules, chiffres, underscores)' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('pending_domains')
    .update({
      suggested_name: name,
      suggested_label: label,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
