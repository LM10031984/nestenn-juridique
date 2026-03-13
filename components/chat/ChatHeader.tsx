'use client'

import NestennLogo from '@/components/ui/NestennLogo'

interface ChatHeaderProps {
  dilaAvailable?: boolean
}

export default function ChatHeader({ dilaAvailable = false }: ChatHeaderProps) {
  return (
    <header className="sticky top-0 z-40 bg-white border-b border-nestenn-border" style={{ boxShadow: '0 1px 0 #E5E7EB' }}>
      <div className="flex items-center justify-between px-4 sm:px-6 h-14 max-w-4xl mx-auto">
        {/* Logo */}
        <NestennLogo size="md" />

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Légifrance badge — only when DILA active */}
          {dilaAvailable && (
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold tracking-wide border"
              style={{ background: '#E0F5F7', color: '#007D8A', borderColor: '#A7D9DE' }}>
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
                <circle cx="4.5" cy="4.5" r="3.5" stroke="#007D8A" strokeWidth="1.2"/>
                <path d="M2.8 4.6 L4 5.8 L6.2 3.4" stroke="#007D8A" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Légifrance
            </span>
          )}

          {/* Status */}
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"/>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"/>
            </span>
            <span className="text-xs text-nestenn-muted hidden sm:inline" style={{ fontFamily: 'Lato, sans-serif' }}>
              En ligne
            </span>
          </div>
        </div>
      </div>
    </header>
  )
}
