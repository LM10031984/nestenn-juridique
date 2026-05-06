import { createClient } from '@/lib/supabase/server'
import { getApiUser } from '@/lib/auth'
import { NextResponse, NextRequest } from 'next/server'

/**
 * app/api/chat/[id]/messages/route.ts
 * Récupère les messages d'une conversation spécifique.
 */

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await getApiUser()
    if ('error' in authResult) return authResult.error

    const supabase = createClient()
    const { id } = params

    // Vérification que la conversation appartient bien à l'utilisateur
    const { data: conv, error: convError } = await supabase
      .from('conversations')
      .select('user_id')
      .eq('id', id)
      .single()

    if (convError || !conv) {
      return NextResponse.json({ error: 'Conversation non trouvée.' }, { status: 404 })
    }

    if (conv.user_id !== authResult.user.id) {
      return NextResponse.json({ error: 'Non autorisé.' }, { status: 403 })
    }

    // Récupération des messages
    const { data: messages, error: msgError } = await supabase
      .from('messages')
      .select('id, role, content, created_at, model_used')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })

    if (msgError) {
      return NextResponse.json({ error: msgError.message }, { status: 500 })
    }

    return NextResponse.json(messages)
  } catch (error: any) {
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 })
  }
}
