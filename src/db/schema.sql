-- Broadtele database schema
--
-- MULTI-AKUN: tabel `accounts` = akun Telegram pribadi (userbot/MTProto),
-- tabel `bot_tokens` = bot Telegram (@BotFather). Satu instalasi bisa punya
-- banyak keduanya; setiap target grup/japri dimiliki oleh satu akun tertentu,
-- dan setiap baris pengiriman memilih bot mana yang dipakai (bisa juga personal).

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,                -- nama panggilan, misal "Jual Pulsa", "Pribadi"
  phone TEXT,                         -- nomor yang dipakai saat login (untuk identifikasi)
  session_key TEXT UNIQUE NOT NULL,   -- kunci penyimpanan session string di userData
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bot_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,                -- nama panggilan, misal "Bot Promo"
  token TEXT NOT NULL UNIQUE,         -- token dari @BotFather
  bot_username TEXT,                  -- diisi otomatis dari getMe() saat disimpan
  polling INTEGER DEFAULT 0,          -- 1 = jalankan polling untuk deteksi grup/kontak baru
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  -- pemilik target: akun userbot yang melihat chat ini (NULL pada DB lama sebelum migrasi)
  account_id INTEGER REFERENCES accounts(id),
  -- bot terakhir yang terbukti bisa kirim ke target ini (kolom agregat lama, tetap dipertahankan)
  bot_token_id INTEGER REFERENCES bot_tokens(id),
  -- daftar semua bot yang terbukti bisa kirim, format ",3,7," (dipisah koma supaya pencarian LIKE aman)
  can_send_bots TEXT NOT NULL DEFAULT ''
);

-- Satu chat_id boleh muncul beberapa kali HANYA kalau milik akun berbeda.
-- Index partial ini menegakkan keunikan (chat_id, account_id) untuk baris ber-akun,
-- sementara baris warisan lama (account_id NULL) tetap unik per chat_id lewat unique index di bawah.
CREATE UNIQUE INDEX IF NOT EXISTS ux_targets_chat_account ON targets(chat_id, account_id) WHERE account_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_targets_chat_noaccount ON targets(chat_id) WHERE account_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_targets_account ON targets(account_id);

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
  finished_at TEXT,
  -- mode pilih bot untuk seluruh job: 'auto' (pakai bot yang terbukti bisa / fallback personal),
  -- 'personal' (selalu akun userbot), atau id bot_token tertentu sebagai angka (pakai bot itu untuk semua target)
  bot_mode TEXT NOT NULL DEFAULT 'auto',
  -- akun userbot default untuk mengirim (dipakai saat method='personal')
  account_id INTEGER REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS broadcast_job_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES broadcast_jobs(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES targets(id),
  method TEXT CHECK(method IN ('bot','personal')) NOT NULL,
  order_index INTEGER NOT NULL,
  status TEXT CHECK(status IN ('pending','sent','failed','skipped')) DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  error_msg TEXT,
  -- bot spesifik yang ditugaskan untuk baris ini (NULL berarti pakai default job / agregat target)
  bot_token_id INTEGER REFERENCES bot_tokens(id),
  -- akun userbot yang ditugaskan untuk baris ini (NULL berarti pakai default job / pemilik target)
  account_id INTEGER REFERENCES accounts(id)
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
CREATE INDEX IF NOT EXISTS idx_jobs_created ON broadcast_jobs(created_at DESC);
