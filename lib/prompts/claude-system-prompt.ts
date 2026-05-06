// lib/prompts/claude-system-prompt.ts
// NE PAS MODIFIER — prompt validé sur benchmark 96/100
// Wrapper acceptant le 4e param PromptContext (ignoré ici : le prompt Claude est figé).

import type { SourceChunk, JuriCase } from '@/lib/system-prompt'
import type { PromptContext } from '@/lib/model-config'
import { getSystemPromptAugmented } from '@/lib/system-prompt'

export function buildClaudeSystemPrompt(
  chunks: SourceChunk[],
  pgJuri: JuriCase[],
  liveJuri: JuriCase[],
  _context?: PromptContext,
): string {
  return getSystemPromptAugmented(chunks, pgJuri, liveJuri, _context)
}
