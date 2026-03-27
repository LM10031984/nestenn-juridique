-- =============================================================================
-- Migration 011 — Recherche hybride : vecteur sémantique + full-text (tsvector)
--
-- Combine le score cosinus pgvector avec ts_rank full-text (migration 010).
-- Cas d'usage : attraper "Art. L412-6" ou "article 24 loi 89-462" même quand
-- le vecteur sémantique les rate (numéros d'articles = faible signal sémantique).
--
-- Score final = vector_score * 0.7 + fts_score * 0.3 (si match FTS)
-- Les documents matchés uniquement par FTS sont inclus avec score plancher 0.35.
-- Conserve le boost curated (x1.30/x1.45) de la migration 009.
-- =============================================================================

CREATE OR REPLACE FUNCTION search_hybrid_legal_context(
    query_embedding  vector(768),
    query_text       text        DEFAULT '',
    match_count      int         DEFAULT 12,
    boost_domains    text[]      DEFAULT NULL
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
    WITH
    -- Convertir le texte en tsquery (français)
    fts_query AS (
        SELECT plainto_tsquery('french', query_text) AS q
    ),

    -- Articles de loi
    articles AS (
        SELECT
            'article'::text                              AS source,
            la.id                                        AS doc_id,
            la.title,
            (la.content_summary::jsonb->>'situation')    AS situation,
            (la.content_summary::jsonb->>'principe')     AS principe,
            (la.content_summary::jsonb->>'consequence')  AS consequence,
            la.url,
            la.domain,
            1 - (la.embedding <=> query_embedding)       AS vec_score,
            CASE WHEN la.fts @@ (SELECT q FROM fts_query)
                 THEN ts_rank_cd(la.fts, (SELECT q FROM fts_query), 32)
                 ELSE 0.0
            END                                          AS fts_score,
            false::boolean                               AS is_curated
        FROM public.legal_articles la
        WHERE la.deleted_at IS NULL
          AND la.in_force = true
          AND la.embedding IS NOT NULL
    ),

    -- Arrêts de jurisprudence
    arrets AS (
        SELECT
            'arret'::text                                AS source,
            j.id                                         AS doc_id,
            COALESCE(j.number, j.source_id)              AS title,
            j.situation,
            j.principle                                  AS principe,
            j.consequence,
            j.url,
            j.domain,
            1 - (j.embedding <=> query_embedding)        AS vec_score,
            CASE WHEN j.fts @@ (SELECT q FROM fts_query)
                 THEN ts_rank_cd(j.fts, (SELECT q FROM fts_query), 32)
                 ELSE 0.0
            END                                          AS fts_score,
            COALESCE(j.curated, false)::boolean          AS is_curated
        FROM public.jurisprudence j
        WHERE j.deleted_at IS NULL
          AND j.embedding IS NOT NULL
    ),

    -- Combinaison avec score hybride
    combined AS (
        SELECT *,
            -- Score hybride : 70% vecteur + 30% full-text (normalisé)
            CASE
                WHEN fts_score > 0 THEN vec_score * 0.7 + LEAST(fts_score * 10.0, 1.0) * 0.3
                WHEN vec_score >= 0.35 THEN vec_score
                ELSE 0.0
            END AS hybrid_raw
        FROM (
            SELECT * FROM articles
            UNION ALL
            SELECT * FROM arrets
        ) all_docs
        -- Garder les docs avec un minimum de pertinence
        WHERE vec_score >= 0.30 OR fts_score > 0
    )

    SELECT
        source, doc_id, title, situation, principe, consequence, url, domain,
        -- Appliquer le boost curated (identique migration 009)
        CASE
            WHEN is_curated = true AND boost_domains IS NOT NULL AND domain = ANY(boost_domains)
            THEN hybrid_raw * 1.45
            WHEN is_curated = true
            THEN hybrid_raw * 1.30
            WHEN boost_domains IS NOT NULL AND domain = ANY(boost_domains)
            THEN hybrid_raw * 1.15
            ELSE hybrid_raw
        END AS similarity
    FROM combined
    ORDER BY
        CASE
            WHEN is_curated = true AND boost_domains IS NOT NULL AND domain = ANY(boost_domains)
            THEN hybrid_raw * 1.45
            WHEN is_curated = true
            THEN hybrid_raw * 1.30
            WHEN boost_domains IS NOT NULL AND domain = ANY(boost_domains)
            THEN hybrid_raw * 1.15
            ELSE hybrid_raw
        END DESC
    LIMIT match_count;
$$;

COMMENT ON FUNCTION search_hybrid_legal_context IS
    'Recherche hybride vecteur+full-text. Score = 0.7*cosinus + 0.3*ts_rank. Boost curated x1.30/x1.45. Migration 011.';
