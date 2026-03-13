export default function TypingIndicator() {
  return (
    <div className="flex justify-start px-4 sm:px-6 py-1.5" role="status" aria-label="Nestenn Juridique rédige">
      <div className="bg-white rounded-2xl rounded-tl-sm border px-4 py-3 flex items-center gap-2.5"
        style={{ borderColor: '#E5E7EB', borderLeftColor: '#00AEBC', borderLeftWidth: 3, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <span className="typing-dot" style={{ animationDelay: '0ms' }} aria-hidden="true"/>
        <span className="typing-dot" style={{ animationDelay: '160ms' }} aria-hidden="true"/>
        <span className="typing-dot" style={{ animationDelay: '320ms' }} aria-hidden="true"/>
        <span className="text-xs ml-1" style={{ color: '#9CA3AF', fontFamily: 'Lato, sans-serif' }}>
          Nestenn Juridique rédige…
        </span>
      </div>
    </div>
  )
}
