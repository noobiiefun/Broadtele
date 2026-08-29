require('dotenv').config();
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const dbLayer = require('./db/db');
const userbot = require('./telegram/userbot');
const botApi = require('./telegram/bot');
const queue = require('./broadcast/queue');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
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

  // Userbot: kalau sudah ada session string tersimpan, connect otomatis.
  // Kalau belum, biarkan UI yang memicu login lewat IPC 'userbot:login'.
  if (process.env.TG_SESSION_STRING) {
    await userbot.initUserbot(process.env.TG_SESSION_STRING);
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
  });
  return { started: true };
});

ipcMain.handle('jobs:pause', (_e, jobId) => queue.pauseJob(jobId));
ipcMain.handle('jobs:stop', (_e, jobId) => queue.stopJob(jobId));

// ---- IPC: Userbot login (dipanggil dari UI kalau belum ada session) ----
ipcMain.handle('userbot:login', async () => {
  // NOTE: alur input.text() di userbot.js saat ini masih CLI-style (untuk dev).
  // Untuk produksi, ganti prompt di userbot.js dengan dialog IPC ke renderer
  // (kirim event ke UI utk minta nomor HP/OTP, lalu resolve promise saat user submit).
  await userbot.initUserbot('');
  return { ok: true };
});
