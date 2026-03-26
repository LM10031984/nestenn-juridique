// lib/qualification.ts
// Pré-qualification juridique : analyse la question AVANT la recherche
// pour décider si on peut répondre directement ou s'il faut clarifier.
//
// Un juriste ne répond jamais "oui" ou "non" à une question floue —
// il commence par qualifier la situation.

import { openRouterChat, MODELS } from '@/lib/openrouter'

export interface QualificationResult {
  /** true = la question est assez précise pour répondre directement */
  canAnswerDirectly: boolean
  /** Questions de clarification à poser (si canAnswerDirectly = false) */
  clarificationQuestions: string[]
  /** Reformulation juridique de la question */
  legalReformulation: string
  /** Mécanismes juridiques distincts à présenter (si la question est ambiguë) */
  distinctMechanisms: string[]
}

const QUALIFICATION_PROMPT = `Tu es un juriste spécialisé en droit immobilier français. On te pose une question juridique.

Ton rôle : QUALIFIER la demande avant d'y répondre, exactement comme un avocat en consultation.

Analyse la question et détermine :

1. Est-elle assez PRÉCISE pour donner une réponse juridique fiable ?
   - canAnswerDirectly = true pour TOUTE question qui demande une explication, une définition, un délai, une procédure, ou un calcul
     (ex: "quel est le délai de rétractation ?", "quels diagnostics sont obligatoires ?", "comment calculer le loyer ?")
   - canAnswerDirectly = true si la question peut avoir plusieurs réponses mais qu'on peut TOUTES les lister
     (ex: "quels sont les motifs de congé ?" → lister tous les motifs, pas besoin de clarifier)
   - canAnswerDirectly = false UNIQUEMENT si la question décrit un CAS CONCRET ambigu où la réponse juridique change RADICALEMENT selon les faits manquants
     (ex: "peut-on renégocier le contrat du syndic" → modifier ? résilier ? ne pas renouveler ? → 3 mécanismes DIFFÉRENTS avec des règles DIFFÉRENTES)
   - En cas de doute → canAnswerDirectly = true (mieux répondre largement que de poser des questions inutiles)

2. Y a-t-il PLUSIEURS mécanismes juridiques distincts possibles ?
   Exemples :
   - "renégocier un contrat de syndic" peut signifier : (a) modifier par avenant accepté, (b) ne pas renouveler à l'échéance, (c) résilier pour faute
   - "mettre fin à un bail" peut signifier : (a) congé du bailleur, (b) congé du locataire, (c) résiliation judiciaire
   Si oui, lister les mécanismes dans distinctMechanisms.

3. Reformule la question en termes juridiques précis.

RÈGLES :
- Questions de clarification : courtes, concrètes, orientées terrain (pas de jargon)
- Maximum 3 questions
- Adapter au public : agents immobiliers Nestenn (pas des juristes)
- Si la question est simple et sans ambiguïté (ex: "quel est le délai de rétractation ?") → canAnswerDirectly = true

Réponds UNIQUEMENT en JSON valide :
{
  "canAnswerDirectly": true/false,
  "clarificationQuestions": ["Question 1 ?", "Question 2 ?"],
  "legalReformulation": "Reformulation juridique précise",
  "distinctMechanisms": ["Mécanisme A : ...", "Mécanisme B : ..."]
}`

/**
 * Qualifie une question juridique avant recherche.
 * Coût : ~80 tokens GPT-4o-mini, latence ~200ms.
 */
export async function qualifyQuestion(question: string): Promise<QualificationResult> {
  try {
    const response = await openRouterChat(
      [
        { role: 'system', content: QUALIFICATION_PROMPT },
        { role: 'user', content: question },
      ],
      MODELS.FILTER,
      500,
    )

    const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned) as QualificationResult

    console.info(`[qualification] direct=${parsed.canAnswerDirectly} questions=${parsed.clarificationQuestions?.length ?? 0} mechanisms=${parsed.distinctMechanisms?.length ?? 0}`)

    return {
      canAnswerDirectly: parsed.canAnswerDirectly ?? true,
      clarificationQuestions: parsed.clarificationQuestions ?? [],
      legalReformulation: parsed.legalReformulation ?? question,
      distinctMechanisms: parsed.distinctMechanisms ?? [],
    }
  } catch (err) {
    console.warn('[qualification] Erreur, réponse directe par défaut:', err)
    return {
      canAnswerDirectly: true,
      clarificationQuestions: [],
      legalReformulation: question,
      distinctMechanisms: [],
    }
  }
}

/**
 * Formate les questions de clarification et les mécanismes distincts
 * en un message lisible pour l'utilisateur.
 */
export function formatQualificationResponse(result: QualificationResult): string {
  const parts: string[] = []

  if (result.distinctMechanisms.length > 0) {
    parts.push('Pour vous donner une réponse précise, j\'ai besoin de clarifier votre situation car plusieurs cas de figure existent :\n')
    for (const mechanism of result.distinctMechanisms) {
      parts.push(`- ${mechanism}`)
    }
    parts.push('')
  }

  if (result.clarificationQuestions.length > 0) {
    parts.push('Quelques questions pour cibler ma réponse :\n')
    for (let i = 0; i < result.clarificationQuestions.length; i++) {
      parts.push(`${i + 1}. ${result.clarificationQuestions[i]}`)
    }
    parts.push('')
  }

  parts.push('Dès que vous me précisez ces éléments, je pourrai vous donner une réponse juridique fiable avec les textes applicables.')

  return parts.join('\n')
}
