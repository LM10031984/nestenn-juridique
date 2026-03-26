// lib/context-extractor.ts
// Étape intermédiaire RAG : extrait les passages pertinents des articles
// et jurisprudences AVANT de les envoyer au LLM final.
//
// Réduit le contexte de ~35K chars à ~3-5K chars ciblés.

import { openRouterChat, MODELS } from '@/lib/openrouter'

export interface ExtractedContext {
  /** Passages clés des articles de loi, avec citations exactes */
  legalPassages: string
  /** Passages clés de la jurisprudence */
  jurisprudencePassages: string
  /** Taille totale du contexte extrait */
  totalChars: number
}

const EXTRACTION_PROMPT = `Tu es un juriste. On te donne une question juridique et des textes de loi + jurisprudence récupérés depuis Légifrance et Judilibre.

Ta mission : EXTRAIRE les passages EXACTS des textes qui répondent à la question. Pas de résumé, pas de reformulation — recopie les extraits pertinents mot pour mot.

RÈGLES :
- Pour chaque article : recopier UNIQUEMENT les alinéas/paragraphes qui répondent à la question
- Conserver le numéro d'article et le nom de la loi devant chaque extrait
- Conserver l'URL si elle est fournie (format markdown [titre](url))
- Pour la jurisprudence : recopier le principe dégagé et la date/numéro de l'arrêt
- Si un texte n'est pas pertinent pour la question : l'IGNORER complètement
- Maximum 800 caractères par article, 500 par arrêt
- IMPORTANT : inclure les passages sur les CONDITIONS et LIMITES (accord nécessaire d'une partie, impossibilité d'imposer unilatéralement, exceptions, résiliation anticipée)
- Ne rien inventer, ne rien ajouter qui ne soit pas dans les textes fournis
- CONSERVER les liens markdown [titre](url) tels quels — ne JAMAIS supprimer une URL
- RECOPIER les délais MOT POUR MOT comme dans le texte original (ex: "au moins vingt et un jours" PAS "21 jours francs")
- Si un article parle de FIN de contrat, résiliation, ou non-renouvellement : TOUJOURS l'inclure

FORMAT DE SORTIE :
---ARTICLES---
[Extraits mot pour mot des articles pertinents avec numéro, loi, et URL si fournie]

---JURISPRUDENCE---
[Extraits des arrêts pertinents avec date, numéro, et URL si fournie]`

/**
 * Extrait les passages pertinents d'un contexte brut volumineux.
 * Entrée : ~35K chars de contexte brut (articles + jurisprudence)
 * Sortie : ~3-5K chars de passages ciblés
 */
export async function extractRelevantContext(
  question: string,
  rawLegalContext: string,
  rawJurisprudence: string,
): Promise<ExtractedContext> {
  const input = []
  if (rawLegalContext) input.push('=== TEXTES DE LOI ===\n' + rawLegalContext)
  if (rawJurisprudence) input.push('=== JURISPRUDENCE ===\n' + rawJurisprudence)

  if (input.length === 0) {
    return { legalPassages: '', jurisprudencePassages: '', totalChars: 0 }
  }

  try {
    const response = await openRouterChat(
      [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: `QUESTION : ${question}\n\n${input.join('\n\n')}` },
      ],
      MODELS.FILTER, // GPT-4o-mini — rapide et peu coûteux
      2000,
    )

    // Parser la sortie
    const articlesMatch = response.match(/---ARTICLES---\s*([\s\S]*?)(?:---JURISPRUDENCE---|$)/)
    const juriMatch = response.match(/---JURISPRUDENCE---\s*([\s\S]*)/)

    const legalPassages = articlesMatch?.[1]?.trim() ?? ''
    const jurisprudencePassages = juriMatch?.[1]?.trim() ?? ''

    console.info(`[extractor] ${rawLegalContext.length + rawJurisprudence.length} chars → ${legalPassages.length + jurisprudencePassages.length} chars (÷${Math.round((rawLegalContext.length + rawJurisprudence.length) / Math.max(1, legalPassages.length + jurisprudencePassages.length))})`)
    console.info(`[extractor] ARTICLES:\n${legalPassages.slice(0, 500)}`)
    console.info(`[extractor] JURI:\n${jurisprudencePassages.slice(0, 300)}`)

    return {
      legalPassages,
      jurisprudencePassages,
      totalChars: legalPassages.length + jurisprudencePassages.length,
    }
  } catch (err) {
    console.warn('[extractor] Erreur, fallback contexte brut tronqué:', err)
    // Fallback : tronquer brutalement
    return {
      legalPassages: rawLegalContext.slice(0, 3000),
      jurisprudencePassages: rawJurisprudence.slice(0, 2000),
      totalChars: 5000,
    }
  }
}
