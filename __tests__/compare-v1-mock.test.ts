// __tests__/compare-v1-mock.test.ts
// Tests du consumer SSE de callV1 — fetch mocké via vi.fn()

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// callV1 est une fonction privée dans compare-v1-v2-benchmark.ts.
// On la teste via un module wrapper minimal qui reproduit sa logique.
// (Alternative : exporter callV1 depuis le script — mais les scripts
// ne sont pas faits pour être importés dans des tests.)
//
// Stratégie : copier la logique callV1 dans un helper testable.

// ── Helper testable (même logique que callV1) ───────────────────────────────

const V1_TIMEOUT_MS = 500  // timeout court pour les tests

async function callV1(
  baseUrl: string,
  question: string
): Promise<{ text: string | null; error?: string }> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), V1_TIMEOUT_MS)

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: question }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      return { text: null, error: `bad_status:${response.status}` }
    }

    if (!response.body) return { text: null, error: 'no_body' }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''
    let streamFinished = false

    while (!streamFinished) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') {
          streamFinished = true
          break
        }
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>
          }
          fullText += parsed.choices?.[0]?.delta?.content ?? ''
        } catch {
          // chunk malformé — ignoré
        }
      }
    }

    return { text: fullText.trim() || null }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { text: null, error: 'timeout' }
    }
    return { text: null, error: `unreachable:${(err as Error).message}` }
  }
}

// ── Helpers pour créer des ReadableStream SSE ────────────────────────────────

function makeSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

function sseChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('callV1 — consumer SSE', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stream SSE complet → retourne le texte concaténé', async () => {
    const stream = makeSSEStream([
      sseChunk('Bonjour'),
      sseChunk(' monde'),
      sseChunk(' !'),
      'data: [DONE]\n',
    ])

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(stream, { status: 200 })
    )

    const result = await callV1('http://localhost:3000', 'test question')
    expect(result.text).toBe('Bonjour monde !')
    expect(result.error).toBeUndefined()
  })

  it('[DONE] interrompt le stream — le texte après [DONE] est ignoré', async () => {
    const stream = makeSSEStream([
      sseChunk('Réponse complète'),
      'data: [DONE]\n',
      sseChunk('Ce texte ne doit pas apparaître'),
    ])

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(stream, { status: 200 })
    )

    const result = await callV1('http://localhost:3000', 'test')
    expect(result.text).toBe('Réponse complète')
  })

  it('status 500 → retourne null avec error bad_status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
    )

    const result = await callV1('http://localhost:3000', 'test')
    expect(result.text).toBeNull()
    expect(result.error).toContain('bad_status:500')
  })

  it('serveur inaccessible (fetch throw) → retourne null avec error unreachable', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(
      Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' })
    )

    const result = await callV1('http://localhost:3000', 'test')
    expect(result.text).toBeNull()
    expect(result.error).toContain('unreachable')
  })

  it('stream avec chunk malformé → le chunk est ignoré, le reste est conservé', async () => {
    const stream = makeSSEStream([
      sseChunk('Début de'),
      'data: MALFORMED_JSON\n',
      sseChunk(' la réponse'),
      'data: [DONE]\n',
    ])

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(stream, { status: 200 })
    )

    const result = await callV1('http://localhost:3000', 'test')
    expect(result.text).toBe('Début de la réponse')
  })

  it('réponse vide (stream sans content) → retourne null', async () => {
    const stream = makeSSEStream(['data: [DONE]\n'])

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(stream, { status: 200 })
    )

    const result = await callV1('http://localhost:3000', 'test')
    expect(result.text).toBeNull()
  })
})
