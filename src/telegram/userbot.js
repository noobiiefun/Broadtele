const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');

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
  // Pastikan client lama benar-benar diputus sebelum membuat yang baru,
  // supaya tidak ada dua koneksi MTProto aktif sekaligus dari satu proses.
  await disconnect();
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
 *
 * Paginasi manual pakai iterativeUpdates/getDialogs dengan offset — `limit` di sini
 * adalah TOTAL maksimum dialog yang dikumpulkan (bukan hanya halaman pertama),
 * memperbaiki keterbatasan versi sebelumnya yang cuma ambil 500 dialog teratas.
 */
async function listDialogs({ totalLimit = 3000, pageSize = 100 } = {}) {
  const results = [];
  const seen = new Set();
  let offsetId = 0;
  let offsetDate = 0;

  while (results.length < totalLimit) {
    const page = await client.getDialogs({
      limit: pageSize,
      offsetId,
      offsetDate,
      ignoreFolder: true,
    });
    if (!page || page.length === 0) break;

    for (const d of page) {
      const idStr = d.id?.toString();
      if (!idStr || seen.has(idStr)) continue;
      seen.add(idStr);
      results.push({
        chat_id: idStr,
        display_name: d.title || d.name || '(tanpa nama)',
        username: d.entity?.username || null,
        type: d.isGroup || d.isChannel ? 'grup' : 'japri',
        isGroup: d.isGroup,
        isChannel: d.isChannel,
        isUser: d.isUser,
      });
      if (results.length >= totalLimit) break;
    }

    const last = page[page.length - 1];
    // Kalau halaman berikutnya identik dengan titik ini, berhenti (hindari loop tak berujung)
    if (last.topMessage && last.topMessage.id === offsetId) break;
    offsetId = last.topMessage ? last.topMessage.id : 0;
    offsetDate = last.date || Math.floor(Date.now() / 1000);
    if (page.length < pageSize) break; // tidak ada halaman lagi
  }
  return results;
}

/**
 * Kirim pesan lewat userbot. Menangani FLOOD_WAIT sesuai aturan Telegram:
 * kalau kena flood wait, TUNGGU durasi yang diminta sebelum retry (jangan diabaikan).
 * Flood-wait TIDAK dihitung sebagai bagian dari maxRetries (itu instruksi server,
 * bukan kegagalan pengiriman), tapi dibatasi maxFloodWaits supaya tidak deadlock.
 * Peer juga di-cache setelah sukses pertama kali — mengirim ke ID mentah setiap kali
 * memaksa GramJS resolve ulang entity (lebih lambat & rawan PEER_ID_INVALID).
 */
const peerCache = new Map(); // chatId(string) -> resolved entity/Api.Peer

async function resolvePeer(chatId) {
  if (peerCache.has(chatId)) return peerCache.get(chatId);
  const peer = await client.getInputEntity(chatId);
  peerCache.set(chatId, peer);
  return peer;
}

async function sendMessage(chatId, text, { maxRetries = 2, maxFloodWaits = 10 } = {}) {
  let attempt = 0;
  let floodWaits = 0;
  let peer;
  try {
    peer = await resolvePeer(chatId);
  } catch (err) {
    return { ok: false, error: `PEER_ID_INVALID — ${err.message}` };
  }

  while (attempt <= maxRetries) {
    try {
      await client.sendMessage(peer, { message: text });
      return { ok: true };
    } catch (err) {
      const msg = err.message || String(err);
      const isFloodWait = err.errorMessage === 'FLOOD_WAIT' || /FLOOD_WAIT/.test(msg);
      if (isFloodWait && err.seconds) {
        floodWaits += 1;
        if (floodWaits > maxFloodWaits) {
          return { ok: false, error: `FLOOD_WAIT berulang (${floodWaits}x) — hentikan, naikkan jeda antar kirim` };
        }
        console.warn(`FLOOD_WAIT ${err.seconds}s untuk chat ${chatId}, menunggu...`);
        await new Promise((r) => setTimeout(r, (err.seconds + 1) * 1000));
        continue; // flood-wait bukan "percobaan gagal" — tidak menambah attempt
      }
      // Session mati di tengah jalan? Jangan cache peer yang salah.
      if (/AUTH_KEY_(UNREGISTERED|REVOKED)|SESSION_REVOKED/.test(msg)) {
        peerCache.delete(chatId);
      }
      return { ok: false, error: msg };
    }
  }
  return { ok: false, error: 'Retry habis (error sementara berulang)' };
}

/** Lupakan seluruh cache peer (dipanggil saat logout/ganti akun). */
function clearPeerCache() {
  peerCache.clear();
}

/** Putuskan koneksi client lama sebelum login/connect ulang (hindari koneksi ganda). */
async function disconnect() {
  if (client) {
    try { await client.disconnect(); } catch { /* sudah terputus, abaikan */ }
    client = null;
    clearPeerCache();
  }
}

function getClient() {
  return client;
}

module.exports = {
  setCredentials, hasCredentials, initUserbot, listDialogs, sendMessage, getClient,
  getSessionString, isConnected, disconnect, clearPeerCache,
};
