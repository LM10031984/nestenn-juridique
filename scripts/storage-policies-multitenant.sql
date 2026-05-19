-- ==========================================
-- POLICIES STORAGE — bucket 'nestenn-documents'
-- À exécuter UNE FOIS sur Supabase (SQL Editor) après création du bucket.
-- Idempotent : peut être ré-exécutée sans danger.
--
-- Chemin cible : uploads/{agency_id}/{user_id}/fichier.pdf
-- Multi-tenant strict : un conseiller ne voit que ses propres uploads.
-- Les responsables d'agence voient ceux de leur agence. Les super_admins voient tout.
-- ==========================================

-- Anciennes politiques (toutes versions confondues)
DROP POLICY IF EXISTS "Utilisateur peut uploader dans son dossier" ON storage.objects;
DROP POLICY IF EXISTS "Utilisateur peut lire son dossier"          ON storage.objects;
DROP POLICY IF EXISTS "Utilisateur peut supprimer de son dossier"  ON storage.objects;
DROP POLICY IF EXISTS "Agent_Insert_MultiTenant"                   ON storage.objects;
DROP POLICY IF EXISTS "Agent_Admin_Select_MultiTenant"             ON storage.objects;
DROP POLICY IF EXISTS "Agent_Admin_Delete_MultiTenant"             ON storage.objects;
DROP POLICY IF EXISTS "nestenn_documents_insert"                   ON storage.objects;
DROP POLICY IF EXISTS "nestenn_documents_select"                   ON storage.objects;
DROP POLICY IF EXISTS "nestenn_documents_delete"                   ON storage.objects;

-- ==========================================
-- INSERT : un conseiller actif peut uploader dans son propre dossier
-- ==========================================
CREATE POLICY "nestenn_documents_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'nestenn-documents'
    AND (storage.foldername(name))[1] = 'uploads'
    AND (storage.foldername(name))[3] = auth.uid()::text
    AND EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid()
        AND status = 'active'
        AND agency_id::text = (storage.foldername(name))[2]
    )
);

-- ==========================================
-- SELECT : propriétaire | responsable_agence (même agence) | super_admin
-- ==========================================
CREATE POLICY "nestenn_documents_select"
ON storage.objects FOR SELECT
TO authenticated
USING (
    bucket_id = 'nestenn-documents'
    AND (storage.foldername(name))[1] = 'uploads'
    AND (
        -- Propriétaire direct
        (storage.foldername(name))[3] = auth.uid()::text
        OR
        -- Responsable de la même agence
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid()
            AND role = 'responsable_agence'
            AND agency_id::text = (storage.foldername(name))[2]
        )
        OR
        -- Super admin (accès global)
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid()
            AND role = 'super_admin'
        )
    )
);

-- ==========================================
-- DELETE : mêmes règles que SELECT
-- ==========================================
CREATE POLICY "nestenn_documents_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'nestenn-documents'
    AND (storage.foldername(name))[1] = 'uploads'
    AND (
        (storage.foldername(name))[3] = auth.uid()::text
        OR
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid()
            AND role = 'responsable_agence'
            AND agency_id::text = (storage.foldername(name))[2]
        )
        OR
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid()
            AND role = 'super_admin'
        )
    )
);
