-- =============================================================================
-- Migration 012 — Fix titre des chunks curated dans les RPCs
--
-- Problème : COALESCE(number, source_id) retourne le slug technique
--   (ex: "curated-convocation-ag-copro-21-jours") pour les arrêts curated
--   dont number = NULL. Le LLM cite ce slug dans ses réponses.
--
-- Fix : pour les enregistrements curated avec visa_refs, utiliser visa_refs[1]
--   comme titre (ex: "Art. 9 décret 67-223 du 17 mars 1967").
--   Fallback : COALESCE(number, source_id) si visa_refs est vide.
-- =============================================================================

-- Macro helper pour ne pas répéter l'expression 3 fois
-- (PG ne supporte pas les macros, on l'injecte directement)

-- 1. Fix search_all_legal_context
-- =============================================================================
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
            CASE
                WHEN curated = true AND array_length(visa_refs, 1) > 0
                THEN visa_refs[1]
                ELSE COALESCE(number, source_id)
            END                                          AS title,
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
    'Recherche sémantique combinée articles + arrêts. boost_domains (optionnel) : domaines dont le score est multiplié par 1.15. Migration 012 : titre curated = visa_refs[1] au lieu du slug source_id.';

-- 2. Fix search_curated_priority
-- =============================================================================
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
            CASE
                WHEN array_length(visa_refs, 1) > 0
                THEN visa_refs[1]
                ELSE COALESCE(number, source_id)
            END                                          AS title,
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
            CASE
                WHEN curated = true AND array_length(visa_refs, 1) > 0
                THEN visa_refs[1]
                ELSE COALESCE(number, source_id)
            END                                          AS title,
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
    'Recherche avec priorité absolue aux grands arrêts curated (similarity forcée à 2.0), puis complétion sémantique. Migration 012 : titre curated = visa_refs[1] au lieu du slug source_id.';
