/**
 * api.js — thin, typed wrapper around the Electron preload bridge.
 *
 * Every call returns a plain value. If the main process reported an error the
 * wrapper throws an Error whose message is safe to show in a toast.
 */

const bridge = typeof window !== 'undefined' ? window.endoreport : null

export const isDesktop = !!bridge

function unwrap(value, context) {
  if (value && typeof value === 'object' && '__error' in value) {
    throw new Error(value.__error || `Unexpected failure in ${context}`)
  }
  return value
}

function guard(fn, context) {
  return async (...args) => {
    if (!fn) throw new Error(`${context} is only available inside the EndoReport desktop app.`)
    return unwrap(await fn(...args), context)
  }
}

export const api = {
  app: {
    info: guard(bridge?.app?.info, 'app.info'),
    openDataDir: guard(bridge?.app?.openDataDir, 'app.openDataDir'),
    openPath: guard(bridge?.app?.openPath, 'app.openPath'),
    revealPath: guard(bridge?.app?.revealPath, 'app.revealPath'),
    chooseDirectory: guard(bridge?.app?.chooseDirectory, 'app.chooseDirectory'),
    readFileAsDataUrl: guard(bridge?.app?.readFileAsDataUrl, 'app.readFileAsDataUrl'),
    copyText: guard(bridge?.app?.saveClipboardText, 'app.copyText'),
    captureEngine: guard(bridge?.app?.captureEngine, 'app.captureEngine'),
    setCaptureEngine: guard(bridge?.app?.setCaptureEngine, 'app.setCaptureEngine'),
    relaunch: guard(bridge?.app?.relaunch, 'app.relaunch'),
    onMenu: (handler) => (bridge?.system?.onMenu ? bridge.system.onMenu(handler) : () => {}),
  },
  patients: {
    list: guard(bridge?.patients?.list, 'patients.list'),
    get: guard(bridge?.patients?.get, 'patients.get'),
    save: guard(bridge?.patients?.save, 'patients.save'),
    update: guard(bridge?.patients?.save, 'patients.update'),
    remove: guard(bridge?.patients?.remove, 'patients.remove'),
    nextRegNo: guard(bridge?.patients?.nextRegNo, 'patients.nextRegNo'),
    referrers: guard(bridge?.patients?.referrers, 'patients.referrers'),
    fieldHistory: guard(bridge?.patients?.fieldHistory, 'patients.fieldHistory'),
  },
  procedures: {
    list: guard(bridge?.procedures?.list, 'procedures.list'),
    get: guard(bridge?.procedures?.get, 'procedures.get'),
    save: guard(bridge?.procedures?.save, 'procedures.save'),
    remove: guard(bridge?.procedures?.remove, 'procedures.remove'),
    labels: guard(bridge?.procedures?.labels, 'procedures.labels'),
  },
  media: {
    list: guard(bridge?.media?.list, 'media.list'),
    addImage: guard(bridge?.media?.addImage, 'media.addImage'),
    addVideo: guard(bridge?.media?.addVideo, 'media.addVideo'),
    thumbnail: guard(bridge?.media?.thumbnail, 'media.thumbnail'),
    sourceSize: guard(bridge?.media?.sourceSize, 'media.sourceSize'),
    update: guard(bridge?.media?.update, 'media.update'),
    annotate: guard(bridge?.media?.annotate, 'media.annotate'),
    remove: guard(bridge?.media?.remove, 'media.remove'),
    import: guard(bridge?.media?.import, 'media.import'),
  },
  doctors: {
    list: guard(bridge?.doctors?.list, 'doctors.list'),
    save: guard(bridge?.doctors?.save, 'doctors.save'),
    remove: guard(bridge?.doctors?.remove, 'doctors.remove'),
    setSeal: guard(bridge?.doctors?.setSeal, 'doctors.setSeal'),
    sealDataUrl: guard(bridge?.doctors?.sealDataUrl, 'doctors.sealDataUrl'),
  },
  templates: {
    list: guard(bridge?.templates?.list, 'templates.list'),
    save: guard(bridge?.templates?.save, 'templates.save'),
    remove: guard(bridge?.templates?.remove, 'templates.remove'),
    importDocx: guard(bridge?.templates?.importDocx, 'templates.importDocx'),
  },
  docx: {
    pickHtml: guard(bridge?.docx?.pickHtml, 'docx.pickHtml'),
  },
  settings: {
    get: guard(bridge?.settings?.get, 'settings.get'),
    set: guard(bridge?.settings?.set, 'settings.set'),
  },
  data: {
    stats: guard(bridge?.data?.stats, 'data.stats'),
    maintenance: guard(bridge?.data?.maintenance, 'data.maintenance'),
    counts: guard(bridge?.data?.counts, 'data.counts'),
    backup: guard(bridge?.data?.backup, 'data.backup'),
    restore: guard(bridge?.data?.restore, 'data.restore'),
    exportJson: guard(bridge?.data?.exportJson, 'data.exportJson'),
    importJson: guard(bridge?.data?.importJson, 'data.importJson'),
  },
  report: {
    exportDocx: guard(bridge?.report?.exportDocx, 'report.exportDocx'),
    exportBatch: guard(bridge?.report?.exportBatch, 'report.exportBatch'),
    print: guard(bridge?.report?.print, 'report.print'),
    printers: guard(bridge?.report?.printers, 'report.printers'),
    printSilent: guard(bridge?.report?.printSilent, 'report.printSilent'),
    savePdf: guard(bridge?.report?.savePdf, 'report.savePdf'),
  },
  ai: {
    status: guard(bridge?.ai?.status, 'ai.status'),
    analyseImage: guard(bridge?.ai?.analyseImage, 'ai.analyseImage'),
  },
  updates: {
    check: guard(bridge?.updates?.check, 'updates.check'),
    download: guard(bridge?.updates?.download, 'updates.download'),
    run: guard(bridge?.updates?.run, 'updates.run'),
    releasePage: guard(bridge?.updates?.releasePage, 'updates.releasePage'),
    onProgress: (handler) => (bridge?.updates?.onProgress ? bridge.updates.onProgress(handler) : () => {}),
    onAvailable: (handler) => (bridge?.updates?.onAvailable ? bridge.updates.onAvailable(handler) : () => {}),
  },
  lifecycle: {
    info: guard(bridge?.lifecycle?.info, 'lifecycle.info'),
    openUpgradeLog: guard(bridge?.lifecycle?.openUpgradeLog, 'lifecycle.openUpgradeLog'),
    openBackup: guard(bridge?.lifecycle?.openBackup, 'lifecycle.openBackup'),
  },
}

/* -------------------------------------------------------------------------- */
/* Media helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Which file to draw: the annotated composite when the frame carries markers,
 * otherwise the untouched capture.
 */
export function mediaPathOf(item) {
  return item?.markedPath || item?.filePath || ''
}

/** Converts a file:// path stored in the database into an <img src>. */
export async function mediaSrc(filePath) {
  if (!filePath) return ''
  try {
    const { dataUrl } = await api.app.readFileAsDataUrl(filePath)
    return dataUrl
  } catch {
    return ''
  }
}

export function newUid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `uid-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
