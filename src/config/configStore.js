const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * Kredensial (API ID, API Hash, Bot Token) disimpan di folder data aplikasi milik OS
 * (userData), BUKAN di file .env dan BUKAN di dalam folder project. Ini supaya:
 * - User tidak perlu edit file manual sama sekali, cukup isi lewat tab Pengaturan
 * - Kalau project di-zip/di-share/dicommit ke Git, kredensial tidak ikut terbawa
 *
 * TODO (tercatat juga di BROADTELE.md): file ini masih plain JSON, belum dienkripsi.
 * Rencana selanjutnya: enkripsi pakai `keytar` (OS credential manager) sebelum produksi.
 */
function getConfigPath() {
  return path.join(app.getPath('userData'), 'broadtele-config.json');
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveConfig(partial) {
  const merged = { ...loadConfig(), ...partial };
  fs.writeFileSync(getConfigPath(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

module.exports = { loadConfig, saveConfig, getConfigPath };
