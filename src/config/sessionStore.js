const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '..', '..', '.broadtele-session');

/**
 * Simpan/baca session string userbot dari file lokal (di luar .env supaya
 * UI bisa login sekali lalu otomatis connect di run berikutnya, tanpa user
 * harus copy-paste manual ke .env).
 *
 * TODO (tercatat juga di BROADTELE.md): file ini masih plain text.
 * Rencana selanjutnya: enkripsi pakai `keytar` (OS credential manager)
 * atau `electron-store` dengan encryptionKey sebelum dipakai di produksi.
 */
function loadSession() {
  try {
    return fs.readFileSync(SESSION_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

function saveSession(sessionString) {
  fs.writeFileSync(SESSION_FILE, sessionString || '', 'utf8');
}

function clearSession() {
  try { fs.unlinkSync(SESSION_FILE); } catch { /* sudah tidak ada, tidak masalah */ }
}

module.exports = { loadSession, saveSession, clearSession };
