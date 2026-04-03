'use client'

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Send, Scale, AlertTriangle, Mic, Paperclip, FileText, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { SuggestionCard } from '@/components/SuggestionCard'
import { LegalDisclaimer } from '@/components/LegalDisclaimer'
import { LetterModal } from '@/components/LetterModal'
import ConversationSidebar from '@/components/chat/ConversationSidebar'
import {
  loadConversations,
  saveConversation,
  deleteConversation,
  generateTitle,
  type StoredConversation,
} from '@/lib/conversation-storage'
import { getOrCreateConversation, saveMessage, resetConversation } from '@/lib/chat-persistence'

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

function stripBold(text: string) {
  return text.replace(/\*\*(.+?)\*\*/g, '$1')
}

function ThinkingBar() {
  const steps = ['Analyse de la question…', 'Consultation Légifrance…', 'Vérification jurisprudence…']
  const [step, setStep] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setStep(s => (s + 1) % steps.length), 2000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="flex-1 min-w-0">
      <motion.p key={step} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-muted-foreground mb-3">
        {steps[step]}
      </motion.p>
      <div className="relative h-0.5 rounded-full bg-border overflow-hidden">
        <motion.div
          className="absolute top-0 h-full bg-primary rounded-full"
          style={{ width: '40%' }}
          animate={{ left: ['-40%', '140%'] }}
          transition={{ duration: 1.8, ease: 'easeInOut', repeat: Infinity, repeatDelay: 0.1 }}
        />
      </div>
    </div>
  )
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

  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  const [uploadedDoc, setUploadedDoc] = useState<{ fileName: string; extractedText: string } | null>(null)
  const supabaseConvId = useRef<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const [isListening, setIsListening] = useState(false)
  const [hasSpeechSupport, setHasSpeechSupport] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    const SRClass = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    if (!SRClass) return
    setHasSpeechSupport(true)
    const ua = navigator.userAgent
    const ios = /iPad|iPhone|iPod/.test(ua) && /Safari/.test(ua) && !/Chrome/.test(ua)
    setIsIOS(ios)
  }, [])

  function toggleVoice() {
    if (isListening) {
      recognitionRef.current?.stop()
      return
    }
    const SRClass = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    if (!SRClass) return
    const recognition = new SRClass()
    recognition.lang = 'fr-FR'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognitionRef.current = recognition
    recognition.onstart = () => setIsListening(true)
    recognition.onend = () => setIsListening(false)
    recognition.onerror = () => setIsListening(false)
    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript ?? ''
      if (transcript) setInput(transcript)
    }
    recognition.start()
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset input pour permettre le même fichier
    if (fileInputRef.current) fileInputRef.current.value = ''

    setIsUploading(true)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/documents', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.text) {
        setUploadedDoc({ fileName: data.filename ?? file.name, extractedText: data.text })
      } else {
        alert(data.error ?? 'Erreur lors de l\'extraction du document.')
      }
    } catch {
      alert('Erreur réseau lors de l\'upload.')
    } finally {
      setIsUploading(false)
    }
  }

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

  function handleNewConversation() {
    abortControllerRef.current?.abort()
    setMessages([])
    setActiveConvId(genId())
    setIsLoading(false)
    supabaseConvId.current = null
    resetConversation()
    setIsSidebarOpen(false)
  }

  function handleSelectConversation(id: string) {
    const conv = conversations.find(c => c.id === id)
    if (!conv) return
    abortControllerRef.current?.abort()
    setIsLoading(false)
    setActiveConvId(id)
    setMessages(conv.messages.map(m => ({ id: m.id, role: m.role, content: m.content, timestamp: new Date(m.timestamp) })))
    setIsSidebarOpen(false)
  }

  function handleDeleteConversation(id: string) {
    deleteConversation(id)
    const updated = loadConversations()
    setConversations(updated)
    if (id === activeConvId) {
      if (updated.length > 0) {
        handleSelectConversation(updated[0].id)
      } else {
        setMessages([])
        setActiveConvId(genId())
      }
    }
  }

  function handleRenameConversation(_id: string, _newTitle: string) {
    setConversations(loadConversations())
  }

  // Scroll vers le bas uniquement quand un nouveau message apparaît (pas pendant le streaming)
  const prevMsgCount = useRef(0)
  useEffect(() => {
    const currentCount = messages.length
    if (currentCount > prevMsgCount.current || (!isLoading && prevMsgCount.current > 0)) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevMsgCount.current = currentCount
  }, [messages.length, isLoading])

  async function handleSubmit(question: string) {
    if (!question.trim() || isLoading) return
    setInput('')

    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal
    const convIdAtStart = activeConvId

    // Injecter le document si présent
    let fullMessage = question
    let docLabel: string | null = null
    if (uploadedDoc) {
      docLabel = uploadedDoc.fileName
      fullMessage = `[Document joint : ${uploadedDoc.fileName}]\n\n${uploadedDoc.extractedText.slice(0, 10000)}\n\n---\n\nMa question : ${question}`
      setUploadedDoc(null)
    }

    const userMsg: Message = {
      id: genId(),
      role: 'user',
      // Afficher uniquement la question + mention doc pour l'utilisateur
      content: docLabel ? `📎 ${docLabel}\n\n${question}` : question,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMsg])
    setIsLoading(true)

    const assistantId = genId()
    let finalContent = ''
    let isRejection = false

    // Persistance Supabase — crée conversation + sauvegarde message user
    let dbMessageId: string | null = null
    try {
      const firstUserMsg = messages.find(m => m.role === 'user')
      const title = firstUserMsg ? generateTitle(firstUserMsg.content) : generateTitle(question)
      if (!supabaseConvId.current) {
        supabaseConvId.current = await getOrCreateConversation(title)
      }
      if (supabaseConvId.current) {
        dbMessageId = await saveMessage(supabaseConvId.current, 'user', question)
      }
    } catch { /* silencieux — ne bloque jamais le chat */ }

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: fullMessage,
          conversationHistory: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
          messageId: dbMessageId ?? undefined,
          conversationId: supabaseConvId.current ?? undefined,
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
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Streaming annulé — nettoyer le placeholder de streaming
        setMessages(prev => prev.filter(m => m.id !== assistantId))
        return
      }
      setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: 'Erreur de connexion. Vérifiez votre réseau et réessayez.', isRejection: true, timestamp: new Date() }])
    } finally {
      setIsLoading(false)
      if (finalContent && convIdAtStart) {
        setMessages(prev => {
          const firstUser = prev.find(m => m.role === 'user')
          const title = firstUser ? generateTitle(firstUser.content) : 'Nouvelle conversation'
          const conv: StoredConversation = {
            id: convIdAtStart,
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
    <div className="flex h-[calc(100vh-3.5rem)] md:h-screen bg-background">
      {/* Sidebar des conversations */}
      <ConversationSidebar
        conversations={conversations}
        activeId={activeConvId}
        onSelect={handleSelectConversation}
        onNew={handleNewConversation}
        onDelete={handleDeleteConversation}
        onRename={handleRenameConversation}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      <div className="flex flex-col flex-1 min-w-0">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-card px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          {/* Bouton hamburger mobile pour ouvrir la sidebar conversations */}
          <button
            className="sm:hidden p-1.5 rounded-lg hover:bg-muted transition-colors mr-1"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Voir les conversations"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
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
                      <ThinkingBar />
                    ) : (
                      <div className="text-sm text-foreground/85 leading-relaxed font-serif-legal prose-legal-md">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[rehypeRaw]}
                          components={{
                            a: ({ href, children }) => (
                              <a href={href} target="_blank" rel="noopener noreferrer"
                                style={{ color: '#00AEBC', textDecoration: 'underline', fontWeight: 500 }}>
                                {children}
                              </a>
                            ),
                            h3: ({ children }) => <h3 style={{ fontSize: 15, fontWeight: 700, margin: '1em 0 0.4em', color: '#1F2937' }}>{children}</h3>,
                            h4: ({ children }) => <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0.8em 0 0.3em', color: '#374151' }}>{children}</h4>,
                            table: ({ children }) => (
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, margin: '0.5em 0' }}>{children}</table>
                            ),
                            th: ({ children }) => (
                              <th style={{ border: '1px solid #E5E7EB', padding: '6px 8px', background: '#F9FAFB', fontWeight: 600, textAlign: 'left', fontSize: 11 }}>{children}</th>
                            ),
                            td: ({ children }) => (
                              <td style={{ border: '1px solid #E5E7EB', padding: '6px 8px', fontSize: 12 }}>{children}</td>
                            ),
                            hr: () => <hr style={{ border: 'none', borderTop: '1px solid #E5E7EB', margin: '0.8em 0' }} />,
                            blockquote: ({ children }) => (
                              <blockquote style={{ borderLeft: '3px solid #00AEBC', paddingLeft: 12, margin: '0.5em 0', color: '#4B5563', fontStyle: 'italic' }}>{children}</blockquote>
                            ),
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                        {msg.isStreaming && <span className="inline-block w-0.5 h-[1em] bg-primary ml-0.5 align-middle animate-pulse" />}
                      </div>
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

          {isLoading && !messages.some(m => m.role === 'assistant' && m.isStreaming) && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-card rounded-xl border border-border p-6">
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Scale className="h-4 w-4 text-primary" />
                </div>
                <ThinkingBar />
              </div>
            </motion.div>
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
          {/* Badge document joint */}
          {uploadedDoc && (
            <div className="flex items-center gap-2 px-3 py-1.5 mb-2 bg-primary/10 rounded-lg text-xs w-fit">
              <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-primary font-medium truncate max-w-[200px]">{uploadedDoc.fileName}</span>
              <button
                onClick={() => setUploadedDoc(null)}
                className="text-primary/60 hover:text-primary transition-colors"
                aria-label="Retirer le document"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <div className="flex gap-2 mb-2">
            {/* Bouton upload fichier */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt"
              onChange={handleUpload}
              className="hidden"
              id="doc-upload"
            />
            <label
              htmlFor="doc-upload"
              className={`px-3 py-3 rounded-xl cursor-pointer transition-colors ${
                isUploading
                  ? 'bg-muted/50 text-muted-foreground/50 cursor-wait'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
              title="Joindre un document (PDF, DOCX, TXT)"
            >
              {isUploading
                ? <span className="block h-4 w-4 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
                : <Paperclip className="h-4 w-4" />
              }
            </label>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSubmit(input)}
              placeholder={isListening ? 'Écoute...' : uploadedDoc ? 'Posez votre question sur ce document...' : 'Posez votre question juridique...'}
              className="flex-1 px-4 py-3 rounded-xl border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-all"
              disabled={isLoading}
            />
            {hasSpeechSupport && (
              <div className="relative flex items-center justify-center">
                {isListening && (
                  <span className="absolute inset-0 rounded-xl bg-red-400 opacity-40 animate-ping" />
                )}
                <button
                  type="button"
                  onClick={toggleVoice}
                  disabled={isLoading}
                  title={isIOS ? 'Maintenez le bouton pour parler' : isListening ? 'Arrêter' : 'Saisie vocale'}
                  className={`relative px-4 py-3 rounded-xl transition-colors disabled:opacity-40 ${
                    isListening
                      ? 'bg-red-500 text-white hover:bg-red-600'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  <Mic className="h-4 w-4" />
                </button>
              </div>
            )}
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
    </div>
  )
}
