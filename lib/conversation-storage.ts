export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string // ISO date
}

export interface StoredConversation {
  id: string
  title: string       // Premier message utilisateur tronqué à 50 chars
  messages: StoredMessage[]
  createdAt: string   // ISO date
  updatedAt: string   // ISO date
}

const STORAGE_KEY = 'nestenn_conversations'
const MAX_STORED = 50

export function loadConversations(): StoredConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: StoredConversation[] = JSON.parse(raw)
    return parsed.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  } catch {
    return []
  }
}

export function saveConversation(conv: StoredConversation): void {
  try {
    const list = loadConversations()
    const idx = list.findIndex(c => c.id === conv.id)
    if (idx >= 0) {
      list[idx] = conv
    } else {
      list.unshift(conv)
    }
    const trimmed = list.slice(0, MAX_STORED)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // Silently ignore storage errors (quota exceeded, etc.)
  }
}

export function deleteConversation(id: string): void {
  try {
    const list = loadConversations().filter(c => c.id !== id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // Silently ignore
  }
}

export function renameConversation(id: string, newTitle: string): void {
  try {
    const list = loadConversations()
    const idx = list.findIndex(c => c.id === id)
    if (idx >= 0) {
      list[idx] = { ...list[idx], title: newTitle.trim().slice(0, 80), updatedAt: new Date().toISOString() }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    }
  } catch {
    // Silently ignore
  }
}

export function clearAllConversations(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Silently ignore
  }
}

export function generateTitle(firstUserMessage: string): string {
  const trimmed = firstUserMessage.trim()
  if (trimmed.length <= 52) return trimmed
  return trimmed.slice(0, 52) + '…'
}
