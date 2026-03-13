'use client'

import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { Send, Paperclip, X, FileText, Loader2 } from 'lucide-react'

export interface AttachedFile {
  name: string
  extractedText: string
  size: number
}

interface ChatInputProps {
  onSubmit: (message: string, attachedFile?: AttachedFile) => void
  isLoading?: boolean
  disabled?: boolean
}

const MAX_CHARS = 2000
const ACCEPTED = '.pdf,.txt,.docx'

export default function ChatInput({ onSubmit, isLoading = false, disabled = false }: ChatInputProps) {
  const [value, setValue] = useState('')
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-resize
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [value])

  const canSubmit = (value.trim().length > 0 || attachedFile !== null) && !isLoading && !disabled && !isUploading && value.length <= MAX_CHARS

  function handleSubmit() {
    if (!canSubmit) return
    onSubmit(value.trim() || (attachedFile ? `Analyse ce document : ${attachedFile.name}` : ''), attachedFile ?? undefined)
    setValue('')
    setAttachedFile(null)
    setUploadError(null)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!fileInputRef.current) return
    fileInputRef.current.value = ''
    if (!file) return

    const maxMb = 10
    if (file.size > maxMb * 1024 * 1024) {
      setUploadError(`Fichier trop volumineux (max ${maxMb} Mo)`)
      return
    }

    setIsUploading(true)
    setUploadError(null)

    try {
      const form = new FormData()
      form.append('file', file)

      const res = await fetch('/api/documents', { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erreur lors de la lecture du fichier' }))
        throw new Error(err.error ?? 'Erreur inconnue')
      }

      const data = await res.json()
      setAttachedFile({ name: file.name, extractedText: data.text, size: file.size })
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Erreur lors de la lecture du fichier')
    } finally {
      setIsUploading(false)
    }
  }

  const isOver = value.length > MAX_CHARS
  const isNear = value.length > 1800

  return (
    <div className="bg-white border-t px-3 sm:px-6 py-3" style={{ borderColor: '#E5E7EB' }}>
      <div className="max-w-4xl mx-auto">
        {/* Attached file chip */}
        {attachedFile && (
          <div className="chip-appear flex items-center gap-2 mb-2 px-3 py-1.5 rounded-lg w-fit"
            style={{ background: '#E0F5F7', border: '1px solid #A7D9DE' }}>
            <FileText size={13} style={{ color: '#007D8A' }} />
            <span className="text-xs font-bold truncate max-w-[200px]" style={{ color: '#007D8A', fontFamily: 'Lato, sans-serif' }}>
              {attachedFile.name}
            </span>
            <span className="text-xs" style={{ color: '#9CA3AF', fontFamily: 'Lato, sans-serif' }}>
              ({Math.round(attachedFile.size / 1024)} Ko)
            </span>
            <button
              onClick={() => setAttachedFile(null)}
              aria-label="Retirer le fichier"
              className="ml-0.5 p-0.5 rounded cursor-pointer hover:bg-white/50 transition-colors"
              style={{ color: '#6B7280' }}
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Upload error */}
        {uploadError && (
          <p className="text-xs mb-2 px-1" style={{ color: '#F4364C', fontFamily: 'Lato, sans-serif' }}>
            {uploadError}
          </p>
        )}

        {/* Input row */}
        <div className={`flex items-end gap-2 rounded-2xl border px-3 py-2 transition-all bg-white ${
          isOver ? 'border-red-400' : 'border-gray-300 focus-within:border-nestenn-blue focus-within:shadow-input'
        }`}>
          {/* Attach button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isLoading || isUploading}
            aria-label="Joindre un document"
            title="Joindre un document (PDF, DOCX, TXT)"
            className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-xl transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed mb-0.5"
            style={{ color: attachedFile ? '#00AEBC' : '#9CA3AF' }}
          >
            {isUploading
              ? <Loader2 size={17} className="animate-spin" />
              : <Paperclip size={17} />
            }
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            onChange={handleFileChange}
            className="hidden"
            aria-hidden="true"
          />

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={attachedFile ? 'Posez votre question sur ce document...' : 'Posez votre question juridique immobilière...'}
            disabled={disabled || isLoading}
            rows={1}
            style={{ fontFamily: 'Lato, sans-serif', fontSize: 15, resize: 'none', background: 'transparent', outline: 'none', lineHeight: 1.6 }}
            className="flex-1 text-nestenn-gray placeholder-gray-400 min-h-[32px] max-h-[120px] py-1 disabled:opacity-60"
            aria-label="Votre message"
          />

          {/* Character count */}
          {isNear && (
            <span className="text-[11px] tabular-nums mb-1 flex-shrink-0" style={{ color: isOver ? '#F4364C' : '#9CA3AF', fontFamily: 'Lato, sans-serif' }}>
              {value.length}/{MAX_CHARS}
            </span>
          )}

          {/* Send button */}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-label="Envoyer"
            className={`flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-xl transition-all duration-200 mb-0.5 cursor-pointer ${
              canSubmit
                ? 'text-white hover:brightness-90 active:scale-95'
                : 'text-gray-400 cursor-not-allowed'
            }`}
            style={{ background: canSubmit ? '#00AEBC' : '#F3F4F6' }}
          >
            {isLoading
              ? <Loader2 size={16} className="animate-spin" />
              : <Send size={15} style={{ marginLeft: 1 }} />
            }
          </button>
        </div>

        {/* Hints */}
        <p className="hidden sm:block text-center text-[11px] mt-1.5" style={{ color: '#9CA3AF', fontFamily: 'Lato, sans-serif' }}>
          Entrée pour envoyer · Shift+Entrée saut de ligne · <span style={{ color: '#00AEBC' }}>PDF, DOCX, TXT</span> acceptés
        </p>
      </div>
    </div>
  )
}
