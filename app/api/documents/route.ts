import { NextRequest, NextResponse } from 'next/server'

const MAX_MB = 10
const MAX_TEXT_CHARS = 30000

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'Aucun fichier reçu.' }, { status: 400 })
    }

    const sizeMb = file.size / (1024 * 1024)
    if (sizeMb > MAX_MB) {
      return NextResponse.json({ error: `Fichier trop volumineux (max ${MAX_MB} Mo, reçu ${sizeMb.toFixed(1)} Mo)` }, { status: 400 })
    }

    const name = file.name.toLowerCase()
    let text = ''

    if (name.endsWith('.txt')) {
      // Plain text — direct read
      text = await file.text()

    } else if (name.endsWith('.pdf')) {
      // PDF extraction with pdf-parse
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      // Dynamic import — pdf-parse is CJS, use require via module interop
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
      const data = await pdfParse(buffer)
      text = data.text

    } else if (name.endsWith('.docx')) {
      // DOCX: basic XML extraction without mammoth (no native dep issues)
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      // DOCX is a ZIP — extract text from word/document.xml
      // Read as binary and extract visible text between XML tags
      const raw = buffer.toString('binary')
      const xmlMatch = raw.match(/word\/document\.xml[\x00-\xff]*?PK/)
      if (xmlMatch) {
        // Strip XML tags to get plain text
        text = xmlMatch[0]
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      }

      if (!text) {
        // Last resort: return error asking for PDF or TXT
        return NextResponse.json({
          error: 'Format DOCX non supporté nativement. Convertissez en PDF ou TXT pour une meilleure extraction.'
        }, { status: 422 })
      }

    } else {
      return NextResponse.json({ error: 'Format non supporté. Utilisez PDF, DOCX ou TXT.' }, { status: 400 })
    }

    // Sanitize and truncate
    text = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim()

    if (text.length === 0) {
      return NextResponse.json({ error: 'Impossible d\'extraire le texte de ce fichier. Vérifiez qu\'il n\'est pas protégé ou scanné sans OCR.' }, { status: 422 })
    }

    const truncated = text.length > MAX_TEXT_CHARS
    const finalText = truncated ? text.slice(0, MAX_TEXT_CHARS) + '\n\n[... document tronqué à 30 000 caractères ...]' : text

    return NextResponse.json({
      text: finalText,
      filename: file.name,
      charCount: text.length,
      truncated,
    })

  } catch (err: unknown) {
    console.error('[documents] Error:', err)
    return NextResponse.json({ error: 'Erreur lors de l\'analyse du fichier.' }, { status: 500 })
  }
}
