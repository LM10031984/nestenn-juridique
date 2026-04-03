// app/api/cron/update-corpus/route.ts
// Mise à jour progressive des articles depuis Légifrance
// Déclenché par pg_cron 4×/jour (0h, 6h, 12h, 18h UTC)
// 4 runs/jour × 7 jours = 28 runs × 10 articles = 280 articles/semaine → couvre ~256 articles
// Le dimanche (isSunday), lance en plus la veille législative : détecte et indexe les nouveaux textes immo

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
    // Offset basé sur le jour et le créneau horaire pour couvrir le corpus progressivement
    const now = new Date()
    const dayOfWeek = now.getUTCDay()                        // 0-6
    const hourSlot  = Math.floor(now.getUTCHours() / 6)     // 0-3 (4 slots de 6h)
    const offset    = (dayOfWeek * 4 + hourSlot) * 10       // 0, 10, 20, …, 270

    const { data: articles } = await supabaseAdmin
      .from('legal_articles')
      .select('id, law_id, article_num, content')
      .is('deleted_at', null)
      .not('law_id', 'like', 'JURI_%') // Exclure la jurisprudence auto-indexée
      .order('id')
      .range(offset, offset + 9) // 10 articles à partir de l'offset

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

    // Logger le résultat de la mise à jour dans quality_alerts
    await supabaseAdmin.from('quality_alerts').insert({
      alert_type: 'corpus_update',
      details: JSON.stringify({ checked, updated, offset, timestamp: new Date().toISOString() }),
    })

    // ── Veille législative (dimanche uniquement) ──────────────────────────
    let newTextsFound = 0
    const isSunday = now.getUTCDay() === 0

    if (isSunday) {
      newTextsFound = await runVeilleLegislative(token)
    }

    return Response.json({
      success: true,
      offset,
      checked,
      updated,
      newTextsFound,
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

// ── Veille législative ─────────────────────────────────────────────────────

const VEILLE_KEYWORDS = [
  'bail habitation',
  'copropriété',
  'agent immobilier',
  'diagnostic immobilier',
  'DPE',
  'urbanisme permis construire',
  'vente immobilière',
  'location meublée',
  'passoire énergétique',
  'assainissement',
]

const IMMO_KEYWORDS = [
  'bail', 'loyer', 'locataire', 'bailleur', 'copropriété', 'syndic',
  'vente', 'acquéreur', 'vendeur', 'mandat', 'agent immobilier',
  'diagnostic', 'urbanisme', 'permis', 'construction', 'habitation',
  'logement', 'immeuble', 'foncier', 'immobilier', 'location',
  'préemption', 'expulsion', 'assainissement',
]

function detectDomainFromContent(text: string): string {
  const lower = text.toLowerCase()
  if (lower.includes('bail') || lower.includes('loyer') || lower.includes('locataire')) return 'baux_habitation'
  if (lower.includes('copropriété') || lower.includes('syndic')) return 'copropriete'
  if (lower.includes('agent immobilier') || lower.includes('mandat')) return 'agent_immobilier'
  if (lower.includes('diagnostic') || lower.includes('dpe')) return 'diagnostics'
  if (lower.includes('urbanisme') || lower.includes('permis')) return 'urbanisme'
  if (lower.includes('vente') || lower.includes('acquéreur')) return 'vente_immobiliere'
  if (lower.includes('construction') || lower.includes('décennale')) return 'construction'
  if (lower.includes('commercial')) return 'bail_commercial'
  if (lower.includes('assainissement') || lower.includes('fosse')) return 'diagnostics'
  return 'autres'
}

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

async function runVeilleLegislative(token: string): Promise<number> {
  const today = isoDate(new Date())
  const sevenDaysAgo = isoDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
  let newTextsFound = 0

  for (const keyword of VEILLE_KEYWORDS) {
    try {
      const res = await fetch(`${PISTE_API_BASE}/search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recherche: {
            typeRecherche: 'EXACTE',
            champs: [{ typeChamp: 'TITLE', criteres: [{ typeRecherche: 'EXACTE', valeur: keyword }] }],
            filtres: [{ facette: 'DATE_VERSION', dates: { start: sevenDaysAgo, end: today } }],
            pageNumber: 1,
            pageSize: 5,
            typePagination: 'ARTICLE',
          },
        }),
      })

      if (!res.ok) continue
      const data = await res.json() as { results?: Array<{ textId?: string; id?: string; num?: string; article?: string; title?: string; dateVersion?: string; url?: string }> }
      const results = data.results ?? []

      for (const result of results) {
        const lawId     = result.textId ?? result.id
        const articleNum = result.num ?? result.article
        if (!lawId || !articleNum) continue

        // Déjà en base ?
        const { count } = await supabaseAdmin
          .from('legal_articles')
          .select('*', { count: 'exact', head: true })
          .eq('law_id', lawId)
          .eq('article_num', articleNum)
        if ((count ?? 0) > 0) continue

        // Fetch texte complet
        const legiartiId = await findLegiartiId(token, lawId, articleNum)
        if (!legiartiId) continue

        const articleData = await fetchArticleText(token, legiartiId)
        if (!articleData?.texte) continue

        // Filtre : doit contenir un mot-clé immobilier
        const lower = articleData.texte.toLowerCase()
        if (!IMMO_KEYWORDS.some(kw => lower.includes(kw))) continue

        // Embed + upsert
        const embedding = await embedQuestion(articleData.texte.slice(0, 500))
        if (!embedding?.length) continue

        const domain = detectDomainFromContent(articleData.texte)

        await supabaseAdmin.from('legal_articles').upsert({
          law_id:      lawId,
          article_num: articleNum,
          content:     articleData.texte,
          url:         result.url ?? null,
          domain,
          embedding,
        }, { onConflict: 'law_id,article_num' })

        try {
          await supabaseAdmin.from('quality_alerts').insert({
            alert_type: 'auto_indexed_new_legislation',
            details: JSON.stringify({ lawId, articleNum, keyword, domain }),
          })
        } catch { /* non-bloquant */ }

        newTextsFound++
        console.info(`[veille] ✅ Nouveau texte indexé : ${lawId} art. ${articleNum} (${domain})`)
      }
    } catch (err) {
      console.error(`[veille] Erreur recherche "${keyword}":`, err)
    }

    // Throttle pour ne pas saturer l'API PISTE
    await new Promise(r => setTimeout(r, 200))
  }

  return newTextsFound
}
