// app/api/cron/update-corpus/route.ts
// Mise à jour hebdomadaire des articles existants depuis Légifrance
// Déclenché par pg_cron de Supabase Pro (dimanche 3h UTC)

export const maxDuration = 60 // secondes (Vercel Pro)

import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { embedQuestion } from '@/lib/embedding'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PISTE_TOKEN_URL = 'https://oauth.piste.gouv.fr/api/oauth/token'
const PISTE_API_BASE = process.env.PISTE_API_URL ?? 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Non autorisé' }, { status: 401 })
  }

  const token = await getPisteToken()
  if (!token) {
    return Response.json({ error: 'Token PISTE indisponible' }, { status: 503 })
  }

  try {
    const { data: articles } = await supabaseAdmin
      .from('legal_articles')
      .select('id, law_id, article_num, content')
      .is('deleted_at', null)
      .not('law_id', 'like', 'JURI_%') // Exclure la jurisprudence auto-indexée
      .limit(10) // Max 10 par run pour rester sous le timeout Vercel

    if (!articles?.length) {
      return Response.json({ checked: 0, updated: 0 })
    }

    let checked = 0
    let updated = 0

    for (const article of articles) {
      checked++

      try {
        // Chercher le LEGIARTI ID
        const legiartiId = await findLegiartiId(token, article.law_id, article.article_num)
        if (!legiartiId) continue

        // Fetch le texte depuis Légifrance
        const fresh = await fetchArticleText(token, legiartiId)
        if (!fresh?.texte) continue

        // Comparer (hash simple)
        const oldHash = simpleHash(article.content ?? '')
        const newHash = simpleHash(fresh.texte)
        if (oldHash === newHash) continue

        // Contenu modifié — re-embedder et mettre à jour
        const embedding = await embedQuestion(fresh.texte.slice(0, 500))
        if (!embedding?.length) continue

        await supabaseAdmin
          .from('legal_articles')
          .update({
            content: fresh.texte,
            embedding,
            updated_at: new Date().toISOString(),
          })
          .eq('id', article.id)

        updated++
        console.info(`[cron] Mis à jour : ${article.law_id} art. ${article.article_num}`)
      } catch (err) {
        console.error(`[cron] Erreur ${article.id}:`, err)
      }

    }

    // Logger le résultat dans quality_alerts
    await supabaseAdmin.from('quality_alerts').insert({
      alert_type: 'corpus_update',
      details: JSON.stringify({ checked, updated, timestamp: new Date().toISOString() }),
    })

    return Response.json({
      success: true,
      checked,
      updated,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}

async function getPisteToken(): Promise<string | null> {
  try {
    const res = await fetch(PISTE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.PISTE_CLIENT_ID ?? '',
        client_secret: process.env.PISTE_CLIENT_SECRET ?? '',
        scope: 'openid',
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as { access_token: string }
    return data.access_token
  } catch {
    return null
  }
}

async function findLegiartiId(token: string, lawId: string, articleNum: string): Promise<string | null> {
  try {
    const res = await fetch(`${PISTE_API_BASE}/consult/code/tableMatieres`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        textId: lawId,
        date: new Date().toISOString().split('T')[0],
        pageSize: 200,
        searchArticle: articleNum,
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as { sections?: Array<{ articles?: Array<{ id: string; num: string }> }> }
    for (const section of data.sections ?? []) {
      const found = section.articles?.find(a => a.num === articleNum || a.num === articleNum.toUpperCase())
      if (found) return found.id
    }
  } catch { /* silencieux */ }
  return null
}

async function fetchArticleText(token: string, legiartiId: string): Promise<{ texte: string } | null> {
  try {
    const res = await fetch(`${PISTE_API_BASE}/consult/getArticle`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: legiartiId }),
    })
    if (!res.ok) return null
    const data = await res.json() as { article?: { texte?: string; etat?: string } }
    const texte = data.article?.texte?.replace(/<[^>]+>/g, ' ').trim() ?? ''
    if (texte.length < 20 || data.article?.etat === 'ABROGE') return null
    return { texte }
  } catch {
    return null
  }
}

function simpleHash(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i)
    hash |= 0
  }
  return hash.toString(36)
}
