-- Migration 016 : Renommage des rôles + colonne status + trigger Auth
-- agent → conseiller, director → responsable_agence, admin → super_admin

-- 1. Renommer les valeurs de rôle existantes
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role = 'super_admin'         WHERE role = 'admin';
UPDATE users SET role = 'responsable_agence'  WHERE role = 'director';
UPDATE users SET role = 'conseiller'          WHERE role = 'agent';
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('super_admin', 'responsable_agence', 'conseiller'));

-- 2. Colonne status (pending par défaut à l'inscription)
ALTER TABLE users ADD COLUMN IF NOT EXISTS status text
  NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'active', 'rejected'));

-- Tous les comptes existants sont considérés actifs
UPDATE users SET status = 'active' WHERE status = 'pending';

-- 3. Index
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);

-- 4. Helper function pour le statut
CREATE OR REPLACE FUNCTION get_user_status()
  RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public AS $$
    SELECT status FROM public.users WHERE id = auth.uid();
  $$;

-- 5. Trigger : création du profil à l'inscription Supabase Auth
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, full_name, role, status, agency_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'conseiller'),
    'pending',
    NULLIF(NEW.raw_user_meta_data->>'agency_id', '')::uuid
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Ne jamais bloquer l'inscription même si le profil échoue
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 6. Mise à jour des policies RLS avec les nouveaux noms de rôle

-- agencies
DROP POLICY IF EXISTS "agencies_admin_all"          ON agencies;
DROP POLICY IF EXISTS "agencies_director_own"        ON agencies;
DROP POLICY IF EXISTS "agencies_director_update_own" ON agencies;
DROP POLICY IF EXISTS "agencies_agent_read_own"      ON agencies;

CREATE POLICY "agencies_super_admin_all" ON agencies FOR ALL
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY "agencies_responsable_read_own" ON agencies FOR SELECT
  USING (get_user_role() = 'responsable_agence' AND id = get_user_agency_id());

CREATE POLICY "agencies_responsable_update_own" ON agencies FOR UPDATE
  USING (get_user_role() = 'responsable_agence' AND id = get_user_agency_id())
  WITH CHECK (get_user_role() = 'responsable_agence' AND id = get_user_agency_id());

CREATE POLICY "agencies_conseiller_read_own" ON agencies FOR SELECT
  USING (get_user_role() = 'conseiller' AND id = get_user_agency_id());

-- Lecture publique des agences pour la page d'inscription
CREATE POLICY "agencies_public_read" ON agencies FOR SELECT
  USING (is_active = true);

-- users
DROP POLICY IF EXISTS "users_admin_all"                   ON users;
DROP POLICY IF EXISTS "users_director_own_agency"         ON users;
DROP POLICY IF EXISTS "users_director_update_own_agency"  ON users;
DROP POLICY IF EXISTS "users_agent_own_profile"           ON users;
DROP POLICY IF EXISTS "users_agent_update_own_profile"    ON users;

CREATE POLICY "users_super_admin_all" ON users FOR ALL
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY "users_responsable_read_own_agency" ON users FOR SELECT
  USING (get_user_role() = 'responsable_agence' AND agency_id = get_user_agency_id());

CREATE POLICY "users_own_profile" ON users FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "users_update_own_profile" ON users FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = (SELECT role FROM users WHERE id = auth.uid()) AND status = (SELECT status FROM users WHERE id = auth.uid()));

-- conversations
DROP POLICY IF EXISTS "conversations_admin_all"         ON conversations;
DROP POLICY IF EXISTS "conversations_director_own_agency" ON conversations;
DROP POLICY IF EXISTS "conversations_agent_own"          ON conversations;

CREATE POLICY "conversations_super_admin_all" ON conversations FOR ALL
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY "conversations_responsable_own_agency" ON conversations FOR SELECT
  USING (get_user_role() = 'responsable_agence' AND agency_id = get_user_agency_id());

CREATE POLICY "conversations_own" ON conversations FOR ALL
  USING (user_id = auth.uid() AND get_user_status() = 'active')
  WITH CHECK (user_id = auth.uid() AND get_user_status() = 'active');

-- messages
DROP POLICY IF EXISTS "messages_admin_all"                        ON messages;
DROP POLICY IF EXISTS "messages_agent_own_conversations"          ON messages;
DROP POLICY IF EXISTS "messages_agent_insert_own_conversations"   ON messages;

CREATE POLICY "messages_super_admin_all" ON messages FOR ALL
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

CREATE POLICY "messages_responsable_own_agency" ON messages FOR SELECT
  USING (
    get_user_role() = 'responsable_agence'
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id AND c.agency_id = get_user_agency_id()
    )
  );

CREATE POLICY "messages_own_conversations" ON messages FOR SELECT
  USING (
    get_user_status() = 'active'
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "messages_insert_own_conversations" ON messages FOR INSERT
  WITH CHECK (
    get_user_status() = 'active'
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  );
