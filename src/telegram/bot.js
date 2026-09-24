const TelegramBot = require('node-telegram-bot-api');
const { db, upsertTarget, upsertBotContact } = require('../db/db');

let bot = null;

/**
 * Inisialisasi bot dengan polling. Setiap event message dipakai untuk:
 * - mendeteksi grup baru tempat bot berada (source: 'bot')
 * - mencatat kontak personal yang pernah DM bot (bot_contacts -> otomatis jadi target japri)
 */
function initBot(token) {
  if (bot) stopBot(); // hindari dua polling aktif kalau token diganti dari tab Pengaturan

  bot = new TelegramBot(token, { polling: true });

  // Simpan token yang dipakai instance ini. Ini penting saat token diganti dari
  // tab Pengaturan: polling_error dari bot LAMA (yang sudah dihentikan) kadang
  // masih datang terlambat dan tidak boleh lagi menimpa status bot yang baru.
  const myToken = token;

  // Batch write ke SQLite: event message bisa datang beruntun dalam jumlah besar
  // (grup ramai). Daripada satu transaksi per pesan, kumpulkan dulu lalu flush
  // maksimal tiap 2 detik — jauh lebih ringan untuk disk & CPU.
  const pendingEvents = [];
  let flushTimer = null;
  const FLUSH_INTERVAL_MS = 2000;

  function flushEvents() {
    flushTimer = null;
    if (!pendingEvents.length) return;
    const events = pendingEvents.splice(0, pendingEvents.length);
    try {
      db.transaction(() => {
        for (const ev of events) {
          if (ev.kind === 'private') {
            upsertBotContact({ chat_id: ev.chat_id, username: ev.username, first_name: ev.first_name });
          } else {
            upsertTarget({
              chat_id: ev.chat_id, type: 'grup', display_name: ev.title,
              username: ev.username, source: 'bot', bot_can_send: 1,
            });
          }
        }
      })();
    } catch (err) {
      console.error('Gagal menyimpan event bot:', err.message);
    }
  }

  bot.on('message', (msg) => {
    const chat = msg.chat;
    if (chat.type === 'private') {
      pendingEvents.push({
        kind: 'private',
        chat_id: chat.id.toString(),
        username: chat.username || null,
        first_name: chat.first_name || chat.username || 'Tanpa nama',
      });
    } else if (chat.type === 'group' || chat.type === 'supergroup') {
      pendingEvents.push({
        kind: 'group',
        chat_id: chat.id.toString(),
        title: chat.title,
        username: chat.username || null,
      });
    } else {
      return;
    }
    if (!flushTimer) flushTimer = setTimeout(flushEvents, FLUSH_INTERVAL_MS);
  });

  bot.on('polling_error', (err) => {
    if (bot !== getBotInstanceForToken(myToken)) return; // error dari instance lama, abaikan
    console.error('Bot polling error:', err.message);
  });

  return bot;
}

// Helper kecil: kembalikan `bot` saat ini HANYA kalau memang dibuat dengan token ini.
function getBotInstanceForToken(token) {
  return bot && bot._options && bot._options.token === token ? bot : (bot && bot.token === token ? bot : null);
}

/** Hentikan polling bot yang sedang jalan (dipanggil sebelum ganti token). */
function stopBot() {
  if (bot) {
    bot.stopPolling().catch(() => {});
    bot = null;
  }
}

/**
 * Kirim pesan lewat Bot API. Rate limit resmi ~1 pesan/detik per chat, ~30/detik total,
 * jadi pengaturan delay antar kirim tetap harus dihormati walau lewat bot.
 */
async function sendMessage(chatId, text) {
  if (!bot) return { ok: false, error: 'Bot belum diinisialisasi. Isi Bot Token di tab Pengaturan.' };
  try {
    await bot.sendMessage(chatId, text);
    return { ok: true };
  } catch (err) {
    const retryAfter = err.response?.body?.parameters?.retry_after;
    if (retryAfter) {
      console.warn(`Bot API retry_after ${retryAfter}s untuk chat ${chatId}, menunggu...`);
      await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
      try {
        await bot.sendMessage(chatId, text);
        return { ok: true };
      } catch (err2) {
        return { ok: false, error: err2.message };
      }
    }
    return { ok: false, error: err.message };
  }
}

function getBot() {
  return bot;
}

function isActive() {
  return !!bot;
}

module.exports = { initBot, stopBot, sendMessage, getBot, isActive };
