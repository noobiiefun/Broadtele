const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('broadtele', {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    save: (payload) => ipcRenderer.invoke('config:save', payload),
  },
  targets: {
    list: (type) => ipcRenderer.invoke('targets:list', type),
    setFlag: (id, field, value) => ipcRenderer.invoke('targets:setFlag', { id, field, value }),
    delete: (id) => ipcRenderer.invoke('targets:delete', id),
    syncUserbotDialogs: () => ipcRenderer.invoke('targets:syncUserbotDialogs'),
    syncBotMembership: () => ipcRenderer.invoke('targets:syncBotMembership'),
  },
  jobs: {
    create: (payload) => ipcRenderer.invoke('jobs:create', payload),
    run: (jobId) => ipcRenderer.invoke('jobs:run', jobId),
    pause: (jobId) => ipcRenderer.invoke('jobs:pause', jobId),
    stop: (jobId) => ipcRenderer.invoke('jobs:stop', jobId),
    list: (limit) => ipcRenderer.invoke('jobs:list', limit),
    details: (jobId) => ipcRenderer.invoke('jobs:details', jobId),
    duplicate: (sourceJobId, targetIds) => ipcRenderer.invoke('jobs:duplicate', { sourceJobId, targetIds }),
    onProgress: (cb) => ipcRenderer.on('jobs:progress', (_e, data) => cb(data)),
  },
  userbot: {
    login: () => ipcRenderer.invoke('userbot:login'),
    logout: () => ipcRenderer.invoke('userbot:logout'),
    status: () => ipcRenderer.invoke('userbot:status'),
    onStatusUpdate: (cb) => ipcRenderer.on('userbot:statusUpdate', (_e, data) => cb(data)),
    onPrompt: (cb) => ipcRenderer.on('userbot:prompt', (_e, data) => cb(data)),
    respondPrompt: (requestId, value) => ipcRenderer.send(`userbot:promptResponse:${requestId}`, value),
  },
});
