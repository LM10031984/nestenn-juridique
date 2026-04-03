export const dynamic = 'force-dynamic'

import { NextRequest } from 'next/server'
import { getApiUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function GET() {
  const result = await getApiUser()
  if ('error' in result) return result.error
  if (result.user.role !== 'super_admin') {
    return Response.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const admin = createAdminClient()

  const { data: agencies, error } = await admin
    .from('agencies')
    .select('id, name, slug, city, email, phone, credits_remaining, credits_total, is_active, created_at')
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Compter les utilisateurs par agence
  const { data: userCounts } = await admin
    .from('users')
    .select('agency_id')

  const countByAgency: Record<string, number> = {}
  for (const u of userCounts ?? []) {
    if (u.agency_id) countByAgency[u.agency_id] = (countByAgency[u.agency_id] ?? 0) + 1
  }

  const result2 = (agencies ?? []).map(a => ({
    ...a,
    user_count: countByAgency[a.id] ?? 0,
  }))

  return Response.json({ agencies: result2 })
}

export async function POST(req: NextRequest) {
  const result = await getApiUser()
  if ('error' in result) return result.error
  if (result.user.role !== 'super_admin') {
    return Response.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const { name, city, email, phone, credits } = await req.json()
  if (!name?.trim()) {
    return Response.json({ error: 'Le nom est requis' }, { status: 400 })
  }

  const slug = toSlug(`${name}${city ? '-' + city : ''}`)
  const creditsNum = Number(credits) || 1000

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('agencies')
    .insert({
      name: name.trim(),
      slug,
      city: city?.trim() || null,
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      credits_remaining: creditsNum,
      credits_total: creditsNum,
    })
    .select('id, name, slug, city')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ agency: data })
}
