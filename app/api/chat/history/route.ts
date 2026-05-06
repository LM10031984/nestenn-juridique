import { createClient } from '@/lib/supabase/server'
import { getApiUser } from '@/lib/auth'
import { NextResponse } from 'next/server'

/**
 * app/api/chat/history/route.ts
 * Récupère l'historique des conversations de l'utilisateur connecté.
 */

export async function GET() {
  try {
    const authResult = await getApiUser()
    if ('error' in authResult) return authResult.error

    const supabase = createClient()
    
    // Récupération des conversations triées par date de création
    const { data, error } = await supabase
      .from('conversations')
      .select('id, title, created_at')
      .eq('user_id', authResult.user.id)
      .order('created_at', { ascending: false })
      .limit(30)

    if (error) {
      console.error('[History API] Error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('[History API] Exception:', error.message)
    return NextResponse.json(
      { error: 'Erreur lors de la récupération de l\'historique.' },
      { status: 500 }
    )
  }
}
