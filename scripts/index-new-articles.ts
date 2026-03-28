/**
 * scripts/index-new-articles.ts
 * Indexer un batch de nouveaux articles depuis Légifrance
 *
 * Supporte les codes (CODE_DATE — tableMatieres) et les lois LODA (LODA_DATE — legiPart).
 *
 * Usage :
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
const TODAY           = new Date().toISOString().split('T')[0]

const DRY_RUN = process.argv.includes('--dry-run')

// =============================================================================
// ÉDITE ICI — articles à indexer
// fond: 'CODE_DATE' pour les codes, 'LODA_DATE' pour les lois
// =============================================================================
interface ArticleEntry {
  law: string
  legitextId: string
  fond: 'CODE_DATE' | 'LODA_DATE'
  articles: string[]
  domain: string
}

const TO_INDEX: ArticleEntry[] = [
  // Tutelle / capacité juridique (lacune identifiée en prod)
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['473', '475', '476', '505', '507'], domain: 'transactions' },

  // Double mandat (Q79 — seul vrai échec du benchmark)
  // Art. 1161 + Prescription 2224
  { law: 'code civil', legitextId: 'LEGITEXT000006070721', fond: 'CODE_DATE', articles: ['1161', '2224'], domain: 'agent_immobilier' },

  // Frais de notaire (Q19) + Plus-value (lacune cartographie)
  // Note : CGI utilise des espaces dans la numérotation (ex: "150 U" pas "150-U")
  { law: 'cgi', legitextId: 'LEGITEXT000006069577', fond: 'CODE_DATE', articles: ['683', '1594 D', '150 U', '150 VB', '150 VC'], domain: 'fiscalite' },

  // Documents vente lot copro (Q26)
  { law: 'cch', legitextId: 'LEGITEXT000006074096', fond: 'CODE_DATE', articles: ['L721-2', 'L721-3'], domain: 'transactions' },

  // Assignation / procédure civile (Q87)
  { law: 'cpc', legitextId: 'LEGITEXT000006070716', fond: 'CODE_DATE', articles: ['755', '756', '817'], domain: 'litiges' },

  // Trêve hivernale / expulsion (Q89)
  { law: 'cpce', legitextId: 'LEGITEXT000025024948', fond: 'CODE_DATE', articles: ['L412-6', 'L411-1'], domain: 'baux_habitation' },

  // Condition suspensive prêt (lacune cartographie)
  { law: 'code de la consommation', legitextId: 'LEGITEXT000006069565', fond: 'CODE_DATE', articles: ['L313-41'], domain: 'transactions' },

  // Décès locataire / sous-location / charges récupérables (loi 89-462 — LODA)
  { law: 'loi 89-462', legitextId: 'LEGITEXT000006069108', fond: 'LODA_DATE', articles: ['8', '14', '23'], domain: 'baux_habitation' },
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

// ── Map LEGITEXT → NOM_CODE (pour filtre API /search) ────────────────────────

const CODE_NAMES: Record<string, string> = {
  'LEGITEXT000006070721': 'Code civil',
  'LEGITEXT000006074096': "Code de la construction et de l'habitation",
  'LEGITEXT000006074075': "Code de l'urbanisme",
  'LEGITEXT000006069565': 'Code de la consommation',
  'LEGITEXT000006069577': 'Code général des impôts',
  'LEGITEXT000006070716': 'Code de procédure civile',
  'LEGITEXT000025024948': "Code des procédures civiles d'exécution",
  'LEGITEXT000006069719': 'Code pénal',
  'LEGITEXT000006072026': 'Code monétaire et financier',
}

// ── CODE_DATE : tableMatieres → LEGIARTI ID, fallback /search NUM_ARTICLE ─────

function collectSectionArticles(node: any, out: Array<{ id: string; num: string }> = []): Array<{ id: string; num: string }> {
  for (const art of (node?.articles ?? [])) {
    if (art.id) out.push({ id: art.id, num: art.num ?? '' })
  }
  for (const sub of (node?.sections ?? [])) collectSectionArticles(sub, out)
  return out
}

async function findLegiartiInCode(token: string, legitextId: string, articleNum: string): Promise<string | null> {
  // Tentative 1 : tableMatieres (rapide, couvre la majorité des codes)
  try {
    const res = await fetch(`${PISTE_API_BASE}/consult/code/tableMatieres`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ textId: legitextId, date: TODAY, pageSize: 200, searchArticle: articleNum }),
      signal: AbortSignal.timeout(12000),
    })
    if (res.ok) {
      const data = await res.json() as { sections?: any[] }
      const allArts = collectSectionArticles({ sections: data.sections ?? [] })
      const found = allArts.find(a =>
        a.num === articleNum || a.num === articleNum.toUpperCase()
      )
      if (found) return found.id
    }
  } catch { /* fallback */ }

  // Tentative 2 : /search avec NUM_ARTICLE + NOM_CODE (couvre CGI, CPC, etc.)
  const codeName = CODE_NAMES[legitextId]
  if (codeName) {
    try {
      const res = await fetch(`${PISTE_API_BASE}/search`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fond: 'CODE_DATE',
          recherche: {
            champs: [{
              typeChamp: 'NUM_ARTICLE',
              criteres: [{ typeRecherche: 'EXACTE', valeur: articleNum, operateur: 'ET' }],
              operateur: 'ET',
            }],
            filtres: [
              { facette: 'TEXT_LEGAL_STATUS', valeur: 'VIGUEUR' },
              { facette: 'NOM_CODE', valeur: codeName },
            ],
            pageNumber: 1,
            pageSize: 5,
            operateur: 'ET',
            typePagination: 'DEFAUT',
          },
        }),
        signal: AbortSignal.timeout(12000),
      })
      if (res.ok) {
        const data = await res.json() as { results?: Array<{ id: string; sections?: Array<{ extracts?: Array<{ id: string }> }> }> }
        const firstResult = data.results?.[0]
        // L'id dans results est souvent l'id du texte, pas de l'article
        // On cherche dans sections/extracts
        const artId = firstResult?.sections?.[0]?.extracts?.[0]?.id
        if (artId) return artId
      }
    } catch { /* fallback */ }
  }

  return null
}

// ── LODA_DATE : legiPart → arbre → LEGIARTI ID ────────────────────────────────

function collectArticles(node: any, out: Array<{ id: string; num: string }> = []): Array<{ id: string; num: string }> {
  for (const art of (node?.articles ?? [])) {
    const etat = (art.etat ?? '').toUpperCase()
    if ((etat === 'VIGUEUR' || etat === 'VIGUEUR_ETEN') && art.id) {
      out.push({ id: art.id, num: art.num ?? '' })
    }
  }
  for (const section of (node?.sections ?? [])) collectArticles(section, out)
  return out
}

async function findLegiartiInLoda(token: string, legitextId: string, articleNum: string): Promise<string | null> {
  const res = await fetch(`${PISTE_API_BASE}/consult/legiPart`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ textId: legitextId, date: TODAY }),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) return null
  const data = await res.json()
  const root = data?.texteConsolide ?? data?.texte ?? data
  const articles = collectArticles(root)
  const found = articles.find(
    a => a.num === articleNum || a.num === articleNum.toUpperCase()
  )
  return found?.id ?? null
}

// ── getArticle : texte complet ─────────────────────────────────────────────────

async function fetchArticleText(
  token: string,
  legiartiId: string,
  fond: 'CODE_DATE' | 'LODA_DATE'
): Promise<{ texte: string; url: string } | null> {
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
  const urlType = fond === 'CODE_DATE' ? 'codes' : 'loda'
  return { texte, url: `https://www.legifrance.gouv.fr/${urlType}/article_lc/${legiartiId}` }
}

// ── LLM summarize ─────────────────────────────────────────────────────────────

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
      model: 'openai/gpt-4o-mini',
      max_tokens: 350,
      messages: [
        {
          role: 'system',
          content: `Tu es juriste spécialisé en droit immobilier français.
Résume cet article en 3 champs JSON stricts (pas de markdown) :
- situation : quand cet article s'applique (contexte agent immobilier, locataire, acheteur, etc.)
- principe : la règle ou obligation principale, formulée clairement
- consequence : ce qui se passe si non-respecté ou l'effet pratique
Réponds UNIQUEMENT avec du JSON valide : {"situation":"...","principe":"...","consequence":"..."}`,
        },
        { role: 'user', content: `Article ${articleNum} — ${law}\n\n${texte.slice(0, 2000)}` },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) return null
  const data = await res.json() as { choices?: Array<{ message: { content: string } }> }
  const raw = data.choices?.[0]?.message?.content?.trim() ?? ''
  return JSON.parse(raw)
}

// ── Embedding Nomic ───────────────────────────────────────────────────────────

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
  const total  = TO_INDEX.reduce((s, e) => s + e.articles.length, 0)
  let done     = 0

  for (const entry of TO_INDEX) {
    for (const artNum of entry.articles) {
      done++
      const lawId = entry.legitextId

      // Vérifier si déjà indexé
      const { count } = await supabase
        .from('legal_articles')
        .select('*', { count: 'exact', head: true })
        .eq('law_id', lawId)
        .ilike('article_num', artNum)
        .is('deleted_at', null)

      if ((count ?? 0) > 0) {
        console.log(`[${done}/${total}] ⏭️  ${entry.law} art. ${artNum} — déjà indexé`)
        skipped++
        continue
      }

      process.stdout.write(`[${done}/${total}] 📥 ${entry.law} art. ${artNum}...`)

      if (DRY_RUN) {
        console.log(' (dry-run)')
        indexed++
        continue
      }

      try {
        // Résolution LEGIARTI ID selon le fond
        let legiartiId: string | null
        if (entry.fond === 'LODA_DATE') {
          legiartiId = await findLegiartiInLoda(token, lawId, artNum)
        } else {
          legiartiId = await findLegiartiInCode(token, lawId, artNum)
        }
        if (!legiartiId) { console.log(' ⚠️  LEGIARTI introuvable'); errors++; continue }

        // Fetch texte
        const articleData = await fetchArticleText(token, legiartiId, entry.fond)
        if (!articleData) { console.log(' ⚠️  texte vide ou abrogé'); errors++; continue }

        // Résumé LLM
        const summary = await summarize(artNum, entry.law, articleData.texte)
        if (!summary) { console.log(' ⚠️  résumé LLM échoué'); errors++; continue }

        // Embedding
        const embeddingText = `${summary.situation} ${summary.principe} ${summary.consequence}`
        const embedding = await embed(embeddingText)
        if (!embedding) { console.log(' ⚠️  embedding échoué'); errors++; continue }

        // Upsert
        const { error } = await supabase.from('legal_articles').upsert({
          law_id:          lawId,
          article_num:     artNum,
          title:           `Art. ${artNum} — ${entry.law}`,
          content:         articleData.texte,
          content_summary: JSON.stringify(summary),
          date_version:    TODAY,
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

      // Pause anti-rate-limit
      await new Promise(r => setTimeout(r, 200))
    }
  }

  console.log(`\n=== RÉSULTAT ===`)
  console.log(`Indexés      : ${indexed}${DRY_RUN ? ' (dry-run)' : ''}`)
  console.log(`Déjà en base : ${skipped}`)
  console.log(`Erreurs      : ${errors}`)
  console.log(`Total        : ${total}\n`)
}

main().catch(console.error)
