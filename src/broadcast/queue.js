const { getJobTargets, updateJobTargetStatus, updateJobStatus, db } = require('../db/db');
const { shuffle } = require('./shuffle');
const { randomDelayMs, sleep } = require('./delay');
const userbot = require('../telegram/userbot');
const bot = require('../telegram/bot');

/**
 * Jalankan satu broadcast job:
 * - shuffle urutan target
 * - kirim SEKUENSIAL (bukan paralel) satu per satu
 * - pilih method 'bot' atau 'personal' sesuai yang tersimpan di broadcast_job_targets
 * - jeda acak (jitter) antar kirim, sesuai delay_min_sec/delay_max_sec job
 * - laporkan progres lewat callback onProgress (dipakai untuk update UI realtime)
 *
 * FLOOD_WAIT / retry_after sudah ditangani di level userbot.js / bot.js masing-masing.
 */
async function runJob(jobId, { onProgress } = {}) {
  const job = db.prepare('SELECT * FROM broadcast_jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`Job ${jobId} tidak ditemukan`);

  let targets = getJobTargets(jobId);
  targets = shuffle(targets);

  updateJobStatus(jobId, 'running');
  let stopped = false;

  for (const target of targets) {
    if (stopped) break;

    const currentJob = db.prepare('SELECT status FROM broadcast_jobs WHERE id = ?').get(jobId);
    if (currentJob.status === 'stopped') { stopped = true; break; }
    while (currentJob.status === 'paused') {
      await sleep(1000);
      Object.assign(currentJob, db.prepare('SELECT status FROM broadcast_jobs WHERE id = ?').get(jobId));
    }

    const sender = target.method === 'bot' ? bot : userbot;
    const result = await sender.sendMessage(target.chat_id, job.message_text);

    if (result.ok) {
      updateJobTargetStatus(target.id, 'sent');
    } else {
      updateJobTargetStatus(target.id, 'failed', result.error);
    }

    if (onProgress) {
      onProgress({ jobId, targetId: target.id, displayName: target.display_name, ok: result.ok, error: result.error });
    }

    // Jeda acak sebelum target berikutnya (tidak perlu jeda setelah target terakhir)
    const isLast = target === targets[targets.length - 1];
    if (!isLast) {
      await sleep(randomDelayMs(job.delay_min_sec, job.delay_max_sec));
    }
  }

  updateJobStatus(jobId, stopped ? 'stopped' : 'done');
}

function pauseJob(jobId) {
  updateJobStatus(jobId, 'paused');
}

function stopJob(jobId) {
  updateJobStatus(jobId, 'stopped');
}

module.exports = { runJob, pauseJob, stopJob };
