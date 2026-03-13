'use client'

import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { Send } from 'lucide-react'

interface ChatInputProps {
  onSubmit: (message: string) => void
  isLoading?: boolean
  disabled?: boolean
}

const MAX_CHARS = 2000
const WARN_THRESHOLD = 1800

export default function ChatInput({ onSubmit, isLoading = false, disabled = false }: ChatInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const lineHeight = 24
    const maxHeight = lineHeight * 4 + 24 // 4 lines + padding
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px'
  }, [value])

  const canSubmit = value.trim().length > 0 && !isLoading && !disabled && value.length <= MAX_CHARS

  function handleSubmit() {
    if (!canSubmit) return
    onSubmit(value.trim())
    setValue('')
    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const charCount = value.length
  const isOverLimit = charCount > MAX_CHARS
  const isNearLimit = charCount > WARN_THRESHOLD

  return (
    <div className="bg-white border-t border-gray-200 px-4 py-3">
      <div className="max-w-4xl mx-auto">
        <div
          className={`flex items-end gap-2 border rounded-2xl px-4 py-2 transition-colors bg-white ${
            isOverLimit
              ? 'border-nestenn-red focus-within:border-nestenn-red'
              : 'border-gray-300 focus-within:border-nestenn-blue'
          }`}
          style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Posez votre question juridique immobilière..."
            disabled={disabled || isLoading}
            rows={1}
            className="flex-1 resize-none bg-transparent text-nestenn-gray text-sm font-metropolis placeholder-gray-400 focus:outline-none leading-6 py-1 min-h-[32px] max-h-[120px] disabled:opacity-60"
            aria-label="Votre message"
          />

          {/* Send button */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-label="Envoyer le message"
            className={`flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-200 mb-0.5 ${
              canSubmit
                ? 'bg-nestenn-blue hover:bg-nestenn-blue-dark text-white shadow-sm hover:shadow-md'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            <Send
              size={16}
              className={isLoading ? 'animate-spin' : ''}
            />
          </button>
        </div>

        {/* Character counter */}
        <div className="flex justify-end mt-1 pr-1">
          {(isNearLimit || isOverLimit) && (
            <span
              className={`text-[11px] font-metropolis tabular-nums ${
                isOverLimit ? 'text-nestenn-red font-semibold' : 'text-gray-400'
              }`}
            >
              {charCount} / {MAX_CHARS}
            </span>
          )}
        </div>

        {/* Keyboard hint — desktop only */}
        <p className="hidden sm:block text-center text-[11px] text-gray-400 font-metropolis mt-1">
          Entrée pour envoyer · Shift+Entrée pour un saut de ligne
        </p>
      </div>
    </div>
  )
}
