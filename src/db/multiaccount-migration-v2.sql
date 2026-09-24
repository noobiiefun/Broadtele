-- Migrasi multi-akun (v2): satu DB menampung banyak akun userbot & banyak bot.
-- Dijalankan dari JS per-statement; error "duplicate column" / "already exists" diabaikan
-- supaya idempotent terhadap DB yang sebagian kolomnya sudah ada.

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  phone TEXT,
  session_key TEXT UNIQUE NOT NULL,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bot_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  bot_username TEXT,
  polling INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE targets ADD COLUMN account_id INTEGER REFERENCES accounts(id);
ALTER TABLE targets ADD COLUMN bot_token_id INTEGER REFERENCES bot_tokens(id);
ALTER TABLE targets ADD COLUMN can_send_bots TEXT NOT NULL DEFAULT '';
ALTER TABLE broadcast_jobs ADD COLUMN bot_mode TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE broadcast_jobs ADD COLUMN account_id INTEGER REFERENCES accounts(id);
ALTER TABLE broadcast_job_targets ADD COLUMN bot_token_id INTEGER REFERENCES bot_tokens(id);
ALTER TABLE broadcast_job_targets ADD COLUMN account_id INTEGER REFERENCES accounts(id);

CREATE INDEX IF NOT EXISTS idx_targets_account ON targets(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_targets_chat_account ON targets(chat_id, account_id) WHERE account_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_targets_chat_noaccount ON targets(chat_id) WHERE account_id IS NULL;
