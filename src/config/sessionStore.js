const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * Simpan/baca session string userbot dari folder data aplikasi (userData),
 * sama seperti configStore.js. Supaya UI bisa login sekali lalu otomatis
 * connect di run berikutnya, tanpa user harus copy-paste manual ke mana pun.
 *
 * TODO (tercatat juga di BROADTELE.md): file ini masih plain text.
 * Rencana selanjutnya: enkripsi pakai `keytar` (OS credential manager)
 * atau `electron-store` dengan encryptionKey sebelum dipakai di produksi.
 */
function getSessionPath() {
  return path.join(app.getPath('userData'), 'broadtele-session.txt');
}

function loadSession() {
  try {
    return fs.readFileSync(getSessionPath(), 'utf8').trim();
  } catch {
    return '';
  }
}

function saveSession(sessionString) {
  fs.writeFileSync(getSessionPath(), sessionString || '', 'utf8');
}

function clearSession() {
  try { fs.unlinkSync(getSessionPath()); } catch { /* sudah tidak ada, tidak masalah */ }
}

module.exports = { loadSession, saveSession, clearSession };
