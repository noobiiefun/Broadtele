const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('broadtele', {
  targets: {
    list: (type) => ipcRenderer.invoke('targets:list', type),
    setFlag: (id, field, value) => ipcRenderer.invoke('targets:setFlag', { id, field, value }),
    syncUserbotDialogs: () => ipcRenderer.invoke('targets:syncUserbotDialogs'),
  },
  jobs: {
    create: (payload) => ipcRenderer.invoke('jobs:create', payload),
    run: (jobId) => ipcRenderer.invoke('jobs:run', jobId),
    pause: (jobId) => ipcRenderer.invoke('jobs:pause', jobId),
    stop: (jobId) => ipcRenderer.invoke('jobs:stop', jobId),
    onProgress: (cb) => ipcRenderer.on('jobs:progress', (_e, data) => cb(data)),
  },
  userbot: {
    login: () => ipcRenderer.invoke('userbot:login'),
    logout: () => ipcRenderer.invoke('userbot:logout'),
    status: () => ipcRenderer.invoke('userbot:status'),
    onPrompt: (cb) => ipcRenderer.on('userbot:prompt', (_e, data) => cb(data)),
    respondPrompt: (requestId, value) => ipcRenderer.send(`userbot:promptResponse:${requestId}`, value),
  },
});
