const TelegramBot = require('node-telegram-bot-api');

/**
 * MANAJEMEN BANYAK BOT (Bot API).
 *
 * Setiap bot = satu baris di tabel `bot_tokens` + satu instance TelegramBot di Map ini.
 * - Bot dengan flag `polling=1` menjalankan polling untuk DETEKSI otomatis:
 *   grup tempat bot berada -> tabel targets, orang yang DM -> bot_contacts.
 *   (Hanya boleh ada SATU polling per token — Telegram menolak polling ganda.)
 * - Bot TANPA polling tetap bisa dipakai MENGIRIM ke grup/japri mana pun selama
 *   sudah di-invite ke grup / sudah pernah di-chat usernya — tidak perlu polling.
 */

/** botTokenId(number) -> { bot, label } */
const instances = new Map();

// Batch write ke SQLite: event message bisa datang beruntun dalam jumlah besar.
const pendingEvents = [];
let flushTimer = null;
let dbLayer = null;

function initDependencies({ dbLayer: layer }) {
  dbLayer = layer;
}

function flushEvents() {
  flushTimer = null;
  if (!pendingEvents.length || !dbLayer) return;
  const events = pendingEvents.splice(0, pendingEvents.length);
  try {
    dbLayer.db.transaction(() => {
      for (const ev of events) {
        if (ev.kind === 'private') {
          dbLayer.upsertBotContact({ chat_id: ev.chat_id, username: ev.username, first_name: ev.first_name, botTokenId: ev.botId });
        } else {
          dbLayer.upsertTarget({
            chat_id: ev.chat_id, type: 'grup', display_name: ev.title,
            username: ev.username, source: 'bot', bot_can_send: 1, botTokenId: ev.botId,
          });
        }
      }
    })();
  } catch (err) {
    console.error('Gagal menyimpan event bot:', err.message);
  }
}

/**
 * Mulai satu bot dari data baris bot_tokens.
 * options.validate=true -> panggil getMe() dulu (throw kalau token salah).
 */
async function startBot(botRow, { validate = true } = {}) {
  stopBot(botRow.id); // hindari dua instance untuk id yang sama

  const bot = new TelegramBot(botRow.token, { polling: !!botRow.polling });
  const myToken = botRow.token;

  if (validate) {
    try {
      const me = await bot.getMe();
      if (dbLayer && botRow.id) dbLayer.updateBotToken(botRow.id, { bot_username: me.username });
    } catch (err) {
      try { bot.stopPolling().catch(() => {}); } catch { /* abaikan */ }
      throw new Error(`Token bot "${botRow.label}" tidak valid: ${err.message}`);
    }
  }

  if (botRow.polling) {
    bot.on('message', (msg) => {
      const chat = msg.chat;
      if (chat.type === 'private') {
        pendingEvents.push({
          kind: 'private', botId: botRow.id,
          chat_id: chat.id.toString(),
          username: chat.username || null,
          first_name: chat.first_name || chat.username || 'Tanpa nama',
        });
      } else if (chat.type === 'group' || chat.type === 'supergroup') {
        pendingEvents.push({
          kind: 'group', botId: botRow.id,
          chat_id: chat.id.toString(),
          title: chat.title,
          username: chat.username || null,
        });
      } else {
        return;
      }
      if (!flushTimer) flushTimer = setTimeout(flushEvents, 2000);
    });

    bot.on('polling_error', (err) => {
      if (instances.get(botRow.id)?.bot !== bot) return; // error dari instance lama, abaikan
      console.error(`Bot polling error (${botRow.label}):`, err.message);
    });
  }

  instances.set(Number(botRow.id), { bot, label: botRow.label });
  return bot;
}

/** Hentikan satu bot (polling & instance) — tetap bisa dijalankan utk bot non-polling. */
function stopBot(botId) {
  const inst = instances.get(Number(botId));
  if (!inst) return;
  instances.delete(Number(botId));
  if (inst.bot) {
    try { inst.bot.stopPolling().catch(() => {}); } catch { /* abaikan */ }
  }
}

function stopAllBots() {
  for (const id of [...instances.keys()]) stopBot(id);
}

function getBot(botId) {
  const inst = instances.get(Number(botId));
  return inst ? inst.bot : null;
}

function isActive(botId) {
  return instances.has(Number(botId));
}

function activeIds() {
  return [...instances.keys()];
}

/**
 * Kirim pesan lewat bot tertentu. Rate limit resmi ~1 pesan/detik per chat,
 * ~30/detik total — pengaturan delay antar kirim di queue tetap dihormati.
 */
async function sendMessage(botId, chatId, text) {
  const inst = instances.get(Number(botId));
  if (!inst) return { ok: false, error: `Bot #${botId} tidak aktif.` };
  try {
    await inst.bot.sendMessage(chatId, text);
    return { ok: true };
  } catch (err) {
    const retryAfter = err.response?.body?.parameters?.retry_after;
    if (retryAfter) {
      console.warn(`Bot API retry_after ${retryAfter}s untuk chat ${chatId}, menunggu...`);
      await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
      try {
        await inst.bot.sendMessage(chatId, text);
        return { ok: true };
      } catch (err2) {
        return { ok: false, error: err2.message };
      }
    }
    return { ok: false, error: err.message };
  }
}

module.exports = {
  initDependencies, startBot, stopBot, stopAllBots,
  getBot, isActive, activeIds, sendMessage,
};
