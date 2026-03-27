-- Migration 013 — Table quality_alerts
-- Alertes qualité détectées par le post-traitement async
-- Alimente le cycle d'amélioration continue

CREATE TABLE IF NOT EXISTS quality_alerts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_type  text NOT NULL,     -- 'unverified_reference', 'low_score', 'no_sources'
    details     jsonb,
    question    text,
    session_id  text,
    resolved    boolean DEFAULT false,
    created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quality_alerts_type    ON quality_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_quality_alerts_created ON quality_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quality_alerts_unresolved
    ON quality_alerts(resolved) WHERE resolved = false;

COMMENT ON TABLE quality_alerts IS
    'Alertes qualité détectées par le post-traitement — alimente le cycle d''amélioration';
