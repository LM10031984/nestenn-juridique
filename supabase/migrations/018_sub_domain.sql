-- =============================================================================
-- Nestenn Juridique — Migration 018 : Sous-domaine IA pour pain points précis
-- Fichier : 018_sub_domain.sql
-- Date    : 2026-03-28
-- =============================================================================
-- Contenu :
--   1. Colonne sub_domain sur messages (classifiée par GPT-4o-mini en async)
--   2. Index pour les requêtes analytics
--   3. Vue analytics_pain_points (pain points précis par sous-domaine)
-- =============================================================================


-- =============================================================================
-- 1. COLONNE sub_domain SUR MESSAGES
-- =============================================================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS sub_domain text;


-- =============================================================================
-- 2. INDEX
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_messages_sub_domain ON messages(sub_domain);


-- =============================================================================
-- 3. VUE analytics_pain_points
-- Agrégation des questions par domaine + sous-domaine IA
-- =============================================================================

CREATE OR REPLACE VIEW analytics_pain_points AS
SELECT
    m.domain,
    m.sub_domain,
    COUNT(*)            AS question_count,
    MAX(m.created_at)   AS last_asked
FROM messages m
WHERE m.role = 'user'
  AND m.sub_domain IS NOT NULL
GROUP BY 1, 2
ORDER BY 3 DESC;

COMMENT ON VIEW analytics_pain_points IS
    'Pain points précis classifiés par GPT-4o-mini : domaine + sous-thème en 2-4 mots.';


-- =============================================================================
-- FIN DE LA MIGRATION 018_sub_domain.sql
-- =============================================================================
