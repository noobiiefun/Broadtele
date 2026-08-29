const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', '..', 'broadtele.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

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
function createJob({ name, message_text, target_type, delay_min_sec, delay_max_sec, targetIds }) {
  const insertJob = db.prepare(`INSERT INTO broadcast_jobs (name, message_text, target_type, delay_min_sec, delay_max_sec)
                                 VALUES (?, ?, ?, ?, ?)`);
  const insertTarget = db.prepare(`INSERT INTO broadcast_job_targets (job_id, target_id, method, order_index)
                                    VALUES (?, ?, ?, ?)`);
  const txn = db.transaction((ids) => {
    const info = insertJob.run(name, message_text, target_type, delay_min_sec, delay_max_sec);
    const jobId = info.lastInsertRowid;
    ids.forEach((targetId, idx) => {
      const target = db.prepare('SELECT * FROM targets WHERE id = ?').get(targetId);
      const method = target.source === 'personal' ? 'personal' : (target.bot_can_send ? 'bot' : 'personal');
      insertTarget.run(jobId, targetId, method, idx);
    });
    return jobId;
  });
  return txn(targetIds);
}

function getJobTargets(jobId) {
  return db.prepare(`SELECT bjt.*, t.chat_id, t.display_name FROM broadcast_job_targets bjt
                      JOIN targets t ON t.id = bjt.target_id
                      WHERE bjt.job_id = ? ORDER BY bjt.order_index`).all(jobId);
}

function updateJobTargetStatus(id, status, error_msg = null) {
  db.prepare('UPDATE broadcast_job_targets SET status = ?, sent_at = CURRENT_TIMESTAMP, error_msg = ? WHERE id = ?')
    .run(status, error_msg, id);
}

function updateJobStatus(jobId, status) {
  const finished = ['done', 'failed', 'stopped'].includes(status) ? ', finished_at = CURRENT_TIMESTAMP' : '';
  const started = status === 'running' ? ', started_at = CURRENT_TIMESTAMP' : '';
  db.prepare(`UPDATE broadcast_jobs SET status = ?${finished}${started} WHERE id = ?`).run(status, jobId);
}

module.exports = {
  db,
  upsertTarget,
  listTargets,
  setTargetFlag,
  upsertBotContact,
  createJob,
  getJobTargets,
  updateJobTargetStatus,
  updateJobStatus,
};
