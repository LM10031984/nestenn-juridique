-- =============================================================================
-- Migration 007 — Colonne curated pour les grands arrêts de principe
-- Fichier : 007_curated_flag.sql
-- Date    : 2026-03-24
-- =============================================================================
-- Objectif : permettre d'indexer des arrêts de principe rédigés manuellement
-- (grands arrêts du droit immobilier) dans la table jurisprudence.
-- Ces arrêts sont récupérés automatiquement par searchLegalContext() si
-- sémantiquement proches — aucune modification de pgvector.ts ou route.ts.
--
-- Règle de rédaction des curated :
--   - source_id = 'curated-<slug>'  (préfixe pour éviter collision Judilibre)
--   - court     = 'cc' ou 'ca'
--   - number    = numéro exact si certifié, NULL si incertain
--   - curated   = true
-- =============================================================================

ALTER TABLE public.jurisprudence
    ADD COLUMN IF NOT EXISTS curated boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.jurisprudence.curated IS
    'true = arrêt de principe rédigé manuellement (grand arrêt). false = arrêt indexé via Judilibre API.';

-- Index partiel pour récupérer rapidement les curated (petit volume, utile pour debug)
CREATE INDEX IF NOT EXISTS idx_juris_curated
    ON public.jurisprudence (domain)
    WHERE curated = true;


-- =============================================================================
-- FIN DE LA MIGRATION 007_curated_flag.sql
-- =============================================================================
