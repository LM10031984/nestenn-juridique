-- =============================================================================
-- Nestenn Juridique — Migration pgvector (Moteur v2)
-- Fichier : 003_pgvector.sql
-- Date    : 2026-03-22
-- =============================================================================
-- Contenu :
--   1. Tables legal_articles, jurisprudence, sync_log
--   2. Index HNSW (vectoriels) + GIN (sous-thèmes) + partiels (deleted_at)
--   3. Triggers updated_at
--   4. Fonction de recherche sémantique search_legal_context()
--   5. Row Level Security
-- =============================================================================
-- =============================================================================

-- S'assure que pgvector est activé (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;


-- =============================================================================
-- 1. TABLES
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1.1 legal_articles
-- Articles de loi en vigueur (Légifrance), vectorisés via nomic-embed-text.
-- Embedding = résumé concaténé (situation + principe + conséquence) en langage
-- agent, pour maximiser la similarité cosinus avec les questions des agents.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.legal_articles (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    law_id           text        NOT NULL,
    article_num      text        NOT NULL,
    title            text        NOT NULL,
    content          text        NOT NULL,
    content_summary  text,
    date_version     date,
    url              text,
    domain           text        NOT NULL,
    sub_themes       text[]      DEFAULT '{}',
    in_force         boolean     DEFAULT true,
    embedding        vector(768),
    indexed_at       timestamptz DEFAULT now(),
    updated_at       timestamptz DEFAULT now(),
    deleted_at       timestamptz,

    CONSTRAINT legal_articles_law_article_unique UNIQUE (law_id, article_num)
);

COMMENT ON TABLE public.legal_articles IS 'Articles de loi indexés depuis Légifrance. Vectorisés via nomic-embed-text (768 dims).';
COMMENT ON COLUMN public.legal_articles.content_summary IS 'Résumé JSON Llama 3.2 : {situation, principe, consequence} en langage agent.';
COMMENT ON COLUMN public.legal_articles.embedding IS 'Vecteur nomic-embed-text (768 dims) du résumé concaténé situation+principe+consequence.';
COMMENT ON COLUMN public.legal_articles.deleted_at IS 'Soft-delete. NULL = actif. Non-null = article abrogé ou retiré du périmètre.';


-- ----------------------------------------------------------------------------
-- 1.2 jurisprudence
-- Arrêts Judilibre (Cour de cassation + Cours d''appel), vectorisés.
-- motivations_raw : texte intégral sans limite — nécessaire pour re-traitement
-- local si le résumé Llama est insuffisant.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.jurisprudence (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id        text        NOT NULL UNIQUE,
    court            text        NOT NULL CHECK (court IN ('cc', 'ca')),
    chamber          text,
    date             date,
    number           text,
    solution         text,
    situation        text,
    principle        text,
    consequence      text,
    visa_refs        text[]      DEFAULT '{}',
    domain           text        NOT NULL,
    sub_themes       text[]      DEFAULT '{}',
    url              text,
    motivations_raw  text,
    embedding        vector(768),
    indexed_at       timestamptz DEFAULT now(),
    updated_at       timestamptz DEFAULT now(),
    deleted_at       timestamptz
);

COMMENT ON TABLE public.jurisprudence IS 'Arrêts CC et CA indexés depuis Judilibre. Vectorisés via nomic-embed-text (768 dims).';
COMMENT ON COLUMN public.jurisprudence.source_id IS 'ID Judilibre de la décision — clé d''idempotence pour l''indexation delta.';
COMMENT ON COLUMN public.jurisprudence.court IS 'cc = Cour de cassation | ca = Cour d''appel.';
COMMENT ON COLUMN public.jurisprudence.motivations_raw IS 'Texte intégral des motivations (sans limite). Permet re-traitement Llama sans re-fetch API.';
COMMENT ON COLUMN public.jurisprudence.embedding IS 'Vecteur nomic-embed-text (768 dims) du résumé concaténé situation+principe+consequence.';
COMMENT ON COLUMN public.jurisprudence.deleted_at IS 'Soft-delete. NULL = actif. Non-null = décision supprimée sur Judilibre.';


-- ----------------------------------------------------------------------------
-- 1.3 sync_log
-- Journal de chaque cycle de synchronisation (initial ou delta).
-- Granularité par domaine pour diagnostiquer les échecs partiels.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sync_log (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_type      text        NOT NULL CHECK (sync_type IN ('initial', 'delta')),
    source         text        NOT NULL CHECK (source IN ('legifrance', 'judilibre')),
    domain         text        NOT NULL DEFAULT 'all',
    started_at     timestamptz NOT NULL DEFAULT now(),
    completed_at   timestamptz,
    items_fetched  integer     DEFAULT 0,
    items_indexed  integer     DEFAULT 0,
    items_skipped  integer     DEFAULT 0,
    errors         jsonb       DEFAULT '[]',
    status         text        CHECK (status IN ('running', 'success', 'partial', 'failed'))
                               DEFAULT 'running'
);

COMMENT ON TABLE public.sync_log IS 'Journal des cycles d''indexation. Une ligne par domaine par run.';
COMMENT ON COLUMN public.sync_log.domain IS 'Domaine indexé (ex: baux_habitation) ou ''all'' pour un run complet.';
COMMENT ON COLUMN public.sync_log.errors IS 'Tableau JSON des erreurs : [{source_id, error, timestamp}].';


-- =============================================================================
-- 2. INDEX
-- =============================================================================

-- Index HNSW (vectoriels) — meilleur rappel, pas de calibration volume
-- m=16 : voisins par nœud (précision/vitesse). ef_construction=64 : qualité build.
CREATE INDEX IF NOT EXISTS idx_articles_embedding
    ON public.legal_articles
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_juris_embedding
    ON public.jurisprudence
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Index de filtrage domaine (utilisé dans WHERE domain = $detected_domain)
CREATE INDEX IF NOT EXISTS idx_articles_domain
    ON public.legal_articles (domain);

CREATE INDEX IF NOT EXISTS idx_juris_domain
    ON public.jurisprudence (domain);

-- Index GIN sur sous-thèmes (recherche dans les tableaux text[])
CREATE INDEX IF NOT EXISTS idx_articles_subthemes
    ON public.legal_articles USING GIN (sub_themes);

CREATE INDEX IF NOT EXISTS idx_juris_subthemes
    ON public.jurisprudence USING GIN (sub_themes);

-- Index partiels sur deleted_at (seules les lignes actives — la grande majorité)
CREATE INDEX IF NOT EXISTS idx_articles_active
    ON public.legal_articles (domain)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_juris_active
    ON public.jurisprudence (domain, court)
    WHERE deleted_at IS NULL;

-- Index sync_log
CREATE INDEX IF NOT EXISTS idx_sync_log_started_at
    ON public.sync_log (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_log_source_domain
    ON public.sync_log (source, domain);


-- =============================================================================
-- 3. TRIGGERS updated_at
-- =============================================================================

-- Crée la fonction si elle n'existe pas déjà (définie dans 001_initial.sql)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_legal_articles_updated_at
    BEFORE UPDATE ON public.legal_articles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_jurisprudence_updated_at
    BEFORE UPDATE ON public.jurisprudence
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- =============================================================================
-- 4. FONCTION DE RECHERCHE SÉMANTIQUE
-- Appelée depuis lib/rag.ts — retourne les N documents les plus proches
-- d'un vecteur de query, filtrés par domaine, excluant les soft-deleted.
-- =============================================================================

CREATE OR REPLACE FUNCTION search_legal_context(
    query_embedding  vector(768),
    target_domain    text,
    match_count      int DEFAULT 5
)
RETURNS TABLE (
    source      text,
    doc_id      uuid,
    title       text,
    situation   text,
    principle   text,
    consequence text,
    url         text,
    similarity  float
)
LANGUAGE sql
STABLE
AS $$
    SELECT source, doc_id, title, situation, principle, consequence, url, similarity
    FROM (
        -- Articles de loi
        SELECT
            'article'::text                              AS source,
            id                                           AS doc_id,
            title,
            (content_summary::jsonb->>'situation')       AS situation,
            (content_summary::jsonb->>'principe')        AS principle,
            (content_summary::jsonb->>'consequence')     AS consequence,
            url,
            1 - (embedding <=> query_embedding)          AS similarity
        FROM public.legal_articles
        WHERE domain = target_domain
          AND deleted_at IS NULL
          AND embedding IS NOT NULL
        ORDER BY embedding <=> query_embedding
        LIMIT match_count
    ) articles

    UNION ALL

    SELECT source, doc_id, title, situation, principle, consequence, url, similarity
    FROM (
        -- Arrêts de jurisprudence
        SELECT
            'arret'::text                                AS source,
            id                                           AS doc_id,
            COALESCE(number, source_id)                  AS title,
            situation,
            principle,
            consequence,
            url,
            1 - (embedding <=> query_embedding)          AS similarity
        FROM public.jurisprudence
        WHERE domain = target_domain
          AND deleted_at IS NULL
          AND embedding IS NOT NULL
        ORDER BY embedding <=> query_embedding
        LIMIT match_count
    ) arrets

    ORDER BY similarity DESC;
$$;

COMMENT ON FUNCTION search_legal_context IS
    'Recherche sémantique combinée articles + arrêts pour un domaine donné. Utilisée par lib/rag.ts au query time.';


-- =============================================================================
-- 5. ROW LEVEL SECURITY
-- Les tables juridiques sont une base de connaissance partagée (pas de données
-- personnelles). Lecture autorisée à tous les utilisateurs authentifiés.
-- Écriture réservée au service_role (bypass RLS automatique côté scripts).
-- =============================================================================

ALTER TABLE public.legal_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jurisprudence  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_log       ENABLE ROW LEVEL SECURITY;

-- legal_articles : lecture pour tous les authentifiés
CREATE POLICY "legal_articles_read_authenticated"
    ON public.legal_articles
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- jurisprudence : idem
CREATE POLICY "jurisprudence_read_authenticated"
    ON public.jurisprudence
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- sync_log : lecture pour tous les authentifiés (dashboard interne)
CREATE POLICY "sync_log_read_authenticated"
    ON public.sync_log
    FOR SELECT
    USING (auth.role() = 'authenticated');


-- =============================================================================
-- FIN DE LA MIGRATION 003_pgvector.sql
-- =============================================================================
