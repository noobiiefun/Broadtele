const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', '..', 'broadtele.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const MULTIACCOUNT_MIGRATION_PATH = path.join(__dirname, 'multiaccount-migration-v2.sql');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

/** Jalankan satu statement, abaikan error "sudah ada" (idempotent). */
function tryExec(sql) {
  try { db.exec(sql); } catch (err) {
    if (!/duplicate column name|already exists/i.test(err.message)) throw err;
  }
}

/**
 * Migrasi ringan berbasis PRAGMA user_version.
 * schema.sql hanya menjamin DB baru; untuk DB lama yang sudah terlanjur dibuat,
 * perubahan struktur (kolom baru, dsb) ditambahkan di sini secara berurutan.
 */
const MIGRATIONS = [
  // v1: kolom retry_count untuk mekanisme requeue otomatis
  (d) => {
    const cols = d.prepare(`PRAGMA table_info(broadcast_job_targets)`).all().map((c) => c.name);
    if (!cols.includes('retry_count')) {
      d.exec(`ALTER TABLE broadcast_job_targets ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`);
    }
  },
  // v2: MULTI-AKUN — tabel accounts & bot_tokens, plus kolom penghubungnya.
  // Semua statement idempotent (IF NOT EXISTS / duplicate-column diabaikan),
  // jadi aman walau sebagian struktur sudah pernah dibuat sebelumnya.
  () => {
    const statements = fs.readFileSync(MULTIACCOUNT_MIGRATION_PATH, 'utf8')
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) tryExec(stmt);

    // Drop constraint UNIQUE(chat_id) lama: rebuild tabel targets salin-data.
    const tblSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='targets'`).get()?.sql || '';
    if (/chat_id\s+TEXT\s+UNIQUE/i.test(tblSql)) {
      db.transaction(() => {
        const cols = db.prepare('PRAGMA table_info(targets)').all().map((c) => c.name);
        const has = (name) => (cols.includes(name) ? '' : `, ${name} TEXT`);
        db.exec(`CREATE TABLE targets_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id TEXT NOT NULL,
          type TEXT CHECK(type IN ('grup','japri')) NOT NULL,
          display_name TEXT, username TEXT,
          source TEXT CHECK(source IN ('bot','personal','both')) NOT NULL DEFAULT 'personal',
          bot_can_send INTEGER DEFAULT 0, is_bot_contact INTEGER DEFAULT 0,
          is_business_relation INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
          last_broadcast_at TEXT, last_status TEXT, notes TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          account_id INTEGER, bot_token_id INTEGER${has('can_send_bots')}
        )`);
        db.exec(`INSERT INTO targets_new SELECT ${cols.map((c) => `"${c}"`).join(', ')}, NULL, NULL${cols.includes('can_send_bots') ? '' : ', ""'} FROM targets`);
        db.exec('DROP TABLE targets');
        db.exec('ALTER TABLE targets_new RENAME TO targets');
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_targets_chat_account ON targets(chat_id, account_id) WHERE account_id IS NOT NULL`);
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_targets_chat_noaccount ON targets(chat_id) WHERE account_id IS NULL`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_targets_account ON targets(account_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_targets_type ON targets(type)`);
      })();
    }
  },
];

function runMigrations() {
  let version = db.pragma('user_version', { simple: true }) || 0;
  while (version < MIGRATIONS.length) {
    db.transaction(() => {
      MIGRATIONS[version](db);
      db.pragma(`user_version = ${version + 1}`);
    })();
    version += 1;
  }
}
runMigrations();

/**
 * Dipanggil dari main.js setelah sessionStore tersedia (butuh akses folder userData):
 * pindahkan sesi tunggal lama menjadi "Akun 1", lalu klaim semua target warisan.
 */
function migrateLegacySingleSession({ legacySessionString, createAccount }) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
  if (count > 0) return null;
  if (!legacySessionString) return null;
  const acc = createAccount({ label: 'Akun 1 (lama)', phone: null, session_key: `acc-${Date.now()}`, sessionString: legacySessionString });
  db.prepare('UPDATE targets SET account_id = ? WHERE account_id IS NULL').run(acc.id);
  return acc;
}

// ---- Targets ----
/**
 * Upsert target. Kalau `account_id` diisi, keunikan per (chat_id, account_id)
 * sehingga dua akun berbeda boleh punya baris untuk grup yang sama.
 * `botTokenId` menambah bukti "bot X bisa kirim ke target ini" ke can_send_bots.
 */
function upsertTarget({ chat_id, type, display_name, username, source, bot_can_send, is_bot_contact, account_id = null, botTokenId = null }) {
  const existing = account_id != null
    ? db.prepare('SELECT * FROM targets WHERE chat_id = ? AND account_id = ?').get(chat_id, account_id)
    : db.prepare('SELECT * FROM targets WHERE chat_id = ? AND account_id IS NULL').get(chat_id);
  if (existing) {
    const mergedSource = !source || existing.source === source ? (existing.source || source || 'personal') : 'both';
    let canSendBots = existing.can_send_bots || '';
    let botTokenCol = existing.bot_token_id;
    if (botTokenId != null) {
      const tokenStr = `,${botTokenId},`;
      if (!canSendBots.includes(tokenStr)) canSendBots += tokenStr;
      botTokenCol = botTokenId;
    }
    db.prepare(`UPDATE targets SET display_name = ?, username = ?, source = ?, bot_can_send = ?, is_bot_contact = ?,
                can_send_bots = ?, bot_token_id = ? WHERE id = ?`)
      .run(display_name ?? existing.display_name, username ?? existing.username, mergedSource,
           bot_can_send ?? existing.bot_can_send, is_bot_contact ?? existing.is_bot_contact,
           canSendBots, botTokenCol, existing.id);
    return db.prepare('SELECT * FROM targets WHERE id = ?').get(existing.id);
  }
  const initialCanSend = botTokenId != null && bot_can_send ? `,${botTokenId},` : '';
  db.prepare(`INSERT INTO targets (chat_id, type, display_name, username, source, bot_can_send, is_bot_contact, account_id, bot_token_id, can_send_bots)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(chat_id, type, display_name, username, source || 'personal', bot_can_send ? 1 : 0, is_bot_contact ? 1 : 0,
         account_id, botTokenId ?? null, initialCanSend);
  return db.prepare('SELECT * FROM targets ORDER BY id DESC LIMIT 1').get();
}

function listTargets(type, accountId = null) {
  const base = 'SELECT t.*, a.label AS account_label FROM targets t LEFT JOIN accounts a ON a.id = t.account_id WHERE t.active = 1';
  if (accountId != null) {
    return db.prepare(`${base} AND t.type = ? AND t.account_id = ? ORDER BY t.display_name`).all(type, accountId);
  }
  if (type) return db.prepare(`${base} AND t.type = ? ORDER BY t.display_name`).all(type);
  return db.prepare(`${base} ORDER BY t.display_name`).all();
}

function setTargetFlag(id, field, value) {
  const allowed = ['is_business_relation', 'active', 'bot_can_send'];
  if (!allowed.includes(field)) throw new Error(`Field tidak diizinkan: ${field}`);
  db.prepare(`UPDATE targets SET ${field} = ? WHERE id = ?`).run(value ? 1 : 0, id);
}

/** Tandai satu bot terbukti bisa/tidak bisa kirim ke satu target. */
function setTargetBotPermission(targetId, botTokenId, canSend) {
  const t = db.prepare('SELECT * FROM targets WHERE id = ?').get(targetId);
  if (!t) throw new Error(`Target ${targetId} tidak ditemukan`);
  const tokenStr = `,${botTokenId},`;
  let list = t.can_send_bots || '';
  if (canSend) {
    if (!list.includes(tokenStr)) list += tokenStr;
  } else {
    list = list.split(tokenStr).join('');
  }
  db.prepare('UPDATE targets SET can_send_bots = ?, bot_can_send = (CASE WHEN ? = 1 THEN 1 ELSE bot_can_send END), bot_token_id = ? WHERE id = ?')
    .run(list, canSend ? 1 : 0, canSend ? botTokenId : t.bot_token_id, targetId);
}

// ---- Akun (userbot multi-akun) ----
function createAccount({ label, phone = null, session_key = null, sessionString = null }) {
  const key = session_key || `acc-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const info = db.prepare('INSERT INTO accounts (label, phone, session_key) VALUES (?, ?, ?)').run(label, phone, key);
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid);
  if (sessionString && typeof module.exports._saveSessionForAccount === 'function') {
    module.exports._saveSessionForAccount(acc.id, sessionString);
  }
  return acc;
}

function listAccounts() {
  return db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM targets t WHERE t.account_id = a.id AND t.active = 1) AS target_count
    FROM accounts a ORDER BY a.id`).all();
}

function getAccount(id) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

function renameAccount(id, label) {
  db.prepare('UPDATE accounts SET label = ? WHERE id = ?').run(label, id);
}

function deleteAccount(id) {
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM broadcast_job_targets WHERE account_id = ?').run(id);
    db.prepare('DELETE FROM targets WHERE account_id = ?').run(id);
    db.prepare('UPDATE broadcast_jobs SET account_id = NULL WHERE account_id = ?').run(id);
    db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  });
  txn();
}

// ---- Bot tokens (multi-bot) ----
function createBotToken({ label, token, bot_username = null, polling = 0 }) {
  const info = db.prepare('INSERT INTO bot_tokens (label, token, bot_username, polling) VALUES (?, ?, ?, ?)')
    .run(label, token, bot_username, polling ? 1 : 0);
  return db.prepare('SELECT * FROM bot_tokens WHERE id = ?').get(info.lastInsertRowid);
}

function listBotTokens() {
  return db.prepare(`
    SELECT b.*,
      (SELECT COUNT(*) FROM targets t WHERE t.can_send_bots LIKE '%,' || b.id || ',%') AS reachable_groups
    FROM bot_tokens b ORDER BY b.id`).all();
}

function getBotToken(id) {
  return db.prepare('SELECT * FROM bot_tokens WHERE id = ?').get(id);
}

function getBotTokenByValue(token) {
  return db.prepare('SELECT * FROM bot_tokens WHERE token = ?').get(token);
}

function updateBotToken(id, fields) {
  const allowed = ['label', 'token', 'bot_username', 'polling', 'active'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (!keys.length) return;
  db.prepare(`UPDATE bot_tokens SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map((k) => (typeof fields[k] === 'boolean' ? (fields[k] ? 1 : 0) : fields[k])), id);
}

function deleteBotToken(id) {
  const txn = db.transaction(() => {
    db.prepare('UPDATE targets SET bot_token_id = NULL WHERE bot_token_id = ?').run(id);
    db.prepare('UPDATE broadcast_job_targets SET bot_token_id = NULL WHERE bot_token_id = ?').run(id);
    db.prepare('UPDATE broadcast_jobs SET bot_mode = \'auto\' WHERE bot_mode = ?').run(String(id));
    // bersihkan id bot dari can_send_bots semua target
    const rows = db.prepare('SELECT id, can_send_bots FROM targets').all();
    const stmt = db.prepare('UPDATE targets SET can_send_bots = ? WHERE id = ?');
    const needle = `,${id},`;
    for (const r of rows) {
      if ((r.can_send_bots || '').includes(needle)) stmt.run(r.can_send_bots.split(needle).join(''), r.id);
    }
    db.prepare('DELETE FROM bot_tokens WHERE id = ?').run(id);
  });
  txn();
}

// ---- Bot contacts (prospek dari DM ke bot) ----
function upsertBotContact({ chat_id, username, first_name, botTokenId = null }) {
  const existing = db.prepare('SELECT * FROM bot_contacts WHERE chat_id = ?').get(chat_id);
  if (existing) {
    db.prepare('UPDATE bot_contacts SET username = ?, first_name = ?, last_seen_at = CURRENT_TIMESTAMP WHERE chat_id = ?')
      .run(username, first_name, chat_id);
  } else {
    db.prepare('INSERT INTO bot_contacts (chat_id, username, first_name, last_seen_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
      .run(chat_id, username, first_name);
  }
  // Otomatis jadi kandidat target japri, tercatat atas nama bot yang menerimanya
  upsertTarget({
    chat_id, type: 'japri', display_name: first_name, username,
    source: 'bot', bot_can_send: 1, is_bot_contact: 1, botTokenId,
  });
}

// ---- Broadcast jobs ----
const stmtInsertJob = db.prepare(`INSERT INTO broadcast_jobs (name, message_text, target_type, delay_min_sec, delay_max_sec, bot_mode, account_id)
                                   VALUES (?, ?, ?, ?, ?, ?, ?)`);
const stmtInsertJobTarget = db.prepare(`INSERT INTO broadcast_job_targets (job_id, target_id, method, order_index, bot_token_id, account_id)
                                         VALUES (?, ?, ?, ?, ?, ?)`);
const stmtGetTargetById = db.prepare('SELECT * FROM targets WHERE id = ?');

/**
 * Tentukan metode kirim untuk satu target berdasarkan mode job:
 * - 'personal'            -> selalu akun userbot
 * - angka (id bot)        -> bot tsb utk SEMUA target (paksa, walau belum terbukti bisa)
 * - 'auto' (default)      -> bot terakhir yang terbukti bisa; kalau tidak ada, bot mana pun
 *                            yang terbukti; kalau masih tidak ada -> personal
 * `preferredBotTokenId` dipakai saat membuat job ulang dari Riwayat (mode 'auto' per-baris).
 */
function decideMethodAndBot(target, botMode, preferredBotTokenId = null) {
  if (botMode === 'personal') return { method: 'personal', botTokenId: null };
  if (botMode && /^\d+$/.test(String(botMode))) {
    return { method: 'bot', botTokenId: Number(botMode) };
  }
  // auto
  if (preferredBotTokenId != null) return { method: 'bot', botTokenId: preferredBotTokenId };
  const canList = (target.can_send_bots || '').split(',').filter(Boolean).map(Number);
  if (target.bot_token_id && canList.includes(target.bot_token_id)) return { method: 'bot', botTokenId: target.bot_token_id };
  if (canList.length) return { method: 'bot', botTokenId: canList[0] };
  if (target.bot_can_send && target.bot_token_id) return { method: 'bot', botTokenId: target.bot_token_id };
  return { method: 'personal', botTokenId: null };
}

function createJob({ name, message_text, target_type, delay_min_sec, delay_max_sec, targetIds, bot_mode = 'auto', account_id = null, perTarget = {} }) {
  const txn = db.transaction((ids) => {
    const info = stmtInsertJob.run(name, message_text, target_type, delay_min_sec, delay_max_sec, String(bot_mode || 'auto'), account_id);
    const jobId = info.lastInsertRowid;
    ids.forEach((targetId, idx) => {
      const target = stmtGetTargetById.get(targetId);
      if (!target) return; // target sudah dihapus — lewati, jangan bikin baris menggantung
      const pref = perTarget[targetId] || {};
      const mode = pref.bot_mode || bot_mode;
      const { method, botTokenId } = decideMethodAndBot(target, mode, pref.bot_token_id ?? null);
      const rowAccountId = method === 'personal' ? (pref.account_id ?? account_id ?? target.account_id) : null;
      stmtInsertJobTarget.run(jobId, targetId, method, idx, botTokenId, rowAccountId);
    });
    return jobId;
  });
  return txn(targetIds);
}

const stmtGetJobTargets = db.prepare(`SELECT bjt.*, t.chat_id, t.display_name FROM broadcast_job_targets bjt
                        JOIN targets t ON t.id = bjt.target_id
                        WHERE bjt.job_id = ? ORDER BY bjt.order_index`);
function getJobTargets(jobId) {
  return stmtGetJobTargets.all(jobId);
}

/**
 * Target yang masih harus dikirim untuk suatu job.
 * Baris berstatus 'pending' saja yang diambil — ini membuat job yang terhenti
 * (app crash / ditutup saat running) bisa dilanjutkan tanpa mengirim ulang
 * ke target yang sudah sukses ('sent').
 */
const stmtGetPendingTargets = db.prepare(`SELECT bjt.*, t.chat_id, t.display_name FROM broadcast_job_targets bjt
                            JOIN targets t ON t.id = bjt.target_id
                            WHERE bjt.job_id = ? AND bjt.status = 'pending'
                            ORDER BY bjt.order_index`);
function getPendingTargets(jobId) {
  return stmtGetPendingTargets.all(jobId);
}

/** Ambil akun default sebuah job (dipakai queue saat baris tidak punya akun sendiri). */
function getJobAccountId(jobId) {
  const row = db.prepare('SELECT account_id FROM broadcast_jobs WHERE id = ?').get(jobId);
  return row ? row.account_id : null;
}

const stmtUpdateJobTargetStatus = db.prepare('UPDATE broadcast_job_targets SET status = ?, sent_at = CURRENT_TIMESTAMP, error_msg = ? WHERE id = ?');
function updateJobTargetStatus(id, status, error_msg = null) {
  stmtUpdateJobTargetStatus.run(status, error_msg, id);
}

const stmtIncrementRetry = db.prepare('UPDATE broadcast_job_targets SET retry_count = retry_count + 1, status = \'pending\' WHERE id = ?');
function incrementRetry(id) {
  stmtIncrementRetry.run(id);
}

const stmtUpdateJobStatusRunning = db.prepare(`UPDATE broadcast_jobs SET status = ?, started_at = COALESCE(started_at, CURRENT_TIMESTAMP) WHERE id = ?`);
const stmtUpdateJobStatusFinished = db.prepare(`UPDATE broadcast_jobs SET status = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`);
const stmtUpdateJobStatusPlain = db.prepare('UPDATE broadcast_jobs SET status = ? WHERE id = ?');
function updateJobStatus(jobId, status) {
  if (status === 'running') stmtUpdateJobStatusRunning.run(status, jobId);
  else if (['done', 'failed', 'stopped'].includes(status)) stmtUpdateJobStatusFinished.run(status, jobId);
  else stmtUpdateJobStatusPlain.run(status, jobId);
}

const stmtGetJob = db.prepare('SELECT * FROM broadcast_jobs WHERE id = ?');
function getJob(jobId) {
  return stmtGetJob.get(jobId);
}

/** Salin pesan & pengaturan job lama jadi job baru berisi target yang dipilih (untuk kirim ulang / edit sebelum kirim). */
const stmtDuplicateJob = db.prepare(`INSERT INTO broadcast_jobs (name, message_text, target_type, delay_min_sec, delay_max_sec, bot_mode, account_id)
                                      SELECT name || ' (kirim ulang)', message_text, target_type, delay_min_sec, delay_max_sec, bot_mode, account_id
                                      FROM broadcast_jobs WHERE id = ?`);
function duplicateJobWithTargets(sourceJobId, targetIds) {
  const source = getJob(sourceJobId);
  const txn = db.transaction((ids) => {
    const info = stmtDuplicateJob.run(sourceJobId);
    const newJobId = info.lastInsertRowid;
    ids.forEach((targetId, idx) => {
      const target = stmtGetTargetById.get(targetId);
      if (!target) return;
      // 'auto' per-baris: bot yang pernah dipakai di job sumber untuk target ini dipertahankan
      const prev = db.prepare('SELECT bot_token_id FROM broadcast_job_targets WHERE job_id = ? AND target_id = ? ORDER BY id DESC LIMIT 1')
        .get(sourceJobId, targetId);
      const { method, botTokenId } = decideMethodAndBot(target, 'auto', prev?.bot_token_id ?? null);
      const rowAccountId = method === 'personal' ? (target.account_id ?? source?.account_id ?? null) : null;
      stmtInsertJobTarget.run(newJobId, targetId, method, idx, botTokenId, rowAccountId);
    });
    return newJobId;
  });
  return txn(targetIds);
}

// ---- Riwayat job ----
const stmtListJobs = db.prepare(`
  SELECT j.id, j.name, j.target_type, j.status, j.created_at, j.started_at, j.finished_at,
         j.delay_min_sec, j.delay_max_sec, j.bot_mode, a.label AS account_label,
         substr(j.message_text, 1, 80) AS message_preview,
         COUNT(jt.id) AS total,
         SUM(CASE WHEN jt.status = 'sent' THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN jt.status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN jt.status = 'pending' THEN 1 ELSE 0 END) AS pending
  FROM broadcast_jobs j
  LEFT JOIN broadcast_job_targets jt ON jt.job_id = j.id
  LEFT JOIN accounts a ON a.id = j.account_id
  GROUP BY j.id
  ORDER BY j.id DESC
  LIMIT ?`);
function listJobs(limit = 50) {
  return stmtListJobs.all(limit);
}

const stmtListJobDetails = db.prepare(`
  SELECT bjt.id, bjt.order_index, bjt.method, bjt.status, bjt.sent_at, bjt.error_msg, bjt.retry_count,
         bjt.bot_token_id, bjt.account_id,
         t.chat_id, t.display_name,
         bt.label AS bot_label, bt.bot_username, acc.label AS account_label
  FROM broadcast_job_targets bjt
  JOIN targets t ON t.id = bjt.target_id
  LEFT JOIN bot_tokens bt ON bt.id = bjt.bot_token_id
  LEFT JOIN accounts acc ON acc.id = bjt.account_id
  WHERE bjt.job_id = ?
  ORDER BY bjt.order_index`);
function getJobDetails(jobId) {
  return stmtListJobDetails.all(jobId);
}

// ---- Hapus target ----
const stmtDeleteTarget = db.prepare('DELETE FROM targets WHERE id = ?');
const stmtDeleteOrphanJobTargets = db.prepare('DELETE FROM broadcast_job_targets WHERE target_id = ?');
function deleteTarget(id) {
  const txn = db.transaction(() => {
    stmtDeleteOrphanJobTargets.run(id);
    stmtDeleteTarget.run(id);
  });
  txn();
}

module.exports = {
  db,
  migrateLegacySingleSession,
  upsertTarget,
  listTargets,
  setTargetFlag,
  setTargetBotPermission,
  createAccount,
  listAccounts,
  getAccount,
  renameAccount,
  deleteAccount,
  createBotToken,
  listBotTokens,
  getBotToken,
  getBotTokenByValue,
  updateBotToken,
  deleteBotToken,
  upsertBotContact,
  createJob,
  getJobTargets,
  getPendingTargets,
  getJobAccountId,
  getJob,
  updateJobTargetStatus,
  incrementRetry,
  updateJobStatus,
  duplicateJobWithTargets,
  listJobs,
  getJobDetails,
  deleteTarget,
};
