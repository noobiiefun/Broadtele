require('dotenv').config();
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const dbLayer = require('./db/db');
const userbot = require('./telegram/userbot');
const botApi = require('./telegram/bot');
const queue = require('./broadcast/queue');
const sessionStore = require('./config/sessionStore');

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

app.whenReady().then(async () => {
  createWindow();

  // Bot API bisa langsung jalan kalau token sudah ada di .env
  if (process.env.TG_BOT_TOKEN) {
    botApi.initBot(process.env.TG_BOT_TOKEN);
  }

  // Userbot: kalau ada session tersimpan (file lokal atau .env lama), connect otomatis tanpa prompt.
  const savedSession = sessionStore.loadSession() || process.env.TG_SESSION_STRING || '';
  if (savedSession) {
    try {
      await userbot.initUserbot(savedSession);
    } catch (err) {
      console.error('Gagal connect userbot dari session tersimpan:', err.message);
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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
function promptRenderer(type, label) {
  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = setTimeout(() => reject(new Error(`Timeout menunggu input: ${label}`)), 5 * 60 * 1000);
    ipcMain.once(`userbot:promptResponse:${requestId}`, (_e, value) => {
      clearTimeout(timeout);
      resolve(value);
    });
    mainWindow.webContents.send('userbot:prompt', { requestId, type, label });
  });
}

ipcMain.handle('userbot:login', async () => {
  await userbot.initUserbot('', {
    phoneNumber: () => promptRenderer('phoneNumber', 'Nomor HP (contoh: +6281234567890)'),
    password: () => promptRenderer('password', 'Password 2FA (kosongkan jika tidak punya)'),
    phoneCode: () => promptRenderer('phoneCode', 'Kode OTP dari Telegram'),
  });
  sessionStore.saveSession(userbot.getSessionString());
  return { ok: true };
});

ipcMain.handle('userbot:status', () => ({ connected: userbot.isConnected() }));

ipcMain.handle('userbot:logout', () => {
  sessionStore.clearSession();
  return { ok: true };
});
