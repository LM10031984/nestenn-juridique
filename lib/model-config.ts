import type { SourceChunk, JuriCase } from '@/lib/system-prompt'
import { buildMistralLargeSystemPrompt, buildMistralSmallSystemPrompt } from '@/lib/prompts/mistral-system-prompt'

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

export const DEFAULT_MODEL_ID = 'mistralai/mistral-large-2512'

// Ordonné du plus cher (haut) au moins cher (bas) : Large → Medium → Small
export const AVAILABLE_MODELS: ModelConfig[] = [
  {
    id: 'mistralai/mistral-large-2512',
    name: 'Mistral Large 3',
    provider: 'Mistral AI',
    description: 'Qualité maximale, flagship français, 256K context, RGPD natif',
    badge: 'Premium',
    color: '#FA520F',
    maxTokens: 8192,
    temperature: 0.1,
    buildSystemPrompt: buildMistralLargeSystemPrompt,  // tier='large'
  },
  {
    id: 'mistralai/mistral-medium-3.1',
    name: 'Mistral Medium 3.1',
    provider: 'Mistral AI',
    description: 'Frontier-class à ~8× moins cher que Large, RGPD natif',
    badge: 'Recommandé',
    color: '#FA520F',
    maxTokens: 8192,
    temperature: 0.1,
    buildSystemPrompt: buildMistralLargeSystemPrompt,  // réutilise règles Large (même famille) — à ré-évaluer après bench comparatif
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
    buildSystemPrompt: buildMistralSmallSystemPrompt,  // tier='small'
  },
]

export function getModelById(id?: string | null): ModelConfig {
  if (!id) return AVAILABLE_MODELS[0]
  return AVAILABLE_MODELS.find(m => m.id === id) ?? AVAILABLE_MODELS[0]
}

export function isAllowedModel(id: string): boolean {
  return AVAILABLE_MODELS.some(m => m.id === id)
}
