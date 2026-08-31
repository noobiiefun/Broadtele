const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

let apiId = null;
let apiHash = null;
let client = null;

/** Dipanggil main.js setiap kali kredensial dibaca/diubah dari tab Pengaturan. */
function setCredentials({ apiId: id, apiHash: hash }) {
  apiId = parseInt(id, 10);
  apiHash = hash;
}

function hasCredentials() {
  return !!(apiId && apiHash);
}

/**
 * Login/connect userbot.
 * - sessionString terisi -> langsung connect, tidak ada prompt sama sekali.
 * - sessionString kosong -> login baru, minta data lewat `prompts` (dipasok oleh main.js,
 *   yang meneruskannya sebagai dialog di UI, bukan prompt terminal).
 *
 * prompts = { phoneNumber: () => Promise<string>, password: () => Promise<string>, phoneCode: () => Promise<string> }
 */
async function initUserbot(sessionString = '', prompts = {}) {
  if (!hasCredentials()) {
    throw new Error('API ID / API Hash belum diisi. Isi dulu di tab Pengaturan.');
  }
  const stringSession = new StringSession(sessionString);
  client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });

  if (!sessionString) {
    await client.start({
      phoneNumber: prompts.phoneNumber || (() => { throw new Error('Prompt nomor HP tidak tersedia'); }),
      password: prompts.password || (async () => ''),
      phoneCode: prompts.phoneCode || (() => { throw new Error('Prompt kode OTP tidak tersedia'); }),
      onError: (err) => console.error('Login userbot gagal:', err),
    });
  } else {
    await client.connect();
  }
  return client;
}

/** Dipanggil setelah login sukses, untuk disimpan lewat sessionStore. */
function getSessionString() {
  return client ? client.session.save() : '';
}

function isConnected() {
  return !!(client && client.connected);
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

module.exports = {
  setCredentials, hasCredentials, initUserbot, listDialogs, sendMessage, getClient, getSessionString, isConnected,
};
