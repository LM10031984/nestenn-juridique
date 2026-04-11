import { NextRequest } from 'next/server'
import { getApiUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const result = await getApiUser()
  if ('error' in result) return result.error
  if (result.user.role !== 'super_admin') {
    return Response.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const { id, target } = await req.json()
  if (!id || !target) {
    return Response.json({ error: 'Paramètres id et target requis' }, { status: 400 })
  }

  if (!/^[a-z][a-z0-9_]*$/.test(target)) {
    return Response.json({ error: 'Le domaine cible doit être en snake_case' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Récupérer les articles associés à ce pending domain
  const { data: pendingData, error: fetchError } = await admin
    .from('pending_domains')
    .select('sample_article_ids')
    .eq('id', id)
    .single()

  if (fetchError) return Response.json({ error: fetchError.message }, { status: 500 })

  // Reclasser les articles dans le domaine cible
  if (pendingData?.sample_article_ids?.length > 0) {
    const { error: updateError } = await admin
      .from('legal_articles')
      .update({ domain: target })
      .in('id', pendingData.sample_article_ids)

    if (updateError) return Response.json({ error: updateError.message }, { status: 500 })
  }

  // Marquer comme fusionné
  const { error } = await admin
    .from('pending_domains')
    .update({
      status: 'merged',
      merged_into: target,
      reviewed_at: new Date().toISOString(),
      reviewed_by: result.user.id,
    })
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ success: true })
}
