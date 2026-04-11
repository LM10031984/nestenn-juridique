import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export type UserRole = 'super_admin' | 'responsable_agence' | 'conseiller'
export type UserStatus = 'pending' | 'active' | 'rejected'

export interface AuthUser {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  status: UserStatus
  agency_id: string | null
  can_switch_model: boolean
}

// Retourne l'utilisateur connecté ou null
export async function getUser(): Promise<AuthUser | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('full_name, role, status, agency_id, can_switch_model')
    .eq('id', user.id)
    .single()

  if (!profile) return null

  return {
    id: user.id,
    email: user.email ?? '',
    full_name: profile.full_name,
    role: profile.role as UserRole,
    status: profile.status as UserStatus,
    agency_id: profile.agency_id,
    can_switch_model: profile.can_switch_model ?? false,
  }
}

// Requiert une session — redirige sinon
export async function requireAuth(): Promise<AuthUser> {
  const user = await getUser()
  if (!user) redirect('/login')
  if (user.status === 'pending') redirect('/pending')
  if (user.status === 'rejected') redirect('/login?error=rejected')
  return user
}

// Requiert un rôle spécifique
export async function requireRole(roles: UserRole[]): Promise<AuthUser> {
  const user = await requireAuth()
  if (!roles.includes(user.role)) redirect('/chat')
  return user
}

// Pour les routes API — retourne une Response d'erreur au lieu de redirect
export async function getApiUser(): Promise<{ user: AuthUser } | { error: Response }> {
  const user = await getUser()
  if (!user) {
    return { error: new Response(JSON.stringify({ error: 'Non authentifié' }), { status: 401 }) }
  }
  if (user.status !== 'active') {
    return { error: new Response(JSON.stringify({ error: 'Compte en attente de validation' }), { status: 403 }) }
  }
  return { user }
}
