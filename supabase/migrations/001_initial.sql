-- =============================================================================
-- Nestenn Juridique — Migration initiale (Phase 1)
-- Fichier : 001_initial.sql
-- Date    : 2026-03-13
-- =============================================================================
-- Contenu :
--   1. Extensions PostgreSQL
--   2. Tables principales (agencies, users, conversations, messages, usage_logs)
--   3. Index
--   4. Triggers (updated_at, message_count)
--   5. Helper functions pour RLS
--   6. Row Level Security — politiques par rôle
-- =============================================================================


-- =============================================================================
-- 1. EXTENSIONS
-- =============================================================================

-- pgvector : embeddings vectoriels (utilisé Phase 2 — uploads de documents)
CREATE EXTENSION IF NOT EXISTS vector;

-- pg_trgm : recherche full-text / similarité (utilisé Phase 2 — recherche dans l'historique)
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- =============================================================================
-- 2. TABLES
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 2.1 agencies
-- Représente une agence immobilière cliente de Nestenn Juridique.
-- Le credit system suit la consommation de tokens par agence.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agencies (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name              text        NOT NULL,
    slug              text        UNIQUE NOT NULL,
    email             text,
    phone             text,
    city              text,
    credits_remaining integer     DEFAULT 1000,
    credits_total     integer     DEFAULT 1000,
    is_active         boolean     DEFAULT true,
    created_at        timestamptz DEFAULT now(),
    updated_at        timestamptz DEFAULT now()
);

COMMENT ON TABLE agencies IS 'Agences immobilières clientes — unité de facturation et de cloisonnement des données.';
COMMENT ON COLUMN agencies.slug IS 'Identifiant URL-friendly unique (ex: nestenn-bordeaux).';
COMMENT ON COLUMN agencies.credits_remaining IS 'Crédits de tokens IA restants pour le cycle en cours.';
COMMENT ON COLUMN agencies.credits_total IS 'Crédits alloués au total pour le cycle en cours.';


-- ----------------------------------------------------------------------------
-- 2.2 users
-- Profils étendus liés à auth.users (Supabase Auth).
-- Chaque profil appartient à une agence et possède un rôle applicatif.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    agency_id   uuid        REFERENCES agencies(id) ON DELETE SET NULL,
    role        text        DEFAULT 'agent'
                            CHECK (role IN ('agent', 'director', 'admin')),
    full_name   text,
    avatar_url  text,
    is_active   boolean     DEFAULT true,
    created_at  timestamptz DEFAULT now(),
    updated_at  timestamptz DEFAULT now()
);

COMMENT ON TABLE users IS 'Profils applicatifs étendant auth.users. Un utilisateur appartient à une agence.';
COMMENT ON COLUMN users.role IS 'agent = collaborateur standard | director = accès complet à l''agence | admin = super-admin Nestenn.';


-- ----------------------------------------------------------------------------
-- 2.3 conversations
-- Regroupe un fil de messages entre un utilisateur et l'assistant IA.
-- Une conversation est toujours rattachée à un utilisateur ET à son agence.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agency_id       uuid        NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    -- Titre auto-généré à partir de la première question (implémenté Phase 2)
    title           text,
    message_count   integer     DEFAULT 0,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now(),
    last_message_at timestamptz DEFAULT now()
);

COMMENT ON TABLE conversations IS 'Fils de discussion IA. Un fil = un contexte juridique continu.';
COMMENT ON COLUMN conversations.title IS 'Titre résumé, généré automatiquement depuis la première question (Phase 2).';
COMMENT ON COLUMN conversations.message_count IS 'Compteur dénormalisé mis à jour par trigger à chaque INSERT dans messages.';
COMMENT ON COLUMN conversations.last_message_at IS 'Horodatage du dernier message, utilisé pour le tri de l''historique.';


-- ----------------------------------------------------------------------------
-- 2.4 messages
-- Chaque ligne = un tour de conversation (user / assistant / system).
-- Stocke les métadonnées IA (tokens, feedback, contexte DILA).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id         uuid        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role                    text        NOT NULL
                                        CHECK (role IN ('user', 'assistant', 'system')),
    content                 text        NOT NULL,
    tokens_used             integer,
    -- Indique si une source DILA (legifrance/api.gouv) était disponible pour cette réponse
    dila_context_available  boolean     DEFAULT false,
    -- Feedback utilisateur : 1 = 👍  /  -1 = 👎  /  NULL = pas de feedback
    feedback                smallint    CHECK (feedback IN (-1, 1)),
    created_at              timestamptz DEFAULT now()
);

COMMENT ON TABLE messages IS 'Tous les messages d''une conversation, tous rôles confondus.';
COMMENT ON COLUMN messages.dila_context_available IS 'True si l''API DILA a fourni un contexte légal pour cette réponse.';
COMMENT ON COLUMN messages.feedback IS '1 = pouce haut, -1 = pouce bas. NULL = aucun retour.';


-- ----------------------------------------------------------------------------
-- 2.5 usage_logs
-- Trace fine de chaque appel IA pour la facturation et l'audit.
-- Conservé même si l'utilisateur ou la conversation est supprimé (SET NULL).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usage_logs (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid            REFERENCES users(id) ON DELETE SET NULL,
    agency_id       uuid            REFERENCES agencies(id) ON DELETE SET NULL,
    conversation_id uuid            REFERENCES conversations(id) ON DELETE SET NULL,
    model           text            NOT NULL,
    tokens_input    integer         DEFAULT 0,
    tokens_output   integer         DEFAULT 0,
    -- Coût en euros, précision à 6 décimales pour les micro-transactions
    cost_eur        numeric(10, 6)  DEFAULT 0,
    -- Nombre d'appels API DILA effectués pour cette requête
    dila_calls      integer         DEFAULT 0,
    -- Résultat du filtre de pertinence juridique immobilière
    filter_result   text            CHECK (filter_result IN ('relevant', 'rejected')),
    created_at      timestamptz     DEFAULT now()
);

COMMENT ON TABLE usage_logs IS 'Journal de consommation IA par requête — base de la facturation et de l''audit.';
COMMENT ON COLUMN usage_logs.cost_eur IS 'Coût calculé côté applicatif selon la grille tarifaire du modèle utilisé.';
COMMENT ON COLUMN usage_logs.filter_result IS 'relevant = question juridique immobilière traitée | rejected = hors périmètre filtré.';


-- =============================================================================
-- 3. INDEX
-- =============================================================================

-- conversations : accès par utilisateur, par agence, tri chronologique
CREATE INDEX IF NOT EXISTS idx_conversations_user_id
    ON conversations(user_id);

CREATE INDEX IF NOT EXISTS idx_conversations_agency_id
    ON conversations(agency_id);

CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at
    ON conversations(last_message_at DESC);

-- messages : accès par conversation, tri chronologique
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
    ON messages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_messages_created_at
    ON messages(created_at DESC);

-- usage_logs : analyse de consommation par agence et dans le temps
CREATE INDEX IF NOT EXISTS idx_usage_logs_agency_id
    ON usage_logs(agency_id);

CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at
    ON usage_logs(created_at DESC);


-- =============================================================================
-- 4. TRIGGERS
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 4.1 Fonction générique updated_at
-- Appelée par un trigger BEFORE UPDATE sur chaque table concernée.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION update_updated_at() IS 'Met à jour automatiquement updated_at avant chaque UPDATE.';

-- Trigger sur agencies
CREATE TRIGGER trg_agencies_updated_at
    BEFORE UPDATE ON agencies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger sur users
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger sur conversations
CREATE TRIGGER trg_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ----------------------------------------------------------------------------
-- 4.2 Incrément du compteur de messages + mise à jour de last_message_at
-- Déclenché AFTER INSERT sur messages pour maintenir la dénormalisation.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_message_count()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE conversations
    SET
        message_count   = message_count + 1,
        last_message_at = NEW.created_at,
        updated_at      = now()
    WHERE id = NEW.conversation_id;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION increment_message_count() IS
    'Maintient conversations.message_count et last_message_at en synchronisation après chaque INSERT dans messages.';

CREATE TRIGGER trg_messages_increment_count
    AFTER INSERT ON messages
    FOR EACH ROW EXECUTE FUNCTION increment_message_count();


-- =============================================================================
-- 5. HELPER FUNCTIONS POUR RLS
-- Utilisation de SECURITY DEFINER pour lire la table users sans récursion.
-- search_path restreint pour éviter les injections de schéma.
-- =============================================================================

-- Retourne l'agency_id de l'utilisateur connecté
CREATE OR REPLACE FUNCTION get_user_agency_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT agency_id
    FROM public.users
    WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION get_user_agency_id() IS
    'Retourne l''agency_id de l''utilisateur Supabase Auth connecté. Utilisée dans les policies RLS.';

-- Retourne le rôle applicatif de l'utilisateur connecté
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role
    FROM public.users
    WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION get_user_role() IS
    'Retourne le rôle applicatif (agent | director | admin) de l''utilisateur connecté. Utilisée dans les policies RLS.';


-- =============================================================================
-- 6. ROW LEVEL SECURITY (RLS)
-- =============================================================================
-- Modèle de permissions :
--   admin    → accès complet à toutes les tables
--   director → accès complet aux données de son agence
--   agent    → accès à ses propres conversations/messages, lecture de son agence
-- =============================================================================

-- Activation du RLS sur toutes les tables
ALTER TABLE agencies      ENABLE ROW LEVEL SECURITY;
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs    ENABLE ROW LEVEL SECURITY;


-- ----------------------------------------------------------------------------
-- 6.1 Table : agencies
-- ----------------------------------------------------------------------------

-- Admin : accès total
CREATE POLICY "agencies_admin_all"
    ON agencies
    FOR ALL
    USING (get_user_role() = 'admin')
    WITH CHECK (get_user_role() = 'admin');

-- Director : lecture/modification de sa propre agence
CREATE POLICY "agencies_director_own"
    ON agencies
    FOR SELECT
    USING (
        get_user_role() = 'director'
        AND id = get_user_agency_id()
    );

CREATE POLICY "agencies_director_update_own"
    ON agencies
    FOR UPDATE
    USING (
        get_user_role() = 'director'
        AND id = get_user_agency_id()
    )
    WITH CHECK (
        get_user_role() = 'director'
        AND id = get_user_agency_id()
    );

-- Agent : lecture seule de sa propre agence (nom, ville, crédits restants)
CREATE POLICY "agencies_agent_read_own"
    ON agencies
    FOR SELECT
    USING (
        get_user_role() = 'agent'
        AND id = get_user_agency_id()
    );


-- ----------------------------------------------------------------------------
-- 6.2 Table : users
-- ----------------------------------------------------------------------------

-- Admin : accès total
CREATE POLICY "users_admin_all"
    ON users
    FOR ALL
    USING (get_user_role() = 'admin')
    WITH CHECK (get_user_role() = 'admin');

-- Director : lecture/modification de tous les users de son agence
CREATE POLICY "users_director_own_agency"
    ON users
    FOR SELECT
    USING (
        get_user_role() = 'director'
        AND agency_id = get_user_agency_id()
    );

CREATE POLICY "users_director_update_own_agency"
    ON users
    FOR UPDATE
    USING (
        get_user_role() = 'director'
        AND agency_id = get_user_agency_id()
    )
    WITH CHECK (
        get_user_role() = 'director'
        AND agency_id = get_user_agency_id()
    );

-- Agent : lecture/modification de son propre profil uniquement
CREATE POLICY "users_agent_own_profile"
    ON users
    FOR SELECT
    USING (id = auth.uid());

CREATE POLICY "users_agent_update_own_profile"
    ON users
    FOR UPDATE
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());


-- ----------------------------------------------------------------------------
-- 6.3 Table : conversations
-- ----------------------------------------------------------------------------

-- Admin : accès total
CREATE POLICY "conversations_admin_all"
    ON conversations
    FOR ALL
    USING (get_user_role() = 'admin')
    WITH CHECK (get_user_role() = 'admin');

-- Director : accès complet à toutes les conversations de son agence
CREATE POLICY "conversations_director_own_agency"
    ON conversations
    FOR ALL
    USING (
        get_user_role() = 'director'
        AND agency_id = get_user_agency_id()
    )
    WITH CHECK (
        get_user_role() = 'director'
        AND agency_id = get_user_agency_id()
    );

-- Agent : accès uniquement à ses propres conversations
CREATE POLICY "conversations_agent_own"
    ON conversations
    FOR SELECT
    USING (
        get_user_role() = 'agent'
        AND user_id = auth.uid()
    );

CREATE POLICY "conversations_agent_insert_own"
    ON conversations
    FOR INSERT
    WITH CHECK (
        get_user_role() = 'agent'
        AND user_id = auth.uid()
        AND agency_id = get_user_agency_id()
    );

CREATE POLICY "conversations_agent_update_own"
    ON conversations
    FOR UPDATE
    USING (
        get_user_role() = 'agent'
        AND user_id = auth.uid()
    )
    WITH CHECK (
        get_user_role() = 'agent'
        AND user_id = auth.uid()
    );


-- ----------------------------------------------------------------------------
-- 6.4 Table : messages
-- Les messages héritent du périmètre de leur conversation.
-- On utilise une sous-requête pour vérifier l'appartenance via conversations.
-- ----------------------------------------------------------------------------

-- Admin : accès total
CREATE POLICY "messages_admin_all"
    ON messages
    FOR ALL
    USING (get_user_role() = 'admin')
    WITH CHECK (get_user_role() = 'admin');

-- Director : accès aux messages des conversations de son agence
CREATE POLICY "messages_director_own_agency"
    ON messages
    FOR ALL
    USING (
        get_user_role() = 'director'
        AND EXISTS (
            SELECT 1 FROM conversations c
            WHERE c.id = messages.conversation_id
              AND c.agency_id = get_user_agency_id()
        )
    )
    WITH CHECK (
        get_user_role() = 'director'
        AND EXISTS (
            SELECT 1 FROM conversations c
            WHERE c.id = messages.conversation_id
              AND c.agency_id = get_user_agency_id()
        )
    );

-- Agent : accès aux messages de ses propres conversations
CREATE POLICY "messages_agent_own_conversations"
    ON messages
    FOR SELECT
    USING (
        get_user_role() = 'agent'
        AND EXISTS (
            SELECT 1 FROM conversations c
            WHERE c.id = messages.conversation_id
              AND c.user_id = auth.uid()
        )
    );

CREATE POLICY "messages_agent_insert_own_conversations"
    ON messages
    FOR INSERT
    WITH CHECK (
        get_user_role() = 'agent'
        AND EXISTS (
            SELECT 1 FROM conversations c
            WHERE c.id = messages.conversation_id
              AND c.user_id = auth.uid()
        )
    );


-- ----------------------------------------------------------------------------
-- 6.5 Table : usage_logs
-- En lecture seule pour agents et directors.
-- Les INSERTs sont effectués par des fonctions/triggers côté serveur (service_role).
-- ----------------------------------------------------------------------------

-- Admin : accès total
CREATE POLICY "usage_logs_admin_all"
    ON usage_logs
    FOR ALL
    USING (get_user_role() = 'admin')
    WITH CHECK (get_user_role() = 'admin');

-- Director : lecture des logs de son agence
CREATE POLICY "usage_logs_director_read_own_agency"
    ON usage_logs
    FOR SELECT
    USING (
        get_user_role() = 'director'
        AND agency_id = get_user_agency_id()
    );

-- Agent : lecture de ses propres logs uniquement
CREATE POLICY "usage_logs_agent_read_own"
    ON usage_logs
    FOR SELECT
    USING (
        get_user_role() = 'agent'
        AND user_id = auth.uid()
    );


-- =============================================================================
-- FIN DE LA MIGRATION 001_initial.sql
-- =============================================================================
