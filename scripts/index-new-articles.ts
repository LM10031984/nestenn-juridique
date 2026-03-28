/**
 * scripts/index-new-articles.ts
 * Indexer un batch de nouveaux articles depuis Légifrance
 *
 * Édite la liste TO_INDEX en bas du fichier, puis :
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/index-new-articles.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/index-new-articles.ts --dry-run
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const PISTE_TOKEN_URL = 'https://oauth.piste.gouv.fr/api/oauth/token'
const PISTE_API_BASE  = process.env.PISTE_API_URL ?? 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app'
const NOMIC_API_URL   = 'https://api-atlas.nomic.ai/v1/embedding/text'
const OPENROUTER_URL  = 'https://openrouter.ai/api/v1/chat/completions'

const DRY_RUN = process.argv.includes('--dry-run')

// =============================================================================
// ÉDITE ICI — articles à indexer
// =============================================================================
interface ArticleEntry { law: string; legitextId: string; articles: string[]; domain: string }

const TO_INDEX: ArticleEntry[] = [
  // Tutelle / protection des majeurs (Code civil)
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', articles: ['473', '475', '477', '505', '507', '509'], domain: 'transactions' },
  // CCH — diagnostics et vente
  { law: 'cch', legitextId: 'LEGITEXT000006074096', articles: ['L721-2', 'L721-3', 'L271-1'], domain: 'transactions' },
  // CGI — fiscalité immobilière
  { law: 'cgi', legitextId: 'LEGITEXT000006069577', articles: ['683', '1594-D', '150-U'], domain: 'fiscalite' },
  // Code de procédure civile d'exécution — litiges
  { law: 'cpce', legitextId: 'LEGITEXT000025024948', articles: ['L321-1', 'L321-2', 'L321-3'], domain: 'litiges' },
]
// =============================================================================

// ── PISTE OAuth ───────────────────────────────────────────────────────────────

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

async function findLegiartiId(token: string, legitextId: string, articleNum: string): Promise<string | null> {
  const res = await fetch(`${PISTE_API_BASE}/consult/code/tableMatieres`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      textId: legitextId, date: new Date().toISOString().split('T')[0], pageSize: 200, searchArticle: articleNum,
    }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) return null
  const data = await res.json() as { sections?: Array<{ articles?: Array<{ id: string; num: string }> }> }
  for (const s of data.sections ?? []) {
    const found = s.articles?.find(a => a.num === articleNum || a.num === articleNum.toUpperCase())
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

// ── LLM + Embedding ───────────────────────────────────────────────────────────

async function summarize(articleNum: string, law: string, texte: string): Promise<{
  situation: string; principe: string; consequence: string
} | null> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://nestenn.com',
      'X-Title':      'Nestenn Juridique',
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini', max_tokens: 300,
      messages: [
        {
          role: 'system',
          content: `Tu es juriste spécialisé en droit immobilier français.
Résume cet article en 3 champs JSON stricts (pas de markdown) :
- situation : quand cet article s'applique
- principe : la règle ou obligation principale
- consequence : ce qui se passe si non-respecté
Réponds UNIQUEMENT avec du JSON valide : {"situation":"...","principe":"...","consequence":"..."}`,
        },
        { role: 'user', content: `Article ${articleNum} — ${law}\n\n${texte.slice(0, 2000)}` },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) return null
  const data = await res.json() as { choices?: Array<{ message: { content: string } }> }
  return JSON.parse(data.choices?.[0]?.message?.content?.trim() ?? '')
}

async function embed(text: string): Promise<number[] | null> {
  const res = await fetch(NOMIC_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.NOMIC_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'nomic-embed-text-v1.5', texts: [text] }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) return null
  const data = await res.json() as { embeddings: number[][] }
  return data.embeddings?.[0] ?? null
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== INDEXATION NOUVEAUX ARTICLES${DRY_RUN ? ' (DRY-RUN)' : ''} ===\n`)

  const token = await getPisteToken()
  let indexed = 0
  let skipped = 0
  let errors  = 0

  for (const entry of TO_INDEX) {
    for (const artNum of entry.articles) {
      const lawId = entry.legitextId

      // Vérifier si déjà indexé
      const { count } = await supabase
        .from('legal_articles')
        .select('*', { count: 'exact', head: true })
        .eq('law_id', lawId)
        .ilike('article_num', artNum)
        .is('deleted_at', null)

      if ((count ?? 0) > 0) {
        console.log(`⏭️  ${entry.law} art. ${artNum} — déjà indexé`)
        skipped++
        continue
      }

      process.stdout.write(`📥 ${entry.law} art. ${artNum}...`)

      if (DRY_RUN) {
        console.log(' (dry-run — skip)')
        indexed++
        continue
      }

      try {
        const legiartiId = await findLegiartiId(token, entry.legitextId, artNum)
        if (!legiartiId) { console.log(' ⚠️  LEGIARTI introuvable'); errors++; continue }

        const articleData = await fetchArticleText(token, legiartiId)
        if (!articleData) { console.log(' ⚠️  texte vide ou abrogé'); errors++; continue }

        const summary = await summarize(artNum, entry.law, articleData.texte)
        if (!summary) { console.log(' ⚠️  résumé LLM échoué'); errors++; continue }

        const embeddingText = `${summary.situation} ${summary.principe} ${summary.consequence}`
        const embedding = await embed(embeddingText)
        if (!embedding) { console.log(' ⚠️  embedding échoué'); errors++; continue }

        const { error } = await supabase.from('legal_articles').upsert({
          law_id:          lawId,
          article_num:     artNum,
          title:           `Art. ${artNum} — ${entry.law}`,
          content:         articleData.texte,
          content_summary: JSON.stringify(summary),
          date_version:    new Date().toISOString().split('T')[0],
          url:             articleData.url,
          domain:          entry.domain,
          sub_themes:      [],
          in_force:        true,
          embedding,
        }, { onConflict: 'law_id,article_num' })

        if (error) { console.log(` ❌ ${error.message}`); errors++ }
        else       { console.log(' ✅ indexé'); indexed++ }
      } catch (err) {
        console.log(` ❌ exception: ${err}`)
        errors++
      }

      await new Promise(r => setTimeout(r, 200))
    }
  }

  console.log(`\n=== RÉSULTAT ===`)
  console.log(`Indexés  : ${indexed}${DRY_RUN ? ' (dry-run)' : ''}`)
  console.log(`Déjà en base : ${skipped}`)
  console.log(`Erreurs  : ${errors}\n`)
}

main().catch(console.error)
