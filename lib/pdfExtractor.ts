import { createClient } from '@supabase/supabase-js'
import pdfParse from 'pdf-parse'
import { extractTextWithVisionOcr } from './visionOcr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export type ExtractionMethod = 'pdf_parse' | 'vision_ocr'

export interface ExtractionResult {
  text: string
  method: ExtractionMethod
}

const MIN_TEXT_LENGTH = 50

export async function extractTextFromSupabasePDF(filePath: string): Promise<ExtractionResult> {
  const { data: fileData, error: downloadError } = await supabase.storage
    .from('nestenn-documents')
    .download(filePath)

  if (downloadError) {
    throw new Error(`Erreur lors du téléchargement depuis Supabase : ${downloadError.message}`)
  }

  if (!fileData) {
    throw new Error('Le fichier est vide ou introuvable.')
  }

  const arrayBuffer = await fileData.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Fast path : extraction texte natif via pdf-parse
  try {
    const pdfData = await pdfParse(buffer)
    const cleaned = pdfData.text?.replace(/\n\s*\n/g, '\n\n').trim() ?? ''
    if (cleaned.length >= MIN_TEXT_LENGTH) {
      return { text: cleaned, method: 'pdf_parse' }
    }
    console.warn(`[pdfExtractor] pdf-parse a extrait ${cleaned.length} caractères (< ${MIN_TEXT_LENGTH}), fallback OCR`)
  } catch (err: any) {
    console.warn(`[pdfExtractor] pdf-parse a échoué (${err.message}), fallback OCR`)
  }

  // Fallback : OCR via vision model (PDF scanné, image, ou texte non extractible)
  const ocrText = await extractTextWithVisionOcr(filePath)
  return { text: ocrText, method: 'vision_ocr' }
}
