import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractTextFromSupabasePDF } from '@/lib/pdfExtractor'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // OCR sur gros PDF peut prendre du temps

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const body = await req.json()
    const { filePath } = body

    if (!filePath) {
      return NextResponse.json({ error: 'filePath manquant' }, { status: 400 })
    }

    console.log(`[API Process] Début extraction ${filePath}`)
    const { text, method } = await extractTextFromSupabasePDF(filePath)
    console.log(`[API Process] Extraction OK via ${method} (${text.length} caractères)`)

    const { error: dbError } = await supabase
      .from('document_contents')
      .insert({
        file_path: filePath,
        content: text,
        user_id: user.id,
        extraction_method: method,
      })

    if (dbError) {
      console.error('[API Process] Erreur insertion DB:', dbError)
      return NextResponse.json({ error: 'Erreur lors de la sauvegarde du contenu en base de données' }, { status: 500 })
    }

    return NextResponse.json({ success: true, contentLength: text.length, method })
  } catch (err: any) {
    console.error('[API Process] Erreur globale:', err)
    return NextResponse.json({ error: err.message || 'Erreur inconnue' }, { status: 500 })
  }
}
