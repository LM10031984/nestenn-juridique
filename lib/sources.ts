// lib/sources.ts
// Recherche dans pgvector — retourne chunks (articles) + juriCases (arrêts)
// Utilise la RPC search_all_legal_context (migration 012).

import { createClient } from '@supabase/supabase-js'
import type { SourceChunk, JuriCase } from '@/lib/system-prompt'

export type { SourceChunk, JuriCase }

export interface SourcesResult {
  chunks: SourceChunk[]
  juriCases: JuriCase[]
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env manquant')
  return createClient(url, key)
}

interface PgVectorRow {
  source:      'article' | 'arret'
  doc_id:      string
  title:       string
  number:      string | null  // champ ajouté par migration 014
  situation:   string | null
  principe:    string | null
  consequence: string | null
  holding:     string | null  // champ ajouté par migration 019
  url:         string | null
  domain:      string
  similarity:  number
}

// Pattern UUID v4 et hex Judilibre (24 chars) — identifiants internes à filtrer
const INTERNAL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[0-9a-f]{24}$/i

function rowToChunk(row: PgVectorRow): SourceChunk {
  const parts = [
    row.situation   ? `Contexte : ${row.situation}`      : null,
    row.principe    ? `Règle : ${row.principe}`          : null,
    row.consequence ? `En pratique : ${row.consequence}` : null,
  ].filter(Boolean)

  return {
    sourceLaw: row.title,
    sourceArticle: '',
    sourceUrl: row.url,
    chunkText: parts.join('\n'),
    similarity: row.similarity,
  }
}

function rowToJuriCase(row: PgVectorRow): JuriCase | null {
  const parts = [
    row.situation,
    row.principe,
    row.consequence,
  ].filter(Boolean)

  // Numéro : utiliser row.number (migration 014) en priorité
  // Sinon extraire depuis le titre, sinon null
  let caseNumber = row.number ?? ''
  if (!caseNumber) {
    const numMatch = row.title.match(/n°\s*([\d\-.\/]+)/)
    caseNumber = numMatch?.[1] ?? ''
  }

  // Filtrer les identifiants internes (UUID, hex Judilibre)
  if (!caseNumber || INTERNAL_ID_RE.test(caseNumber)) return null

  const court: 'cass' | 'ca' = row.title.startsWith('Cass') ? 'cass' : 'ca'
  const dateMatch = row.title.match(/(\d{1,2}\s+\w+\s+\d{4})/)

  // Utiliser le holding indexé (migration 019) si disponible, sinon reconstruire
  const holding = row.holding && row.holding.length > 20
    ? row.holding
    : parts.join(' — ')

  return {
    court,
    date:    dateMatch?.[1] ?? '',
    number:  caseNumber,
    holding,
    url:     row.url ?? undefined,
  }
}

export async function fetchRelevantSources(
  embedding: number[],
  boostDomains: string[] | null,
  maxResults: number = 8,
  threshold: number = 0.30,
): Promise<SourcesResult> {
  const empty: SourcesResult = { chunks: [], juriCases: [] }

  if (!embedding.length) {
    console.warn('[sources] embedding vide — skip pgvector')
    return empty
  }

  try {
    const supabase = getSupabase()

    const { data, error } = await supabase.rpc('search_all_legal_context', {
      query_embedding: embedding,
      match_count: maxResults + 4,
      boost_domains: boostDomains?.length ? boostDomains : null,
    })

    if (error) {
      console.error('[sources] pgvector RPC error:', error.message)
      return empty
    }

    const rows = ((data ?? []) as PgVectorRow[])
      .filter(r => r.similarity >= threshold)
      .slice(0, maxResults)

    const chunks: SourceChunk[] = rows
      .filter(r => r.source === 'article')
      .map(rowToChunk)

    const juriCases: JuriCase[] = rows
      .filter(r => r.source === 'arret')
      .map(rowToJuriCase)
      .filter((c): c is JuriCase => c !== null)

    console.info(
      `[sources] ${chunks.length} articles + ${juriCases.length} arrêts `
      + `(sim ≥ ${threshold}, best=${rows[0]?.similarity?.toFixed(3) ?? '—'})`
    )

    return { chunks, juriCases }
  } catch (err) {
    console.error('[sources] Exception:', err)
    return empty  // fail graceful — le LLM répondra de mémoire
  }
}
