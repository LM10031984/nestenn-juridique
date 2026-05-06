'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
          <div className="rounded-2xl rounded-br-sm px-4 py-2.5 text-slate-900 text-sm leading-relaxed bg-slate-100 border border-slate-200"
            style={{ fontFamily: 'Lato, sans-serif', textAlign: 'left' }}>
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
        {/* Header (déplacé hors de la bulle pour que l'icône soit visible avec sa couleur) */}
        <div className="flex items-center gap-1.5 mb-1 pl-1">
          <svg width="13" height="13" viewBox="0 0 32 32" fill="none" aria-hidden="true" className="flex-shrink-0 text-[#00a1b0]">
            <path d="M16 3.5 L29 14 L3 14 Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
            <path d="M6 14 L6 29 L26 29 L26 14" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
            <path d="M11.5 23.5 L11.5 18 L20.5 23.5 L20.5 18" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
          <span style={{ fontSize: 11, fontFamily: 'Lato, sans-serif', fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Nestenn Juridique
          </span>
        </div>

        {/* Bubble */}
        <div className="bg-[#00a1b0] text-white rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
          {/* Content */}
          <div className={`prose-legal${isStreaming ? ' typing-cursor' : ''}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer"
                    className="underline font-medium hover:text-white/80"
                    style={{ color: 'white' }}>
                    {children}
                  </a>
                ),
                p: ({ children }) => <p style={{ margin: '0 0 0.65em' }}>{children}</p>,
                h3: ({ children }) => <h3 style={{ fontSize: 14, fontWeight: 700, margin: '1em 0 0.4em', color: 'white' }}>{children}</h3>,
                h4: ({ children }) => <h4 style={{ fontSize: 13, fontWeight: 600, margin: '0.8em 0 0.3em', color: 'white' }}>{children}</h4>,
                strong: ({ children }) => <strong style={{ fontWeight: 700, color: 'white' }}>{children}</strong>,
                table: ({ children }) => (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, margin: '0.5em 0' }}>{children}</table>
                ),
                th: ({ children }) => (
                  <th style={{ border: '1px solid rgba(255,255,255,0.2)', padding: '6px 8px', background: 'rgba(0,0,0,0.1)', fontWeight: 600, textAlign: 'left', fontSize: 11 }}>{children}</th>
                ),
                td: ({ children }) => (
                  <td style={{ border: '1px solid rgba(255,255,255,0.2)', padding: '6px 8px', fontSize: 12 }}>{children}</td>
                ),
                hr: () => <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.2)', margin: '0.8em 0' }} />,
              }}
            >
              {content}
            </ReactMarkdown>
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
