// lib/pgvector.ts
// Recherche sémantique dans Supabase pgvector (legal_articles + jurisprudence)
// Pipeline : query → nomic-embed-text → search_hybrid_legal_context() → { articles, arretText }
//
// Utilisé par chat/route.ts en parallèle du pipeline Légifrance live + Judilibre live.
// Avantage : résumés pré-calculés (situation/principe/consequence) + URLs directes.

import { createClient } from '@supabase/supabase-js'
import type { LegiTextResult } from '@/lib/legifrance'
import { detectDomains } from '@/lib/domain-detector'

// ---------------------------------------------------------------------------
// Client Supabase (server-side : service role pour RPC)
// ---------------------------------------------------------------------------

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env manquant')
  return createClient(url, key)
}

// ---------------------------------------------------------------------------
// Embedding — nomic-embed-text via Nomic cloud API
// Fallback : retourne null si API indisponible (pipeline continue sans pgvector)
// ---------------------------------------------------------------------------

const NOMIC_API_KEY = process.env.NOMIC_API_KEY ?? ''

async function embedQuery(text: string): Promise<number[] | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)

    const res = await fetch('https://api-atlas.nomic.ai/v1/embedding/text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NOMIC_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'nomic-embed-text-v1.5',
        texts: [text],
        // Pas de task_type : les vecteurs en base ont été indexés sans préfixe (Ollama local)
        // Ajouter task_type modifierait l'espace vectoriel et casserait la similarité
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))

    if (!res.ok) {
      console.warn('[pgvector] Nomic API error:', res.status)
      return null
    }
    const data = await res.json() as { embeddings: number[][] }
    return data.embeddings?.[0]?.length ? data.embeddings[0] : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PgVectorRow {
  source:      'article' | 'arret'
  doc_id:      string
  title:       string
  situation:   string | null
  principe:    string | null
  consequence: string | null
  url:         string | null
  domain:      string
  similarity:  number
}

export interface PgVectorContext {
  articles:  LegiTextResult[]  // injectés dans dilaContext.texts
  arretText: string            // injecté dans juriContext.text (format JUDILIBRE)
}

interface PgVectorCuratedRow extends PgVectorRow {
  is_curated: boolean
}

// ---------------------------------------------------------------------------
// Formatage
// ---------------------------------------------------------------------------

function rowToLegiTextResult(row: PgVectorRow): LegiTextResult {
  const parts = [
    row.situation   ? `Contexte : ${row.situation}`      : null,
    row.principe    ? `Règle : ${row.principe}`          : null,
    row.consequence ? `En pratique : ${row.consequence}` : null,
  ].filter(Boolean)

  return {
    textId:      row.doc_id,
    title:       row.title,
    content:     parts.join('\n'),
    dateVersion: '',
    url:         row.url ?? '',
    sourceType:  'loi',
  }
}

function rowToArretText(row: PgVectorRow): string {
  const lines = [`**${row.title}** (domaine : ${row.domain})`]
  if (row.situation)   lines.push(`Contexte : ${row.situation}`)
  if (row.principe)    lines.push(`Règle : ${row.principe}`)
  if (row.consequence) lines.push(`En pratique : ${row.consequence}`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Recherche combinée articles + arrêts
// ---------------------------------------------------------------------------

/**
 * Recherche sémantique dans la base pgvector (articles Légifrance + arrêts Judilibre).
 * Retourne les articles formatés pour dilaContext et les arrêts formatés pour juriSection.
 *
 * @param query    La question de l'agent immobilier
 * @param count    Nombre total de documents à retourner (défaut : 8)
 * @param minScore Score cosinus minimum pour filtrer le bruit (défaut : 0.50)
 */
export async function searchLegalContext(
  query: string,
  count = 12,
  minScore = 0.50,
): Promise<PgVectorContext> {
  const empty: PgVectorContext = { articles: [], arretText: '' }

  // 1. Embed + détection de domaine en parallèle
  const [embedding, domains] = await Promise.all([
    embedQuery(query),
    Promise.resolve(detectDomains(query)),
  ])

  if (!embedding) {
    console.warn('[pgvector] Embedding indisponible — skip pgvector search')
    return empty
  }

  if (domains.length > 0) {
    console.info(`[pgvector] domaines détectés : ${domains.join(', ')} (boost ×1.15 via migration 008)`)
  }

  // 2. Requête Supabase RPC hybride (vecteur + full-text, boost curated)
  try {
    const supabase = getSupabase()

    // Recherche vectorielle standard (migration 009) — rapide grâce à l'index HNSW
    // La recherche hybride (migration 011) est disponible mais désactivée par défaut
    // car le full scan CTE est trop lent sans index partiel sur fts.
    // TODO: optimiser la RPC hybride avec un pré-filtre vectoriel + re-rank FTS
    const { data, error } = await supabase.rpc('search_all_legal_context', {
      query_embedding: embedding,
      match_count: count + 3,
      boost_domains: domains.length > 0 ? domains : null,
    })

    if (error) {
      console.error('[pgvector] RPC error:', error.message)
      return empty
    }

    const rows = (data as PgVectorRow[]) ?? []

    // 3. Filtrer par score + dédupliquer par title
    const seen = new Set<string>()
    const filtered = rows
      .filter(r => r.similarity >= minScore)
      .filter(r => {
        if (seen.has(r.title)) return false
        seen.add(r.title)
        return true
      })
      .slice(0, count)

    const articles  = filtered.filter(r => r.source === 'article').map(rowToLegiTextResult)
    const arretRows = filtered.filter(r => r.source === 'arret')

    const arretText = arretRows.length > 0
      ? `Jurisprudence pgvector (résumés indexés) :\n\n${arretRows.map(rowToArretText).join('\n\n---\n\n')}`
      : ''

    console.info(`[pgvector] ${articles.length} articles + ${arretRows.length} arrêts (score ≥ ${minScore})`)
    return { articles, arretText }

  } catch (err) {
    console.error('[pgvector] Exception:', err)
    return empty
  }
}

// ---------------------------------------------------------------------------
// Recherche priorité curated (grands arrêts + complétion sémantique)
// ---------------------------------------------------------------------------

/**
 * Recherche avec priorité absolue aux grands arrêts curated demandés par le playbook.
 * Appelle la RPC search_curated_priority (migration 008).
 * Fail gracefully si Ollama ou Supabase indisponible.
 */
export async function searchCuratedCases(
  curatedIds: string[],
  query: string,
  count = 8,
): Promise<PgVectorContext> {
  const empty: PgVectorContext = { articles: [], arretText: '' }
  if (!curatedIds.length) return empty

  try {
    const embedding = await embedQuery(query)
    if (!embedding) {
      console.warn('[pgvector] Embedding indisponible — skip searchCuratedCases')
      return empty
    }

    const supabase = getSupabase()
    const { data, error } = await supabase.rpc('search_curated_priority', {
      query_embedding: embedding,
      curated_ids: curatedIds,
      match_count: count,
    })

    if (error) {
      console.error('[pgvector] search_curated_priority error:', error.message)
      return empty
    }

    const rows = (data as PgVectorCuratedRow[]) ?? []
    const articles  = rows.filter(r => r.source === 'article').map(rowToLegiTextResult)
    const arretRows = rows.filter(r => r.source === 'arret')

    const arretText = arretRows.length > 0
      ? `Jurisprudence prioritaire (grands arrêts) :\n\n${arretRows.map(rowToArretText).join('\n\n---\n\n')}`
      : ''

    console.info(`[pgvector] curated: ${articles.length} articles + ${arretRows.length} arrêts`)
    return { articles, arretText }

  } catch (err) {
    console.error('[pgvector] searchCuratedCases exception:', err)
    return empty
  }
}
