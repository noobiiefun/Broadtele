const {
  getJob, getPendingTargets, updateJobTargetStatus, incrementRetry,
  updateJobStatus, db, setTargetBotPermission, getJobAccountId,
} = require('../db/db');
const { shuffle } = require('./shuffle');
const { randomDelayMs, sleep } = require('./delay');
const userbot = require('../telegram/userbot');
const bot = require('../telegram/bot');

/**
 * Kode error Telegram yang PERMANEN — mengirim ulang ke target yang sama
 * tidak akan pernah sukses (keluar grup, diblokir, chat dihapus, dsb),
 * jadi jangan buang waktu retry; tandai failed dan lanjut.
 */
const PERMANENT_ERRORS = [
  'CHAT_WRITE_FORBIDDEN', 'USER_DELETED', 'PEER_ID_INVALID', 'USERNAME_NOT_OCCUPIED',
  'USER_IS_BLOCKED', 'BOT_KICKED', 'CHAT_ADMIN_REQUIRED', 'INPUT_FETCH_ERROR',
  'PEER_ID_INVALID', 'USER_BANNED_IN_CHANNEL', 'CHANNEL_PRIVATE',
  // Bot API
  'chat not found', 'bot was kicked', 'bot is not a member', 'USER_BANNED',
  'Forbidden', 'UnAuthorized',
];

function isPermanentError(errMsg = '') {
  return PERMANENT_ERRORS.some((code) => errMsg.includes(code));
}

/**
 * Kode error SEMENTARA yang layak dicoba lagi di akhir putaran berikutnya
 * (jaringan putus, flood terlalu sering, peer belum ter-resolve).
 */
const TRANSIENT_CODES = ['FLOOD_WAIT', 'TIMED_OUT', 'RPC_MCGET_FAIL', 'NETWORK_MIGRATE', 'TRY_AGAIN_LATER'];

function isTransientError(errMsg = '') {
  return TRANSIENT_CODES.some((code) => errMsg.includes(code));
}

// Job yang sedang aktif dijalankan (cegah satu job jalan dobel kalau tombol Run diklik 2x)
const activeJobs = new Set();

/**
 * Jalankan satu broadcast job:
 * - hanya ambil target berstatus 'pending' → job yang terhenti (crash/restart) bisa dilanjutkan
 *   tanpa mengirim dobel ke target yang sudah 'sent'
 * - urutan diacak (Fisher-Yates) tiap kali jalan
 * - kirim SEKUENSIAL (bukan paralel) — sesuai aturan rate-limit Telegram
 * - cek status jeda/stop DARI DATABASE setiap iterasi (sumber kebenaran tunggal,
 *   bukan snapshot objek yang basi)
 * - error sementara (flood/transient) di-retry sampai MAX_ROUNDS putaran dengan
 *   backoff eksponensial; error permanen langsung ditandai failed
 * - setelah semua target diproses, laporkan ringkasan lewat onProgress({summary:true})
 *
 * options.maxRetriesPerTarget: berapa kali satu target boleh dicoba ulang (default 2)
 */
async function runJob(jobId, { onProgress, maxRetriesPerTarget = 2 } = {}) {
  if (activeJobs.has(jobId)) {
    throw new Error(`Job ${jobId} sedang berjalan — jangan jalankan dua kali bersamaan.`);
  }
  const job = getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} tidak ditemukan`);

  activeJobs.add(jobId);
  updateJobStatus(jobId, 'running');

  let stopped = false;
  try {
    for (let round = 1; round <= maxRetriesPerTarget + 1; round += 1) {
      let targets = getPendingTargets(jobId);
      if (!targets.length) break;
      if (round > 1) {
        // Putaran retry: beri jeda backoff dulu supaya error sementara punya waktu pulih
        const backoff = Math.min(60, 5 * Math.pow(2, round - 2)) * 1000;
        if (onProgress) onProgress({ jobId, meta: true, ok: true, name: `Putaran retry ${round}: menunggu ${backoff / 1000}s sebelum mencoba ${targets.length} target...` });
        await sleep(backoff);
        targets = getPendingTargets(jobId);
        if (!targets.length) break;
      }
      targets = shuffle(targets);

      for (let i = 0; i < targets.length; i += 1) {
        const target = targets[i];

        // Cek status langsung dari DB — ini yang membuat Jeda/Hentikan responsif
        const status = db.prepare('SELECT status FROM broadcast_jobs WHERE id = ?').get(jobId).status;
        if (status === 'stopped') { stopped = true; break; }
        while (true) {
          const s = db.prepare('SELECT status FROM broadcast_jobs WHERE id = ?').get(jobId).status;
          if (s !== 'paused') break;
          await sleep(1000);
        }

        // Lewati baris yang ternyata sudah dikirim (misal oleh proses lain) — cegah kirim dobel
        const fresh = db.prepare('SELECT status FROM broadcast_job_targets WHERE id = ?').get(target.id);
        if (!fresh || fresh.status !== 'pending') continue;

        // ---- MULTI-AKUN & MULTI-BOT: penentu jalur kirim per baris job ----
        let result;
        if (target.method === 'bot') {
          if (!target.bot_token_id) {
            result = { ok: false, error: 'Baris job ini tidak punya bot yang ditugaskan.' };
          } else if (!bot.isActive(target.bot_token_id)) {
            result = { ok: false, error: `Bot #${target.bot_token_id} tidak aktif — jalankan dari tab Akun & Bot.` };
          } else {
            result = await bot.sendMessage(target.bot_token_id, target.chat_id, job.message_text).catch((err) => ({ ok: false, error: err.message || String(err) }));
            if (result.ok) setTargetBotPermission(target.target_id, target.bot_token_id, true);
          }
        } else {
          // personal: akun yang ditugaskan di baris ini, atau default job, atau pemilik target
          const accountId = target.account_id ?? getJobAccountId(jobId) ?? null;
          if (!accountId) {
            result = { ok: false, error: 'Tidak ada akun userbot untuk target ini — centang akun atau pilih bot.' };
          } else if (!userbot.isConnected(accountId)) {
            result = { ok: false, error: `Akun userbot #${accountId} belum terhubung.` };
          } else {
            result = await userbot.sendMessage(accountId, target.chat_id, job.message_text).catch((err) => ({ ok: false, error: err.message || String(err) }));
          }
        }

        if (result.ok) {
          updateJobTargetStatus(target.id, 'sent');
          db.prepare('UPDATE targets SET last_broadcast_at = CURRENT_TIMESTAMP, last_status = ? WHERE id = ?')
            .run('sent', target.target_id);
        } else {
          const permanent = isPermanentError(result.error || '');
          const transient = isTransientError(result.error || '');
          const canRetryAgain = round <= maxRetriesPerTarget && (transient || !permanent);
          if (canRetryAgain && !permanent) {
            incrementRetry(target.id); // kembali jadi pending, retry_count+1
          } else {
            updateJobTargetStatus(target.id, 'failed', result.error);
            db.prepare('UPDATE targets SET last_broadcast_at = CURRENT_TIMESTAMP, last_status = ? WHERE id = ?')
              .run('failed', target.target_id);
          }
        }

        if (onProgress) {
          onProgress({
            jobId, targetId: target.id, displayName: target.display_name,
            ok: result.ok, error: result.error, round, willRetry: !result.ok && !isPermanentError(result.error || '') && round <= maxRetriesPerTarget,
          });
        }

        // Jeda acak antar kirim (skip setelah target terakhir pada putaran ini)
        if (i < targets.length - 1) {
          await sleep(randomDelayMs(job.delay_min_sec, job.delay_max_sec));
        }
      }
      if (stopped) break;
    }

    const remaining = getPendingTargets(jobId).length;
    updateJobStatus(jobId, stopped ? 'stopped' : 'done');

    if (onProgress) {
      const counts = db.prepare(`SELECT
          SUM(status='sent') AS sent, SUM(status='failed') AS failed, SUM(status='pending') AS pending
        FROM broadcast_job_targets WHERE job_id = ?`).get(jobId);
      onProgress({
        jobId, meta: true, ok: !stopped, summary: true,
        name: `Selesai — terkirim ${counts.sent ?? 0}, gagal ${counts.failed ?? 0}${remaining ? `, belum terkirim ${remaining}` : ''}.`,
      });
    }
  } finally {
    activeJobs.delete(jobId);
  }
}

function pauseJob(jobId) {
  updateJobStatus(jobId, 'paused');
}

function stopJob(jobId) {
  updateJobStatus(jobId, 'stopped');
}

function isJobActive(jobId) {
  return activeJobs.has(jobId);
}

/**
 * Bersihkan status 'running'/'paused' yang tertinggal dari sesi sebelumnya
 * (app crash / ditutup saat job jalan) supaya tercatat 'stopped' & bisa
 * dilanjutkan dari tab Riwayat. Dipanggil sekali saat aplikasi start.
 */
function recoverOrphanedJobs() {
  const orphans = db.prepare(`SELECT id FROM broadcast_jobs WHERE status IN ('running','paused')`).all();
  for (const o of orphans) {
    updateJobStatus(o.id, 'stopped');
  }
  return orphans.map((o) => o.id);
}

module.exports = { runJob, pauseJob, stopJob, isJobActive, recoverOrphanedJobs };
