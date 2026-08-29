-- Broadtele database schema

CREATE TABLE IF NOT EXISTS targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT UNIQUE NOT NULL,
  type TEXT CHECK(type IN ('grup','japri')) NOT NULL,
  display_name TEXT,
  username TEXT,
  source TEXT CHECK(source IN ('bot','personal','both')) NOT NULL DEFAULT 'personal',
  bot_can_send INTEGER DEFAULT 0,
  is_bot_contact INTEGER DEFAULT 0,
  is_business_relation INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  last_broadcast_at TEXT,
  last_status TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS broadcast_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  message_text TEXT NOT NULL,
  target_type TEXT CHECK(target_type IN ('grup','japri')) NOT NULL,
  delay_min_sec INTEGER NOT NULL DEFAULT 8,
  delay_max_sec INTEGER NOT NULL DEFAULT 25,
  status TEXT CHECK(status IN ('pending','running','paused','done','failed','stopped')) DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS broadcast_job_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES broadcast_jobs(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES targets(id),
  method TEXT CHECK(method IN ('bot','personal')) NOT NULL,
  order_index INTEGER NOT NULL,
  status TEXT CHECK(status IN ('pending','sent','failed','skipped')) DEFAULT 'pending',
  sent_at TEXT,
  error_msg TEXT
);

CREATE TABLE IF NOT EXISTS bot_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_targets_type ON targets(type);
CREATE INDEX IF NOT EXISTS idx_job_targets_job ON broadcast_job_targets(job_id);
