const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('broadtele', {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    save: (payload) => ipcRenderer.invoke('config:save', payload),
  },
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    add: (label) => ipcRenderer.invoke('accounts:add', label),
    remove: (accountId) => ipcRenderer.invoke('accounts:remove', accountId),
    rename: (payload) => ipcRenderer.invoke('accounts:rename', payload),
    logout: (accountId) => ipcRenderer.invoke('accounts:logout', accountId),
    loginAgain: (accountId) => ipcRenderer.invoke('accounts:loginAgain', accountId),
  },
  bots: {
    list: () => ipcRenderer.invoke('bots:list'),
    add: (payload) => ipcRenderer.invoke('bots:add', payload),
    setPolling: (payload) => ipcRenderer.invoke('bots:setPolling', payload),
    remove: (botId) => ipcRenderer.invoke('bots:remove', botId),
  },
  targets: {
    list: (params) => ipcRenderer.invoke('targets:list', params),
    setFlag: (id, field, value) => ipcRenderer.invoke('targets:setFlag', { id, field, value }),
    delete: (id) => ipcRenderer.invoke('targets:delete', id),
    syncUserbotDialogs: (accountId) => ipcRenderer.invoke('targets:syncUserbotDialogs', accountId),
    syncBotMembership: (botId) => ipcRenderer.invoke('targets:syncBotMembership', botId),
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
  status: {
    getAll: () => ipcRenderer.invoke('status:getAll'),
    onUpdate: (cb) => ipcRenderer.on('status:update', (_e, data) => cb(data)),
    onAccountStatus: (cb) => ipcRenderer.on('userbot:accountStatus', (_e, data) => cb(data)),
  },
  userbot: {
    onPrompt: (cb) => ipcRenderer.on('userbot:prompt', (_e, data) => cb(data)),
    respondPrompt: (requestId, value) => ipcRenderer.send(`userbot:promptResponse:${requestId}`, value),
  },
});
