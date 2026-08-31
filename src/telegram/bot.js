const TelegramBot = require('node-telegram-bot-api');
const { upsertTarget, upsertBotContact } = require('../db/db');

let bot = null;

/**
 * Inisialisasi bot dengan polling. Setiap event message dipakai untuk:
 * - mendeteksi grup baru tempat bot berada (source: 'bot')
 * - mencatat kontak personal yang pernah DM bot (bot_contacts -> otomatis jadi target japri)
 */
function initBot(token) {
  if (bot) stopBot(); // hindari dua polling aktif kalau token diganti dari tab Pengaturan

  bot = new TelegramBot(token, { polling: true });

  bot.on('message', (msg) => {
    const chat = msg.chat;
    if (chat.type === 'private') {
      upsertBotContact({
        chat_id: chat.id.toString(),
        username: chat.username || null,
        first_name: chat.first_name || chat.username || 'Tanpa nama',
      });
    } else if (chat.type === 'group' || chat.type === 'supergroup') {
      upsertTarget({
        chat_id: chat.id.toString(),
        type: 'grup',
        display_name: chat.title,
        username: chat.username || null,
        source: 'bot',
        bot_can_send: 1,
      });
    }
  });

  bot.on('polling_error', (err) => console.error('Bot polling error:', err.message));

  return bot;
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
