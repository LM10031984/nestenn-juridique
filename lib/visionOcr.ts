import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const OCR_MODEL = 'google/gemini-2.5-flash'
const OCR_PROMPT = `Tu es un moteur d'OCR. Extrais TOUT le texte de ce document PDF de manière exhaustive et verbatim.

Règles strictes :
- Restitue le texte exactement tel qu'il apparaît, sans paraphrase ni résumé
- Préserve la structure : titres, paragraphes, listes, tableaux (en markdown si tableau)
- Conserve les numéros d'articles, références juridiques, dates, montants et noms propres à l'identique
- N'ajoute aucun commentaire, en-tête ou note de ta part
- Si une zone est illisible, indique [illisible] à cet endroit précis
- Sortie en markdown propre, prête à être indexée`

export async function extractTextWithVisionOcr(filePath: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set')
  }

  const { data: fileData, error: downloadError } = await supabase.storage
    .from('nestenn-documents')
    .download(filePath)

  if (downloadError || !fileData) {
    throw new Error(`Téléchargement Supabase échoué : ${downloadError?.message ?? 'fichier vide'}`)
  }

  const arrayBuffer = await fileData.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  const filename = filePath.split('/').pop() ?? 'document.pdf'

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://nestenn.com',
      'X-Title': 'Nestenn Juridique - OCR',
    },
    body: JSON.stringify({
      model: OCR_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: OCR_PROMPT },
            {
              type: 'file',
              file: {
                filename,
                file_data: `data:application/pdf;base64,${base64}`,
              },
            },
          ],
        },
      ],
      max_tokens: 16000,
      temperature: 0,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenRouter OCR error ${response.status}: ${errorText}`)
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content

  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('OpenRouter OCR returned empty content')
  }

  return content.trim()
}
