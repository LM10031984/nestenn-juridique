// app/api/letter/route.ts
// Génère un courrier juridique à partir du contexte de conversation

import { NextRequest } from 'next/server'
import { openRouterChat, MODELS } from '@/lib/openrouter'

interface LetterRequestBody {
  conversationContext: string
  letterType: string
  recipient: string
  lrar: boolean
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: LetterRequestBody
  try {
    body = (await req.json()) as LetterRequestBody
  } catch {
    return new Response(JSON.stringify({ error: 'Corps de la requête invalide.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { conversationContext, letterType, recipient, lrar } = body

  if (!letterType || !recipient) {
    return new Response(JSON.stringify({ error: 'letterType et recipient sont requis.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const systemPrompt = `Tu es juriste expert en droit immobilier français. Génère un courrier "${letterType}" destiné à "${recipient}", prêt à envoyer. ${lrar ? 'Mention LRAR obligatoire dans le corps.' : ''} Cite les articles de loi pertinents. Les champs à personnaliser sont entre [CROCHETS]. Format : courrier professionnel français standard, ville et date en haut à droite, objet en gras, formule de politesse complète.`

  try {
    const letter = await openRouterChat(
      [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Contexte de la situation :\n\n${conversationContext}\n\nGénère le courrier complet.`,
        },
      ],
      MODELS.MAIN,
      1500
    )

    return new Response(JSON.stringify({ letter }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[letter] Erreur génération :', err)
    return new Response(
      JSON.stringify({ error: 'Erreur lors de la génération du courrier. Réessayez.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
