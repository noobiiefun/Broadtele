const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * Simpan/baca session string userbot dari folder data aplikasi (userData),
 * sama seperti configStore.js. Supaya UI bisa login sekali lalu otomatis
 * connect di run berikutnya, tanpa user harus copy-paste manual ke mana pun.
 *
 * MULTI-AKUN: setiap akun punya file sesi sendiri —
 *   userData/sessions/<session_key>.txt
 * sehingga banyak akun Telegram bisa login bersamaan dan masing-masing
 * reconnect otomatis saat aplikasi dibuka.
 *
 * File sesi lama (single-session, broadtele-session.txt) tetap dibaca lewat
 * loadLegacySession() untuk keperluan migrasi menjadi "Akun 1".
 *
 * TODO (tercatat juga di BROADTELE.md): file ini masih plain text.
 * Rencana selanjutnya: enkripsi pakai `keytar` (OS credential manager)
 * atau `electron-store` dengan encryptionKey sebelum dipakai di produksi.
 */
function getSessionsDir() {
  return path.join(app.getPath('userData'), 'sessions');
}

function getLegacySessionPath() {
  return path.join(app.getPath('userData'), 'broadtele-session.txt');
}

function sessionFileFor(key) {
  // session_key dibuat sendiri oleh db.createAccount (format acc-<timestamp>-<hex>),
  // tapi sanitasi tetap dilakukan demi keamanan path.
  const safe = String(key).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(getSessionsDir(), `${safe}.txt`);
}

function saveSession(key, sessionString) {
  fs.mkdirSync(getSessionsDir(), { recursive: true });
  fs.writeFileSync(sessionFileFor(key), sessionString || '', 'utf8');
}

function loadSession(key) {
  try {
    return fs.readFileSync(sessionFileFor(key), 'utf8').trim();
  } catch {
    return '';
  }
}

function clearSession(key) {
  try { fs.unlinkSync(sessionFileFor(key)); } catch { /* sudah tidak ada, tidak masalah */ }
}

/** Baca file sesi tunggal versi lama (sebelum multi-akun) — untuk migrasi. */
function loadLegacySession() {
  try {
    return fs.readFileSync(getLegacySessionPath(), 'utf8').trim();
  } catch {
    return '';
  }
}

/** Hapus file sesi lama setelah berhasil dimigrasikan menjadi akun pertama. */
function clearLegacySession() {
  try { fs.unlinkSync(getLegacySessionPath()); } catch { /* tidak ada, abaikan */ }
}

module.exports = { saveSession, loadSession, clearSession, loadLegacySession, clearLegacySession };
