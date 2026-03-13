'use client'

import { useState, useEffect, useRef } from 'react'
import ChatHeader from '@/components/chat/ChatHeader'
import ChatInput from '@/components/chat/ChatInput'
import MessageBubble from '@/components/chat/MessageBubble'
import TypingIndicator from '@/components/chat/TypingIndicator'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  isRejection?: boolean
  timestamp: Date
}

const WELCOME_MESSAGE = `Bonjour 👋 Je suis l'assistant juridique Nestenn, spécialisé en droit immobilier français.

Je peux vous aider sur :
• La loi Hoguet et les obligations des agents immobiliers
• Les baux d'habitation (locations vides et meublées)
• La copropriété et le règlement de copropriété
• Les diagnostics immobiliers obligatoires
• Les lois ALUR et ELAN
• Les transactions immobilières

Posez-moi votre question !`

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [dilaAvailable, setDilaAvailable] = useState(true)
  const [feedbacks, setFeedbacks] = useState<Record<string, 1 | -1>>({})

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  async function handleSubmit(message: string) {
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: message,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setIsLoading(true)

    // Prepare assistant message placeholder
    const assistantId = generateId()

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          conversationHistory: messages.slice(-10).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      })

      // Read DILA availability from response header
      const dilaHeader = response.headers.get('X-DILA-Available')
      if (dilaHeader !== null) {
        setDilaAvailable(dilaHeader === 'true')
      }

      // Check if it's a rejection (non-2xx or JSON error)
      if (!response.ok && response.status !== 200) {
        const errorData = await response.json().catch(() => ({ error: 'Erreur inconnue' }))
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: 'assistant',
            content: errorData.error ?? "Une erreur est survenue. Veuillez réessayer.",
            isRejection: true,
            timestamp: new Date(),
          },
        ])
        return
      }

      // Handle non-streaming JSON response (rejection / filter)
      const contentType = response.headers.get('Content-Type') ?? ''
      if (contentType.includes('application/json')) {
        const data = await response.json()
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: 'assistant',
            content: data.content ?? data.error ?? "Réponse non disponible.",
            isRejection: data.rejection === true,
            timestamp: new Date(),
          },
        ])
        return
      }

      // Streaming SSE response
      const reader = response.body?.getReader()
      if (!reader) throw new Error('Pas de body dans la réponse')

      const decoder = new TextDecoder()
      let accumulatedContent = ''

      // Add streaming assistant message
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          isStreaming: true,
          timestamp: new Date(),
        },
      ])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (data === '[DONE]') break
            try {
              const parsed = JSON.parse(data)
              const token: string =
                parsed.choices?.[0]?.delta?.content ??
                parsed.content ??
                parsed.token ??
                ''
              if (token) {
                accumulatedContent += token
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: accumulatedContent, isStreaming: true }
                      : m
                  )
                )
              }
            } catch {
              // Non-JSON chunk (plain text stream)
              accumulatedContent += data
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: accumulatedContent, isStreaming: true }
                    : m
                )
              )
            }
          }
        }
      }

      // Mark streaming as done
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, isStreaming: false } : m
        )
      )
    } catch (error) {
      console.error('Chat error:', error)
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content:
            "Une erreur de connexion est survenue. Vérifiez votre connexion internet et réessayez.",
          isRejection: true,
          timestamp: new Date(),
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  function handleFeedback(messageId: string, value: 1 | -1) {
    setFeedbacks((prev) => ({ ...prev, [messageId]: value }))
    // TODO: persist feedback via API
  }

  return (
    <div className="flex flex-col h-screen bg-nestenn-gray-light">
      {/* Header */}
      <ChatHeader dilaAvailable={dilaAvailable} />

      {/* Messages area */}
      <main
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto py-4"
        aria-label="Conversation"
      >
        <div className="max-w-4xl mx-auto">
          {/* Welcome screen */}
          {messages.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 max-w-lg w-full">
                <MessageBubble
                  role="assistant"
                  content={WELCOME_MESSAGE}
                  timestamp={new Date()}
                />
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              role={msg.role}
              content={msg.content}
              isStreaming={msg.isStreaming}
              isRejection={msg.isRejection}
              timestamp={msg.timestamp}
              feedbackGiven={feedbacks[msg.id] ?? null}
              onFeedback={
                msg.role === 'assistant' && !msg.isRejection
                  ? (value) => handleFeedback(msg.id, value)
                  : undefined
              }
            />
          ))}

          {/* Typing indicator */}
          {isLoading && <TypingIndicator />}

          {/* Scroll anchor */}
          <div ref={messagesEndRef} className="h-4" aria-hidden="true" />
        </div>
      </main>

      {/* Input area */}
      <ChatInput
        onSubmit={handleSubmit}
        isLoading={isLoading}
        disabled={isLoading}
      />
    </div>
  )
}
