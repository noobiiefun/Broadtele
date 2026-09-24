const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

/**
 * MANAJEMEN BANYAK AKUN USERBOT (MTProto / GramJS).
 *
 * Setiap akun = satu entri di tabel `accounts` (SQLite) + satu file session string
 * di userData/sessions/<key>.txt + satu TelegramClient aktif di Map ini.
 * Kredensial API ID/Hash dipakai bersama oleh semua akun (satu aplikasi di
 * my.telegram.org bisa dipakai untuk login berapa pun nomor).
 */

let apiId = null;
let apiHash = null;

/** accountId(number) -> { client, status: 'connecting'|'connected'|'disconnected', phone } */
const instances = new Map();

/** Dipanggil main.js setiap kali kredensial dibaca/diubah dari tab Pengaturan. */
function setCredentials({ apiId: id, apiHash: hash }) {
  apiId = parseInt(id, 10);
  apiHash = hash;
}

function hasCredentials() {
  return !!(apiId && apiHash);
}

function getInstance(accountId) {
  return instances.get(Number(accountId)) || null;
}

function getClient(accountId) {
  const inst = getInstance(accountId);
  return inst ? inst.client : null;
}

function isConnected(accountId) {
  const inst = getInstance(accountId);
  return !!(inst && inst.client && inst.client.connected);
}

function getStatus(accountId) {
  const inst = getInstance(accountId);
  return inst ? inst.status : 'disconnected';
}

function listConnectedIds() {
  return [...instances.entries()].filter(([, i]) => i.status === 'connected').map(([id]) => id);
}

/** Status ringkas semua akun yang dikenal (untuk UI). */
function statusMap() {
  const out = {};
  for (const [id, inst] of instances.entries()) out[id] = inst.status;
  return out;
}

async function disconnectAccount(accountId) {
  const inst = instances.get(Number(accountId));
  if (!inst) return;
  instances.delete(Number(accountId));
  try { if (inst.client) await inst.client.disconnect(); } catch { /* sudah terputus, abaikan */ }
}

async function disconnectAll() {
  for (const id of [...instances.keys()]) await disconnectAccount(id);
}

/**
 * Connect ulang akun dari session string tersimpan (tanpa prompt apa pun).
 * instanceFactory() disediakan main.js supaya pembuatan objek per-akun
 * (peer cache dll) bisa dikelola di sana.
 */
async function connectSaved(accountId, sessionString, { instanceFactory } = {}) {
  if (!hasCredentials()) throw new Error('API ID / API Hash belum diisi. Isi dulu di tab Pengaturan.');
  if (!sessionString) throw new Error(`Akun ${accountId} tidak punya sesi tersimpan.`);
  await disconnectAccount(accountId);

  const entry = { client: null, status: 'connecting', phone: null, ...(instanceFactory ? instanceFactory() : {}) };
  instances.set(Number(accountId), entry);
  try {
    const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, { connectionRetries: 5 });
    await client.connect();
    entry.client = client;
    entry.status = 'connected';
    return client;
  } catch (err) {
    entry.status = 'disconnected';
    instances.delete(Number(accountId));
    throw err;
  }
}

/**
 * Login akun BARU (sessionString kosong) atau reconnect (terisi).
 * prompts = { phoneNumber, password, phoneCode } — masing-masing () => Promise<string>,
 * dipasok main.js sebagai dialog di UI (bukan prompt terminal).
 * Nomor HP yang diketik user dikembalikan supaya main.js bisa menyimpannya ke DB.
 */
async function loginNew({ phoneNumber: initialPhone, prompts = {}, instanceFactory } = {}) {
  if (!hasCredentials()) throw new Error('API ID / API Hash belum diisi. Isi dulu di tab Pengaturan.');

  let enteredPhone = initialPhone || null;
  const stringSession = new StringSession('');
  const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });

  await client.start({
    phoneNumber: async () => {
      if (enteredPhone) return enteredPhone;
      enteredPhone = await (prompts.phoneNumber || (() => { throw new Error('Prompt nomor HP tidak tersedia'); }))();
      return enteredPhone;
    },
    password: prompts.password || (async () => ''),
    phoneCode: prompts.phoneCode || (() => { throw new Error('Prompt kode OTP tidak tersedia'); }),
    onError: (err) => console.error('Login userbot gagal:', err),
  });

  const me = await client.getMe();
  const phone = me.phone || enteredPhone || null;
  const sessionString = client.session.save();

  // Jangan langsung dipasang sebagai instance permanen — main.js yang memutuskan
  // (menyimpan akun ke DB & memanggil connectSaved), supaya lifecycle konsisten.
  try { await client.disconnect(); } catch { /* abaikan */ }

  return { phone, sessionString, username: me.username || null, firstName: me.firstName || null };
}

/**
 * Ambil semua dialog (grup, channel, private chat) yang diikuti SATU akun ini.
 * Paginasi manual pakai offset — `totalLimit` adalah TOTAL maksimum dialog
 * yang dikumpulkan (bukan hanya halaman pertama).
 */
async function listDialogs(accountId, { totalLimit = 3000, pageSize = 100 } = {}) {
  const client = getClient(accountId);
  if (!client || !isConnected(accountId)) throw new Error(`Userbot akun ${accountId} belum terhubung.`);
  const results = [];
  const seen = new Set();
  let offsetId = 0;
  let offsetDate = 0;

  while (results.length < totalLimit) {
    const page = await client.getDialogs({ limit: pageSize, offsetId, offsetDate, ignoreFolder: true });
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
    if (last.topMessage && last.topMessage.id === offsetId) break;
    offsetId = last.topMessage ? last.topMessage.id : 0;
    offsetDate = last.date || Math.floor(Date.now() / 1000);
    if (page.length < pageSize) break;
  }
  return results;
}

/**
 * Kirim pesan lewat akun tertentu. Penanganan FLOOD_WAIT sesuai aturan Telegram:
 * tunggu durasi yang diminta (bukan dihitung sebagai retry gagal, tapi dibatasi
 * maxFloodWaits). Peer di-cache PER AKUN setelah sukses pertama kali.
 */
async function sendMessage(accountId, chatId, text, { maxRetries = 2, maxFloodWaits = 10 } = {}) {
  const inst = getInstance(accountId);
  if (!inst || !inst.client || !inst.peerCache) {
    return { ok: false, error: `Akun ${accountId} belum login/terhubung.` };
  }
  const { client, peerCache } = inst;

  let attempt = 0;
  let floodWaits = 0;
  let peer;
  try {
    if (peerCache.has(chatId)) {
      peer = peerCache.get(chatId);
    } else {
      peer = await client.getInputEntity(chatId);
      peerCache.set(chatId, peer);
    }
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
        console.warn(`FLOOD_WAIT ${err.seconds}s (akun ${accountId}, chat ${chatId}), menunggu...`);
        await new Promise((r) => setTimeout(r, (err.seconds + 1) * 1000));
        continue;
      }
      if (/AUTH_KEY_(UNREGISTERED|REVOKED)|SESSION_REVOKED/.test(msg)) {
        peerCache.delete(chatId);
        inst.status = 'disconnected';
      }
      return { ok: false, error: msg };
    }
  }
  return { ok: false, error: 'Retry habis (error sementara berulang)' };
}

module.exports = {
  setCredentials, hasCredentials,
  connectSaved, loginNew, disconnectAccount, disconnectAll,
  isConnected, getStatus, statusMap, listConnectedIds, getClient,
  listDialogs, sendMessage,
};
