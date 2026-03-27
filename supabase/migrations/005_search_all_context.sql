-- =============================================================================
-- Migration 005 — Recherche sémantique combinée articles + arrêts, cross-domaine
-- Remplace les appels séparés search_articles_all_domains + search_legal_context.
-- Retourne les N documents les plus proches toutes sources confondues.
-- =============================================================================

CREATE OR REPLACE FUNCTION search_all_legal_context(
    query_embedding  vector(768),
    match_count      int DEFAULT 8
)
RETURNS TABLE (
    source      text,
    doc_id      uuid,
    title       text,
    situation   text,
    principe    text,
    consequence text,
    url         text,
    domain      text,
    similarity  float
)
LANGUAGE sql
STABLE
AS $$
    SELECT source, doc_id, title, situation, principe, consequence, url, domain, similarity
    FROM (
        -- Articles de loi Légifrance
        SELECT
            'article'::text                              AS source,
            id                                           AS doc_id,
            title,
            (content_summary::jsonb->>'situation')       AS situation,
            (content_summary::jsonb->>'principe')        AS principe,
            (content_summary::jsonb->>'consequence')     AS consequence,
            url,
            domain,
            1 - (embedding <=> query_embedding)          AS similarity
        FROM public.legal_articles
        WHERE deleted_at IS NULL
          AND in_force = true
          AND embedding IS NOT NULL

        UNION ALL

        -- Arrêts de jurisprudence Judilibre
        SELECT
            'arret'::text                                AS source,
            id                                           AS doc_id,
            COALESCE(number, source_id)                  AS title,
            situation,
            principle                                    AS principe,
            consequence,
            url,
            domain,
            1 - (embedding <=> query_embedding)          AS similarity
        FROM public.jurisprudence
        WHERE deleted_at IS NULL
          AND embedding IS NOT NULL
    ) combined
    ORDER BY similarity DESC
    LIMIT match_count;
$$;

COMMENT ON FUNCTION search_all_legal_context IS
    'Recherche sémantique combinée articles Légifrance + arrêts Judilibre, tous domaines. Appelée par lib/pgvector.ts.';
