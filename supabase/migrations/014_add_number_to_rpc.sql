-- =============================================================================
-- Migration 014 — Ajouter le champ `number` à search_all_legal_context
--
-- Problème : la RPC retourne uniquement `title` pour les arrêts, qui vaut
--   COALESCE(number, source_id). Quand number = NULL, c'est le source_id
--   Judilibre (hex, ex: "68369a5d97f0874892822320") qui est retourné comme
--   titre et utilisé comme numéro d'arrêt par sources.ts → fuite d'identifiant.
--
-- Fix : exposer `number` séparément dans le RETURNS TABLE afin que
--   sources.ts puisse utiliser le vrai numéro (ex: "24/00374") sans regex.
-- =============================================================================

DROP FUNCTION IF EXISTS search_all_legal_context(vector, integer, text[]);

CREATE OR REPLACE FUNCTION search_all_legal_context(
    query_embedding  vector(768),
    match_count      int     DEFAULT 8,
    boost_domains    text[]  DEFAULT NULL
)
RETURNS TABLE (
    source      text,
    doc_id      uuid,
    title       text,
    number      text,
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
        source, doc_id, title, number, situation, principe, consequence, url, domain,
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
            NULL::text                                   AS number,
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
            number,
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
    'Recherche sémantique combinée articles + arrêts. boost_domains (optionnel) : domaines dont le score est multiplié par 1.15. Migration 014 : expose le champ number pour éviter la fuite des source_id hex dans les numéros d''arrêt.';
