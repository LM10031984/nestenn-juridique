import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { embedQuestion } from '@/lib/embedding'

/**
 * app/api/admin/seed/route.ts
 * API d'administration pour injecter manuellement des règles juridiques.
 * 
 * NOTE : Cette route utilise la SERVICE_ROLE_KEY et doit être protégée 
 * par un middleware d'authentification admin en production.
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { title, situation, principe, consequence, domain = 'vente_immobiliere', sub_themes = [] } = body

    // Validation minimale
    if (!title || !principe) {
      return NextResponse.json(
        { error: 'Le titre et le principe juridique sont obligatoires.' },
        { status: 400 }
      )
    }

    // 1. Préparation du texte pour l'embedding (format identique au pipeline RAG)
    const embeddingText = `${situation || ''} ${principe} ${consequence || ''}`.trim()
    
    // 2. Génération du vecteur (Nomic ou Ollama selon le .env)
    const embedding = await embedQuestion(embeddingText)

    if (!embedding || embedding.length === 0) {
      return NextResponse.json(
        { error: 'Échec de la génération de l\'embedding.' },
        { status: 500 }
      )
    }

    // 3. Initialisation du client admin (outre-passe les RLS)
    const supabaseAdmin = createAdminClient()

    // Génération d'identifiants uniques pour cette règle personnalisée
    const customLawId = `ADMIN-CUSTOM-${Date.now()}`
    const customArtNum = `RULE-${Math.random().toString(36).substring(2, 7).toUpperCase()}`

    // 4. Insertion dans la table legal_articles
    const { data, error } = await supabaseAdmin
      .from('legal_articles')
      .insert({
        law_id: customLawId,
        article_num: customArtNum,
        title: title,
        content: principe, // Texte brut
        content_summary: JSON.stringify({ situation, principe, consequence }),
        date_version: new Date().toISOString().split('T')[0],
        domain: domain,
        sub_themes: sub_themes,
        in_force: true,
        embedding: embedding
      })
      .select()
      .single()

    if (error) {
      console.error('[Admin Seed] Supabase Error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: 'Règle juridique injectée et indexée avec succès.',
      data: {
        id: data.id,
        title: data.title,
        law_id: data.law_id
      }
    })

  } catch (error: any) {
    console.error('[Admin Seed] Global Exception:', error.message)
    return NextResponse.json(
      { error: 'Erreur serveur lors de l\'injection.' },
      { status: 500 }
    )
  }
}
