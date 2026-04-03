-- =============================================================================
-- Nestenn Juridique — Migration 022 : Analytics v2 — Tendances + Pain points + Agents complets
-- Fichier : 022_analytics_v2.sql
-- Date    : 2026-04-03
-- =============================================================================
-- Contenu :
--   1. get_weekly_activity       — Activité par semaine (Section Tendances)
--   2. get_pain_point_detail     — Détail d'un pain point cliqué
--   3. Remplacement get_agency_detail — Inclut tous les agents (même inactifs)
-- =============================================================================


-- =============================================================================
-- 1. get_weekly_activity
-- Activité hebdomadaire sur N semaines — pour le graphe Tendances
-- =============================================================================

CREATE OR REPLACE FUNCTION get_weekly_activity(p_weeks integer DEFAULT 5)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH week_series AS (
    SELECT
      gs AS week_num,
      DATE_TRUNC('week', NOW()::timestamptz) - (gs * interval '1 week')       AS week_end,
      DATE_TRUNC('week', NOW()::timestamptz) - ((gs + 1) * interval '1 week') AS week_start
    FROM generate_series(0, p_weeks - 1) AS gs
  ),
  weekly AS (
    SELECT
      w.week_num,
      w.week_start,
      COUNT(m.id) AS cnt
    FROM week_series w
    LEFT JOIN messages m ON
      m.role = 'user' AND
      m.created_at >= w.week_start AND
      m.created_at <  w.week_end
    GROUP BY w.week_num, w.week_start
    ORDER BY w.week_start
  )
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'week_start', week_start,
        'week_offset', week_num,
        'count', cnt
      ) ORDER BY week_start
    ),
    '[]'::json
  )
  FROM weekly
$$;

COMMENT ON FUNCTION get_weekly_activity IS
  'Agrégation hebdomadaire sur N semaines. Utilisé par la section Tendances du dashboard.';


-- =============================================================================
-- 2. get_pain_point_detail
-- Détail d'un sous-domaine (pain point) cliqué par le directeur
-- Retourne : top agences concernées + questions récentes
-- =============================================================================

CREATE OR REPLACE FUNCTION get_pain_point_detail(
  p_theme  text,
  p_period integer DEFAULT 30
)
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH
    since AS (
      SELECT NOW() - (p_period || ' days')::interval AS dt
    ),
    by_agency AS (
      SELECT
        a.name AS agency_name,
        a.slug AS agency_slug,
        COUNT(*)  AS cnt
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN agencies a ON a.id = c.agency_id
      WHERE m.role = 'user'
        AND m.sub_domain = p_theme
        AND m.created_at >= (SELECT dt FROM since)
      GROUP BY a.id, a.name, a.slug
      ORDER BY cnt DESC
      LIMIT 10
    ),
    recent AS (
      SELECT
        LEFT(m.content, 140) AS preview,
        m.created_at,
        a.name AS agency_name
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN agencies a ON a.id = c.agency_id
      WHERE m.role = 'user'
        AND m.sub_domain = p_theme
        AND m.created_at >= (SELECT dt FROM since)
      ORDER BY m.created_at DESC
      LIMIT 6
    )
  SELECT json_build_object(
    'theme',      p_theme,
    'by_agency',  COALESCE((SELECT json_agg(row_to_json(b)) FROM by_agency b), '[]'),
    'recent',     COALESCE((SELECT json_agg(row_to_json(r)) FROM recent r),    '[]')
  )
$$;

COMMENT ON FUNCTION get_pain_point_detail IS
  'Détail d''un pain point cliqué : top agences + questions récentes sur ce sous-domaine.';


-- =============================================================================
-- 3. get_agency_detail (version 2 — remplace la v1)
-- Inclut TOUS les conseillers de l'agence, même inactifs
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
    -- Tous les conseillers de l'agence, y compris inactifs
    by_agent AS (
      SELECT
        u.full_name,
        u.id                                         AS user_id,
        COUNT(m.id)                                  AS cnt,
        -- Dernière question dans la période
        MAX(m.created_at)                            AS last_in_period,
        -- Dernière question ever (pour statut réel)
        (SELECT MAX(m2.created_at)
         FROM conversations c2
         JOIN messages m2 ON m2.conversation_id = c2.id AND m2.role = 'user'
         WHERE c2.user_id = u.id
           AND c2.agency_id = (SELECT id FROM agency))  AS last_ever
      FROM users u
      LEFT JOIN conversations c
        ON c.agency_id = (SELECT id FROM agency) AND c.user_id = u.id
      LEFT JOIN messages m
        ON m.conversation_id = c.id AND m.role = 'user'
       AND m.created_at >= (SELECT dt FROM since)
      WHERE u.agency_id = (SELECT id FROM agency)
        AND u.role      = 'conseiller'
      GROUP BY u.id, u.full_name
      ORDER BY cnt DESC, last_in_period DESC NULLS LAST
    ),
    total_users AS (
      SELECT COUNT(*) AS cnt
      FROM users
      WHERE agency_id = (SELECT id FROM agency)
        AND role      = 'conseiller'
    ),
    daily_activity AS (
      SELECT date_trunc('day', m.created_at)::date AS day, COUNT(*) AS cnt
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.agency_id = (SELECT id FROM agency)
        AND m.role       = 'user'
        AND m.created_at >= NOW() - '30 days'::interval
      GROUP BY 1 ORDER BY 1
    ),
    recent_questions AS (
      SELECT
        LEFT(m.content, 140) AS question_preview,
        m.sub_domain,
        m.domain,
        m.created_at
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.agency_id = (SELECT id FROM agency)
        AND m.role       = 'user'
        AND m.created_at >= (SELECT dt FROM since)
      ORDER BY m.created_at DESC LIMIT 20
    )
  SELECT json_build_object(
    'agency',            (SELECT row_to_json(a) FROM agency a),
    'total_questions',   (SELECT cnt FROM total),
    'total_users',       (SELECT cnt FROM total_users),
    'by_domain',         COALESCE((SELECT json_agg(row_to_json(b)) FROM by_domain b),     '[]'),
    'pain_points',       COALESCE((SELECT json_agg(row_to_json(p)) FROM pain_points p),   '[]'),
    'by_agent',          COALESCE((SELECT json_agg(row_to_json(g)) FROM by_agent g),      '[]'),
    'daily_activity',    COALESCE((SELECT json_agg(row_to_json(d)) FROM daily_activity d),'[]'),
    'recent_questions',  COALESCE((SELECT json_agg(row_to_json(r)) FROM recent_questions r), '[]')
  )
$$;

COMMENT ON FUNCTION get_agency_detail IS
  'v2 : inclut tous les conseillers (actifs + inactifs + jamais connectés) avec last_ever pour statut précis.';


-- =============================================================================
-- FIN DE LA MIGRATION 022_analytics_v2.sql
-- =============================================================================
