// lib/embedding.ts
// Embedding via API Nomic (production) ou Ollama (local dev)
// NOTE: pas de task_type — les vecteurs en base ont été indexés sans préfixe (Ollama local).
// Ajouter task_type modifierait l'espace vectoriel et casserait la similarité.

const NOMIC_API_URL = 'https://api-atlas.nomic.ai/v1/embedding/text'

export async function embedQuestion(text: string): Promise<number[]> {
  if (process.env.NOMIC_API_KEY) {
    return embedNomic(text)
  }
  return embedOllama(text)
}

async function embedNomic(text: string): Promise<number[]> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(NOMIC_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOMIC_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'nomic-embed-text-v1.5',
        texts: [text],
        // Pas de task_type — voir note en tête de fichier
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))

    if (!res.ok) {
      console.warn('[embedding] Nomic API error:', res.status)
      return []
    }

    const data = await res.json() as { embeddings: number[][] }
    return data.embeddings?.[0] ?? []
  } catch {
    console.error('[embedding] Nomic unavailable')
    return []
  }
}

async function embedOllama(text: string): Promise<number[]> {
  try {
    const res = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', prompt: text }),
    })
    const data = await res.json() as { embedding: number[] }
    return data.embedding ?? []
  } catch {
    console.error('[embedding] Ollama not available')
    return []
  }
}
