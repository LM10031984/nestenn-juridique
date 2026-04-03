-- =============================================================================
-- Nestenn Juridique — Migration 021 : Analytics réseau (super_admin)
-- Fichier : 021_analytics_network.sql
-- Date    : 2026-04-03
-- =============================================================================
-- Contenu :
--   1. get_network_kpis        — KPIs synthétiques du réseau (bannière directeur)
--   2. get_analytics_by_agency — Liste agences paginée + recherche + filtres
--   3. get_agency_detail       — Détail complet d'une agence (stats + activité)
-- =============================================================================


-- =============================================================================
-- 1. get_network_kpis
-- KPIs synthétiques pour la bannière directeur réseau
-- =============================================================================

CREATE OR REPLACE FUNCTION get_network_kpis(p_period integer DEFAULT 30)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH
    total AS (
      SELECT COUNT(*) AS cnt
      FROM messages m
      WHERE m.role = 'user'
        AND m.created_at >= NOW() - (p_period || ' days')::interval
    ),
    prev_total AS (
      SELECT COUNT(*) AS cnt
      FROM messages m
      WHERE m.role = 'user'
        AND m.created_at >= NOW() - (p_period * 2 || ' days')::interval
        AND m.created_at < NOW() - (p_period || ' days')::interval
    ),
    active_agencies AS (
      SELECT COUNT(DISTINCT c.agency_id) AS cnt
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.role = 'user'
        AND m.created_at >= NOW() - '30 days'::interval
    ),
    total_agencies AS (
      SELECT COUNT(*) AS cnt FROM agencies WHERE is_active = true
    ),
    top_theme AS (
      SELECT
        COALESCE(m.sub_domain, m.domain, 'Non classé') AS theme,
        COUNT(*) AS cnt
      FROM messages m
      WHERE m.role = 'user'
        AND m.created_at >= NOW() - (p_period || ' days')::interval
        AND (m.sub_domain IS NOT NULL OR m.domain IS NOT NULL)
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 1
    ),
    inactive_alert AS (
      SELECT COUNT(DISTINCT a.id) AS cnt
      FROM agencies a
      WHERE a.is_active = true
        AND EXISTS (
          SELECT 1 FROM conversations c
          JOIN messages m ON m.conversation_id = c.id
          WHERE c.agency_id = a.id AND m.role = 'user'
        )
        AND NOT EXISTS (
          SELECT 1 FROM conversations c
          JOIN messages m ON m.conversation_id = c.id
          WHERE c.agency_id = a.id AND m.role = 'user'
            AND m.created_at >= NOW() - '7 days'::interval
        )
    )
  SELECT json_build_object(
    'total_questions',       (SELECT cnt FROM total),
    'prev_total_questions',  (SELECT cnt FROM prev_total),
    'active_agencies',       (SELECT cnt FROM active_agencies),
    'total_agencies',        (SELECT cnt FROM total_agencies),
    'top_theme',             (SELECT theme FROM top_theme),
    'top_theme_count',       (SELECT cnt FROM top_theme),
    'inactive_count',        (SELECT cnt FROM inactive_alert)
  )
$$;

COMMENT ON FUNCTION get_network_kpis IS
  'KPIs synthétiques réseau pour le tableau de bord super_admin.';


-- =============================================================================
-- 2. get_analytics_by_agency
-- Liste paginée des agences avec recherche et filtres
-- =============================================================================

CREATE OR REPLACE FUNCTION get_analytics_by_agency(
  p_limit   integer DEFAULT 20,
  p_offset  integer DEFAULT 0,
  p_search  text    DEFAULT NULL,
  p_filter  text    DEFAULT 'all',
  p_sort    text    DEFAULT 'questions'
)
RETURNS TABLE (
  agency_name    text,
  agency_slug    text,
  city           text,
  question_count bigint,
  last_question  timestamptz,
  total_count    bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH agency_stats AS (
    SELECT
      a.name  AS agency_name,
      a.slug  AS agency_slug,
      a.city,
      COUNT(m.id)          AS question_count,
      MAX(m.created_at)    AS last_question
    FROM agencies a
    LEFT JOIN conversations c ON c.agency_id = a.id
    LEFT JOIN messages m ON m.conversation_id = c.id AND m.role = 'user'
    WHERE a.is_active = true
      AND (
        p_search IS NULL
        OR a.name ILIKE '%' || p_search || '%'
        OR a.city ILIKE '%' || p_search || '%'
      )
    GROUP BY a.id, a.name, a.slug, a.city
  ),
  filtered AS (
    SELECT *
    FROM agency_stats
    WHERE
      CASE p_filter
        WHEN 'active'   THEN last_question >= NOW() - '30 days'::interval
        WHEN 'inactive' THEN last_question IS NULL OR last_question < NOW() - '7 days'::interval
        ELSE true
      END
  ),
  counted AS (
    SELECT *, COUNT(*) OVER () AS total_count FROM filtered
  )
  SELECT
    agency_name, agency_slug, city, question_count, last_question, total_count
  FROM counted
  ORDER BY
    CASE WHEN p_sort = 'questions' THEN question_count     END DESC NULLS LAST,
    CASE WHEN p_sort = 'activity'  THEN last_question      END DESC NULLS LAST,
    CASE WHEN p_sort = 'city'      THEN city               END ASC  NULLS LAST,
    CASE WHEN p_sort = 'name'      THEN agency_name        END ASC  NULLS LAST,
    question_count DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset
$$;

COMMENT ON FUNCTION get_analytics_by_agency IS
  'Liste paginée des agences avec comptage questions, recherche texte et filtres activité.';


-- =============================================================================
-- 3. get_agency_detail
-- Détail complet d'une agence pour la page /analytics/agency/[slug]
-- =============================================================================

CREATE OR REPLACE FUNCTION get_agency_detail(
  p_slug   text,
  p_period integer DEFAULT 30
)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH
    agency AS (
      SELECT id, name, slug, city, is_active
      FROM agencies
      WHERE slug = p_slug
      LIMIT 1
    ),
    since AS (
      SELECT NOW() - (p_period || ' days')::interval AS dt
    ),
    total AS (
      SELECT COUNT(*) AS cnt
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.agency_id = (SELECT id FROM agency)
        AND m.role = 'user'
        AND m.created_at >= (SELECT dt FROM since)
    ),
    by_domain AS (
      SELECT m.domain AS label, COUNT(*) AS cnt
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.agency_id = (SELECT id FROM agency)
        AND m.role = 'user'
        AND m.created_at >= (SELECT dt FROM since)
        AND m.domain IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10
    ),
    pain_points AS (
      SELECT m.sub_domain AS label, COUNT(*) AS cnt
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.agency_id = (SELECT id FROM agency)
        AND m.role = 'user'
        AND m.created_at >= (SELECT dt FROM since)
        AND m.sub_domain IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10
    ),
    by_agent AS (
      SELECT u.full_name, COUNT(*) AS cnt
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN users u ON u.id = c.user_id
      WHERE c.agency_id = (SELECT id FROM agency)
        AND m.role = 'user'
        AND m.created_at >= (SELECT dt FROM since)
      GROUP BY u.id, u.full_name ORDER BY 2 DESC LIMIT 20
    ),
    daily_activity AS (
      SELECT date_trunc('day', m.created_at)::date AS day, COUNT(*) AS cnt
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.agency_id = (SELECT id FROM agency)
        AND m.role = 'user'
        AND m.created_at >= NOW() - '30 days'::interval
      GROUP BY 1 ORDER BY 1
    ),
    recent_questions AS (
      SELECT
        LEFT(m.content, 120) AS question_preview,
        m.sub_domain,
        m.domain,
        m.created_at
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.agency_id = (SELECT id FROM agency)
        AND m.role = 'user'
        AND m.created_at >= (SELECT dt FROM since)
      ORDER BY m.created_at DESC LIMIT 20
    )
  SELECT json_build_object(
    'agency',            (SELECT row_to_json(a) FROM agency a),
    'total_questions',   (SELECT cnt FROM total),
    'by_domain',         COALESCE((SELECT json_agg(row_to_json(b)) FROM by_domain b),     '[]'),
    'pain_points',       COALESCE((SELECT json_agg(row_to_json(p)) FROM pain_points p),   '[]'),
    'by_agent',          COALESCE((SELECT json_agg(row_to_json(g)) FROM by_agent g),      '[]'),
    'daily_activity',    COALESCE((SELECT json_agg(row_to_json(d)) FROM daily_activity d),'[]'),
    'recent_questions',  COALESCE((SELECT json_agg(row_to_json(r)) FROM recent_questions r), '[]')
  )
$$;

COMMENT ON FUNCTION get_agency_detail IS
  'Détail complet d''une agence : KPIs, domaines, pain points, agents, activité 30j, questions récentes.';


-- =============================================================================
-- FIN DE LA MIGRATION 021_analytics_network.sql
-- =============================================================================
