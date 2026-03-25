-- Migration 010 : Full-text search (tsvector) sur legal_articles et jurisprudence
-- Permet une recherche hybride : vecteur sémantique + full-text exact
-- Cas d'usage : trouver "Art. L412-6" même quand le vecteur cosinus rate

-- 1. Colonne tsvector sur legal_articles (title + content)
ALTER TABLE legal_articles
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('french', coalesce(title, '') || ' ' || coalesce(content, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_legal_articles_fts ON legal_articles USING GIN (fts);

-- 2. Colonne tsvector sur jurisprudence (situation + principle + consequence)
ALTER TABLE jurisprudence
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('french', coalesce(situation, '') || ' ' || coalesce(principle, '') || ' ' || coalesce(consequence, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_jurisprudence_fts ON jurisprudence USING GIN (fts);
