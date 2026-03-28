/**
 * scripts/update-corpus.ts
 * Mise à jour hebdomadaire du corpus légal
 *
 * Parcourt tous les articles dans legal_articles, re-fetch depuis Légifrance,
 * compare le hash du contenu, et re-indexe si le texte a changé.
 * Ne touche pas aux entrées domain='auto_indexed_jurisprudence'.
 *
 * Usage :
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/update-corpus.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/update-corpus.ts --dry-run
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/update-corpus.ts --law 89-462
 */

import { createClient } from '@supabase/supabase-js'

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const DRY_RUN   = args.includes('--dry-run')
const TARGET_LAW = args.includes('--law') ? args[args.indexOf('--law') + 1] : null

// ── Supabase ──────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ── PISTE OAuth ───────────────────────────────────────────────────────────────

const PISTE_TOKEN_URL = 'https://oauth.piste.gouv.fr/api/oauth/token'
const PISTE_API_BASE  = process.env.PISTE_API_URL ?? 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app'
const NOMIC_API_URL   = 'https://api-atlas.nomic.ai/v1/embedding/text'
const OPENROUTER_URL  = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL_FILTER    = 'openai/gpt-4o-mini'

let _cachedToken: { token: string; expiresAt: number } | null = null

async function getPisteToken(): Promise<string> {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt) return _cachedToken.token
  const res = await fetch(PISTE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     process.env.PISTE_CLIENT_ID ?? '',
      client_secret: process.env.PISTE_CLIENT_SECRET ?? '',
      scope:         'openid',
    }),
  })
  if (!res.ok) throw new Error(`PISTE token error: ${res.status}`)
  const data = await res.json() as { access_token: string; expires_in: number }
  _cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 }
  return _cachedToken.token
}

// ── Légifrance fetch ──────────────────────────────────────────────────────────

async function findLegiartiId(token: string, legitextId: string, articleNum: string): Promise<string | null> {
  const res = await fetch(`${PISTE_API_BASE}/consult/code/tableMatieres`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      textId:        legitextId,
      date:          new Date().toISOString().split('T')[0],
      pageSize:      200,
      searchArticle: articleNum,
    }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return null
  const data = await res.json() as { sections?: Array<{ articles?: Array<{ id: string; num: string }> }> }
  for (const section of data.sections ?? []) {
    const found = section.articles?.find(
      a => a.num === articleNum || a.num === articleNum.toUpperCase()
    )
    if (found) return found.id
  }
  return null
}

async function fetchArticleText(token: string, legiartiId: string): Promise<{ texte: string; url: string } | null> {
  const res = await fetch(`${PISTE_API_BASE}/consult/getArticle`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: legiartiId }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return null
  const data = await res.json() as { article?: { texte?: string; etat?: string } }
  const texte = data.article?.texte?.replace(/<[^>]+>/g, ' ').trim() ?? ''
  if (texte.length < 20 || data.article?.etat === 'ABROGE') return null
  return { texte, url: `https://www.legifrance.gouv.fr/codes/article_lc/${legiartiId}` }
}

// ── LLM summarize ─────────────────────────────────────────────────────────────

async function summarizeArticle(articleNum: string, lawLabel: string, texte: string): Promise<{
  situation: string; principe: string; consequence: string
} | null> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer':  'https://nestenn.com',
      'X-Title':       'Nestenn Juridique',
    },
    body: JSON.stringify({
      model:      MODEL_FILTER,
      max_tokens: 300,
      messages: [
        {
          role:    'system',
          content: `Tu es juriste spécialisé en droit immobilier français.
Résume cet article en 3 champs JSON stricts (pas de markdown) :
- situation : quand cet article s'applique
- principe : la règle ou obligation principale
- consequence : ce qui se passe si non-respecté
Réponds UNIQUEMENT avec du JSON valide : {"situation":"...","principe":"...","consequence":"..."}`,
        },
        {
          role:    'user',
          content: `Article ${articleNum} — ${lawLabel}\n\n${texte.slice(0, 2000)}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) return null
  const data = await res.json() as { choices?: Array<{ message: { content: string } }> }
  const raw = data.choices?.[0]?.message?.content?.trim() ?? ''
  const parsed = JSON.parse(raw)
  if (!parsed.situation || !parsed.principe) return null
  return parsed
}

// ── Embedding Nomic ───────────────────────────────────────────────────────────

async function embedText(text: string): Promise<number[] | null> {
  const res = await fetch(NOMIC_API_URL, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${process.env.NOMIC_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'nomic-embed-text-v1.5', texts: [text] }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) return null
  const data = await res.json() as { embeddings: number[][] }
  return data.embeddings?.[0] ?? null
}

// ── Hash simple ───────────────────────────────────────────────────────────────

function simpleHash(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i)
    hash |= 0
  }
  return hash.toString(36)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function updateCorpus() {
  console.log(`[update] Démarrage${DRY_RUN ? ' (DRY-RUN)' : ''}${TARGET_LAW ? ` — law=${TARGET_LAW}` : ''}`)

  let query = supabase
    .from('legal_articles')
    .select('law_id, article_num, content')
    .eq('in_force', true)
    .neq('domain', 'auto_indexed_jurisprudence')

  if (TARGET_LAW) query = query.ilike('law_id', `%${TARGET_LAW}%`)

  const { data: articles, error } = await query
  if (error || !articles) {
    console.error('[update] Erreur lecture legal_articles :', error?.message)
    process.exit(1)
  }

  // Dédupliquer par (law_id, article_num)
  const unique = new Map<string, { law_id: string; article_num: string; content: string }>()
  for (const a of articles) {
    unique.set(`${a.law_id}|${a.article_num}`, a)
  }

  console.log(`[update] ${unique.size} articles à vérifier`)

  const token = await getPisteToken()
  let checked = 0
  let updated = 0
  let errors  = 0

  for (const [, meta] of unique) {
    checked++
    try {
      // Re-fetch depuis Légifrance
      const legiartiId = await findLegiartiId(token, meta.law_id, meta.article_num)
      if (!legiartiId) continue

      const fresh = await fetchArticleText(token, legiartiId)
      if (!fresh) continue

      // Comparer hash
      if (simpleHash(fresh.texte) === simpleHash(meta.content ?? '')) continue

      console.info(`[update] ${meta.law_id} art.${meta.article_num} — contenu modifié`)

      if (DRY_RUN) {
        updated++
        continue
      }

      // Re-résumer + re-embedder
      const summary = await summarizeArticle(meta.article_num, meta.law_id, fresh.texte)
      if (!summary) { errors++; continue }

      const embedding = await embedText(
        `${summary.situation} ${summary.principe} ${summary.consequence}`
      )
      if (!embedding) { errors++; continue }

      const { error: upsertErr } = await supabase
        .from('legal_articles')
        .update({
          content:         fresh.texte,
          content_summary: JSON.stringify(summary),
          date_version:    new Date().toISOString().split('T')[0],
          url:             fresh.url,
          embedding,
        })
        .eq('law_id', meta.law_id)
        .ilike('article_num', meta.article_num)

      if (upsertErr) {
        console.error(`[update] Erreur upsert ${meta.law_id} art.${meta.article_num}:`, upsertErr.message)
        errors++
      } else {
        console.info(`[update] ✅ Mis à jour : ${meta.law_id} art.${meta.article_num}`)
        updated++
      }
    } catch (err) {
      console.error(`[update] Exception ${meta.law_id} art.${meta.article_num}:`, err)
      errors++
    }

    // Pause anti-rate-limit (100ms entre chaque article)
    await new Promise(r => setTimeout(r, 100))
  }

  console.log(
    `[update] Terminé — ${checked} vérifiés, ${updated} mis à jour, ${errors} erreurs`
    + (DRY_RUN ? ' (DRY-RUN — aucune écriture)' : '')
  )
}

updateCorpus().catch(err => {
  console.error('[update] Erreur fatale :', err)
  process.exit(1)
})
