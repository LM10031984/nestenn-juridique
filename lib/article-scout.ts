// lib/article-scout.ts
// Éclaireur d'articles : un appel LLM léger (MODELS.FILTER) liste les références
// d'articles pertinentes pour la question AVANT la génération principale.
// Les références sont ensuite résolues en live sur Légifrance (texte exact en
// vigueur) et injectées dans le prompt. Le savoir paramétrique du modèle sert
// d'index — Légifrance reste la seule source du contenu.
//
// Coût : ~0,0001 €/question (gpt-4o-mini, ~100 tokens).
// Latence : lancé en parallèle de l'embedding + Judilibre → masquée.

import { openRouterChat, MODELS } from '@/lib/openrouter'
import { extractArticleRefs, refsToCandidates, type LiveArticleCandidate } from '@/lib/extract-refs'

const SCOUT_PROMPT = `Tu es un juriste expert en droit immobilier français.
Pour la question d'agent immobilier ci-dessous, liste les références EXACTES des articles de loi français les plus pertinents (5 maximum).

Règles strictes :
- Une référence par ligne, au format : "article <numéro> de la <loi n° XX-XXX du ...>" ou "article <numéro> du <code>"
- UNIQUEMENT des références dont tu es certain. En cas de doute, omets la référence.
- Pas de commentaire, pas d'explication, pas de jurisprudence — seulement les lignes de références.

Question : `

/**
 * Retourne jusqu'à `max` candidats d'articles à résoudre en live sur Légifrance.
 * Ne lève jamais : toute erreur → tableau vide (le pipeline continue sans).
 */
export async function scoutArticleRefs(question: string, max = 5): Promise<LiveArticleCandidate[]> {
  try {
    const out = await openRouterChat(
      [{ role: 'user', content: SCOUT_PROMPT + question }],
      MODELS.FILTER,
      200,
    )
    if (!out?.trim()) return []
    const candidates = refsToCandidates(extractArticleRefs(out)).slice(0, max)
    if (candidates.length > 0) {
      console.info(
        `[article-scout] ${candidates.length} candidat(s) : `
        + candidates.map(c => `${c.lawName} art. ${c.articleNum}`).join(' | ')
      )
    }
    return candidates
  } catch (err) {
    console.warn('[article-scout] erreur (non bloquant) :', err)
    return []
  }
}
