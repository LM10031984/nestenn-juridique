'use client'

export default function TypingIndicator() {
  return (
    <div className="flex justify-start px-4 py-1">
      <div className="bg-white border border-gray-200 rounded-[18px_18px_18px_4px] shadow-sm px-4 py-3 flex items-center gap-3">
        {/* Label */}
        <span className="text-xs font-metropolis text-nestenn-gray/60 hidden sm:inline">
          Nestenn Juridique rédige
        </span>

        {/* Animated dots */}
        <div className="flex items-center gap-1" aria-label="En cours de rédaction" role="status">
          <span className="typing-dot" style={{ animationDelay: '0ms' }} />
          <span className="typing-dot" style={{ animationDelay: '150ms' }} />
          <span className="typing-dot" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}
