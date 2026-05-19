-- Migration 028 : corrections RLS pré-mise-en-prod
-- 1. Crée la table document_contents manquante (avec RLS owner-only)
-- 2. Corrige la policy feedback_reviews (rôle 'admin' renommé en 'super_admin' depuis 016)
-- 3. Ajoute policy SELECT super_admin sur auto_index_queue
-- 4. Active RLS sur filter_keywords (lecture publique, écriture service_role)
-- 5. Active RLS sur quality_alerts (lecture super_admin uniquement)

-- =============================================================================
-- 1. TABLE document_contents (manquante)
--    Stocke le texte extrait des documents PDF uploadés.
--    Visibilité : strict owner only (chaque conseiller voit ses propres docs).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.document_contents (
  id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  file_path          text NOT NULL,
  content            text NOT NULL,
  extraction_method  text CHECK (extraction_method IN ('pdf_parse', 'vision_ocr')),
  created_at         timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_document_contents_user_id
  ON public.document_contents (user_id);
CREATE INDEX IF NOT EXISTS idx_document_contents_file_path
  ON public.document_contents (file_path);
CREATE INDEX IF NOT EXISTS idx_document_contents_extraction_method
  ON public.document_contents (extraction_method);

COMMENT ON TABLE public.document_contents IS
  'Texte extrait des PDF uploadés via /api/documents/process. Strict owner-only via RLS.';
COMMENT ON COLUMN public.document_contents.extraction_method IS
  'pdf_parse (texte natif, gratuit) ou vision_ocr (fallback OCR OpenRouter, payant).';

ALTER TABLE public.document_contents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "document_contents_super_admin_all" ON public.document_contents;
DROP POLICY IF EXISTS "document_contents_owner_select"    ON public.document_contents;
DROP POLICY IF EXISTS "document_contents_owner_insert"    ON public.document_contents;
DROP POLICY IF EXISTS "document_contents_owner_delete"    ON public.document_contents;

CREATE POLICY "document_contents_super_admin_all" ON public.document_contents FOR ALL
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY "document_contents_owner_select" ON public.document_contents FOR SELECT
  USING (user_id = auth.uid() AND get_user_status() = 'active');

CREATE POLICY "document_contents_owner_insert" ON public.document_contents FOR INSERT
  WITH CHECK (user_id = auth.uid() AND get_user_status() = 'active');

CREATE POLICY "document_contents_owner_delete" ON public.document_contents FOR DELETE
  USING (user_id = auth.uid() AND get_user_status() = 'active');

-- Volontairement pas d'UPDATE : un document extrait est immuable.

-- =============================================================================
-- 2. CORRECTION feedback_reviews
--    La policy 002 utilisait get_user_role() = 'admin' (ancien nom).
--    Depuis 016, le rôle est 'super_admin'. Plus aucun admin ne pouvait lire.
-- =============================================================================

DROP POLICY IF EXISTS "admins_read_all_feedbacks"          ON public.feedback_reviews;
DROP POLICY IF EXISTS "super_admins_read_all_feedbacks"    ON public.feedback_reviews;

CREATE POLICY "super_admins_read_all_feedbacks" ON public.feedback_reviews
  FOR SELECT USING (get_user_role() = 'super_admin');

-- =============================================================================
-- 3. auto_index_queue : ajouter SELECT pour super_admin (debug/monitoring)
--    La table avait ENABLE RLS sans policy (migration 024) → tout bloqué côté
--    client. Service_role bypass donc le backend continue de fonctionner.
-- =============================================================================

DROP POLICY IF EXISTS "auto_index_queue_super_admin_read" ON public.auto_index_queue;

CREATE POLICY "auto_index_queue_super_admin_read" ON public.auto_index_queue
  FOR SELECT USING (get_user_role() = 'super_admin');

-- =============================================================================
-- 4. filter_keywords : table système, RLS read-only pour authenticated
--    Écriture réservée au service_role (qui bypass RLS de toute façon).
-- =============================================================================

ALTER TABLE public.filter_keywords ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "filter_keywords_authenticated_read" ON public.filter_keywords;

CREATE POLICY "filter_keywords_authenticated_read" ON public.filter_keywords
  FOR SELECT TO authenticated USING (true);

-- =============================================================================
-- 5. quality_alerts : analytics interne, SELECT super_admin uniquement
--    Insertion via service_role en backend (auto-indexer, post-treatment).
-- =============================================================================

ALTER TABLE public.quality_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quality_alerts_super_admin_read" ON public.quality_alerts;

CREATE POLICY "quality_alerts_super_admin_read" ON public.quality_alerts
  FOR SELECT USING (get_user_role() = 'super_admin');
