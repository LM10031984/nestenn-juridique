-- =============================================================================
-- Nestenn Juridique — Migration 015 : Analytics questions juridiques
-- Fichier : 015_message_analytics.sql
-- Date    : 2026-03-27
-- =============================================================================
-- Contenu :
--   1. Colonnes analytics sur messages (domain, sources_count, response_mode)
--   2. Colonne domain sur conversations
--   3. Index pour les requêtes analytics
--   4. Vue analytics_by_domain
--   5. Vue analytics_by_agency
--   6. Vue top_questions
-- =============================================================================


-- =============================================================================
-- 1. COLONNES ANALYTICS SUR MESSAGES
-- =============================================================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS domain         text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sources_count  integer DEFAULT 0;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS response_mode  text
    CHECK (response_mode IN ('sourced', 'free'));


-- =============================================================================
-- 2. COLONNE DOMAIN SUR CONVERSATIONS
-- =============================================================================

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS domain text;


-- =============================================================================
-- 3. INDEX POUR LES REQUÊTES ANALYTICS
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_messages_domain
    ON messages(domain);

CREATE INDEX IF NOT EXISTS idx_messages_created_domain
    ON messages(created_at DESC, domain)
    WHERE role = 'user';

CREATE INDEX IF NOT EXISTS idx_conversations_domain
    ON conversations(domain);


-- =============================================================================
-- 4. VUE analytics_by_domain
-- Agrégation des questions par domaine et par jour
-- =============================================================================

CREATE OR REPLACE VIEW analytics_by_domain AS
SELECT
    date_trunc('day', m.created_at)::date AS day,
    m.domain,
    COUNT(*)                               AS question_count,
    COUNT(*) FILTER (WHERE m.response_mode = 'sourced') AS sourced_count,
    COUNT(*) FILTER (WHERE m.response_mode = 'free')    AS free_count
FROM messages m
WHERE m.role = 'user'
  AND m.domain IS NOT NULL
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC;

COMMENT ON VIEW analytics_by_domain IS
    'Nombre de questions par domaine juridique et par jour. Utilisé par le dashboard analytics.';


-- =============================================================================
-- 5. VUE analytics_by_agency
-- Activité par agence
-- =============================================================================

CREATE OR REPLACE VIEW analytics_by_agency AS
SELECT
    a.name              AS agency_name,
    a.slug              AS agency_slug,
    m.domain,
    COUNT(*)            AS question_count,
    MAX(m.created_at)   AS last_question
FROM messages m
JOIN conversations c ON c.id = m.conversation_id
JOIN agencies a      ON a.id = c.agency_id
WHERE m.role = 'user'
GROUP BY 1, 2, 3
ORDER BY 4 DESC;

COMMENT ON VIEW analytics_by_agency IS
    'Volume de questions par agence et par domaine. Utilisé par le dashboard analytics.';


-- =============================================================================
-- 6. VUE top_questions
-- Questions les plus fréquemment posées (regroupées par préfixe)
-- =============================================================================

CREATE OR REPLACE VIEW top_questions AS
SELECT
    m.domain,
    LEFT(m.content, 100) AS question_preview,
    COUNT(*)             AS ask_count,
    MAX(m.created_at)    AS last_asked
FROM messages m
WHERE m.role = 'user'
  AND m.domain IS NOT NULL
GROUP BY 1, 2
HAVING COUNT(*) >= 2
ORDER BY 3 DESC
LIMIT 50;

COMMENT ON VIEW top_questions IS
    'Top 50 questions récurrentes avec leur domaine. Seuil minimum : 2 occurrences.';


-- =============================================================================
-- FIN DE LA MIGRATION 015_message_analytics.sql
-- =============================================================================
