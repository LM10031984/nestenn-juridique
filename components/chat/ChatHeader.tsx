'use client'

import NestennLogo from '@/components/ui/NestennLogo'

interface ChatHeaderProps {
  dilaAvailable?: boolean
}

export default function ChatHeader({ dilaAvailable = true }: ChatHeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 max-w-4xl mx-auto">
        {/* Left: Logo */}
        <div className="flex items-center gap-3">
          <NestennLogo size="md" />
        </div>

        {/* Right: Title + badges + status */}
        <div className="flex items-center gap-3">
          {/* DILA badge */}
          {dilaAvailable && (
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-nestenn-blue-light text-nestenn-blue-dark text-xs font-metropolis font-semibold border border-nestenn-blue/30">
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                aria-hidden="true"
              >
                <circle cx="5" cy="5" r="4" stroke="#007D8A" strokeWidth="1.2" />
                <path
                  d="M3 5.2l1.3 1.3L7 3.8"
                  stroke="#007D8A"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Légifrance
            </span>
          )}

          {/* Title + AI badge */}
          <div className="flex items-center gap-2">
            <span className="font-metropolis font-bold text-nestenn-gray text-sm sm:text-base">
              Assistant Juridique
            </span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-white text-xs font-metropolis font-bold bg-nestenn-blue leading-none">
              IA
            </span>
          </div>

          {/* Online status */}
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
            <span className="text-xs text-gray-500 font-metropolis hidden sm:inline">
              En ligne
            </span>
          </div>
        </div>
      </div>
    </header>
  )
}
