import { NextRequest, NextResponse } from 'next/server'
import pdfParse from 'pdf-parse'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    // 1. Réception du FormData
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'Aucun fichier fourni' }, { status: 400 })
    }

    // 2. Extraction du PDF en mémoire (Buffer)
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    let textContent = ''
    try {
      const pdfData = await pdfParse(buffer)
      textContent = pdfData.text
    } catch (parseError) {
      console.error('[Simulator Extract] Erreur de parsing PDF:', parseError)
      return NextResponse.json({ error: 'Impossible de lire ce document. Veuillez fournir un PDF valide (non scanné).' }, { status: 422 })
    }

    // Vérification de sécurité OCR
    if (!textContent || textContent.trim().length < 50) {
      return NextResponse.json({ error: 'Le document semble vide ou est une image scannée non supportée pour le moment.' }, { status: 422 })
    }

    // 3. Appel au LLM (Mistral via OpenRouter) en mode JSON
    const systemPrompt = `Tu es un expert financier en immobilier. Lis le document fourni par l'utilisateur et extrais les données financières demandées au format JSON.
Si une donnée n'est pas mentionnée ou est impossible à déduire, n'inclus pas la clé dans le JSON.
NE renvoie QUE le JSON, aucun texte avant ou après.

Structure attendue (en nombres, pas de texte ni de symboles €) :
{
  "purchasePrice": 200000,
  "works": 15000,
  "notaryFees": 16000,
  "monthlyRent": 1200,
  "propertyTax": 1000,
  "annualCharges": 1500,
  "managementFeePercent": 5
}`

    const openRouterApiKey = process.env.OPENROUTER_API_KEY
    if (!openRouterApiKey) {
      throw new Error("Clé API OpenRouter manquante.")
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openRouterApiKey}`,
      },
      body: JSON.stringify({
        model: 'mistralai/mistral-large-2411', // Modèle choisi
        response_format: { type: "json_object" }, // FORCAGE STRICT DU JSON
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Voici le texte du document :\n\n${textContent.substring(0, 50000)}` }
        ],
        temperature: 0.1, // Basse température pour éviter l'hallucination de chiffres
      })
    })

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}))
      console.error('[Simulator Extract] Erreur OpenRouter:', errData)
      return NextResponse.json({ error: 'Erreur de communication avec l\'IA Mistral.' }, { status: 502 })
    }

    const result = await response.json()
    const content = result.choices?.[0]?.message?.content

    if (!content) {
      return NextResponse.json({ error: 'L\'IA n\'a rien retourné.' }, { status: 500 })
    }

    // 4. Parsing et retour sécurisé
    let parsedData = {}
    try {
      parsedData = JSON.parse(content)
    } catch (jsonError) {
      console.error('[Simulator Extract] Erreur de parsing JSON de la réponse IA:', content)
      return NextResponse.json({ error: 'L\'IA a généré un format invalide.' }, { status: 500 })
    }

    return NextResponse.json(parsedData, { status: 200 })

  } catch (error: any) {
    console.error('[Simulator Extract] Erreur inattendue:', error)
    return NextResponse.json({ error: 'Erreur inattendue lors de l\'extraction.' }, { status: 500 })
  }
}
