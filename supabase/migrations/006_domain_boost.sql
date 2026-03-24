-- =============================================================================
-- Migration 006 — Domain boost dans la recherche sémantique
-- Ajoute un paramètre optionnel boost_domains : les résultats dont le domaine
-- est dans la liste reçoivent un score × 1.2 avant tri final.
-- Rétrocompatible : sans boost_domains, comportement identique à 005.
-- =============================================================================

CREATE OR REPLACE FUNCTION search_all_legal_context(
    query_embedding  vector(768),
    match_count      int     DEFAULT 8,
    boost_domains    text[]  DEFAULT NULL   -- ex: ARRAY['baux_habitation','copropriete']
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
    SELECT source, doc_id, title, situation, principe, consequence, url, domain,
           -- boost × 1.2 si le domaine est dans boost_domains
           CASE
               WHEN boost_domains IS NOT NULL AND domain = ANY(boost_domains)
               THEN similarity * 1.2
               ELSE similarity
           END AS similarity
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
    ORDER BY
        CASE
            WHEN boost_domains IS NOT NULL AND domain = ANY(boost_domains)
            THEN similarity * 1.2
            ELSE similarity
        END DESC
    LIMIT match_count;
$$;

COMMENT ON FUNCTION search_all_legal_context IS
    'Recherche sémantique combinée articles + arrêts. boost_domains (optionnel) : domaines dont le score est multiplié par 1.2.';
