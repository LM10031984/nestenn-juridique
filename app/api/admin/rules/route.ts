import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * app/api/admin/rules/route.ts
 * Gestion de la liste des règles juridiques (Lecture & Suppression)
 */

export async function GET() {
  try {
    const supabaseAdmin = createAdminClient()

    // On récupère les 10 dernières règles ajoutées
    const { data, error } = await supabaseAdmin
      .from('legal_articles')
      .select('id, title, domain, created_at, article_num')
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) {
      console.error('[Admin Rules GET] Error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: 'Erreur lors de la récupération.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID requis pour la suppression.' }, { status: 400 })
    }

    const supabaseAdmin = createAdminClient()

    const { error } = await supabaseAdmin
      .from('legal_articles')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('[Admin Rules DELETE] Error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'Règle supprimée avec succès.' })
  } catch (error: any) {
    return NextResponse.json({ error: 'Erreur lors de la suppression.' }, { status: 500 })
  }
}
