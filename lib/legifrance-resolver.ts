// lib/legifrance-resolver.ts
// Résolution synchrone d'articles Légifrance via legiPart → getArticle.
// Note : l'endpoint /consult/tableMatieres est déprécié dans la PISTE API v2 ;
// legiPart est l'équivalent stable et universel (codes + lois).

import { getAccessToken } from './legifrance'
import type { SourceChunk } from './system-prompt'

const API_BASE = process.env.PISTE_API_URL ?? 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app'
const TIMEOUT_MS = 6000
const MAX_LIVE_ARTICLES = 3

// ---------------------------------------------------------------------------
// Types exportés
// ---------------------------------------------------------------------------

export interface ResolvedArticle {
  lawId: string      // LEGITEXT
  articleNum: string
  legiartiId: string // LEGIARTI
  lawName: string    // ex : "Code de la santé publique"
  title: string      // ex : "Art. L.1331-1 — Code de la santé publique"
  text: string       // texte brut, max 4000 chars
  url: string
  source: 'legiPart+getArticle'
}

// ---------------------------------------------------------------------------
// Helpers privés
// ---------------------------------------------------------------------------

function fetchWithTimeout(url: string, init: RequestInit, ms = TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer))
}

// Traversée récursive de l'arbre legiPart — même logique que legifrance.ts
function findArticleInTree(node: any, artNum: string): { id: string; cid: string } | null {
  for (const art of (node.articles ?? [])) {
    if ((art.etat ?? '').toUpperCase() === 'VIGUEUR' && art.num === artNum) {
      const id: string = art.id ?? art.cid ?? ''
      const cid: string = art.cid ?? art.id ?? ''
      if (id) return { id, cid }
    }
  }
  for (const section of (node.sections ?? [])) {
    const found = findArticleInTree(section, artNum)
    if (found) return found
  }
  return null
}

// ---------------------------------------------------------------------------
// resolveLiveArticle — legiPart → getArticle
// ---------------------------------------------------------------------------

/**
 * Résout un article en appelant legiPart (structure du texte) puis getArticle (contenu).
 * Retourne null si l'article est introuvable, abrogé, ou si l'API est indisponible.
 *
 * @param textId    LEGITEXT du texte (ex : 'LEGITEXT000006072665')
 * @param articleNum Numéro d'article tel qu'il apparaît dans l'arbre (ex : 'L.1331-1')
 * @param lawName   Nom lisible du texte, pour le titre et le chunkText
 */
export async function resolveLiveArticle(
  textId: string,
  articleNum: string,
  lawName = 'Texte officiel',
): Promise<ResolvedArticle | null> {
  try {
    const token = await getAccessToken()
    const todayDate = new Date().toISOString().split('T')[0]

    // Étape 1 : structure du texte (legiPart)
    const legiPartRes = await fetchWithTimeout(`${API_BASE}/consult/legiPart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ textId, date: todayDate }),
    })

    if (!legiPartRes.ok) {
      console.warn(`[legifrance-resolver] legiPart ${textId} → HTTP ${legiPartRes.status}`)
      return null
    }

    const legiData = await legiPartRes.json() as any
    // legiPart retourne legalTexts[] pour les codes, ou la structure directe pour les lois
    const tree = legiData?.legalTexts?.[0] ?? legiData

    // Étape 2 : trouver le LEGIARTI dans l'arbre
    const artRef = findArticleInTree(tree, articleNum)
    if (!artRef) {
      console.warn(`[legifrance-resolver] ${textId}/art.${articleNum} → non trouvé dans legiPart`)
      return null
    }

    // Étape 3 : contenu de l'article (getArticle)
    const artRes = await fetchWithTimeout(`${API_BASE}/consult/getArticle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: artRef.id }),
    })

    if (!artRes.ok) {
      console.warn(`[legifrance-resolver] getArticle ${artRef.id} → HTTP ${artRes.status}`)
      return null
    }

    const artData = await artRes.json() as any
    const article = artData?.article ?? artData

    const text = (article?.texte ?? '').slice(0, 4000)
    if (!text) {
      console.warn(`[legifrance-resolver] getArticle ${artRef.id} → texte vide`)
      return null
    }

    const legiartiId: string = article?.id ?? artRef.id

    return {
      lawId: textId,
      articleNum,
      legiartiId,
      lawName,
      title: `Art. ${articleNum} — ${lawName}`,
      text,
      url: `https://www.legifrance.gouv.fr/codes/article_lc/${legiartiId}`,
      source: 'legiPart+getArticle',
    }
  } catch (err) {
    console.error(`[legifrance-resolver] ${textId}/${articleNum} — exception :`, err)
    return null
  }
}

// ---------------------------------------------------------------------------
// resolveLiveArticles — batch parallèle, max MAX_LIVE_ARTICLES
// ---------------------------------------------------------------------------

/**
 * Résout en parallèle jusqu'à MAX_LIVE_ARTICLES articles candidats.
 * Les échecs individuels sont silencieux (Promise.allSettled).
 */
export async function resolveLiveArticles(
  candidates: Array<{ textId: string; articleNum: string; lawName?: string }>,
): Promise<ResolvedArticle[]> {
  const batch = candidates.slice(0, MAX_LIVE_ARTICLES)

  const results = await Promise.allSettled(
    batch.map(c => resolveLiveArticle(c.textId, c.articleNum, c.lawName))
  )

  const resolved: ResolvedArticle[] = []
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value !== null) {
      resolved.push(r.value)
    }
  }

  if (resolved.length > 0) {
    console.info(
      `[legifrance-sync] resolved=${resolved.map(a => a.articleNum).join(',')} source=legiPart+getArticle`
    )
  } else {
    console.info('[legifrance-sync] no live article resolved')
  }

  return resolved
}

// ---------------------------------------------------------------------------
// resolvedArticlesToChunks — conversion pour injection dans le prompt
// ---------------------------------------------------------------------------

/**
 * Convertit des ResolvedArticle en SourceChunk compatibles avec le pipeline existant.
 * similarity=1.0 : les articles live ont confiance maximale (source primaire).
 */
export function resolvedArticlesToChunks(articles: ResolvedArticle[]): SourceChunk[] {
  return articles.map(a => ({
    sourceLaw: a.lawName,
    sourceArticle: a.articleNum,
    sourceUrl: a.url,
    chunkText: a.text,
    similarity: 1.0,
  }))
}
