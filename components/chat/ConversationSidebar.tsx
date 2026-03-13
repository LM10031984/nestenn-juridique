'use client'

import { useState } from 'react'
import type { StoredConversation } from '@/lib/conversation-storage'
import { clearAllConversations } from '@/lib/conversation-storage'

interface Props {
  conversations: StoredConversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  isOpen: boolean
  onClose: () => void
}

function relativeDate(isoDate: string): string {
  const date = new Date(isoDate)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  if (d.getTime() === today.getTime()) return "Aujourd'hui"
  if (d.getTime() === yesterday.getTime()) return 'Hier'

  const day = date.getDate()
  const months = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
  const month = months[date.getMonth()]
  if (date.getFullYear() === now.getFullYear()) return `${day} ${month}`
  return `${day} ${month} ${date.getFullYear()}`
}

export default function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  isOpen,
  onClose,
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  function handleClearAll() {
    if (window.confirm('Effacer toutes les conversations ?')) {
      clearAllConversations()
      // Parent will reload on next interaction; we trigger onNew to reset state
      onNew()
    }
  }

  const sidebarContent = (
    <div
      className="flex flex-col h-full bg-white"
      style={{ width: 260, borderRight: '1px solid #E5E7EB' }}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid #E5E7EB' }}>
        {/* Mobile close button */}
        <div className="flex items-center justify-between mb-3 sm:hidden">
          <span className="text-xs font-bold tracking-widest uppercase" style={{ color: '#00AEBC', fontFamily: 'Lato, sans-serif' }}>
            Nestenn Juridique
          </span>
          <button
            onClick={onClose}
            aria-label="Fermer le menu"
            className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
            style={{ color: '#374151' }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Logo text (desktop) */}
        <p className="hidden sm:block text-xs font-bold tracking-widest uppercase mb-3" style={{ color: '#00AEBC', fontFamily: 'Lato, sans-serif' }}>
          Nestenn Juridique
        </p>

        {/* New chat button */}
        <button
          onClick={onNew}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-sm font-semibold transition-all duration-150"
          style={{
            background: '#00AEBC',
            color: '#fff',
            fontFamily: 'Lato, sans-serif',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#0099A8')}
          onMouseLeave={e => (e.currentTarget.style.background = '#00AEBC')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Nouveau chat
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-2">
        {conversations.length === 0 ? (
          <p className="text-center text-sm mt-8" style={{ color: '#9CA3AF', fontFamily: 'Lato, sans-serif' }}>
            Aucune conversation
          </p>
        ) : (
          conversations.map(conv => {
            const isActive = conv.id === activeId
            const isHovered = conv.id === hoveredId
            return (
              <div
                key={conv.id}
                className="relative flex items-center group px-3 py-2.5 cursor-pointer transition-colors duration-100"
                style={{
                  background: isActive ? '#E0F5F7' : isHovered ? '#F9FAFB' : 'transparent',
                  borderLeft: isActive ? '3px solid #00AEBC' : '3px solid transparent',
                }}
                onClick={() => onSelect(conv.id)}
                onMouseEnter={() => setHoveredId(conv.id)}
                onMouseLeave={() => setHoveredId(null)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && onSelect(conv.id)}
                aria-current={isActive ? 'true' : undefined}
              >
                <div className="flex-1 min-w-0 pr-6">
                  <p
                    className="text-sm truncate"
                    style={{
                      color: isActive ? '#0F2744' : '#374151',
                      fontFamily: 'Lato, sans-serif',
                      fontWeight: isActive ? 600 : 400,
                    }}
                  >
                    {conv.title}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: '#9CA3AF', fontFamily: 'Lato, sans-serif' }}>
                    {relativeDate(conv.updatedAt)}
                  </p>
                </div>

                {/* Delete button — visible on hover */}
                <button
                  className="absolute right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-50"
                  style={{ color: '#9CA3AF' }}
                  onClick={e => {
                    e.stopPropagation()
                    onDelete(conv.id)
                  }}
                  aria-label={`Supprimer "${conv.title}"`}
                  tabIndex={-1}
                  onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#9CA3AF')}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path d="M2 3.5h10M5.5 3.5V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5v1M11 3.5l-.6 7.5a1 1 0 01-1 .9H4.6a1 1 0 01-1-.9L3 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            )
          })
        )}
      </div>

      {/* Footer — Clear all */}
      {conversations.length > 0 && (
        <div className="px-4 py-3" style={{ borderTop: '1px solid #E5E7EB' }}>
          <button
            onClick={handleClearAll}
            className="text-xs transition-colors"
            style={{ color: '#EF4444', fontFamily: 'Lato, sans-serif', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.7 }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
          >
            Tout effacer
          </button>
        </div>
      )}
    </div>
  )

  return (
    <>
      {/* Desktop sidebar — always visible */}
      <aside className="hidden sm:flex flex-col h-full" style={{ width: 260, flexShrink: 0 }}>
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {isOpen && (
        <div className="sm:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(15,39,68,0.4)' }}
            onClick={onClose}
            aria-hidden="true"
          />
          {/* Drawer */}
          <div className="relative z-10 h-full" style={{ width: 260 }}>
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  )
}
