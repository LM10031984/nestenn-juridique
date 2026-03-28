-- Migration 017 : Colonne topic sur messages pour classification fine des questions

ALTER TABLE messages ADD COLUMN IF NOT EXISTS topic text;
CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic);
