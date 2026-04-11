-- Ajouter le flag can_switch_model sur les users
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_switch_model boolean DEFAULT false;

-- Tracker quel modèle a été utilisé pour chaque message
ALTER TABLE messages ADD COLUMN IF NOT EXISTS model_used text DEFAULT 'anthropic/claude-sonnet-4-6';

-- Activer pour tous les super_admin par défaut
UPDATE users SET can_switch_model = true WHERE role = 'super_admin';

-- Index pour les analytics futures par modèle
CREATE INDEX IF NOT EXISTS idx_messages_model_used ON messages(model_used) WHERE role = 'assistant';
