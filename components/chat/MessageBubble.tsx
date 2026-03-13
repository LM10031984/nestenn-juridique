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

/** Renders **bold** markers as <strong> and newlines as <br /> */
function renderContent(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const parts = text.split(/(\*\*[^*]+\*\*|\n)/g)

  parts.forEach((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      nodes.push(<strong key={i}>{part.slice(2, -2)}</strong>)
    } else if (part === '\n') {
      nodes.push(<br key={i} />)
    } else {
      nodes.push(part)
    }
  })

  return nodes
}

/** Small inline Nestenn house icon for assistant header */
function MiniNestennIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="flex-shrink-0"
    >
      <polygon
        points="8,1 1,7 15,7"
        fill="none"
        stroke="#00AEBC"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <rect
        x="2"
        y="6.5"
        width="12"
        height="8.5"
        fill="none"
        stroke="#00AEBC"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <rect x="5.5" y="10" width="5" height="5" fill="#00AEBC" rx="1" />
    </svg>
  )
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

  const formattedTime = timestamp
    ? timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : null

  // ── Rejection notice ──────────────────────────────────────────────────────
  if (isRejection) {
    return (
      <div className="message-appear flex justify-start px-4 py-1">
        <div className="max-w-[85%] sm:max-w-[70%] bg-[#FFF7F0] border-l-[3px] border-nestenn-red rounded-lg rounded-tl-sm px-4 py-3 flex gap-3 shadow-sm">
          <AlertCircle className="text-nestenn-red mt-0.5 flex-shrink-0" size={18} />
          <p className="text-nestenn-gray text-sm font-metropolis leading-relaxed">{content}</p>
        </div>
      </div>
    )
  }

  // ── User bubble ───────────────────────────────────────────────────────────
  if (role === 'user') {
    return (
      <div className="message-appear flex justify-end px-4 py-1">
        <div className="flex flex-col items-end gap-1 max-w-[85%] sm:max-w-[70%]">
          <div className="bg-nestenn-blue text-white px-4 py-3 rounded-[18px_18px_4px_18px] font-metropolis text-sm leading-relaxed">
            {content}
          </div>
          {formattedTime && (
            <span className="text-[11px] text-gray-400 pr-1">{formattedTime}</span>
          )}
        </div>
      </div>
    )
  }

  // ── Assistant bubble ──────────────────────────────────────────────────────
  return (
    <div
      className="message-appear flex justify-start px-4 py-1"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex flex-col items-start gap-1 max-w-[85%] sm:max-w-[75%]">
        {/* Bubble */}
        <div className="bg-white border border-gray-200 rounded-[18px_18px_18px_4px] shadow-sm px-4 py-3">
          {/* Header */}
          <div className="flex items-center gap-1.5 mb-2">
            <MiniNestennIcon />
            <span className="text-xs font-metropolis font-semibold text-nestenn-gray/70 tracking-wide">
              Nestenn Juridique
            </span>
          </div>

          {/* Content */}
          <div className={`legal-content text-nestenn-gray text-sm leading-relaxed font-metropolis${isStreaming ? ' typing-cursor' : ''}`}>
            {renderContent(content)}
          </div>
        </div>

        {/* Footer: time + feedback */}
        <div className="flex items-center gap-3 px-1">
          {formattedTime && (
            <span className="text-[11px] text-gray-400">{formattedTime}</span>
          )}

          {/* Feedback buttons — visible on hover or when feedback already given */}
          {onFeedback && (
            <div
              className={`flex items-center gap-1 transition-opacity duration-200 ${
                hovered || feedbackGiven !== null ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <button
                onClick={() => onFeedback(1)}
                disabled={feedbackGiven !== null}
                title="Réponse utile"
                aria-label="Marquer comme utile"
                className={`p-1 rounded transition-colors ${
                  feedbackGiven === 1
                    ? 'text-nestenn-blue'
                    : 'text-gray-400 hover:text-nestenn-blue'
                } disabled:cursor-default`}
              >
                <ThumbsUp size={14} />
              </button>
              <button
                onClick={() => onFeedback(-1)}
                disabled={feedbackGiven !== null}
                title="Réponse à améliorer"
                aria-label="Marquer comme à améliorer"
                className={`p-1 rounded transition-colors ${
                  feedbackGiven === -1
                    ? 'text-nestenn-red'
                    : 'text-gray-400 hover:text-nestenn-red'
                } disabled:cursor-default`}
              >
                <ThumbsDown size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
