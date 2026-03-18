'use client'

import { useState, useEffect, useRef } from 'react'
import ChatHeader from '@/components/chat/ChatHeader'
import ChatInput, { type AttachedFile } from '@/components/chat/ChatInput'
import MessageBubble from '@/components/chat/MessageBubble'
import TypingIndicator from '@/components/chat/TypingIndicator'
import ConversationSidebar from '@/components/chat/ConversationSidebar'
import {
  loadConversations,
  saveConversation,
  deleteConversation,
  generateTitle,
  type StoredConversation,
} from '@/lib/conversation-storage'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  isRejection?: boolean
  timestamp: Date
}

const SUGGESTIONS = [
  'Quelles sont les obligations d\'un agent immobilier selon la loi Hoguet ?',
  'Quels diagnostics sont obligatoires pour vendre un appartement ?',
  'Comment fonctionne la révision annuelle du loyer ?',
  'Qu\'est-ce que le droit de préemption urbain ?',
]

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [dilaAvailable, setDilaAvailable] = useState(false)
  const [feedbacks, setFeedbacks] = useState<Record<string, 1 | -1>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Sidebar state
  const [conversations, setConversations] = useState<StoredConversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Load conversations from localStorage on mount
  useEffect(() => {
    const stored = loadConversations()
    setConversations(stored)
    if (stored.length > 0) {
      // Restore last active conversation
      const last = stored[0]
      setActiveConvId(last.id)
      setMessages(
        last.messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.timestamp),
        }))
      )
    } else {
      setActiveConvId(genId())
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  function startNewConversation() {
    const newId = genId()
    setActiveConvId(newId)
    setMessages([])
    setFeedbacks({})
    setSidebarOpen(false)
  }

  function handleSelectConversation(id: string) {
    const conv = conversations.find(c => c.id === id)
    if (!conv) return
    setActiveConvId(id)
    setMessages(
      conv.messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: new Date(m.timestamp),
      }))
    )
    setFeedbacks({})
    setSidebarOpen(false)
  }

  function handleDeleteConversation(id: string) {
    deleteConversation(id)
    const updated = loadConversations()
    setConversations(updated)
    if (activeConvId === id) {
      startNewConversation()
    }
  }

  async function handleSubmit(message: string, attachedFile?: AttachedFile) {
    const userContent = attachedFile
      ? `${message}\n\n---\n📎 **Document joint : ${attachedFile.name}**\n\n${attachedFile.extractedText.slice(0, 8000)}`
      : message

    const userMsg: Message = {
      id: genId(),
      role: 'user',
      content: message || `Analyser : ${attachedFile?.name}`,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMsg])
    setIsLoading(true)

    const assistantId = genId()
    let finalAssistantContent = ''
    let isRejection = false

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userContent,
          conversationHistory: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        }),
      })

      const dilaHeader = res.headers.get('X-DILA-Available')
      if (dilaHeader !== null) setDilaAvailable(dilaHeader === 'true')

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erreur inconnue' }))
        const errContent = err.error ?? 'Erreur survenue.'
        setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: errContent, isRejection: true, timestamp: new Date() }])
        return
      }

      const ct = res.headers.get('Content-Type') ?? ''
      if (ct.includes('application/json')) {
        const data = await res.json()
        finalAssistantContent = data.content ?? data.error ?? 'Réponse indisponible.'
        isRejection = data.rejection === true
        setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: finalAssistantContent, isRejection, timestamp: new Date() }])
      } else {
        // SSE streaming
        const reader = res.body?.getReader()
        if (!reader) throw new Error('Pas de body')
        const decoder = new TextDecoder()
        let accumulated = ''

        setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', isStreaming: true, timestamp: new Date() }])

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const lines = decoder.decode(value, { stream: true }).split('\n')
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6).trim()
            if (raw === '[DONE]') break
            try {
              const parsed = JSON.parse(raw)
              const token: string = parsed.choices?.[0]?.delta?.content ?? parsed.content ?? parsed.token ?? ''
              if (token) {
                accumulated += token
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: accumulated } : m))
              }
            } catch {
              // Chunk JSON invalide ou partiel — ignorer silencieusement
            }
          }
        }

        finalAssistantContent = accumulated
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, isStreaming: false } : m))
      }
    } catch {
      setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: 'Erreur de connexion. Vérifiez votre réseau et réessayez.', isRejection: true, timestamp: new Date() }])
    } finally {
      setIsLoading(false)

      // Save conversation only after streaming is complete and we have content
      if (finalAssistantContent && activeConvId) {
        setMessages(prev => {
          const allMsgs = prev
          // Determine title from first user message
          const firstUser = allMsgs.find(m => m.role === 'user')
          const title = firstUser ? generateTitle(firstUser.content) : 'Nouvelle conversation'

          const conv: StoredConversation = {
            id: activeConvId,
            title,
            messages: allMsgs.map(m => ({
              id: m.id,
              role: m.role,
              content: m.content,
              timestamp: m.timestamp.toISOString(),
            })),
            createdAt: allMsgs[0]?.timestamp.toISOString() ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
          saveConversation(conv)
          setConversations(loadConversations())
          return prev
        })
      }
    }
  }

  async function handleFeedback(id: string, value: 1 | -1) {
    setFeedbacks(prev => ({ ...prev, [id]: value }))

    // Trouver la question associée (message user précédent)
    const msgIndex = messages.findIndex(m => m.id === id)
    const assistantMsg = messages[msgIndex]
    const precedingUserMsg = messages.slice(0, msgIndex).reverse().find(m => m.role === 'user')

    if (!assistantMsg || !precedingUserMsg) return

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: precedingUserMsg.content,
          response: assistantMsg.content,
          feedback: value,
          sessionId: activeConvId ?? undefined,
        }),
      })
      if (!res.ok) {
        console.warn('[feedback] API returned', res.status)
      }
    } catch {
      // Feedback non bloquant — on ignore silencieusement les erreurs réseau
    }
  }

  const isEmpty = messages.length === 0 && !isLoading

  return (
    <div className="flex h-screen" style={{ background: '#F0F4F8' }}>
      {/* Sidebar */}
      <ConversationSidebar
        conversations={conversations}
        activeId={activeConvId}
        onSelect={handleSelectConversation}
        onNew={startNewConversation}
        onDelete={handleDeleteConversation}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0">
        <ChatHeader dilaAvailable={dilaAvailable} onMenuClick={() => setSidebarOpen(true)} />

        {/* Messages */}
        <main className="flex-1 overflow-y-auto" style={{ scrollBehavior: 'smooth' }}>
          {isEmpty ? (
            /* ── Welcome screen ──────────────────────────────────────────────── */
            <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 pb-6">
              {/* Hero */}
              <div className="text-center mb-8">
                <p className="text-sm font-bold tracking-widest mb-3" style={{ color: '#00AEBC', fontFamily: 'Lato, sans-serif', textTransform: 'uppercase' }}>
                  Assistant IA · Droit immobilier français
                </p>
                <h1 style={{ fontFamily: '"EB Garamond", Georgia, serif', fontSize: 'clamp(1.6rem, 4vw, 2.4rem)', fontWeight: 600, color: '#0F2744', lineHeight: 1.25, marginBottom: '0.75rem' }}>
                  Votre expert juridique<br />immobilier, disponible 24h/24
                </h1>
                <p className="text-base" style={{ color: '#6B7280', fontFamily: 'Lato, sans-serif', maxWidth: 460, margin: '0 auto' }}>
                  Réponses précises avec sources officielles Légifrance. Posez votre question ou importez un document à analyser.
                </p>
              </div>

              {/* Capabilities */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
                {[
                  { icon: '⚖️', label: 'Loi Hoguet & agents' },
                  { icon: '🏠', label: 'Baux & locations' },
                  { icon: '🏢', label: 'Copropriété' },
                  { icon: '📋', label: 'Diagnostics obligatoires' },
                  { icon: '📜', label: 'ALUR · ELAN' },
                  { icon: '📎', label: 'Analyse de documents' },
                ].map(({ icon, label }) => (
                  <div key={label} className="flex items-center gap-2.5 bg-white rounded-xl px-3 py-2.5 border"
                    style={{ borderColor: '#E5E7EB', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                    <span style={{ fontSize: 18 }} aria-hidden="true">{icon}</span>
                    <span style={{ fontSize: 13, color: '#374151', fontFamily: 'Lato, sans-serif', fontWeight: 400 }}>{label}</span>
                  </div>
                ))}
              </div>

              {/* Suggestion chips */}
              <div>
                <p className="text-xs mb-3 font-bold tracking-wide" style={{ color: '#9CA3AF', fontFamily: 'Lato, sans-serif', textTransform: 'uppercase' }}>
                  Questions fréquentes
                </p>
                <div className="flex flex-col gap-2">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      onClick={() => handleSubmit(s)}
                      className="text-left px-4 py-3 rounded-xl border bg-white text-sm transition-all duration-150 cursor-pointer hover:border-nestenn-blue hover:shadow-card-hover"
                      style={{ borderColor: '#E5E7EB', color: '#374151', fontFamily: 'Lato, sans-serif', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* ── Message list ────────────────────────────────────────────────── */
            <div className="max-w-4xl mx-auto py-4">
              {messages.map(msg => (
                <MessageBubble
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  isStreaming={msg.isStreaming}
                  isRejection={msg.isRejection}
                  timestamp={msg.timestamp}
                  feedbackGiven={feedbacks[msg.id] ?? null}
                  onFeedback={msg.role === 'assistant' && !msg.isRejection ? v => handleFeedback(msg.id, v) : undefined}
                />
              ))}
              {isLoading && <TypingIndicator />}
              <div ref={messagesEndRef} className="h-4" aria-hidden="true" />
            </div>
          )}
        </main>

        {/* Input */}
        <ChatInput onSubmit={handleSubmit} isLoading={isLoading} disabled={isLoading} />
      </div>
    </div>
  )
}
