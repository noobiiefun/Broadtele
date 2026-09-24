const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const dbLayer = require('./db/db');
const userbot = require('./telegram/userbot');
const botApi = require('./telegram/bot');
const queue = require('./broadcast/queue');
const sessionStore = require('./config/sessionStore');
const configStore = require('./config/configStore');

let mainWindow;

// Peer cache per akun — dibuat ulang setiap kali sebuah akun connect,
// dipakai oleh userbot.sendMessage lewat entry instances (lihat userbot.js).
function accountInstanceFactory() {
  return { peerCache: new Map() };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

/** Push status SEMUA akun userbot + semua bot ke UI (realtime, bukan cuma dijawab sekali). */
function pushStatus() {
  const accounts = dbLayer.listAccounts().map((a) => ({
    id: a.id,
    label: a.label,
    phone: a.phone,
    status: userbot.getStatus(a.id),
  }));
  const bots = dbLayer.listBotTokens().map((b) => ({
    id: b.id,
    label: b.label,
    bot_username: b.bot_username,
    polling: !!b.polling,
    active: botApi.isActive(b.id),
  }));
  send('status:update', { accounts, bots });
}

async function connectAccountById(account) {
  const sessionString = sessionStore.loadSession(account.session_key);
  if (!sessionString || !userbot.hasCredentials()) return false;
  try {
    await userbot.connectSaved(account.id, sessionString, { instanceFactory: accountInstanceFactory });
    return true;
  } catch (err) {
    console.error(`Gagal connect akun "${account.label}":`, err.message);
    return false;
  }
}

/** Connect ulang semua akun tersimpan secara paralel. */
async function reconnectAllAccounts() {
  const accounts = dbLayer.listAccounts().filter((a) => a.active);
  await Promise.all(accounts.map(async (acc) => {
    send('userbot:accountStatus', { accountId: acc.id, status: 'connecting' });
    const ok = await connectAccountById(acc);
    send('userbot:accountStatus', { accountId: acc.id, status: ok ? 'connected' : 'disconnected' });
  }));
  pushStatus();
}

async function startBotsFromDb() {
  for (const b of dbLayer.listBotTokens()) {
    if (!b.active) continue;
    try {
      await botApi.startBot(b, { validate: true });
    } catch (err) {
      console.error(err.message); // token mati / revoked — tampilkan nanti via status UI
    }
  }
  pushStatus();
}

app.whenReady().then(() => {
  createWindow();
  botApi.initDependencies({ dbLayer });

  // Job yang statusnya masih 'running'/'paused' dari sesi sebelumnya berarti
  // aplikasinya ditutup/crash di tengah jalan — tandai 'stopped' supaya bisa
  // dilanjutkan (sisa target pending-nya) dari tab Riwayat, bukan nyangkut selamanya.
  const recovered = queue.recoverOrphanedJobs();
  if (recovered.length) console.log(`Job yatim ditemukan & ditandai stopped: ${recovered.join(', ')}`);

  // Tunggu halaman selesai load dulu (listener di renderer sudah siap) baru mulai
  // reconnect di background, supaya event status ini pasti kebaca oleh UI.
  mainWindow.webContents.once('did-finish-load', async () => {
    const config = configStore.loadConfig();
    if (config.apiId && config.apiHash) {
      userbot.setCredentials({ apiId: config.apiId, apiHash: config.apiHash });
    }

    // Migrasi warisan: sesi tunggal lama -> "Akun 1", klaim target tanpa pemilik.
    const legacy = sessionStore.loadLegacySession();
    if (legacy && userbot.hasCredentials()) {
      const acc = dbLayer.migrateLegacySingleSession({
        legacySessionString: legacy,
        createAccount: (fields) => dbLayer.createAccount(fields),
      });
      if (acc) {
        sessionStore.saveSession(acc.session_key, legacy);
        sessionStore.clearLegacySession();
        console.log(`Sesi lama dimigrasikan menjadi "${acc.label}" (#${acc.id})`);
      }
    }
    // Sesi lama tapi DB belum punya akun & kredensial belum ada -> biarkan,
    // akan dimigrasikan setelah API ID/Hash diisi (lihat config:save).

    await Promise.all([reconnectAllAccounts(), startBotsFromDb()]);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: Pengaturan (API ID / API Hash bersama untuk semua akun) ----
ipcMain.handle('config:get', () => {
  const c = configStore.loadConfig();
  return { apiId: c.apiId || '', apiHash: c.apiHash || '' };
});

ipcMain.handle('config:save', async (_e, { apiId, apiHash }) => {
  configStore.saveConfig({ apiId, apiHash });
  if (apiId && apiHash) {
    userbot.setCredentials({ apiId, apiHash });

    // kesempatan migrasi sesi lama kalau kredensial baru saja diisi
    const legacy = sessionStore.loadLegacySession();
    if (legacy && dbLayer.listAccounts().length === 0) {
      const acc = dbLayer.migrateLegacySingleSession({
        legacySessionString: legacy,
        createAccount: (fields) => dbLayer.createAccount(fields),
      });
      if (acc) {
        sessionStore.saveSession(acc.session_key, legacy);
        sessionStore.clearLegacySession();
      }
    }
    await reconnectAllAccounts();
  }
  pushStatus();
  return { ok: true };
});

// ---- IPC: Multi-akun userbot ----
ipcMain.handle('accounts:list', () => {
  const accounts = dbLayer.listAccounts().map((a) => ({ ...a, status: userbot.getStatus(a.id) }));
  return accounts;
});

ipcMain.handle('accounts:add', async (_e, { label }) => {
  if (!userbot.hasCredentials()) throw new Error('Isi API ID dan API Hash di tab Pengaturan dulu.');
  if (!label || !label.trim()) throw new Error('Nama panggilan akun wajib diisi.');
  const result = await userbot.loginNew({
    prompts: {
      phoneNumber: () => promptRenderer('phoneNumber', 'Nomor HP akun baru (contoh: +6281234567890)'),
      password: () => promptRenderer('password', 'Password 2FA (kosongkan jika tidak punya)'),
      phoneCode: () => promptRenderer('phoneCode', 'Kode OTP dari Telegram'),
    },
  });
  const acc = dbLayer.createAccount({ label: label.trim(), phone: result.phone });
  sessionStore.saveSession(acc.session_key, result.sessionString);
  await connectAccountById(acc);
  pushStatus();
  return acc;
});

ipcMain.handle('accounts:remove', async (_e, accountId) => {
  await userbot.disconnectAccount(accountId);
  const acc = dbLayer.getAccount(accountId);
  if (acc) sessionStore.clearSession(acc.session_key);
  dbLayer.deleteAccount(accountId);
  pushStatus();
  return { ok: true };
});

ipcMain.handle('accounts:rename', (_e, { accountId, label }) => {
  dbLayer.renameAccount(accountId, label);
  pushStatus();
  return { ok: true };
});

ipcMain.handle('accounts:logout', async (_e, accountId) => {
  await userbot.disconnectAccount(accountId);
  const acc = dbLayer.getAccount(accountId);
  if (acc) sessionStore.clearSession(acc.session_key);
  pushStatus();
  return { ok: true };
});

ipcMain.handle('accounts:loginAgain', async (_e, accountId) => {
  if (!userbot.hasCredentials()) throw new Error('Isi API ID dan API Hash di tab Pengaturan dulu.');
  const acc = dbLayer.getAccount(accountId);
  if (!acc) throw new Error('Akun tidak ditemukan.');
  send('userbot:accountStatus', { accountId, status: 'connecting' });
  try {
    const result = await userbot.loginNew({
      phoneNumber: acc.phone,
      prompts: {
        phoneNumber: () => promptRenderer('phoneNumber', `Nomor HP untuk akun "${acc.label}"`),
        password: () => promptRenderer('password', 'Password 2FA (kosongkan jika tidak punya)'),
        phoneCode: () => promptRenderer('phoneCode', 'Kode OTP dari Telegram'),
      },
    });
    sessionStore.saveSession(acc.session_key, result.sessionString);
    await connectAccountById(acc);
    send('userbot:accountStatus', { accountId, status: 'connected' });
    pushStatus();
    return { ok: true };
  } catch (err) {
    send('userbot:accountStatus', { accountId, status: 'disconnected' });
    throw err;
  }
});

// ---- IPC: Multi-bot ----
ipcMain.handle('bots:list', () => dbLayer.listBotTokens().map((b) => ({
  ...b,
  token: `${String(b.token).slice(0, 8)}…`, // jangan kirim token penuh ke renderer
  active: botApi.isActive(b.id),
})));

ipcMain.handle('bots:add', async (_e, { label, token, polling }) => {
  if (!label || !label.trim()) throw new Error('Nama panggilan bot wajib diisi.');
  if (!token || !/^\d+:[\w-]+$/.test(token.trim())) throw new Error('Format token bot tidak valid (contoh: 123456:ABC-DEF...).');
  const existing = dbLayer.getBotTokenByValue(token.trim());
  if (existing) throw new Error(`Token ini sudah terdaftar sebagai bot "${existing.label}".`);
  const row = dbLayer.createBotToken({ label: label.trim(), token: token.trim(), polling: polling ? 1 : 0 });
  try {
    await botApi.startBot(row, { validate: true });
  } catch (err) {
    dbLayer.deleteBotToken(row.id);
    throw err;
  }
  pushStatus();
  return { ok: true, id: row.id };
});

ipcMain.handle('bots:setPolling', async (_e, { botId, polling }) => {
  dbLayer.updateBotToken(botId, { polling: polling ? 1 : 0 });
  const row = dbLayer.getBotToken(botId);
  if (row && row.active) await botApi.startBot(row, { validate: false });
  pushStatus();
  return { ok: true };
});

ipcMain.handle('bots:remove', async (_e, botId) => {
  botApi.stopBot(botId);
  dbLayer.deleteBotToken(botId);
  pushStatus();
  return { ok: true };
});

// ---- IPC: Targets ----
ipcMain.handle('targets:list', (_e, { type, accountId } = {}) => dbLayer.listTargets(type, accountId ?? null));
ipcMain.handle('targets:setFlag', (_e, { id, field, value }) => dbLayer.setTargetFlag(id, field, value));

ipcMain.handle('targets:syncUserbotDialogs', async (_e, accountId) => {
  if (!accountId) throw new Error('Pilih akun dulu untuk sync.');
  if (!userbot.isConnected(accountId)) {
    throw new Error('Akun userbot tersebut belum terhubung. Login / sambungkan ulang dulu.');
  }
  const dialogs = await userbot.listDialogs(accountId);
  dialogs
    .filter((d) => d.isGroup || d.isChannel || d.isUser)
    .forEach((d) => dbLayer.upsertTarget({
      chat_id: d.chat_id,
      type: d.type,
      display_name: d.display_name,
      username: d.username,
      source: 'personal',
      account_id: accountId,
    }));
  return dbLayer.listTargets();
});

// ---- IPC: Jobs ----
ipcMain.handle('jobs:create', (_e, payload) => dbLayer.createJob(payload));

ipcMain.handle('jobs:run', (_e, jobId) => {
  queue.runJob(jobId, {
    onProgress: (progress) => send('jobs:progress', progress),
  }).catch((err) => {
    send('jobs:progress', { jobId, ok: false, error: `Job gagal: ${err.message}`, fatal: true });
  });
  return { started: true };
});

ipcMain.handle('jobs:pause', (_e, jobId) => queue.pauseJob(jobId));
ipcMain.handle('jobs:stop', (_e, jobId) => queue.stopJob(jobId));
ipcMain.handle('jobs:list', (_e, limit) => dbLayer.listJobs(limit || 50));
ipcMain.handle('jobs:details', (_e, jobId) => dbLayer.getJobDetails(jobId));
ipcMain.handle('jobs:duplicate', (_e, { sourceJobId, targetIds }) => dbLayer.duplicateJobWithTargets(sourceJobId, targetIds));

// ---- IPC: Target — hapus & sinkron massal keanggotaan BOT PER BOT ----
ipcMain.handle('targets:delete', (_e, id) => {
  dbLayer.deleteTarget(id);
  return { ok: true };
});

/**
 * Sinkronkan bukti "bot X bisa kirim" utk satu bot terpilih ke SEMUA grup aktif:
 * kalau getChatMemberCount sukses, bot ada di grup itu → catat di can_send_bots.
 */
ipcMain.handle('targets:syncBotMembership', async (_e, botId) => {
  const b = botApi.getBot(botId);
  if (!b) throw new Error('Bot tersebut tidak aktif. Tambahkan/jalankan bot di tab Akun & Bot dulu.');
  const groups = dbLayer.db.prepare(`SELECT * FROM targets WHERE type = 'grup' AND active = 1`).all();
  let updated = 0;
  for (const g of groups) {
    try {
      await b.getChatMemberCount(g.chat_id);
      dbLayer.setTargetBotPermission(g.id, botId, true);
      updated += 1;
    } catch {
      // bot tidak ada di grup itu / tidak bisa akses — biarkan apa adanya
    }
    // Hormati rate limit Bot API (~30 request/detik global)
    await new Promise((r) => setTimeout(r, 60));
  }
  return { checked: groups.length, updated };
});

// ---- IPC: prompt login (dialog ditampilkan di UI, bukan terminal) ----

/**
 * Minta input dari user lewat modal di renderer. Kalau user klik "Batal" di modal,
 * renderer mengirim balik { __cancelled: true } lewat channel yang sama — di sini
 * itu diterjemahkan jadi REJECT, supaya client.start() di GramJS langsung berhenti
 * dengan error alih-alih nyangkut nunggu input yang tidak akan datang.
 */
function promptRenderer(type, label) {
  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = setTimeout(() => reject(new Error(`Timeout menunggu input: ${label}`)), 5 * 60 * 1000);
    ipcMain.once(`userbot:promptResponse:${requestId}`, (_e, value) => {
      clearTimeout(timeout);
      if (value && value.__cancelled) {
        reject(new Error('Login dibatalkan.'));
        return;
      }
      resolve(value);
    });
    send('userbot:prompt', { requestId, type, label });
  });
}

// Status gabungan sekali-query (dipanggil renderer saat halaman pertama dibuka)
ipcMain.handle('status:getAll', () => {
  const accounts = dbLayer.listAccounts().map((a) => ({
    id: a.id, label: a.label, phone: a.phone, status: userbot.getStatus(a.id),
  }));
  const bots = dbLayer.listBotTokens().map((b) => ({
    id: b.id, label: b.label, bot_username: b.bot_username, polling: !!b.polling, active: botApi.isActive(b.id),
  }));
  return { accounts, bots };
});
