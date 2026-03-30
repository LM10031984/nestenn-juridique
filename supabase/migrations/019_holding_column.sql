-- =============================================================================
-- Migration 019 — Ajouter le champ `holding` à jurisprudence
--
-- Problème : les arrêts pgvector n'ont pas de holding lisible.
--   rowToJuriCase reconstruit holding depuis situation+principe+consequence,
--   ce qui donne un texte verbeux ("Contexte : ... — Règle : ...") peu citable.
--
-- Fix : ajouter un champ holding text contenant un résumé 1-2 phrases
--   généré par GPT-4o-mini lors de l'indexation, et exposé par la RPC.
-- =============================================================================

ALTER TABLE public.jurisprudence
    ADD COLUMN IF NOT EXISTS holding text;

COMMENT ON COLUMN public.jurisprudence.holding IS
    'Résumé 1-2 phrases du principe juridique, généré par GPT-4o-mini. Utilisé par le LLM pour citer l''arrêt précisément.';


-- Mise à jour de search_all_legal_context pour exposer holding
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
    holding     text,
    url         text,
    domain      text,
    similarity  float
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        source, doc_id, title, number, situation, principe, consequence, holding, url, domain,
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
            NULL::text                                   AS holding,
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
            holding,
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
    'Recherche sémantique combinée articles + arrêts. boost_domains (optionnel) : domaines dont le score est multiplié par 1.15. Migration 019 : expose le champ holding pour des arrêts directement citables.';
