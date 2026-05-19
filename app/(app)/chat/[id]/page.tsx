'use client'

import { ChatUI } from '../_components/ChatUI'

export default function DynamicChatPage({ params }: { params: { id: string } }) {
  return <ChatUI conversationId={params.id} />
}
