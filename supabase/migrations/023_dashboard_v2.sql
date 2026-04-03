-- =============================================================================
-- Nestenn Juridique — Migration 023 : Dashboard v2 — Agences inactives + Activité réseau
-- Fichier : 023_dashboard_v2.sql
-- Date    : 2026-04-03
-- =============================================================================
-- Contenu :
--   1. get_inactive_agencies      — Liste détaillée des agences inactives (avec email)
--   2. get_network_daily_activity — Activité journalière réseau (30 derniers jours)
-- =============================================================================


-- =============================================================================
-- 1. get_inactive_agencies
-- Agences actives sans activité depuis 7+ jours — pour le modal directeur
-- =============================================================================

CREATE OR REPLACE FUNCTION get_inactive_agencies()
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH last_msg AS (
    SELECT
      c.agency_id,
      MAX(m.created_at) AS last_at
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.role = 'user'
    GROUP BY c.agency_id
  )
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'agency_name',   a.name,
        'agency_slug',   a.slug,
        'city',          a.city,
        'email',         a.email,
        'last_question', lm.last_at,
        'days_inactive', CASE
          WHEN lm.last_at IS NULL THEN NULL
          ELSE EXTRACT(DAY FROM NOW() - lm.last_at)::int
        END
      ) ORDER BY lm.last_at ASC NULLS FIRST
    ),
    '[]'::json
  )
  FROM agencies a
  LEFT JOIN last_msg lm ON lm.agency_id = a.id
  WHERE a.is_active = true
    AND (lm.last_at IS NULL OR lm.last_at < NOW() - '7 days'::interval)
$$;

COMMENT ON FUNCTION get_inactive_agencies IS
  'Liste des agences actives sans activité depuis 7+ jours. Inclut email pour relance directe.';


-- =============================================================================
-- 2. get_network_daily_activity
-- Activité journalière toutes agences — pour le sparkline bannière directeur
-- =============================================================================

CREATE OR REPLACE FUNCTION get_network_daily_activity()
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    json_agg(
      json_build_object('day', day, 'cnt', cnt)
      ORDER BY day
    ),
    '[]'::json
  )
  FROM (
    SELECT
      date_trunc('day', m.created_at)::date AS day,
      COUNT(*) AS cnt
    FROM messages m
    WHERE m.role = 'user'
      AND m.created_at >= NOW() - '30 days'::interval
    GROUP BY 1
  ) sub
$$;

COMMENT ON FUNCTION get_network_daily_activity IS
  'Activité journalière réseau (30 derniers jours). Utilisé pour le sparkline bannière super_admin.';


-- =============================================================================
-- FIN DE LA MIGRATION 023_dashboard_v2.sql
-- =============================================================================
