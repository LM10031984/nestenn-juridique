-- Migration 002: Table feedback_reviews pour analytics des réponses négatives
-- Permet d'identifier les patterns d'erreur et améliorer le RAG

CREATE TABLE IF NOT EXISTS public.feedback_reviews (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  question    text NOT NULL,
  response    text NOT NULL,
  feedback    smallint NOT NULL CHECK (feedback IN (-1, 1)), -- -1 = thumbs down, 1 = thumbs up
  reason      text,                                          -- raison optionnelle (texte libre)
  agent_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  session_id  text,
  created_at  timestamptz DEFAULT now() NOT NULL
);

-- Index pour les requêtes analytics
CREATE INDEX idx_feedback_reviews_created_at ON public.feedback_reviews(created_at DESC);
CREATE INDEX idx_feedback_reviews_feedback ON public.feedback_reviews(feedback);
CREATE INDEX idx_feedback_reviews_agent_id ON public.feedback_reviews(agent_id);

-- RLS
ALTER TABLE public.feedback_reviews ENABLE ROW LEVEL SECURITY;

-- Les agents peuvent insérer leurs propres feedbacks
CREATE POLICY "agents_insert_own_feedback" ON public.feedback_reviews
  FOR INSERT WITH CHECK (
    agent_id = auth.uid()
    OR agent_id IS NULL -- autoriser feedback anonyme (sans auth)
  );

-- Seuls les admins peuvent lire tous les feedbacks
CREATE POLICY "admins_read_all_feedbacks" ON public.feedback_reviews
  FOR SELECT USING (get_user_role() = 'admin');

-- Commentaires
COMMENT ON TABLE public.feedback_reviews IS 'Feedbacks négatifs/positifs sur les réponses de l''assistant juridique';
COMMENT ON COLUMN public.feedback_reviews.feedback IS '-1 = thumbs down (à réviser), 1 = thumbs up (bonne réponse)';
