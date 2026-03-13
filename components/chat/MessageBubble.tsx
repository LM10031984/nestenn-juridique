'use client'

import { useState } from 'react'
import { ThumbsUp, ThumbsDown, AlertCircle } from 'lucide-react'

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  isRejection?: boolean
  onFeedback?: (value: 1 | -1) => void
  feedbackGiven?: 1 | -1 | null
  timestamp?: Date
}

/** Convert **bold** and newlines to React nodes */
function renderContent(text: string): React.ReactNode {
  const paragraphs = text.split('\n\n')
  return paragraphs.map((para, pi) => {
    const lines = para.split('\n')
    const rendered = lines.map((line, li) => {
      const parts = line.split(/(\*\*[^*]+\*\*)/)
      const nodes = parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={i}>{part.slice(2, -2)}</strong>
          : part
      )
      return (
        <span key={li}>
          {nodes}
          {li < lines.length - 1 && <br />}
        </span>
      )
    })
    return <p key={pi} style={{ margin: pi < paragraphs.length - 1 ? '0 0 0.65em' : '0' }}>{rendered}</p>
  })
}

export default function MessageBubble({
  role,
  content,
  isStreaming = false,
  isRejection = false,
  onFeedback,
  feedbackGiven = null,
  timestamp,
}: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false)

  const time = timestamp?.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

  /* ── Hors-périmètre ─────────────────────────────────────────────────────── */
  if (isRejection) {
    return (
      <div className="message-appear px-4 sm:px-6 py-1.5">
        <div className="max-w-[80%] flex gap-3 items-start rounded-xl px-4 py-3 border-l-4"
          style={{ background: '#FFF7F0', borderLeftColor: '#F4364C' }}>
          <AlertCircle size={16} style={{ color: '#F4364C', marginTop: 2, flexShrink: 0 }} />
          <p className="prose-legal text-sm m-0" style={{ textAlign: 'left' }}>{content}</p>
        </div>
      </div>
    )
  }

  /* ── Message utilisateur ────────────────────────────────────────────────── */
  if (role === 'user') {
    return (
      <div className="message-appear flex justify-end px-4 sm:px-6 py-1.5">
        <div className="flex flex-col items-end gap-1 max-w-[75%] sm:max-w-[65%]">
          <div className="rounded-2xl rounded-br-sm px-4 py-2.5 text-white text-sm leading-relaxed"
            style={{ background: '#00AEBC', fontFamily: 'Lato, sans-serif', textAlign: 'left' }}>
            {content}
          </div>
          {time && <span className="text-[11px] text-nestenn-muted pr-0.5">{time}</span>}
        </div>
      </div>
    )
  }

  /* ── Message assistant ──────────────────────────────────────────────────── */
  return (
    <div
      className="message-appear flex justify-start px-4 sm:px-6 py-1.5"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex flex-col items-start gap-1 max-w-[85%] sm:max-w-[75%]">
        {/* Bubble */}
        <div className="bg-white rounded-2xl rounded-tl-sm border px-4 py-3"
          style={{ borderColor: '#E5E7EB', borderLeftColor: '#00AEBC', borderLeftWidth: 3, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>

          {/* Header */}
          <div className="flex items-center gap-1.5 mb-2.5">
            <svg width="13" height="13" viewBox="0 0 32 32" fill="none" aria-hidden="true" className="flex-shrink-0">
              <path d="M16 3.5 L29 14 L3 14 Z" stroke="#00AEBC" strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
              <path d="M6 14 L6 29 L26 29 L26 14" stroke="#00AEBC" strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
              <path d="M11.5 23.5 L11.5 18 L20.5 23.5 L20.5 18" stroke="#00AEBC" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
            <span style={{ fontSize: 11, fontFamily: 'Lato, sans-serif', fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Nestenn Juridique
            </span>
          </div>

          {/* Content */}
          <div className={`prose-legal${isStreaming ? ' typing-cursor' : ''}`}>
            {renderContent(content)}
          </div>
        </div>

        {/* Footer: time + feedback */}
        <div className="flex items-center gap-3 pl-1">
          {time && <span className="text-[11px] text-nestenn-muted">{time}</span>}

          {onFeedback && (
            <div className={`flex items-center gap-0.5 transition-opacity duration-150 ${hovered || feedbackGiven !== null ? 'opacity-100' : 'opacity-0'}`}>
              <button
                onClick={() => onFeedback(1)}
                disabled={feedbackGiven !== null}
                aria-label="Utile"
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${feedbackGiven === 1 ? 'text-nestenn-blue bg-nestenn-blue-light' : 'text-nestenn-muted hover:text-nestenn-blue hover:bg-nestenn-blue-light'} disabled:cursor-default`}
              >
                <ThumbsUp size={13} />
              </button>
              <button
                onClick={() => onFeedback(-1)}
                disabled={feedbackGiven !== null}
                aria-label="À améliorer"
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${feedbackGiven === -1 ? 'text-nestenn-red bg-red-50' : 'text-nestenn-muted hover:text-nestenn-red hover:bg-red-50'} disabled:cursor-default`}
              >
                <ThumbsDown size={13} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
