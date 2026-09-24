const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', '..', 'broadtele.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

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

// ---- Targets ----
function upsertTarget({ chat_id, type, display_name, username, source, bot_can_send, is_bot_contact }) {
  const existing = db.prepare('SELECT * FROM targets WHERE chat_id = ?').get(chat_id);
  if (existing) {
    const mergedSource = existing.source === source ? source : 'both';
    db.prepare(`UPDATE targets SET display_name = ?, username = ?, source = ?, bot_can_send = ?, is_bot_contact = ? WHERE chat_id = ?`)
      .run(display_name ?? existing.display_name, username ?? existing.username, mergedSource,
           bot_can_send ?? existing.bot_can_send, is_bot_contact ?? existing.is_bot_contact, chat_id);
    return db.prepare('SELECT * FROM targets WHERE chat_id = ?').get(chat_id);
  }
  db.prepare(`INSERT INTO targets (chat_id, type, display_name, username, source, bot_can_send, is_bot_contact)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(chat_id, type, display_name, username, source, bot_can_send ? 1 : 0, is_bot_contact ? 1 : 0);
  return db.prepare('SELECT * FROM targets WHERE chat_id = ?').get(chat_id);
}

function listTargets(type) {
  if (type) return db.prepare('SELECT * FROM targets WHERE type = ? AND active = 1 ORDER BY display_name').all(type);
  return db.prepare('SELECT * FROM targets WHERE active = 1 ORDER BY display_name').all();
}

function setTargetFlag(id, field, value) {
  const allowed = ['is_business_relation', 'active', 'bot_can_send'];
  if (!allowed.includes(field)) throw new Error(`Field tidak diizinkan: ${field}`);
  db.prepare(`UPDATE targets SET ${field} = ? WHERE id = ?`).run(value ? 1 : 0, id);
}

// ---- Bot contacts (prospek dari DM ke bot) ----
function upsertBotContact({ chat_id, username, first_name }) {
  const existing = db.prepare('SELECT * FROM bot_contacts WHERE chat_id = ?').get(chat_id);
  if (existing) {
    db.prepare('UPDATE bot_contacts SET username = ?, first_name = ?, last_seen_at = CURRENT_TIMESTAMP WHERE chat_id = ?')
      .run(username, first_name, chat_id);
  } else {
    db.prepare('INSERT INTO bot_contacts (chat_id, username, first_name, last_seen_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
      .run(chat_id, username, first_name);
  }
  // Otomatis jadi kandidat target japri
  upsertTarget({ chat_id, type: 'japri', display_name: first_name, username, source: 'bot', bot_can_send: 1, is_bot_contact: 1 });
}

// ---- Broadcast jobs ----
const stmtInsertJob = db.prepare(`INSERT INTO broadcast_jobs (name, message_text, target_type, delay_min_sec, delay_max_sec)
                                   VALUES (?, ?, ?, ?, ?)`);
const stmtInsertJobTarget = db.prepare(`INSERT INTO broadcast_job_targets (job_id, target_id, method, order_index)
                                         VALUES (?, ?, ?, ?)`);
const stmtGetTargetById = db.prepare('SELECT * FROM targets WHERE id = ?');

function createJob({ name, message_text, target_type, delay_min_sec, delay_max_sec, targetIds }) {
  const txn = db.transaction((ids) => {
    const info = stmtInsertJob.run(name, message_text, target_type, delay_min_sec, delay_max_sec);
    const jobId = info.lastInsertRowid;
    ids.forEach((targetId, idx) => {
      const target = stmtGetTargetById.get(targetId);
      if (!target) return; // target sudah dihapus — lewati, jangan bikin baris menggantung
      const method = target.source === 'personal' ? 'personal' : (target.bot_can_send ? 'bot' : 'personal');
      stmtInsertJobTarget.run(jobId, targetId, method, idx);
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
const stmtDuplicateJob = db.prepare(`INSERT INTO broadcast_jobs (name, message_text, target_type, delay_min_sec, delay_max_sec)
                                      SELECT name || ' (kirim ulang)', message_text, target_type, delay_min_sec, delay_max_sec
                                      FROM broadcast_jobs WHERE id = ?`);
function duplicateJobWithTargets(sourceJobId, targetIds) {
  const txn = db.transaction((ids) => {
    const info = stmtDuplicateJob.run(sourceJobId);
    const newJobId = info.lastInsertRowid;
    ids.forEach((targetId, idx) => {
      const target = stmtGetTargetById.get(targetId);
      if (!target) return;
      const method = target.source === 'personal' ? 'personal' : (target.bot_can_send ? 'bot' : 'personal');
      stmtInsertJobTarget.run(newJobId, targetId, method, idx);
    });
    return newJobId;
  });
  return txn(targetIds);
}

// ---- Riwayat job ----
const stmtListJobs = db.prepare(`
  SELECT j.id, j.name, j.target_type, j.status, j.created_at, j.started_at, j.finished_at,
         j.delay_min_sec, j.delay_max_sec,
         substr(j.message_text, 1, 80) AS message_preview,
         COUNT(jt.id) AS total,
         SUM(CASE WHEN jt.status = 'sent' THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN jt.status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN jt.status = 'pending' THEN 1 ELSE 0 END) AS pending
  FROM broadcast_jobs j
  LEFT JOIN broadcast_job_targets jt ON jt.job_id = j.id
  GROUP BY j.id
  ORDER BY j.id DESC
  LIMIT ?`);
function listJobs(limit = 50) {
  return stmtListJobs.all(limit);
}

const stmtListJobDetails = db.prepare(`
  SELECT bjt.id, bjt.order_index, bjt.method, bjt.status, bjt.sent_at, bjt.error_msg, bjt.retry_count,
         t.chat_id, t.display_name
  FROM broadcast_job_targets bjt
  JOIN targets t ON t.id = bjt.target_id
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
  upsertTarget,
  listTargets,
  setTargetFlag,
  upsertBotContact,
  createJob,
  getJobTargets,
  getPendingTargets,
  getJob,
  updateJobTargetStatus,
  incrementRetry,
  updateJobStatus,
  duplicateJobWithTargets,
  listJobs,
  getJobDetails,
  deleteTarget,
};
