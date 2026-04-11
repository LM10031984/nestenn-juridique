import type { SourceChunk, JuriCase } from '@/lib/system-prompt'
import { buildClaudeSystemPrompt } from '@/lib/prompts/claude-system-prompt'
import { buildMistralSystemPrompt } from '@/lib/prompts/mistral-system-prompt'

type SystemPromptBuilder = (
  chunks: SourceChunk[],
  pgJuri: JuriCase[],
  liveJuri: JuriCase[],
) => string

export interface ModelConfig {
  id: string
  name: string
  provider: string
  description: string
  badge?: string
  color: string
  maxTokens: number
  temperature: number
  buildSystemPrompt: SystemPromptBuilder
}

export const DEFAULT_MODEL_ID = 'anthropic/claude-sonnet-4-6'

export const AVAILABLE_MODELS: ModelConfig[] = [
  {
    id: 'anthropic/claude-sonnet-4-6',
    name: 'Claude Sonnet 4',
    provider: 'Anthropic',
    description: 'Qualité maximale (référence actuelle)',
    badge: 'Référence',
    color: '#CC785C',
    maxTokens: 8192,
    temperature: 0.3,
    buildSystemPrompt: buildClaudeSystemPrompt,
  },
  {
    id: 'mistralai/mistral-large-2512',
    name: 'Mistral Large 3',
    provider: 'Mistral AI',
    description: 'Flagship français, RGPD natif, 256K context',
    badge: 'Recommandé',
    color: '#FA520F',
    maxTokens: 8192,
    temperature: 0.1,
    buildSystemPrompt: buildMistralSystemPrompt,
  },
  {
    id: 'mistralai/mistral-small-2603',
    name: 'Mistral Small 4',
    provider: 'Mistral AI',
    description: 'Ultra économique, raisonnement Magistral intégré',
    badge: 'Économique',
    color: '#FA520F',
    maxTokens: 8192,
    temperature: 0.1,
    buildSystemPrompt: buildMistralSystemPrompt,
  },
]

export function getModelById(id?: string | null): ModelConfig {
  if (!id) return AVAILABLE_MODELS[0]
  return AVAILABLE_MODELS.find(m => m.id === id) ?? AVAILABLE_MODELS[0]
}

export function isAllowedModel(id: string): boolean {
  return AVAILABLE_MODELS.some(m => m.id === id)
}
