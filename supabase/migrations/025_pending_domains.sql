-- Migration 025 : Table pending_domains pour la création dynamique de domaines
-- NE PAS EXÉCUTER AUTOMATIQUEMENT — à appliquer manuellement après validation

CREATE TABLE pending_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suggested_name text NOT NULL UNIQUE,
  suggested_label text NOT NULL,
  confidence_avg numeric NOT NULL DEFAULT 0,
  article_count integer NOT NULL DEFAULT 1,
  sample_article_ids uuid[] DEFAULT ARRAY[]::uuid[],
  sample_keywords text[] DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'merged', 'auto_created')),
  merged_into text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  auto_created_at timestamptz
);

CREATE INDEX idx_pending_domains_status ON pending_domains(status);
CREATE INDEX idx_pending_domains_count ON pending_domains(article_count);
CREATE INDEX idx_pending_domains_auto_created_at ON pending_domains(auto_created_at);

-- RLS : seuls les super_admin peuvent lire/modifier
ALTER TABLE pending_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY pending_domains_super_admin_all ON pending_domains
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'super_admin'
    )
  );
