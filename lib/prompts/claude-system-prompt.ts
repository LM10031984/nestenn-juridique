// lib/prompts/claude-system-prompt.ts
// Prompt Claude — wrapper PromptContext-aware.
// ⚠️ Core validé benchmark 96/100 — toute modification du system-prompt.ts doit être re-benchmarkée.

import type { SourceChunk, JuriCase } from '@/lib/system-prompt'
import { getSystemPromptAugmented, FORCE_JURISPRUDENCE_DOMAINS } from '@/lib/system-prompt'
import type { PromptContext } from '@/lib/model-config'

export function buildClaudeSystemPrompt(
  chunks: SourceChunk[],
  pgJuri: JuriCase[],
  liveJuri: JuriCase[],
  context?: PromptContext,
): string {
  const hasLiveCases = liveJuri.length > 0

  // Forcer la jurisprudence dès qu'il y a des arrêts live disponibles
  const forceJuri = hasLiveCases

  // Forcer encore plus fort si le domaine est critique pour la jurisprudence
  const forceDomainJuri = hasLiveCases && (context?.domains ?? []).some(d =>
    FORCE_JURISPRUDENCE_DOMAINS.has(d)
  )

  if (hasLiveCases) {
    console.info(
      `[claude-prompt] judilibreChunks=${liveJuri.length} `
      + `forceJuri=${forceJuri} forceDomainJuri=${forceDomainJuri} `
      + `domains=${context?.domains?.join(',') || '—'}`
    )
  }

  return getSystemPromptAugmented(chunks, pgJuri, liveJuri, { forceJuri, forceDomainJuri })
}
