-- =============================================================================
-- Migration 004 — Recherche sémantique cross-domaine
-- Permet la recherche dans legal_articles sans filtrer par domaine.
-- Appelée depuis lib/pgvector.ts au moment de la requête chat.
-- =============================================================================

CREATE OR REPLACE FUNCTION search_articles_all_domains(
    query_embedding  vector(768),
    match_count      int DEFAULT 6
)
RETURNS TABLE (
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
    SELECT
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
    ORDER BY embedding <=> query_embedding
    LIMIT match_count;
$$;

COMMENT ON FUNCTION search_articles_all_domains IS
    'Recherche sémantique dans legal_articles tous domaines confondus. Appelée par lib/pgvector.ts.';
