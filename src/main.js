const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const dbLayer = require('./db/db');
const userbot = require('./telegram/userbot');
const botApi = require('./telegram/bot');
const queue = require('./broadcast/queue');
const sessionStore = require('./config/sessionStore');
const configStore = require('./config/configStore');

let mainWindow;

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

/**
 * Kirim status userbot ke UI secara aktif (push), bukan cuma dijawab pas ditanya.
 * status: 'connecting' | 'connected' | 'disconnected'
 * Ini yang memperbaiki bug "sesi kelihatan putus padahal masih proses nyambung" —
 * sebelumnya UI cuma nanya status SEKALI pas halaman baru dibuka, padahal proses
 * reconnect ke Telegram di background belum tentu selesai secepat itu.
 */
function pushStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('userbot:statusUpdate', { status, botActive: botApi.isActive() });
  }
}

async function reconnectSavedSession() {
  const config = configStore.loadConfig();
  if (config.apiId && config.apiHash) {
    userbot.setCredentials({ apiId: config.apiId, apiHash: config.apiHash });
  }
  if (config.botToken) {
    botApi.initBot(config.botToken);
  }

  const savedSession = sessionStore.loadSession();
  if (savedSession && userbot.hasCredentials()) {
    pushStatus('connecting');
    try {
      await userbot.initUserbot(savedSession);
      pushStatus('connected');
    } catch (err) {
      console.error('Gagal connect userbot dari session tersimpan:', err.message);
      pushStatus('disconnected');
    }
  } else {
    pushStatus('disconnected');
  }
}

app.whenReady().then(() => {
  createWindow();

  // Tunggu halaman selesai load dulu (listener di renderer sudah siap) baru mulai
  // reconnect di background, supaya event status ini pasti kebaca oleh UI.
  mainWindow.webContents.once('did-finish-load', () => {
    reconnectSavedSession();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: Pengaturan (API ID / API Hash / Bot Token) ----
ipcMain.handle('config:get', () => {
  const c = configStore.loadConfig();
  return {
    apiId: c.apiId || '',
    apiHash: c.apiHash || '',
    botToken: c.botToken || '',
  };
});

ipcMain.handle('config:save', async (_e, { apiId, apiHash, botToken }) => {
  configStore.saveConfig({ apiId, apiHash, botToken });

  if (apiId && apiHash) {
    userbot.setCredentials({ apiId, apiHash });
  }

  if (botToken) {
    try {
      botApi.initBot(botToken);
    } catch (err) {
      throw new Error(`Bot token tidak valid: ${err.message}`);
    }
  } else {
    botApi.stopBot();
  }

  pushStatus(userbot.isConnected() ? 'connected' : 'disconnected');
  return { ok: true };
});

// ---- IPC: Targets ----
ipcMain.handle('targets:list', (_e, type) => dbLayer.listTargets(type));
ipcMain.handle('targets:setFlag', (_e, { id, field, value }) => dbLayer.setTargetFlag(id, field, value));

ipcMain.handle('targets:syncUserbotDialogs', async () => {
  if (!userbot.isConnected()) {
    throw new Error('Userbot belum login. Login dulu lewat tombol "Login Userbot".');
  }
  const dialogs = await userbot.listDialogs();
  dialogs
    .filter((d) => d.isGroup || d.isChannel || d.isUser)
    .forEach((d) => dbLayer.upsertTarget({
      chat_id: d.chat_id,
      type: d.type,
      display_name: d.display_name,
      username: d.username,
      source: 'personal',
    }));
  return dbLayer.listTargets();
});

// ---- IPC: Jobs ----
ipcMain.handle('jobs:create', (_e, payload) => dbLayer.createJob(payload));

ipcMain.handle('jobs:run', (_e, jobId) => {
  queue.runJob(jobId, {
    onProgress: (progress) => mainWindow.webContents.send('jobs:progress', progress),
  }).catch((err) => {
    mainWindow.webContents.send('jobs:progress', { jobId, ok: false, error: `Job gagal: ${err.message}`, fatal: true });
  });
  return { started: true };
});

ipcMain.handle('jobs:pause', (_e, jobId) => queue.pauseJob(jobId));
ipcMain.handle('jobs:stop', (_e, jobId) => queue.stopJob(jobId));

// ---- IPC: Userbot login (dialog ditampilkan di UI, bukan terminal) ----

/**
 * Minta input dari user lewat modal di renderer. Kalau user klik "Batal" di modal,
 * renderer mengirim balik { __cancelled: true } lewat channel yang sama — di sini
 * itu diterjemahkan jadi REJECT (bukan resolve), supaya client.start() di GramJS
 * langsung berhenti dengan error alih-alih nyangkut nunggu input yang tidak akan datang.
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
    mainWindow.webContents.send('userbot:prompt', { requestId, type, label });
  });
}

ipcMain.handle('userbot:login', async () => {
  if (userbot.isConnected()) {
    throw new Error('Userbot sudah terhubung. Klik "Hapus Sesi" dulu kalau mau login dengan akun lain.');
  }
  if (!userbot.hasCredentials()) {
    throw new Error('Isi API ID dan API Hash di tab Pengaturan dulu.');
  }
  pushStatus('connecting');
  try {
    await userbot.initUserbot('', {
      phoneNumber: () => promptRenderer('phoneNumber', 'Nomor HP (contoh: +6281234567890)'),
      password: () => promptRenderer('password', 'Password 2FA (kosongkan jika tidak punya)'),
      phoneCode: () => promptRenderer('phoneCode', 'Kode OTP dari Telegram'),
    });
    sessionStore.saveSession(userbot.getSessionString());
    pushStatus('connected');
    return { ok: true };
  } catch (err) {
    pushStatus('disconnected');
    throw err;
  }
});

ipcMain.handle('userbot:status', () => ({
  connected: userbot.isConnected(),
  botActive: botApi.isActive(),
}));

ipcMain.handle('userbot:logout', () => {
  sessionStore.clearSession();
  pushStatus('disconnected');
  return { ok: true };
});
