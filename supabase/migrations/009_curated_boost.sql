-- =============================================================================
-- Migration 009 — Boost prioritaire pour les entrées curated dans la recherche
-- Les entrées curated=true de la table jurisprudence reçoivent un boost ×1.3
-- afin de surclasser les articles génériques pour les questions ciblées.
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
            WHEN is_curated = true AND boost_domains IS NOT NULL AND domain = ANY(boost_domains)
            THEN similarity_raw * 1.45   -- curated + domaine correspondant = priorité maximale
            WHEN is_curated = true
            THEN similarity_raw * 1.30   -- curated seul = toujours boosté
            WHEN boost_domains IS NOT NULL AND domain = ANY(boost_domains)
            THEN similarity_raw * 1.15   -- article domaine correspondant
            ELSE similarity_raw
        END AS similarity
    FROM (
        -- Articles de loi Légifrance (jamais curated)
        SELECT
            'article'::text                              AS source,
            id                                           AS doc_id,
            title,
            (content_summary::jsonb->>'situation')       AS situation,
            (content_summary::jsonb->>'principe')        AS principe,
            (content_summary::jsonb->>'consequence')     AS consequence,
            url,
            domain,
            1 - (embedding <=> query_embedding)          AS similarity_raw,
            false::boolean                               AS is_curated
        FROM public.legal_articles
        WHERE deleted_at IS NULL
          AND in_force = true
          AND embedding IS NOT NULL

        UNION ALL

        -- Arrêts de jurisprudence (curated + Judilibre)
        SELECT
            'arret'::text                                AS source,
            id                                           AS doc_id,
            COALESCE(number, source_id)                  AS title,
            situation,
            principle                                    AS principe,
            consequence,
            url,
            domain,
            1 - (embedding <=> query_embedding)          AS similarity_raw,
            COALESCE(curated, false)::boolean            AS is_curated
        FROM public.jurisprudence
        WHERE deleted_at IS NULL
          AND embedding IS NOT NULL
    ) combined
    ORDER BY
        CASE
            WHEN is_curated = true AND boost_domains IS NOT NULL AND domain = ANY(boost_domains)
            THEN similarity_raw * 1.45
            WHEN is_curated = true
            THEN similarity_raw * 1.30
            WHEN boost_domains IS NOT NULL AND domain = ANY(boost_domains)
            THEN similarity_raw * 1.15
            ELSE similarity_raw
        END DESC
    LIMIT match_count;
$$;

COMMENT ON FUNCTION search_all_legal_context IS
    'Recherche sémantique combinée articles + arrêts. Boost ×1.30 pour curated, ×1.45 curated+domaine, ×1.15 domaine seul. Migration 009.';
