// lib/prompts/claude-system-prompt.ts
// NE PAS MODIFIER — prompt validé sur benchmark 96/100
// Wrapper direct sur getSystemPromptAugmented, aucune logique ajoutée.

export { getSystemPromptAugmented as buildClaudeSystemPrompt } from '@/lib/system-prompt'
