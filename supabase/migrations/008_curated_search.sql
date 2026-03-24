-- =============================================================================
-- Migration 008 — Deux corrections :
--   1. Fix bug double-multiply dans search_all_legal_context (migration 006)
--      Le CASE WHEN dans ORDER BY re-multipliait l'alias déjà boosté → ×1.44 effectif.
--      Fix : sous-requête avec similarity_raw, ORDER BY sur la valeur boostée.
--      Boost réduit à ×1.15 (moins agressif).
--   2. Nouvelle RPC search_curated_priority :
--      Retourne les grands arrêts curated demandés en priorité absolue (similarity=2.0),
--      puis complète avec la recherche sémantique pour atteindre match_count.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Fix search_all_legal_context — suppression du double boost dans ORDER BY
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION search_all_legal_context(
    query_embedding  vector(768),
    match_count      int     DEFAULT 8,
    boost_domains    text[]  DEFAULT NULL
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
    SELECT
        source, doc_id, title, situation, principe, consequence, url, domain,
        CASE
            WHEN boost_domains IS NOT NULL AND domain = ANY(boost_domains)
            THEN similarity_raw * 1.15
            ELSE similarity_raw
        END AS similarity
    FROM (
        SELECT
            'article'::text                              AS source,
            id                                           AS doc_id,
            title,
            (content_summary::jsonb->>'situation')       AS situation,
            (content_summary::jsonb->>'principe')        AS principe,
            (content_summary::jsonb->>'consequence')     AS consequence,
            url,
            domain,
            1 - (embedding <=> query_embedding)          AS similarity_raw
        FROM public.legal_articles
        WHERE deleted_at IS NULL
          AND in_force = true
          AND embedding IS NOT NULL

        UNION ALL

        SELECT
            'arret'::text                                AS source,
            id                                           AS doc_id,
            COALESCE(number, source_id)                  AS title,
            situation,
            principle                                    AS principe,
            consequence,
            url,
            domain,
            1 - (embedding <=> query_embedding)          AS similarity_raw
        FROM public.jurisprudence
        WHERE deleted_at IS NULL
          AND embedding IS NOT NULL
    ) combined
    ORDER BY
        CASE
            WHEN boost_domains IS NOT NULL AND domain = ANY(boost_domains)
            THEN similarity_raw * 1.15
            ELSE similarity_raw
        END DESC
    LIMIT match_count;
$$;

COMMENT ON FUNCTION search_all_legal_context IS
    'Recherche sémantique combinée articles + arrêts. boost_domains (optionnel) : domaines dont le score est multiplié par 1.15. Fix migration 008 : le boost n''est plus appliqué deux fois.';

-- -----------------------------------------------------------------------------
-- 2. Nouvelle RPC search_curated_priority
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION search_curated_priority(
    query_embedding  vector(768),
    curated_ids      text[],
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
    similarity  float,
    is_curated  boolean
)
LANGUAGE sql
STABLE
AS $$
    SELECT source, doc_id, title, situation, principe, consequence, url, domain, similarity, is_curated
    FROM (
        -- Grands arrêts curated demandés (priorité forcée : similarity = 2.0)
        SELECT
            'arret'::text                                AS source,
            id                                           AS doc_id,
            COALESCE(number, source_id)                  AS title,
            situation,
            principle                                    AS principe,
            consequence,
            url,
            domain,
            2.0::float                                   AS similarity,
            true::boolean                                AS is_curated
        FROM public.jurisprudence
        WHERE source_id = ANY(curated_ids)
          AND deleted_at IS NULL

        UNION ALL

        -- Complétion sémantique : articles Légifrance
        SELECT
            'article'::text                              AS source,
            id                                           AS doc_id,
            title,
            (content_summary::jsonb->>'situation')       AS situation,
            (content_summary::jsonb->>'principe')        AS principe,
            (content_summary::jsonb->>'consequence')     AS consequence,
            url,
            domain,
            1 - (embedding <=> query_embedding)          AS similarity,
            false::boolean                               AS is_curated
        FROM public.legal_articles
        WHERE deleted_at IS NULL
          AND in_force = true
          AND embedding IS NOT NULL

        UNION ALL

        -- Complétion sémantique : arrêts non-curated
        SELECT
            'arret'::text                                AS source,
            id                                           AS doc_id,
            COALESCE(number, source_id)                  AS title,
            situation,
            principle                                    AS principe,
            consequence,
            url,
            domain,
            1 - (embedding <=> query_embedding)          AS similarity,
            false::boolean                               AS is_curated
        FROM public.jurisprudence
        WHERE deleted_at IS NULL
          AND embedding IS NOT NULL
          AND source_id != ALL(curated_ids)
    ) all_results
    ORDER BY similarity DESC
    LIMIT match_count;
$$;

COMMENT ON FUNCTION search_curated_priority IS
    'Recherche avec priorité absolue aux grands arrêts curated demandés (similarity forcée à 2.0), puis complétion sémantique. Utilisée par lib/pgvector.ts::searchCuratedCases().';
