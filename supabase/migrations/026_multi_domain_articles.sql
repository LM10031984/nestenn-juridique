-- =============================================================================
-- Migration 026 — Modèle multi-domaines pour legal_articles et jurisprudence
--
-- Problème : domain (text) = un seul domaine par article.
--   Un article de la Loi 89-462 indexé sous baux_habitation n'est pas visible
--   si on cherche sous gestion_locative, même si c'est le même texte.
--
-- Solution : ajouter domains (text[]) — un article peut appartenir à N domaines.
--   Le champ domain est conservé pour rétrocompatibilité (marqué DEPRECATED).
--
-- Impacts :
--   - scripts/enrich-corpus.ts : logique tag-or-insert (plus de skip aveugle)
--   - scripts/audit-coverage.ts : .contains('domains', [domain])
--   - lib/auto-indexer.ts : upsert écrit domains: [domain]
--   - RPC search_all_legal_context : boost domains && boost_domains (array overlap)
-- =============================================================================

-- ── 1. Colonnes domains ──────────────────────────────────────────────────────

ALTER TABLE legal_articles
  ADD COLUMN IF NOT EXISTS domains text[] DEFAULT ARRAY[]::text[];

ALTER TABLE jurisprudence
  ADD COLUMN IF NOT EXISTS domains text[] DEFAULT ARRAY[]::text[];

-- ── 2. Migration domain → domains pour les lignes existantes ─────────────────

UPDATE legal_articles
SET domains = ARRAY[domain]
WHERE domain IS NOT NULL
  AND (domains IS NULL OR cardinality(domains) = 0);

UPDATE jurisprudence
SET domains = ARRAY[domain]
WHERE domain IS NOT NULL
  AND (domains IS NULL OR cardinality(domains) = 0);

-- ── 3. Index GIN pour recherche rapide par domaine ───────────────────────────

CREATE INDEX IF NOT EXISTS idx_legal_articles_domains
  ON legal_articles USING GIN (domains);

CREATE INDEX IF NOT EXISTS idx_jurisprudence_domains
  ON jurisprudence USING GIN (domains);

-- ── 4. Commentaires colonnes ──────────────────────────────────────────────────

COMMENT ON COLUMN legal_articles.domain IS
  'DEPRECATED — conserver pour rétrocompatibilité. Utiliser domains[] à la place.';

COMMENT ON COLUMN jurisprudence.domain IS
  'DEPRECATED — conserver pour rétrocompatibilité. Utiliser domains[] à la place.';

-- ── 5. Mise à jour search_all_legal_context ───────────────────────────────────
-- Remplace migration 009.
-- Changement clé : domain = ANY(boost_domains) → domains && boost_domains
-- Le boost est calculé sur le tableau domains, pas sur le champ scalaire domain.

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
            WHEN is_curated = true AND boost_domains IS NOT NULL AND article_domains && boost_domains
            THEN similarity_raw * 1.45   -- curated + domaine correspondant = priorité maximale
            WHEN is_curated = true
            THEN similarity_raw * 1.30   -- curated seul = toujours boosté
            WHEN boost_domains IS NOT NULL AND article_domains && boost_domains
            THEN similarity_raw * 1.15   -- article multi-domaine correspondant
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
            COALESCE(domains, ARRAY[domain])             AS article_domains,
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
            COALESCE(domains, ARRAY[domain])             AS article_domains,
            1 - (embedding <=> query_embedding)          AS similarity_raw,
            COALESCE(curated, false)::boolean            AS is_curated
        FROM public.jurisprudence
        WHERE deleted_at IS NULL
          AND embedding IS NOT NULL
    ) combined
    ORDER BY
        CASE
            WHEN is_curated = true AND boost_domains IS NOT NULL AND article_domains && boost_domains
            THEN similarity_raw * 1.45
            WHEN is_curated = true
            THEN similarity_raw * 1.30
            WHEN boost_domains IS NOT NULL AND article_domains && boost_domains
            THEN similarity_raw * 1.15
            ELSE similarity_raw
        END DESC
    LIMIT match_count;
$$;

COMMENT ON FUNCTION search_all_legal_context IS
    'Recherche sémantique combinée articles + arrêts. Boost ×1.30 curated, ×1.45 curated+domaine, ×1.15 domaine. Migration 026 : boost via domains[] (array overlap) au lieu du scalaire domain.';
