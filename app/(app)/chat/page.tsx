'use client'

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Send, Scale, AlertTriangle } from 'lucide-react'
import { SuggestionCard } from '@/components/SuggestionCard'
import { LegalDisclaimer } from '@/components/LegalDisclaimer'
import { LetterModal } from '@/components/LetterModal'
import {
  loadConversations,
  saveConversation,
  deleteConversation,
  generateTitle,
  type StoredConversation,
} from '@/lib/conversation-storage'

interface LetterSuggestion {
  needed: boolean
  type?: string
  recipient?: string
  lrar?: boolean
}

const SUGGESTIONS = [
  { question: 'Puis-je faire signer un mandat exclusif de 6 mois ?', category: 'Mandats' },
  { question: 'Quel est le délai de rétractation après un compromis ?', category: 'Transactions' },
  { question: 'Quelles sont les obligations d\'un syndic en copropriété ?', category: 'Copropriété' },
  { question: 'Quels diagnostics sont obligatoires pour une vente ?', category: 'Transactions' },
  { question: 'Quelles sont les conditions d\'exercice sous la loi Hoguet ?', category: 'Loi Hoguet' },
  { question: 'Comment fonctionne la révision annuelle du loyer ?', category: 'Gestion locative' },
]

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  isRejection?: boolean
  timestamp: Date
}

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [feedbacks, setFeedbacks] = useState<Record<string, 1 | -1>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [conversations, setConversations] = useState<StoredConversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [letterSuggestions, setLetterSuggestions] = useState<Record<string, LetterSuggestion>>({})
  const [letterModal, setLetterModal] = useState<{ open: boolean; msgId: string } | null>(null)

  useEffect(() => {
    const stored = loadConversations()
    setConversations(stored)
    if (stored.length > 0) {
      const last = stored[0]
      setActiveConvId(last.id)
      setMessages(last.messages.map(m => ({ id: m.id, role: m.role, content: m.content, timestamp: new Date(m.timestamp) })))
    } else {
      setActiveConvId(genId())
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  async function handleSubmit(question: string) {
    if (!question.trim() || isLoading) return
    setInput('')

    const userMsg: Message = { id: genId(), role: 'user', content: question, timestamp: new Date() }
    setMessages(prev => [...prev, userMsg])
    setIsLoading(true)

    const assistantId = genId()
    let finalContent = ''
    let isRejection = false

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: question,
          conversationHistory: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erreur inconnue' }))
        setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: err.error ?? 'Erreur survenue.', isRejection: true, timestamp: new Date() }])
        return
      }

      const ct = res.headers.get('Content-Type') ?? ''
      if (ct.includes('application/json')) {
        const data = await res.json()
        finalContent = data.content ?? data.error ?? 'Réponse indisponible.'
        isRejection = data.rejection === true
        setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: finalContent, isRejection, timestamp: new Date() }])
      } else {
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
            } catch { /* chunk partiel */ }
          }
        }

        // Extraction de la suggestion LETTER
        const letterMatch = accumulated.match(/\nLETTER:(\{[^}]+\})\s*$/)
        if (letterMatch) {
          try {
            const suggestion = JSON.parse(letterMatch[1]) as LetterSuggestion
            setLetterSuggestions(prev => ({ ...prev, [assistantId]: suggestion }))
          } catch { /* JSON malformé ignoré */ }
          accumulated = accumulated.replace(/\nLETTER:\{[^}]+\}\s*$/, '')
        }

        finalContent = accumulated
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: accumulated, isStreaming: false } : m))
      }
    } catch {
      setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: 'Erreur de connexion. Vérifiez votre réseau et réessayez.', isRejection: true, timestamp: new Date() }])
    } finally {
      setIsLoading(false)
      if (finalContent && activeConvId) {
        setMessages(prev => {
          const firstUser = prev.find(m => m.role === 'user')
          const title = firstUser ? generateTitle(firstUser.content) : 'Nouvelle conversation'
          const conv: StoredConversation = {
            id: activeConvId,
            title,
            messages: prev.map(m => ({ id: m.id, role: m.role, content: m.content, timestamp: m.timestamp.toISOString() })),
            createdAt: prev[0]?.timestamp.toISOString() ?? new Date().toISOString(),
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
    const msgIndex = messages.findIndex(m => m.id === id)
    const assistantMsg = messages[msgIndex]
    const precedingUserMsg = messages.slice(0, msgIndex).reverse().find(m => m.role === 'user')
    if (!assistantMsg || !precedingUserMsg) return
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: precedingUserMsg.content, response: assistantMsg.content, feedback: value, sessionId: activeConvId ?? undefined }),
      })
    } catch { /* non bloquant */ }
  }

  const showSuggestions = messages.length === 0 && !isLoading

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen bg-background">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-card px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Scale className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground">Assistant Juridique</h1>
            <p className="text-[11px] text-muted-foreground">Droit immobilier français • Sources Légifrance</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-6">

          {showSuggestions && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-card rounded-xl border border-border p-6">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Scale className="h-4 w-4 text-primary" />
                </div>
                <p className="font-serif-legal text-sm text-foreground/85 leading-relaxed">
                  Je suis votre assistant juridique spécialisé en droit immobilier français. Posez-moi vos questions sur la copropriété, les mandats, les baux, la loi Hoguet ou les diagnostics obligatoires — je vous réponds avec des sources officielles Légifrance.
                </p>
              </div>
            </motion.div>
          )}

          {messages.map((msg) => {
            if (msg.role === 'user') {
              return (
                <motion.div key={msg.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
                  <div className="bg-primary text-primary-foreground px-5 py-3 rounded-xl rounded-br-sm text-sm max-w-lg">
                    {msg.content}
                  </div>
                </motion.div>
              )
            }

            if (msg.isRejection) {
              return (
                <motion.div key={msg.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-card rounded-xl border border-orange-200 p-5">
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <AlertTriangle className="h-4 w-4 text-status-warning" />
                    </div>
                    <p className="text-sm text-foreground/80 leading-relaxed">{msg.content}</p>
                  </div>
                </motion.div>
              )
            }

            return (
              <motion.div key={msg.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-card rounded-xl border border-border p-6">
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Scale className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {msg.isStreaming && !msg.content ? (
                      <>
                        <div className="text-xs font-medium text-muted-foreground mb-2">Consultation des bases Légifrance...</div>
                        <div className="h-2 w-48 rounded-full bg-secondary animate-pulse" />
                      </>
                    ) : (
                      <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap font-serif-legal">
                        {msg.content}
                        {msg.isStreaming && <span className="inline-block w-0.5 h-[1em] bg-primary ml-0.5 align-middle animate-pulse" />}
                      </p>
                    )}
                    {!msg.isStreaming && msg.content && (
                      <div className="flex items-center gap-2 mt-3">
                        <span className="text-[10px] text-muted-foreground">Utile ?</span>
                        {([1, -1] as const).map(v => (
                          <button
                            key={v}
                            onClick={() => handleFeedback(msg.id, v)}
                            className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${feedbacks[msg.id] === v ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'}`}
                          >
                            {v === 1 ? '👍' : '👎'}
                          </button>
                        ))}
                      </div>
                    )}
                    {!msg.isStreaming && letterSuggestions[msg.id]?.needed === true && (
                      <div className="mt-4 p-4 rounded-lg border border-amber-200 bg-amber-50 flex items-center justify-between">
                        <div>
                          <p className="text-xs font-bold text-amber-700 uppercase tracking-wider">📝 Courrier recommandé</p>
                          <p className="text-sm text-amber-900 mt-0.5">
                            {letterSuggestions[msg.id].type}
                            {letterSuggestions[msg.id].lrar ? ' — envoi par LRAR conseillé' : ''}
                          </p>
                        </div>
                        <button
                          onClick={() => setLetterModal({ open: true, msgId: msg.id })}
                          className="px-4 py-2 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors"
                        >
                          Générer →
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )
          })}

          {showSuggestions && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Questions fréquentes</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SUGGESTIONS.map((s, i) => (
                  <SuggestionCard key={s.question} question={s.question} category={s.category} onClick={handleSubmit} index={i} />
                ))}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Letter Modal */}
      {letterModal?.open && (() => {
        const suggestion = letterSuggestions[letterModal.msgId]
        const context = messages
          .slice(-3)
          .map(m => `${m.role === 'user' ? 'Question' : 'Réponse'}: ${m.content}`)
          .join('\n\n')
        return (
          <LetterModal
            letterType={suggestion?.type ?? ''}
            recipient={suggestion?.recipient ?? ''}
            lrar={suggestion?.lrar ?? false}
            conversationContext={context}
            onClose={() => setLetterModal(null)}
          />
        )
      })()}

      {/* Input */}
      <div className="shrink-0 border-t border-border bg-card">
        <div className="max-w-3xl mx-auto px-6 py-3">
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSubmit(input)}
              placeholder="Posez votre question juridique..."
              className="flex-1 px-4 py-3 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-all"
              disabled={isLoading}
            />
            <button
              onClick={() => handleSubmit(input)}
              disabled={!input.trim() || isLoading}
              className="px-4 py-3 rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <LegalDisclaimer />
        </div>
      </div>
    </div>
  )
}
