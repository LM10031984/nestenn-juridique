'use client'
// lib/chat-persistence.ts
// Persistance Supabase des conversations et messages depuis le chat client

import { createClient } from '@/lib/supabase/client'

let cachedConversationId: string | null = null
let cachedUserId: string | null = null
let cachedAgencyId: string | null = null

async function getUserContext(): Promise<{ userId: string; agencyId: string } | null> {
  if (cachedUserId && cachedAgencyId) {
    return { userId: cachedUserId, agencyId: cachedAgencyId }
  }
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('agency_id')
    .eq('id', user.id)
    .single()

  if (!profile?.agency_id) return null

  cachedUserId = user.id
  cachedAgencyId = profile.agency_id
  return { userId: user.id, agencyId: profile.agency_id }
}

// Crée ou réutilise la conversation active de la session
export async function getOrCreateConversation(title?: string): Promise<string | null> {
  if (cachedConversationId) return cachedConversationId

  const ctx = await getUserContext()
  if (!ctx) return null

  const supabase = createClient()
  const { data, error } = await supabase
    .from('conversations')
    .insert({
      user_id: ctx.userId,
      agency_id: ctx.agencyId,
      title: title ?? 'Nouvelle conversation',
    })
    .select('id')
    .single()

  if (error || !data) return null
  cachedConversationId = data.id
  return data.id
}

// Réinitialise la conversation (nouvelle session de chat)
export function resetConversation() {
  cachedConversationId = null
}

// Sauvegarde un message et retourne son UUID Supabase
export async function saveMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  modelUsed?: string,
): Promise<string | null> {
  const supabase = createClient()
  const payload: Record<string, unknown> = { conversation_id: conversationId, role, content }
  if (modelUsed) payload.model_used = modelUsed
  const { data, error } = await supabase
    .from('messages')
    .insert(payload)
    .select('id')
    .single()

  if (error || !data) return null
  return data.id
}
