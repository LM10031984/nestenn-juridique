'use client'

import { useEffect, useState } from 'react'
import { X, ClipboardCopy, Download, Loader2 } from 'lucide-react'

interface LetterModalProps {
  letterType: string
  recipient: string
  lrar: boolean
  conversationContext: string
  onClose: () => void
}

function highlightBrackets(text: string): React.ReactNode[] {
  const parts = text.split(/(\[[^\]]+\])/g)
  return parts.map((part, i) => {
    if (/^\[[^\]]+\]$/.test(part)) {
      return (
        <span key={i} className="bg-yellow-100 px-1 rounded text-yellow-800 font-medium">
          {part}
        </span>
      )
    }
    return part
  })
}

export function LetterModal({ letterType, recipient, lrar, conversationContext, onClose }: LetterModalProps) {
  const [letter, setLetter] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    async function generate() {
      try {
        const res = await fetch('/api/letter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationContext, letterType, recipient, lrar }),
        })
        const data = await res.json()
        if (!res.ok || data.error) {
          setError(data.error ?? 'Erreur inconnue')
        } else {
          setLetter(data.letter)
        }
      } catch {
        setError('Erreur réseau. Vérifiez votre connexion.')
      } finally {
        setLoading(false)
      }
    }
    generate()
  }, [conversationContext, letterType, recipient, lrar])

  async function handleCopy() {
    await navigator.clipboard.writeText(letter)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleDownloadPdf() {
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })

    const margin = 20
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const contentWidth = pageWidth - margin * 2
    const footerY = pageHeight - 15

    // En-tête
    doc.setFont('times', 'bold')
    doc.setFontSize(14)
    doc.text('Nestenn Juridique', margin, margin)
    doc.setFont('times', 'normal')
    doc.setFontSize(9)
    doc.text(`Document généré le ${new Date().toLocaleDateString('fr-FR')}`, margin, margin + 6)

    // Ligne de séparation
    doc.setDrawColor(180, 140, 60)
    doc.setLineWidth(0.5)
    doc.line(margin, margin + 10, pageWidth - margin, margin + 10)

    // Corps du courrier
    doc.setFont('times', 'normal')
    doc.setFontSize(12)

    const lines = doc.splitTextToSize(letter, contentWidth)
    let y = margin + 18
    for (const line of lines) {
      if (y > footerY - 10) {
        doc.addPage()
        y = margin
      }
      doc.text(line, margin, y)
      y += 6
    }

    // Footer disclaimer
    doc.setFont('times', 'italic')
    doc.setFontSize(8)
    doc.setTextColor(120, 120, 120)
    doc.line(margin, footerY - 4, pageWidth - margin, footerY - 4)
    doc.text(
      'Document à titre informatif uniquement — pas de conseil juridique personnalisé. Consultez un professionnel habilité.',
      margin,
      footerY
    )

    const safeType = letterType.replace(/[^a-z0-9]/gi, '_').toLowerCase()
    doc.save(`nestenn-juridique_${safeType}.pdf`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-sm font-bold text-gray-900">📝 {letterType}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Destinataire : {recipient}{lrar ? ' · envoi LRAR recommandé' : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Génération du courrier en cours...</p>
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
              {error}
            </div>
          )}
          {!loading && !error && (
            <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap font-serif">
              {highlightBrackets(letter)}
            </div>
          )}
        </div>

        {/* Footer actions */}
        {!loading && !error && (
          <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-xs font-semibold hover:bg-gray-200 transition-colors"
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
              {copied ? 'Copié !' : '📋 Copier'}
            </button>
            <button
              onClick={handleDownloadPdf}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              ⬇️ Télécharger PDF
            </button>
            <button
              onClick={onClose}
              className="ml-auto px-4 py-2 rounded-lg border border-gray-200 text-gray-500 text-xs font-medium hover:bg-gray-100 transition-colors"
            >
              ✕ Fermer
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
