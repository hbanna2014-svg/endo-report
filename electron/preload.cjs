/**
 * preload.cjs — the only bridge between the React renderer and the local
 * machine. `contextIsolation` stays on and `nodeIntegration` stays off; the
 * renderer can only call the explicit, validated functions listed below.
 */

const { contextBridge, ipcRenderer } = require('electron')

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)
const on = (channel, handler) => {
  const wrapped = (_event, payload) => handler(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

contextBridge.exposeInMainWorld('endoreport', {
  app: {
    info: () => invoke('app:info'),
    openDataDir: () => invoke('app:openDataDir'),
    openPath: (target) => invoke('app:openPath', target),
    revealPath: (target) => invoke('app:revealPath', target),
    chooseDirectory: () => invoke('app:chooseDirectory'),
    readFileAsDataUrl: (filePath) => invoke('app:readFileAsDataUrl', filePath),
    saveClipboardText: (text) => invoke('app:saveClipboardText', text),
  },

  updates: {
    check: () => invoke('updates:check'),
    download: (asset) => invoke('updates:download', asset),
    run: (filePath) => invoke('updates:run', filePath),
    releasePage: () => invoke('updates:releasePage'),
    onProgress: (handler) => on('updates:progress', handler),
    onAvailable: (handler) => on('app:update-available', handler),
  },

  lifecycle: {
    info: () => invoke('lifecycle:info'),
    openUpgradeLog: () => invoke('lifecycle:openUpgradeLog'),
    openBackup: (folder) => invoke('lifecycle:openBackup', folder),
  },

  patients: {
    list: (search, limit) => invoke('patients:list', search, limit),
    get: (id) => invoke('patients:get', id),
    save: (patient) => invoke('patients:save', patient),
    remove: (id) => invoke('patients:remove', id),
    nextRegNo: () => invoke('patients:nextRegNo'),
  },

  procedures: {
    list: (filters) => invoke('procedures:list', filters),
    get: (id) => invoke('procedures:get', id),
    save: (patientId, payload) => invoke('procedures:save', patientId, payload),
    remove: (id) => invoke('procedures:remove', id),
  },

  media: {
    list: (procedureId) => invoke('media:list', procedureId),
    addImage: (payload) => invoke('media:addImage', payload),
    addVideo: (payload) => invoke('media:addVideo', payload),
    thumbnail: (filePath, id, width) => invoke('media:thumbnail', filePath, id, width),
    sourceSize: (filePath) => invoke('media:sourceSize', filePath),
    update: (id, patch) => invoke('media:update', id, patch),
    remove: (id) => invoke('media:remove', id),
    import: (payload) => invoke('media:import', payload),
  },

  doctors: {
    list: (activeOnly) => invoke('doctors:list', activeOnly),
    save: (doctor) => invoke('doctors:save', doctor),
    remove: (id) => invoke('doctors:remove', id),
  },

  templates: {
    list: () => invoke('templates:list'),
    save: (template) => invoke('templates:save', template),
    remove: (id) => invoke('templates:remove', id),
    importDocx: () => invoke('templates:importDocx'),
  },

  docx: {
    pickHtml: () => invoke('docx:pickHtml'),
  },

  settings: {
    get: (key, fallback) => invoke('settings:get', key, fallback),
    set: (key, value) => invoke('settings:set', key, value),
  },

  data: {
    stats: () => invoke('data:stats'),
    maintenance: (days) => invoke('data:maintenance', days),
    backup: () => invoke('data:backup'),
    restore: () => invoke('data:restore'),
    exportJson: () => invoke('data:exportJson'),
    importJson: () => invoke('data:importJson'),
    exportReportJson: (payload) => invoke('data:exportReportJson', payload),
  },

  report: {
    exportDocx: (model) => invoke('report:exportDocx', model),
    exportBatch: (models) => invoke('report:exportBatch', models),
    print: (html, title, options) => invoke('report:printHtml', html, title, options),
    savePdf: (html, title) => invoke('report:savePdf', html, title),
  },

  ai: {
    status: () => invoke('ai:status'),
    analyseImage: (payload) => invoke('ai:analyseImage', payload),
  },

  system: {
    onMenu: (handler) => on('app:menu', handler),
  },
})
