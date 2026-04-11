// scripts/enrich-corpus.ts
// Enrichissement idempotent du corpus pour les nouveaux domaines
//
// Usage :
//   npx dotenv-cli -e .env.local -- npx tsx scripts/enrich-corpus.ts --vague V1
//   npx dotenv-cli -e .env.local -- npx tsx scripts/enrich-corpus.ts --domain droit_social_immo
//   npx dotenv-cli -e .env.local -- npx tsx scripts/enrich-corpus.ts --dry-run
//
// ATTENTION : Fixer le bug auto-indexer.ts (VALID_DOMAINS) AVANT de lancer ce script.
// Vérifier l'état du corpus d'abord : npx tsx scripts/audit-coverage.ts

import { createClient } from '@supabase/supabase-js'
import { readFileSync, resolve as pathResolve } from 'fs'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { DOMAIN_CORPUS, type DomainSpec, type DomainSource } from '../lib/domain-reference-corpus.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Charger .env.local
try {
  const envPath = pathResolve(__dirname, '../.env.local')
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
} catch { /* variables système */ }

const args = process.argv.slice(2)
const VAGUE_FILTER  = args.includes('--vague')  ? args[args.indexOf('--vague')  + 1] : null
const DOMAIN_FILTER = args.includes('--domain') ? args[args.indexOf('--domain') + 1] : null
const DRY_RUN       = args.includes('--dry-run')
const REINDEX       = args.includes('--reindex')

// ── Clients ───────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PISTE_TOKEN_URL = 'https://oauth.piste.gouv.fr/api/oauth/token'
const PISTE_API_BASE  = process.env.PISTE_API_URL ?? 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app'
const OPENROUTER_URL  = 'https://openrouter.ai/api/v1/chat/completions'
const SUMMARY_MODEL   = 'openai/gpt-4o-mini'
const TODAY           = new Date().toISOString().split('T')[0]

// ── Helpers ───────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000, label = ''): Promise<T | null> {
  for (let i = 1; i <= retries; i++) {
    try { return await fn() } catch (e: any) {
      if (i === retries) { console.error(`  [RETRY EXHAUSTED] ${label}: ${e.message}`); return null }
      await sleep(delay * i)
    }
  }
  return null
}

// ── Auth PISTE ────────────────────────────────────────────────────────────

let _token: string | null = null
let _tokenExpiry = 0

async function getToken(): Promise<string> {
  if (_token && Date.now() < _tokenExpiry) return _token
  const res = await fetch(PISTE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.PISTE_CLIENT_ID!,
      client_secret: process.env.PISTE_CLIENT_SECRET!,
      scope: 'openid',
    }),
  })
  if (!res.ok) throw new Error(`Token PISTE HTTP ${res.status}`)
  const data = await res.json() as { access_token: string; expires_in: number }
  _token = data.access_token
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
  return _token!
}

// ── Légifrance API ────────────────────────────────────────────────────────

async function fetchLegiPart(token: string, textId: string): Promise<any> {
  return withRetry(async () => {
    const res = await fetch(`${PISTE_API_BASE}/consult/legiPart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ textId, date: TODAY }),
    })
    if (!res.ok) throw new Error(`legiPart ${textId} → HTTP ${res.status}`)
    return res.json()
  }, 3, 1000, `legiPart(${textId})`)
}

interface ArticleRef { id: string; num: string }

function collectArticles(node: any, out: ArticleRef[] = []): ArticleRef[] {
  for (const art of (node?.articles ?? [])) {
    const etat = (art.etat ?? '').toUpperCase()
    if ((etat === 'VIGUEUR' || etat === 'VIGUEUR_ETEN') && art.id)
      out.push({ id: art.id, num: art.num ?? '' })
  }
  for (const sub of (node?.sections ?? [])) collectArticles(sub, out)
  return out
}

function findSectionByCid(node: any, cid: string): any | null {
  if ((node?.cid ?? node?.id ?? '') === cid) return node
  for (const s of (node?.sections ?? [])) { const f = findSectionByCid(s, cid); if (f) return f }
  return null
}

function normalizeRoot(data: any): any {
  return data?.texteConsolide ?? data?.texte ?? data?.legi ?? data?.code ?? data
}

async function fetchArticleText(token: string, legiartiId: string): Promise<string | null> {
  const res = await withRetry(async () => {
    const r = await fetch(`${PISTE_API_BASE}/consult/getArticle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: legiartiId }),
    })
    if (!r.ok) throw new Error(`getArticle HTTP ${r.status}`)
    return r.json() as Promise<any>
  }, 3, 800, `getArticle(${legiartiId})`)
  const texte = res?.article?.texte ?? ''
  return texte.length > 20 ? texte.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null
}

// ── LLM Résumé ────────────────────────────────────────────────────────────

async function summarize(articleNum: string, lawLabel: string, texte: string, domain: DomainSpec): Promise<{ situation: string; principe: string; consequence: string } | null> {
  return withRetry(async () => {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://nestenn.com',
      },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        messages: [{
          role: 'system',
          content: 'Tu es un juriste expert en droit immobilier français. Résume en JSON strict sans markdown.',
        }, {
          role: 'user',
          content: `Article ${articleNum} — ${lawLabel}\n\n${texte.slice(0, 3000)}\n\nRéponds UNIQUEMENT en JSON : {"situation":"...","principe":"...","consequence":"..."}`,
        }],
        max_tokens: 400,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    })
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`)
    const data = await res.json() as any
    const parsed = JSON.parse(data.choices[0].message.content)
    if (!parsed.situation || !parsed.principe) throw new Error('champs manquants')
    return parsed
  }, 3, 1500, `summarize(${articleNum})`)
}

// ── Embedding Nomic ───────────────────────────────────────────────────────

async function embed(text: string): Promise<number[] | null> {
  return withRetry(async () => {
    const res = await fetch('https://api-atlas.nomic.ai/v1/embedding/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.NOMIC_API_KEY}` },
      body: JSON.stringify({ model: 'nomic-embed-text-v1.5', texts: [text] }),
    })
    if (!res.ok) throw new Error(`Nomic HTTP ${res.status}`)
    const data = await res.json() as { embeddings: number[][] }
    if (!data.embeddings?.[0]?.length) throw new Error('embedding vide')
    return data.embeddings[0]
  }, 3, 500, 'embed')
}

// ── Tag-or-insert article (multi-domaines) ────────────────────────────────

/** Retourne l'article existant s'il est déjà en base, null sinon. */
async function getExistingArticle(lawId: string, articleNum: string): Promise<{ id: string; domains: string[] } | null> {
  const { data } = await supabase
    .from('legal_articles')
    .select('id, domains')
    .eq('law_id', lawId)
    .ilike('article_num', articleNum)
    .limit(1)
  const row = data?.[0]
  return row ? { id: row.id as string, domains: (row.domains as string[]) ?? [] } : null
}

/** Ajoute un domaine au tableau domains d'un article existant. */
async function tagArticle(articleId: string, domain: string, currentDomains: string[]): Promise<void> {
  const merged = [...new Set([...currentDomains, domain])]
  const { error } = await supabase
    .from('legal_articles')
    .update({ domains: merged })
    .eq('id', articleId)
  if (error) throw new Error(error.message)
}

/** Insère un nouvel article avec domains: [domain]. */
async function insertArticle(params: {
  lawId: string; articleNum: string; title: string
  content: string; summary: { situation: string; principe: string; consequence: string }
  embedding: number[]; domain: string; url: string
}): Promise<void> {
  const { error } = await supabase.from('legal_articles').insert({
    law_id:          params.lawId,
    article_num:     params.articleNum,
    title:           params.title,
    content:         params.content,
    content_summary: JSON.stringify(params.summary),
    date_version:    TODAY,
    url:             params.url,
    domain:          params.domain,
    domains:         [params.domain],
    sub_themes:      [],
    in_force:        true,
    embedding:       params.embedding,
  })
  if (error) throw new Error(error.message)
}

// ── Indexation d'une source ───────────────────────────────────────────────

async function indexSource(token: string, src: DomainSource, domain: DomainSpec): Promise<{ indexed: number; skipped: number; errors: number }> {
  const stats = { indexed: 0, skipped: 0, errors: 0 }

  console.log(`\n  📄 Source : ${src.label}`)

  // Récupérer l'arbre legiPart
  const raw = await fetchLegiPart(token, src.legitext)
  if (!raw) { console.log(`     ⚠️  legiPart introuvable pour ${src.legitext}`); stats.errors++; return stats }

  const root = normalizeRoot(raw)
  // Cibler la section si sctCid fourni
  const tree = src.sctCid ? findSectionByCid(root, src.sctCid) : root

  if (!tree) {
    console.log(`     ⚠️  Section ${src.sctCid} introuvable dans ${src.legitext}`)
    if (src.notes) console.log(`     ℹ️  Note : ${src.notes}`)
    stats.errors++
    return stats
  }

  const articles = collectArticles(tree)
  const limit = src.maxArticles ?? 200
  const batch = articles.slice(0, limit)

  console.log(`     Articles VIGUEUR : ${articles.length} (traitement : ${batch.length})`)

  for (const art of batch) {
    // ── Cas 1 : article existant ────────────────────────────────────────────
    const existing = REINDEX ? null : await getExistingArticle(src.legitext, art.num)

    if (existing) {
      if (existing.domains.includes(domain.code)) {
        // Domaine déjà tagué → vrai skip
        stats.skipped++
        continue
      }

      // Article existe mais domaine absent → simple tag (pas de re-embed)
      if (DRY_RUN) {
        console.log(`     [DRY] Art. ${art.num} — (tag domaine: ${domain.code})`)
        stats.indexed++
        continue
      }
      try {
        await tagArticle(existing.id, domain.code, existing.domains)
        console.log(`     🏷️  Art. ${art.num} (tagué: ${domain.code})`)
        stats.indexed++
      } catch (e: any) {
        console.error(`     ❌ Tag ${art.num} : ${e.message}`)
        stats.errors++
      }
      await sleep(50)
      continue
    }

    // ── Cas 2 : nouvel article — pipeline complet ───────────────────────────
    const texte = await fetchArticleText(token, art.id)
    if (!texte) { stats.errors++; continue }

    const lawUrl = `https://www.legifrance.gouv.fr/codes/article_lc/${art.id}`

    if (DRY_RUN) {
      console.log(`     [DRY] Art. ${art.num} — ${texte.slice(0, 60)}…`)
      stats.indexed++
      continue
    }

    const summary = await summarize(art.num, src.label, texte, domain)
    if (!summary) { stats.errors++; continue }

    const embeddingText = `${summary.situation} ${summary.principe} ${summary.consequence}`
    const embedding = await embed(embeddingText)
    if (!embedding) { stats.errors++; continue }

    try {
      await insertArticle({
        lawId: src.legitext,
        articleNum: art.num,
        title: `Art. ${art.num} — ${src.label}`,
        content: texte,
        summary,
        embedding,
        domain: domain.code,
        url: lawUrl,
      })
      console.log(`     ✅ Art. ${art.num}`)
      stats.indexed++
    } catch (e: any) {
      console.error(`     ❌ Art. ${art.num} : ${e.message}`)
      stats.errors++
    }

    await sleep(150)
  }

  return stats
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗')
  console.log('║        NESTENN JURIDIQUE — ENRICHISSEMENT CORPUS             ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')
  console.log(`\nConfig : vague=${VAGUE_FILTER ?? 'tous'} domaine=${DOMAIN_FILTER ?? 'tous'} dry-run=${DRY_RUN} reindex=${REINDEX}`)

  if (!DRY_RUN) {
    console.log('\n⚠️  Mode ÉCRITURE — les articles seront insérés en base.')
    console.log('   Vérifier d\'abord l\'état du corpus : npx tsx scripts/audit-coverage.ts')
    console.log('   Utiliser --dry-run pour simuler sans écrire.\n')
  }

  const domains = DOMAIN_CORPUS.filter(d => {
    if (VAGUE_FILTER  && d.vague !== VAGUE_FILTER)  return false
    if (DOMAIN_FILTER && d.code  !== DOMAIN_FILTER) return false
    // Par défaut : seulement les nouveaux domaines
    if (!VAGUE_FILTER && !DOMAIN_FILTER && d.vague === 'existing') return false
    return true
  })

  console.log(`Domaines à enrichir : ${domains.map(d => d.code).join(', ')}\n`)

  let token: string
  try {
    token = await getToken()
    console.log('✅ Token PISTE OK\n')
  } catch (e: any) {
    console.error('❌ Token PISTE indisponible :', e.message)
    process.exit(1)
  }

  const totals = { indexed: 0, skipped: 0, errors: 0 }

  for (const domain of domains) {
    console.log(`\n🏷️  Domaine [${domain.vague}] : ${domain.code} — ${domain.label}`)

    // Déduplication des sources (même id ne doit pas être indexé deux fois pour ce domaine)
    const seenSrcIds = new Set<string>()
    for (const src of domain.sources) {
      const key = `${src.id}::${domain.code}`
      if (seenSrcIds.has(key)) { console.log(`  ↩  Source ${src.id} déjà traitée — skip`); continue }
      seenSrcIds.add(key)

      const stats = await indexSource(token, src, domain)
      totals.indexed += stats.indexed
      totals.skipped += stats.skipped
      totals.errors  += stats.errors
    }
  }

  console.log('\n══════════════════════════════════════════════════════════════')
  console.log(`📊 RÉSULTAT : ✅ ${totals.indexed} indexés | ⏭  ${totals.skipped} déjà présents | ❌ ${totals.errors} erreurs`)
  if (DRY_RUN) console.log('   (dry-run — rien écrit en base)')
  console.log('\n→ Relancer l\'audit : npx tsx scripts/audit-coverage.ts')
  console.log('→ Lancer le benchmark : npx tsx scripts/benchmark.ts --limit 120\n')
}

main().catch(err => { console.error(err); process.exit(1) })
