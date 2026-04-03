export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { getApiUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const result = await getApiUser()
  if ('error' in result) return result.error
  if (result.user.role !== 'super_admin') {
    return Response.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const { email, password, fullName, agencyId, role } = await req.json()

  if (!email?.trim() || !password || !fullName?.trim() || !agencyId || !role) {
    return Response.json({ error: 'Tous les champs sont requis' }, { status: 400 })
  }

  const validRoles = ['conseiller', 'responsable_agence']
  if (!validRoles.includes(role)) {
    return Response.json({ error: 'Rôle invalide' }, { status: 400 })
  }

  const admin = createAdminClient()

  // 1. Créer le compte Auth (le trigger crée automatiquement le profil users avec status=pending)
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName.trim(),
      role,
      agency_id: agencyId,
    },
  })

  if (authError) return Response.json({ error: authError.message }, { status: 500 })

  const userId = authData.user.id

  // 2. Mettre à jour le profil : status=active, s'assurer que role et agency_id sont corrects
  //    (le trigger peut avoir mis des valeurs incorrectes si user_metadata n'a pas été lu)
  const { error: profileError } = await admin
    .from('users')
    .update({
      full_name: fullName.trim(),
      role,
      status: 'active',
      agency_id: agencyId,
    })
    .eq('id', userId)

  if (profileError) {
    // Rollback : supprimer l'utilisateur Auth si le profil échoue
    await admin.auth.admin.deleteUser(userId)
    return Response.json({ error: profileError.message }, { status: 500 })
  }

  return Response.json({ success: true, userId, email: email.trim() })
}
