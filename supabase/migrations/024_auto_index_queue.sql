-- Migration 024 : Table de retry pour les articles/arrêts non indexés
-- Permet de retraiter automatiquement les échecs temporaires (timeout API, format inconnu)

CREATE TABLE IF NOT EXISTS auto_index_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('article', 'jurisprudence')),
  law_name text,
  legitext_id text,
  article_num text,
  case_number text,
  court text,
  error_reason text,
  attempts integer DEFAULT 1,
  max_attempts integer DEFAULT 3,
  next_retry_at timestamptz DEFAULT NOW() + INTERVAL '6 hours',
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(source, legitext_id, article_num),
  UNIQUE(source, case_number)
);

CREATE INDEX idx_queue_pending ON auto_index_queue(next_retry_at)
WHERE resolved_at IS NULL AND attempts < max_attempts;

-- RLS : accès service role uniquement
ALTER TABLE auto_index_queue ENABLE ROW LEVEL SECURITY;
