export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface OpenRouterStreamChunk {
  choices: Array<{
    delta: { content?: string }
    finish_reason: string | null
  }>
}

const BASE_URL = 'https://openrouter.ai/api/v1'

export const MODELS = {
  MAIN: 'anthropic/claude-sonnet-4',
  FILTER: 'openai/gpt-4o-mini',
} as const

function getApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set in environment variables')
  }
  return apiKey
}

function buildHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getApiKey()}`,
    'HTTP-Referer': 'https://nestenn.com',
    'X-Title': 'Nestenn Juridique',
  }
}

export async function openRouterChat(
  messages: OpenRouterMessage[],
  model: string = MODELS.FILTER,
  maxTokens: number = 4000
): Promise<string> {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      stream: false,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenRouter API error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content

  if (typeof content !== 'string') {
    throw new Error('OpenRouter API returned an unexpected response structure')
  }

  return content
}

export async function openRouterStream(
  messages: OpenRouterMessage[],
  model: string = MODELS.MAIN,
  maxTokens: number = 4000
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      stream: true,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenRouter API error ${response.status}: ${errorText}`)
  }

  if (!response.body) {
    throw new Error('OpenRouter API returned an empty response body')
  }

  return response.body
}
