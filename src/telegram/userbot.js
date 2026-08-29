const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input'); // dipakai hanya untuk mode CLI/dev; UI produksi harus gantikan dengan prompt Electron

const apiId = parseInt(process.env.TG_API_ID, 10);
const apiHash = process.env.TG_API_HASH;

let client = null;

/**
 * Login userbot. sessionString kosong ("") = login baru (akan minta nomor HP + OTP + 2FA kalau ada).
 * Kalau sudah punya sessionString tersimpan, langsung connect tanpa prompt ulang.
 */
async function initUserbot(sessionString = '') {
  const stringSession = new StringSession(sessionString);
  client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });

  if (!sessionString) {
    await client.start({
      phoneNumber: async () => await input.text('Nomor HP (format +62...): '),
      password: async () => await input.text('Password 2FA (kosongkan jika tidak ada): '),
      phoneCode: async () => await input.text('Kode OTP dari Telegram: '),
      onError: (err) => console.error('Login error:', err),
    });
    console.log('Session string baru (SIMPAN INI, JANGAN DI-COMMIT):');
    console.log(client.session.save());
  } else {
    await client.connect();
  }
  return client;
}

/**
 * Ambil semua dialog (grup, channel, private chat) yang diikuti akun ini.
 * Dipetakan ke bentuk sederhana untuk disimpan ke tabel `targets`.
 */
async function listDialogs() {
  const dialogs = await client.getDialogs({ limit: 500 });
  return dialogs.map((d) => ({
    chat_id: d.id?.toString(),
    display_name: d.title || d.name || '(tanpa nama)',
    username: d.entity?.username || null,
    type: d.isGroup || d.isChannel ? 'grup' : 'japri',
    isGroup: d.isGroup,
    isChannel: d.isChannel,
    isUser: d.isUser,
  }));
}

/**
 * Kirim pesan lewat userbot. Menangani FLOOD_WAIT sesuai aturan Telegram:
 * kalau kena flood wait, TUNGGU durasi yang diminta sebelum retry (jangan diabaikan).
 */
async function sendMessage(chatId, text, { maxRetries = 2 } = {}) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      await client.sendMessage(chatId, { message: text });
      return { ok: true };
    } catch (err) {
      const isFloodWait = err.errorMessage === 'FLOOD_WAIT' || /FLOOD_WAIT/.test(err.message || '');
      if (isFloodWait && err.seconds) {
        console.warn(`FLOOD_WAIT ${err.seconds}s untuk chat ${chatId}, menunggu...`);
        await new Promise((r) => setTimeout(r, (err.seconds + 1) * 1000));
        attempt += 1;
        continue;
      }
      return { ok: false, error: err.message || String(err) };
    }
  }
  return { ok: false, error: 'FLOOD_WAIT retry habis' };
}

function getClient() {
  return client;
}

module.exports = { initUserbot, listDialogs, sendMessage, getClient };
