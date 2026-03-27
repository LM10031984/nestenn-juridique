// lib/auto-indexer.ts
// Indexation automatique des articles cités par le LLM mais absents de pgvector
// Fire-and-forget : appelé depuis route.ts après le streaming, sans bloquer la réponse

import { createClient } from '@supabase/supabase-js'
import { openRouterChat, MODELS } from '@/lib/openrouter'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PISTE_TOKEN_URL = 'https://oauth.piste.gouv.fr/api/oauth/token'
const PISTE_API_BASE  = process.env.PISTE_API_URL ?? 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app'
const NOMIC_API_URL   = 'https://api-atlas.nomic.ai/v1/embedding/text'

// ── LEGITEXT_MAP minimal pour résolution ──────────────────────────────────

const LEGITEXT_MAP: Record<string, string> = {
  '89-462': 'LEGITEXT000006069108', 'loi 89-462': 'LEGITEXT000006069108',
  '65-557': 'LEGITEXT000006068256', 'loi 65-557': 'LEGITEXT000006068256',
  '70-9':   'LEGITEXT000006068387', 'loi 70-9':   'LEGITEXT000006068387',
  '67-223': 'LEGITEXT000006061423', '72-678':     'LEGITEXT000006063791',
  'civil':  'LEGITEXT000006070721', 'code civil':  'LEGITEXT000006070721',
  'cch':    'LEGITEXT000006074096',
  'cgi':    'LEGITEXT000006069577',
  'cpc':    'LEGITEXT000006070716',
  'cpce':   'LEGITEXT000025024948',
  'consommation': 'LEGITEXT000006069565', 'code consommation': 'LEGITEXT000006069565',
  'commerce':     'LEGITEXT000005634379',
  'urbanisme':    'LEGITEXT000006074075',
  'pénal':        'LEGITEXT000006069719', 'code pénal': 'LEGITEXT000006069719',
}

// ── 1. Extraction des références d'articles ──────────────────────────────

interface ArticleRef {
  law: string
  article: string
  legitextId: string | null
}

const REF_PATTERNS = [
  // "art. 14 de la loi 89-462" / "article 14 loi du 89-462"
  /art(?:icle)?\.?\s+(\d[\d-]*(?:-\d+)?)\s+(?:de (?:la )?)?(?:loi|décret|code)?\s*([\w\s-]{3,40})/gi,
  // "l'article 1589 du code civil" / "art. L271-1 du CCH"
  /l'?art(?:icle)?\.?\s+((?:L|R|D|A)?\d[\d-]*(?:-\d+)?)\s+(?:du |de la |de l')?([^\s,\.]{3,30}(?:\s[\w-]+)?)/gi,
  // "article 24 de la loi" (loi sans nom → contexte)
  /(?:^|\s)art(?:icle)?\.?\s+((?:L|R|D|A)?\d[\d-]*)\s+(?:al\.\s*\d+\s+)?(?:de (?:la )?(?:loi|même loi)|du (?:même )?(?:code|décret))/gi,
]

export function extractArticleReferences(text: string): ArticleRef[] {
  const seen = new Set<string>()
  const refs: ArticleRef[] = []

  for (const pattern of REF_PATTERNS) {
    const matches = [...text.matchAll(pattern)]
    for (const m of matches) {
      const articleNum = m[1]?.trim()
      const lawHint    = m[2]?.trim().toLowerCase() ?? ''
      if (!articleNum) continue

      // Résoudre le LEGITEXT
      const legitextId = resolveLegitext(lawHint)
      const key = `${legitextId ?? lawHint}:${articleNum}`
      if (seen.has(key)) continue
      seen.add(key)

      refs.push({ law: lawHint, article: articleNum, legitextId })
    }
  }

  return refs
}

function resolveLegitext(hint: string): string | null {
  // Cherche la meilleure clé dans LEGITEXT_MAP
  for (const [key, id] of Object.entries(LEGITEXT_MAP)) {
    if (hint.includes(key) || key.includes(hint)) return id
  }
  return null
}

// ── 2. Vérification existence en base ─────────────────────────────────────

async function isIndexed(legitextId: string, articleNum: string): Promise<boolean> {
  const { count } = await supabase
    .from('legal_articles')
    .select('*', { count: 'exact', head: true })
    .eq('law_id', legitextId)
    .ilike('article_num', articleNum)
  return (count ?? 0) > 0
}

// ── 3. Token PISTE OAuth ──────────────────────────────────────────────────

let _cachedToken: { token: string; expiresAt: number } | null = null

async function getPisteToken(): Promise<string | null> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt) return _cachedToken.token
  try {
    const res = await fetch(PISTE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id:     process.env.PISTE_CLIENT_ID ?? '',
        client_secret: process.env.PISTE_CLIENT_SECRET ?? '',
        scope: 'openid',
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as { access_token: string; expires_in: number }
    _cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 }
    return _cachedToken.token
  } catch {
    return null
  }
}

// ── 4. Recherche LEGIARTI via Légifrance ──────────────────────────────────

async function findLegiartiId(token: string, legitextId: string, articleNum: string): Promise<string | null> {
  try {
    const res = await fetch(`${PISTE_API_BASE}/consult/code/tableMatieres`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        textId: legitextId,
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

async function fetchArticleText(token: string, legiartiId: string): Promise<{ texte: string; url: string } | null> {
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
    const url = `https://www.legifrance.gouv.fr/codes/article_lc/${legiartiId}`
    return { texte, url }
  } catch {
    return null
  }
}

// ── 5. Summarize (GPT-4o-mini, même prompt que index-legifrance) ──────────

async function summarizeArticle(articleNum: string, lawLabel: string, texte: string): Promise<{
  situation: string; principe: string; consequence: string
} | null> {
  try {
    const raw = await openRouterChat([
      {
        role: 'system',
        content: `Tu es juriste spécialisé en droit immobilier français.
Résume cet article de loi en 3 champs JSON stricts (pas de markdown) :
- situation : quand cet article s'applique (agent immobilier, acheteur, vendeur, locataire, etc.)
- principe : la règle ou obligation principale
- consequence : ce qui se passe si non-respecté ou l'effet pratique
Réponds UNIQUEMENT avec du JSON valide : {"situation":"...","principe":"...","consequence":"..."}`,
      },
      {
        role: 'user',
        content: `Article ${articleNum} — ${lawLabel}\n\n${texte.slice(0, 2000)}`,
      },
    ], MODELS.FILTER, 300)

    const parsed = JSON.parse(raw.trim())
    if (!parsed.situation || !parsed.principe) return null
    return parsed
  } catch {
    return null
  }
}

// ── 6. Embedding Nomic ────────────────────────────────────────────────────

async function embedText(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(NOMIC_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOMIC_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'nomic-embed-text-v1.5', texts: [text] }),
    })
    if (!res.ok) return null
    const data = await res.json() as { embeddings: number[][] }
    return data.embeddings?.[0] ?? null
  } catch {
    return null
  }
}

// ── 7. Pipeline complet auto-index ────────────────────────────────────────

export async function autoIndexMissingArticles(
  responseText: string,
  chunksFound: number,
): Promise<void> {
  // Ne se déclenche que si peu ou pas de sources trouvées
  if (chunksFound >= 3) return

  const refs = extractArticleReferences(responseText)
  if (refs.length === 0) return

  const token = await getPisteToken()
  if (!token) {
    console.warn('[auto-indexer] Token PISTE indisponible — skip')
    return
  }

  for (const ref of refs) {
    if (!ref.legitextId) {
      console.info(`[auto-indexer] Loi inconnue pour "${ref.law}" art. ${ref.article} — skip`)
      continue
    }

    try {
      // Vérif existence
      if (await isIndexed(ref.legitextId, ref.article)) continue

      // Chercher le LEGIARTI ID
      const legiartiId = await findLegiartiId(token, ref.legitextId, ref.article)
      if (!legiartiId) {
        console.warn(`[auto-indexer] LEGIARTI introuvable : ${ref.law} art. ${ref.article}`)
        continue
      }

      // Fetch texte
      const articleData = await fetchArticleText(token, legiartiId)
      if (!articleData) continue

      // Résumé LLM
      const summary = await summarizeArticle(ref.article, ref.law, articleData.texte)
      if (!summary) continue

      // Embedding
      const embeddingText = `${summary.situation} ${summary.principe} ${summary.consequence}`
      const embedding = await embedText(embeddingText)
      if (!embedding) continue

      // Upsert
      const { error } = await supabase
        .from('legal_articles')
        .upsert({
          law_id:          ref.legitextId,
          article_num:     ref.article,
          title:           `Art. ${ref.article} — ${ref.law}`,
          content:         articleData.texte,
          content_summary: JSON.stringify(summary),
          date_version:    new Date().toISOString().split('T')[0],
          url:             articleData.url,
          domain:          'auto_indexed',
          sub_themes:      [],
          in_force:        true,
          embedding,
        }, { onConflict: 'law_id,article_num' })

      if (error) {
        console.error(`[auto-indexer] Upsert error ${ref.law} art. ${ref.article}:`, error.message)
      } else {
        console.info(`[auto-indexer] ✅ Indexé : ${ref.law} art. ${ref.article}`)
      }
    } catch (err) {
      console.error(`[auto-indexer] Erreur ${ref.law} art. ${ref.article}:`, err)
    }
  }
}
