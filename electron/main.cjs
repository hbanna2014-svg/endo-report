/**
 * main.cjs — EndoReport desktop application entry point.
 *
 * Responsibilities:
 *   • create the single application window
 *   • own the local database and the patient media folder
 *   • expose a narrow, validated IPC surface (see preload.cjs)
 *   • print reports and export Microsoft Word / PDF files entirely offline
 *   • back up and restore the whole clinic dataset
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, safeStorage, clipboard } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')

const db = require('./db.cjs')
const docx = require('./docx.cjs')
const docxTemplate = require('./docxTemplate.cjs')
const { convertDocxBuffer } = require('./docxToHtml.cjs')
const thumbs = require('./thumbs.cjs')
const lifecycle = require('./lifecycle.cjs')
const updater = require('./updater.cjs')

const isDev = process.env.ENDOREPORT_DEV === '1'
const DEV_URL = 'http://127.0.0.1:5178'

let mainWindow = null
let dataDir = null
let dbReady = null
let startupReport = null
const APP_VERSION = require('../package.json').version
const PKG = require('../package.json')

/** GitHub repository used for update checks and release downloads. */
function updateRepo() {
  const pub = Array.isArray(PKG.build?.publish) ? PKG.build.publish[0] : null
  return {
    owner: pub?.owner || 'hbanna2014-svg',
    repo: pub?.repo || 'endo-report',
  }
}

/* -------------------------------------------------------------------------- */
/* Data directory                                                              */
/* -------------------------------------------------------------------------- */

function resolveDataDir() {
  // Portable / test override: ENDOREPORT_DATA_DIR keeps the whole clinic dataset
  // in a folder of your choosing (handy for a USB stick or an automated test).
  const fromEnv = process.env.ENDOREPORT_DATA_DIR
  if (fromEnv) {
    fs.mkdirSync(fromEnv, { recursive: true })
    return fromEnv
  }
  const custom = readDataDirSetting()
  if (custom) {
    try {
      fs.mkdirSync(custom, { recursive: true })
      return custom
    } catch {
      /* fall back to default below */
    }
  }
  const def = path.join(app.getPath('documents'), 'EndoReportData')
  fs.mkdirSync(def, { recursive: true })
  return def
}

function pointerFile() {
  return path.join(app.getPath('userData'), 'data-dir.txt')
}

function readDataDirSetting() {
  try {
    const p = pointerFile()
    if (fs.existsSync(p)) {
      const v = fs.readFileSync(p, 'utf8').trim()
      if (v) return v
    }
  } catch {
    /* ignore */
  }
  return null
}

function writeDataDirSetting(dir) {
  fs.writeFileSync(pointerFile(), dir, 'utf8')
}

/* -------------------------------------------------------------------------- */
/* Window                                                                      */
/* -------------------------------------------------------------------------- */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: '#0f172a',
    title: 'EndoReport — Endoscopy & Colonoscopy Reporting',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  // Headless verification hook: ENDOREPORT_CAPTURE=<file.png> renders the app,
  // writes a screenshot and exits with a diagnostics report. Used by the
  // automated UI check; harmless in normal use because it is opt-in.
  if (process.env.ENDOREPORT_CAPTURE) {
    mainWindow.webContents.once('did-finish-load', async () => {
      const target = process.env.ENDOREPORT_CAPTURE
      const waitMs = Number(process.env.ENDOREPORT_CAPTURE_DELAY || 2600)
      try {
        // Optional interaction script: a JSON array of labels to click in order,
        // so the automated check can reach any screen before capturing.
        if (process.env.ENDOREPORT_CAPTURE_CLICKS) {
          const labels = JSON.parse(process.env.ENDOREPORT_CAPTURE_CLICKS)
          // Let React finish its first render before interacting.
          await new Promise((r) => setTimeout(r, Number(process.env.ENDOREPORT_CAPTURE_SETTLE || 1800)))
          for (const label of labels) {
            let hit = false
            for (let attempt = 0; attempt < 4 && !hit; attempt += 1) {
              // eslint-disable-next-line no-await-in-loop
              hit = await mainWindow.webContents.executeJavaScript(
                `(() => {
                   const want = ${JSON.stringify(label)};
                   const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
                   const nodes = [...document.querySelectorAll('button, .nav-item, tr, .listitem, .sectionitem')];
                   const texts = nodes.map((e) => norm(e.textContent));
                   // 1) exact label  2) label followed only by a counter badge  3) substring
                   let idx = texts.indexOf(want);
                   if (idx < 0) idx = texts.findIndex((t) => new RegExp('^' + want.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + '\\\\s*\\\\d*$').test(t));
                   if (idx < 0) idx = texts.findIndex((t) => t.includes(want));
                   if (idx < 0) return false;
                   nodes[idx].click();
                   return true;
                 })()`,
                true,
              )
              if (!hit) {
                // eslint-disable-next-line no-await-in-loop
                await new Promise((r) => setTimeout(r, 500))
              }
            }
            if (!hit) console.log('[CAPTURE_CLICK_MISS]', label)
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 1100))
          }
        }
        await new Promise((r) => setTimeout(r, waitMs))
        const image = await mainWindow.webContents.capturePage()
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, image.toPNG())
        const probe = await mainWindow.webContents.executeJavaScript(
          `(() => ({
             rootChildren: document.getElementById('root')?.children.length || 0,
             navItems: document.querySelectorAll('.nav-item').length,
             title: document.querySelector('.topbar h2')?.textContent || null,
             bodyText: (document.body.innerText || '').slice(0, 400)
           }))()`,
          true,
        )
        console.log('[CAPTURE]', JSON.stringify({ ok: true, target, probe }))
      } catch (err) {
        console.log('[CAPTURE_ERROR]', err.message)
      }
      app.exit(0)
    })
  }

  if (isDev) {
    mainWindow.loadURL(DEV_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

/* -------------------------------------------------------------------------- */
/* Application menu                                                            */
/* -------------------------------------------------------------------------- */

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New patient…', accelerator: 'CmdOrCtrl+N', click: () => send('app:menu', 'patient:new') },
        { label: 'Patient list', accelerator: 'CmdOrCtrl+P', click: () => send('app:menu', 'nav:patients') },
        { type: 'separator' },
        { label: 'Backup clinic data…', click: () => runBackup().then((r) => send('app:menu', { toast: r })) },
        { label: 'Restore from backup…', click: () => runRestore().then((r) => send('app:menu', { toast: r })) },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Report',
      submenu: [
        { label: 'Save report', accelerator: 'CmdOrCtrl+S', click: () => send('app:menu', 'report:save') },
        { label: 'Print…', accelerator: 'CmdOrCtrl+Shift+P', click: () => send('app:menu', 'report:print') },
        { label: 'Export to Microsoft Word (.docx)', accelerator: 'CmdOrCtrl+E', click: () => send('app:menu', 'report:docx') },
        { label: 'Export to PDF', click: () => send('app:menu', 'report:pdf') },
        { type: 'separator' },
        { label: 'Capture image', accelerator: 'F9', click: () => send('app:menu', 'capture:image') },
        { label: 'Start / stop video recording', accelerator: 'F10', click: () => send('app:menu', 'capture:video') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open data folder',
          click: () => shell.openPath(dataDir),
        },
        {
          label: 'Check for updates…',
          click: async () => {
            const res = await checkForUpdate()
            if (!res.ok) {
              dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: 'Update check',
                message: 'Could not check for updates',
                detail: res.error,
              })
              return
            }
            if (!res.hasUpdate) {
              dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Up to date',
                message: `EndoReport ${APP_VERSION} is the latest version.`,
                detail: 'Your patient data is stored separately from the program and is never affected by an update.',
              })
              return
            }
            send('app:update-available', res)
          },
        },
        { type: 'separator' },
        { label: `Version ${APP_VERSION}`, enabled: false },
        { label: 'Database & update log', click: () => shell.openPath(path.join(dataDir, 'upgrade.log')) },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* -------------------------------------------------------------------------- */
/* Media storage                                                               */
/* -------------------------------------------------------------------------- */

function safeSegment(value, fallback = 'x') {
  const s = String(value || '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60)
  return s || fallback
}

function patientMediaDir(patientId, procedureId) {
  const dir = path.join(dataDir, 'media', safeSegment(patientId, 'patient'), safeSegment(procedureId, 'procedure'))
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function extFor(mime, fallback = 'bin') {
  const map = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'video/webm': 'webm',
    'video/mp4': 'mp4',
    'video/x-matroska': 'mkv',
  }
  return map[mime] || fallback
}

function toBuffer(input) {
  if (!input) return null
  if (Buffer.isBuffer(input)) return input
  if (input instanceof ArrayBuffer) return Buffer.from(new Uint8Array(input))
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  if (typeof input === 'string') {
    const m = /^data:[^;]+;base64,(.*)$/s.exec(input)
    const b64 = m ? m[1] : input
    return Buffer.from(b64, 'base64')
  }
  return null
}

async function writeMediaFile({ patientId, procedureId, kind, buffer, mime }) {
  const dir = patientMediaDir(patientId, procedureId)
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15)
  const ext = extFor(mime, kind === 'video' ? 'webm' : 'png')
  const name = `${stamp}-${crypto.randomBytes(3).toString('hex')}.${ext}`
  const filePath = path.join(dir, name)
  await fsp.writeFile(filePath, buffer)
  return filePath
}

/* -------------------------------------------------------------------------- */
/* Offline report rendering (print + PDF)                                      */
/* -------------------------------------------------------------------------- */

const printWindows = new Set()

async function withPrintWindow(html, title, work) {
  const tmpDir = path.join(app.getPath('temp'), 'endoreport-print')
  fs.mkdirSync(tmpDir, { recursive: true })
  const file = path.join(tmpDir, `report-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.html`)
  fs.writeFileSync(file, html, 'utf8')

  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    title: title || 'Report',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: true },
  })
  printWindows.add(win)
  try {
    await win.loadURL(pathToFileURL(file).href)
    // Give the renderer a moment to lay out embedded images before printing.
    await new Promise((r) => setTimeout(r, 350))
    return await work(win)
  } finally {
    printWindows.delete(win)
    if (!win.isDestroyed()) win.destroy()
    try {
      fs.unlinkSync(file)
    } catch {
      /* ignore */
    }
  }
}

async function printHtml(html, title) {
  return withPrintWindow(html, title, (win) =>
    new Promise((resolve) => {
      win.webContents.print(
        { silent: false, printBackground: true, margins: { marginType: 'default' } },
        (success, failureReason) => resolve({ ok: success, reason: failureReason || null }),
      )
    }),
  )
}

async function savePdf(html, title) {
  const safeName = safeSegment(title || 'EndoReport-report', 'report')
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save report as PDF',
    defaultPath: path.join(app.getPath('documents'), `${safeName}.pdf`),
    filters: [{ name: 'PDF document', extensions: ['pdf'] }],
  })
  if (canceled || !filePath) return { ok: false, cancelled: true }
  const data = await withPrintWindow(html, title, (win) =>
    win.webContents.printToPDF({ printBackground: true, marginsType: 0, pageSize: 'A4' }),
  )
  await fsp.writeFile(filePath, data)
  return { ok: true, filePath }
}

/* -------------------------------------------------------------------------- */
/* Word export                                                                 */
/* -------------------------------------------------------------------------- */

async function exportDocx(model) {
  const base = safeSegment(
    `${(model?.patient?.name || 'patient').replace(/\s+/g, '-')}-${model?.short || 'report'}-${model?.reportNo || ''}`,
    'report',
  )
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export report to Microsoft Word',
    defaultPath: path.join(app.getPath('documents'), `${base}.docx`),
    filters: [{ name: 'Word document', extensions: ['docx'] }],
  })
  if (canceled || !filePath) return { ok: false, cancelled: true }
  return writeDocx(model, filePath)
}

/**
 * Writes a .docx. When the chosen layout carries the clinic's own Word file the
 * report is merged into that package so the hospital letterhead, fonts and page
 * setup survive; otherwise a clean report is generated from the model.
 */
async function writeDocx(model, filePath) {
  const wt = model?.template?.layout?.wordTemplate
  if (wt?.base64) {
    try {
      const images = await collectPlateImages(model)
      const edits = {}
      for (const b of wt.blocks || []) {
        if (b.kind === 'paragraph' && b.pNo && b.text !== b.original) edits[b.pNo] = b.text
      }
      const buf = await docxTemplate.renderDocxTemplate(wt.base64, model, { edits, images })
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, buf)
      return { ok: true, filePath, bytes: buf.length, fromWordTemplate: wt.fileName || true }
    } catch (err) {
      // Never lose the report because a Word file was unusual — fall back and say so.
      const res = await docx.saveDocx(model, filePath)
      return { ok: true, ...res, fromWordTemplate: false, warning: `Word template could not be used (${err.message}). A standard report was written instead.` }
    }
  }
  const res = await docx.saveDocx(model, filePath)
  return { ok: true, ...res }
}

/** Loads the pictures on the plate at their native resolution for embedding. */
async function collectPlateImages(model) {
  const plan = model?.imagePlan
  const byId = new Map((model?.media || []).map((m) => [m.id, m]))
  const slots = plan?.slots?.length
    ? plan.slots.map((s) => (s.media ? byId.get(s.media.id) || s.media : null))
    : (model?.media || []).filter((m) => m.kind === 'image')
  const out = []
  let n = 0
  for (const m of slots) {
    if (!m || !m.filePath) continue
    try {
      // eslint-disable-next-line no-await-in-loop
      const buffer = await fsp.readFile(m.filePath)
      const ext = path.extname(m.filePath).toLowerCase() === '.jpg' || path.extname(m.filePath).toLowerCase() === '.jpeg' ? 'jpg' : 'png'
      n += 1
      out.push({
        relId: `rIdErPlate${n}`,
        docPr: 1000 + n,
        name: `plate-${n}.${ext}`,
        ext,
        buffer,
        caption: `${m.index || n}. ${m.caption || ''}`.trim(),
      })
    } catch {
      /* skip unreadable files */
    }
  }
  return out
}

async function exportBatch(models) {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder for the exported Word reports',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (canceled || !filePaths?.length) return { ok: false, cancelled: true }
  const dir = path.join(filePaths[0], `EndoReport-export-${new Date().toISOString().slice(0, 10)}`)
  fs.mkdirSync(dir, { recursive: true })
  const written = []
  for (const model of models) {
    const base = safeSegment(
      `${(model?.patient?.name || 'patient').replace(/\s+/g, '-')}-${model?.short || 'report'}-${model?.reportNo || ''}`,
      'report',
    )
    const target = path.join(dir, `${base}.docx`)
    // eslint-disable-next-line no-await-in-loop
    await writeDocx(model, target)
    written.push(target)
  }
  return { ok: true, folder: dir, count: written.length }
}

/* -------------------------------------------------------------------------- */
/* Backup / restore                                                            */
/* -------------------------------------------------------------------------- */

async function dumpAll() {
  const patients = await db.listPatients('', 100000)
  const procedures = await db.listProcedures({ limit: 100000 })
  const full = []
  for (const p of procedures) {
    // eslint-disable-next-line no-await-in-loop
    full.push(await db.getProcedure(p.id))
  }
  const doctors = await db.listDoctors(false)
  const templates = await db.listTemplates()
  const settings = {
    clinic: await db.getSetting('clinic', null),
    prefs: await db.getSetting('prefs', null),
  }
  return {
    app: 'EndoReport',
    schema: db.SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    patients,
    procedures: full,
    doctors,
    templates,
    settings,
  }
}

async function runBackup() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose where to store the backup',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (canceled || !filePaths?.length) return { ok: false, cancelled: true }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const target = path.join(filePaths[0], `EndoReport-backup-${stamp}`)
  fs.mkdirSync(target, { recursive: true })

  const dump = await dumpAll()
  fs.writeFileSync(path.join(target, 'data.json'), JSON.stringify(dump, null, 2), 'utf8')

  const mediaSrc = path.join(dataDir, 'media')
  if (fs.existsSync(mediaSrc)) {
    await fsp.cp(mediaSrc, path.join(target, 'media'), { recursive: true })
  }
  return { ok: true, folder: target, patients: dump.patients.length, procedures: dump.procedures.length }
}

async function runRestore() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose the backup folder to restore from',
    properties: ['openDirectory'],
  })
  if (canceled || !filePaths?.length) return { ok: false, cancelled: true }
  const src = filePaths[0]
  const dataFile = path.join(src, 'data.json')
  if (!fs.existsSync(dataFile)) {
    return { ok: false, error: 'The selected folder does not contain data.json — is this really an EndoReport backup?' }
  }
  const confirm = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Erase and restore'],
    defaultId: 0,
    cancelId: 0,
    title: 'Restore backup',
    message: 'This will replace ALL current patients, procedures and images on this computer.',
    detail: `Backup folder:\n${src}\n\nTake a fresh backup first if you are unsure.`,
  })
  if (confirm.response !== 1) return { ok: false, cancelled: true }

  const dump = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
  await db.q('DELETE FROM media')
  await db.q('DELETE FROM procedures')
  await db.q('DELETE FROM patients')

  for (const p of dump.patients || []) {
    // eslint-disable-next-line no-await-in-loop
    await db.savePatient({ ...p, id: p.id })
  }
  for (const proc of dump.procedures || []) {
    // eslint-disable-next-line no-await-in-loop
    await db.saveProcedure(proc.patientId, proc)
  }
  for (const d of dump.doctors || []) {
    // eslint-disable-next-line no-await-in-loop
    await db.saveDoctor(d)
  }
  for (const t of dump.templates || []) {
    // eslint-disable-next-line no-await-in-loop
    await db.saveTemplate(t)
  }
  if (dump.settings?.clinic) await db.setSetting('clinic', dump.settings.clinic)
  if (dump.settings?.prefs) await db.setSetting('prefs', dump.settings.prefs)

  if (fs.existsSync(path.join(src, 'media'))) {
    await fsp.cp(path.join(src, 'media'), path.join(dataDir, 'media'), { recursive: true, force: true })
  }
  return { ok: true, patients: (dump.patients || []).length, procedures: (dump.procedures || []).length }
}

/* -------------------------------------------------------------------------- */
/* Optional AI image analysis                                                  */
/* -------------------------------------------------------------------------- */

const AI_PROMPT = `You are assisting a gastroenterologist reviewing an endoscopic image.
Do not give a diagnosis. List only visual observations that could be relevant, each as a JSON object.
Return STRICT JSON of the shape:
{"observations":[{"findingId":"<one of the ids provided>","label":"...","confidence":0-1,"region":"...","note":"..."}],"quality":"good|fair|poor","summary":"..."}
Only use findingId values from the provided list. If the image is not interpretable, return an empty observations array.`

async function getAiConfig() {
  const cfg = (await db.getSetting('ai', null)) || {}
  let apiKey = ''
  const enc = await db.getSetting('ai.key.enc', null)
  if (enc && safeStorage.isEncryptionAvailable()) {
    try {
      apiKey = safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      apiKey = ''
    }
  }
  return { ...cfg, apiKey }
}

async function aiAnalyseImage({ imageDataUrl, candidateIds, context }) {
  const cfg = await getAiConfig()
  if (!cfg.enabled) return { ok: false, error: 'AI analysis is turned off. Enable it in Settings ▸ AI assist.' }
  if (!cfg.baseUrl || !cfg.apiKey) return { ok: false, error: 'AI analysis needs a base URL and an API key (Settings ▸ AI assist).' }

  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions'
  const body = {
    model: cfg.model || 'gpt-4o-mini',
    temperature: 0.1,
    messages: [
      { role: 'system', content: AI_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Candidate finding IDs for this procedure:\n${(candidateIds || []).join(', ')}\n\nProcedure context: ${context || 'upper GI endoscopy'}\n\nReview the attached image and return the JSON described in the system message.` },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
  }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60000)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `AI request failed (${res.status}). ${text.slice(0, 300)}` }
    }
    const json = await res.json()
    const content = json?.choices?.[0]?.message?.content || ''
    const parsed = extractJson(content)
    if (!parsed) return { ok: false, error: 'The AI response could not be parsed as JSON.', raw: content.slice(0, 800) }
    return { ok: true, result: parsed, model: body.model }
  } catch (err) {
    return { ok: false, error: `AI request error: ${err.message}` }
  }
}

function extractJson(text) {
  if (!text) return null
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------- */
/* IPC registration                                                            */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Updates & the data-safe upgrade sequence                                    */
/* -------------------------------------------------------------------------- */

async function checkForUpdate() {
  const { owner, repo } = updateRepo()
  return updater.checkLatest({ owner, repo, currentVersion: APP_VERSION })
}

async function stageUpdate(asset) {
  const check = await checkForUpdate()
  const withChecksums = {
    ...asset,
    checksumAssets: updater.checksumAssetsFor(check, asset?.name),
  }
  return updater.download(withChecksums, dataDir, (progress) => {
    send('updates:progress', { name: asset?.name, ...progress })
  })
}

/**
 * Startup order matters for data safety:
 *   1. verify the data folder really is a data folder (never silently start empty)
 *   2. copy db/ if the application version is newer than the last run
 *   3. open the database and run transactional schema migrations
 *   4. record the lifecycle, then show the window
 */
async function bootSequence() {
  dataDir = resolveDataDir()

  const health = lifecycle.inspect(dataDir)
  if (health.looksOrphaned) {
    const choice = await dialog.showMessageBox({
      type: 'error',
      buttons: ['Locate the data folder…', 'Quit'],
      defaultId: 0,
      cancelId: 1,
      title: 'Patient data folder not found',
      message: 'This folder is marked as an EndoReport data folder, but its database is missing.',
      detail: `${dataDir}\n\nThis normally means the drive is disconnected, or the folder was moved or deleted. Starting now would create a new, empty database and your existing records would look as if they had vanished.`,
    })
    if (choice.response !== 0) {
      app.quit()
      return
    }
    const picked = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (picked.canceled || !picked.filePaths?.length) {
      app.quit()
      return
    }
    dataDir = picked.filePaths[0]
    writeDataDirSetting(dataDir)
  }

  lifecycle.ensureMarker(dataDir)

  const stamp = lifecycle.readVersionStamp(dataDir)
  const upgrading = !!(stamp?.appVersion && updater.compareVersions(stamp.appVersion, APP_VERSION) < 0)
  let preUpgradeBackup = null

  if (upgrading) {
    try {
      preUpgradeBackup = lifecycle.snapshotBeforeUpgrade(dataDir, stamp.schemaVersion ?? '?', db.SCHEMA_VERSION)
      lifecycle.appendUpgradeLog(dataDir, {
        event: 'upgrade-start',
        from: stamp.appVersion,
        to: APP_VERSION,
        schemaFrom: stamp.schemaVersion,
        schemaTo: db.SCHEMA_VERSION,
        backup: preUpgradeBackup?.dir || null,
      })
    } catch (err) {
      lifecycle.appendUpgradeLog(dataDir, { event: 'upgrade-backup-failed', error: err.message })
      preUpgradeBackup = { error: err.message }
    }
  }

  await db.init(dataDir)

  const prev = await lifecycle.readLifecycle(db)
  const now = new Date().toISOString()
  const migration = db.getLastMigration()

  await lifecycle.writeLifecycle(db, {
    appVersion: APP_VERSION,
    schemaVersion: db.SCHEMA_VERSION,
    firstRunAt: prev.firstRunAt || now,
    lastRunAt: now,
    ...(upgrading ? { lastUpgradeAt: now, lastUpgradeFrom: stamp.appVersion } : {}),
    upgradeHistory: [
      ...(prev.upgradeHistory || []).slice(-19),
      {
        at: now,
        from: stamp?.appVersion || null,
        to: APP_VERSION,
        schema: db.SCHEMA_VERSION,
        migratedSteps: migration?.applied?.length || 0,
      },
    ],
  })
  lifecycle.writeVersionStamp(dataDir, { appVersion: APP_VERSION, schemaVersion: db.SCHEMA_VERSION })

  startupReport = {
    dataDir,
    appVersion: APP_VERSION,
    schemaVersion: db.SCHEMA_VERSION,
    upgradedFrom: upgrading ? stamp.appVersion : null,
    migration,
    preUpgradeBackup,
    markerId: lifecycle.readMarker(dataDir)?.dataId || null,
  }

  registerIpc()
  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

function registerIpc() {
  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await fn(...args)
      } catch (err) {
        console.error(`[ipc:${channel}]`, err)
        return { __error: err?.message || String(err) }
      }
    })
  }

  /* App ------------------------------------------------------------------ */
  handle('app:info', async () => ({
    version: APP_VERSION,
    dataDir,
    platform: process.platform,
    isDev,
    ai: { encryptionAvailable: safeStorage.isEncryptionAvailable() },
  }))
  handle('app:openDataDir', async () => shell.openPath(dataDir))
  handle('app:openPath', async (target) => shell.openPath(target))
  handle('app:revealPath', async (target) => {
    shell.showItemInFolder(target)
    return true
  })
  handle('app:chooseDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    })
    return canceled ? null : filePaths[0]
  })
  handle('app:readFileAsDataUrl', async (filePath) => {
    const stat = await fsp.stat(filePath)
    if (stat.size > 250 * 1024 * 1024) throw new Error('File is too large to embed (limit 250 MB).')
    const buf = await fsp.readFile(filePath)
    const ext = path.extname(filePath).toLowerCase().replace('.', '')
    const mime =
      { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', webm: 'video/webm', mp4: 'video/mp4' }[ext] ||
      'application/octet-stream'
    return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, mime, bytes: stat.size }
  })
  handle('app:saveClipboardText', async (text) => {
    clipboard.writeText(String(text || ''))
    return true
  })

  /* Patients ------------------------------------------------------------- */
  handle('patients:list', (search, limit) => db.listPatients(search, limit))
  handle('patients:get', (id) => db.getPatient(id))
  handle('patients:save', (patient) => db.savePatient(patient))
  handle('patients:remove', (id) => db.deletePatient(id))
  handle('patients:nextRegNo', () => db.nextRegNo())

  /* Procedures ----------------------------------------------------------- */
  handle('procedures:list', (filters) => db.listProcedures(filters || {}))
  handle('procedures:get', (id) => db.getProcedure(id))
  handle('procedures:save', (patientId, payload) => db.saveProcedure(patientId, payload))
  handle('procedures:remove', (id) => db.deleteProcedure(id))

  /* Media ---------------------------------------------------------------- */
  handle('media:list', (procedureId) => db.listMedia(procedureId))
  handle('media:addImage', async ({ patientId, procedureId, section, caption, data, mime }) => {
    const buffer = toBuffer(data)
    if (!buffer?.length) throw new Error('No image data received.')
    const filePath = await writeMediaFile({ patientId, procedureId, kind: 'image', buffer, mime })
    return db.addMedia({
      patientId,
      procedureId,
      kind: 'image',
      section: section || null,
      caption: caption || '',
      filePath,
      mime: mime || 'image/png',
      bytes: buffer.length,
    })
  })
  handle('media:addVideo', async ({ patientId, procedureId, section, caption, data, mime, durationSec }) => {
    const buffer = toBuffer(data)
    if (!buffer?.length) throw new Error('No video data received.')
    const filePath = await writeMediaFile({ patientId, procedureId, kind: 'video', buffer, mime })
    return db.addMedia({
      patientId,
      procedureId,
      kind: 'video',
      section: section || null,
      caption: caption || '',
      filePath,
      mime: mime || 'video/webm',
      bytes: buffer.length,
      durationSec: durationSec || null,
    })
  })
  handle('media:thumbnail', (filePath, id, width) => thumbs.makeThumb(dataDir, filePath, id, width || 320))
  handle('media:sourceSize', (filePath) => thumbs.sourceSize(filePath))
  handle('media:update', (id, patch) => db.updateMedia(id, patch))
  handle('media:remove', (id) => db.deleteMedia(id))
  handle('media:import', async ({ patientId, procedureId, section }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import images or videos from this computer',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images and videos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'mp4', 'webm', 'mkv', 'mov'] },
      ],
    })
    if (canceled || !filePaths?.length) return { ok: false, cancelled: true }
    const added = []
    for (const src of filePaths) {
      const ext = path.extname(src).toLowerCase().replace('.', '')
      const kind = ['mp4', 'webm', 'mkv', 'mov'].includes(ext) ? 'video' : 'image'
      // eslint-disable-next-line no-await-in-loop
      const buffer = await fsp.readFile(src)
      // eslint-disable-next-line no-await-in-loop
      const filePath = await writeMediaFile({
        patientId,
        procedureId,
        kind,
        buffer,
        mime: kind === 'video' ? 'video/mp4' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`,
      })
      // eslint-disable-next-line no-await-in-loop
      const rec = await db.addMedia({
        patientId,
        procedureId,
        kind,
        section: section || null,
        caption: path.basename(src, path.extname(src)),
        filePath,
        mime: kind === 'video' ? 'video/mp4' : `image/${ext}`,
        bytes: buffer.length,
      })
      added.push(rec)
    }
    return { ok: true, added }
  })

  /* Doctors -------------------------------------------------------------- */
  handle('doctors:list', (activeOnly) => db.listDoctors(activeOnly))
  handle('doctors:save', (doctor) => db.saveDoctor(doctor))
  handle('doctors:remove', (id) => db.deleteDoctor(id))

  /* A doctor's signature stamp, stored once and reused on every report. */
  handle('doctors:setSeal', async (doctorId, bytes) => {
    if (!doctorId) throw new Error('Choose a doctor first.')
    const buffer = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes)
    if (!buffer.length) throw new Error('The stamp image is empty.')
    if (buffer.length > 8 * 1024 * 1024) throw new Error('The stamp image is larger than 8 MB.')
    const file = await db.setDoctorSeal(dataDir, doctorId, buffer, 'png')
    return { ok: true, path: file }
  })

  handle('doctors:sealDataUrl', async (doctorId) => {
    const doctors = await db.listDoctors()
    const doctor = doctors.find((d) => d.id === doctorId)
    if (!doctor?.sealPath || !fs.existsSync(doctor.sealPath)) return { dataUrl: '' }
    const buf = fs.readFileSync(doctor.sealPath)
    return { dataUrl: `data:image/png;base64,${buf.toString('base64')}` }
  })

  /* Open a Word report and hand back editable HTML ------------------------ */
  handle('docx:pickHtml', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Open the Word report you want to edit',
      properties: ['openFile'],
      filters: [{ name: 'Word document', extensions: ['docx'] }],
    })
    if (canceled || !filePaths[0]) return { ok: false, cancelled: true }
    const buffer = fs.readFileSync(filePaths[0])
    const { html, margins } = await convertDocxBuffer(buffer)
    return {
      ok: true,
      fileName: path.basename(filePaths[0]),
      bytes: buffer.length,
      html,
      margins,
      base64: buffer.toString('base64'),
    }
  })

  /* Templates ------------------------------------------------------------ */
  handle('templates:importDocx', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose the Word file to use as the report template',
      properties: ['openFile'],
      filters: [{ name: 'Word document', extensions: ['docx'] }],
    })
    if (canceled || !filePaths?.length) return { ok: false, cancelled: true }
    const parsed = await docxTemplate.parseDocxFile(filePaths[0])
    return { ok: true, ...parsed }
  })

  handle('templates:list', () => db.listTemplates())
  handle('templates:save', (template) => db.saveTemplate(template))
  handle('templates:remove', (id) => db.deleteTemplate(id))

  /* Settings ------------------------------------------------------------- */
  handle('settings:get', (key, fallback) => db.getSetting(key, fallback))
  handle('settings:set', async (key, value) => {
    if (key === 'ai') {
      const { apiKey, ...rest } = value || {}
      if (apiKey !== undefined && apiKey !== null) {
        if (apiKey === '') {
          await db.setSetting('ai.key.enc', null)
        } else if (safeStorage.isEncryptionAvailable()) {
          await db.setSetting('ai.key.enc', safeStorage.encryptString(String(apiKey)).toString('base64'))
        } else {
          await db.setSetting('ai.key.plain', String(apiKey))
        }
      }
      return db.setSetting('ai', rest)
    }
    return db.setSetting(key, value)
  })

  /* Data ----------------------------------------------------------------- */
  handle('data:stats', () => db.stats())
  handle('data:maintenance', (days) => db.maintenanceSummary(days || 30))
  handle('data:backup', () => runBackup())
  handle('data:restore', () => runRestore())
  handle('data:exportJson', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export all data as a single JSON file',
      defaultPath: path.join(app.getPath('documents'), `endorreport-data-${new Date().toISOString().slice(0, 10)}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (canceled || !filePath) return { ok: false, cancelled: true }
    const dump = await dumpAll()
    await fsp.writeFile(filePath, JSON.stringify(dump, null, 2), 'utf8')
    return { ok: true, filePath }
  })
  handle('data:importJson', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import a previously exported JSON file',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (canceled || !filePaths?.length) return { ok: false, cancelled: true }
    const dump = JSON.parse(await fsp.readFile(filePaths[0], 'utf8'))
    if (dump.app !== 'EndoReport') return { ok: false, error: 'This file was not produced by EndoReport.' }
    for (const p of dump.patients || []) {
      // eslint-disable-next-line no-await-in-loop
      await db.savePatient(p)
    }
    for (const proc of dump.procedures || []) {
      // eslint-disable-next-line no-await-in-loop
      await db.saveProcedure(proc.patientId, proc)
    }
    return { ok: true, patients: (dump.patients || []).length, procedures: (dump.procedures || []).length }
  })
  handle('data:exportReportJson', async (payload) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save this report as a data file',
      defaultPath: path.join(app.getPath('documents'), `report-${payload?.reportNo || Date.now()}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (canceled || !filePath) return { ok: false, cancelled: true }
    await fsp.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
    return { ok: true, filePath }
  })

  /* Report --------------------------------------------------------------- */
  handle('report:exportDocx', (model) => exportDocx(model))
  handle('report:exportBatch', (models) => exportBatch(models))
  handle('report:printHtml', (html, title) => printHtml(html, title))
  handle('report:savePdf', (html, title) => savePdf(html, title))

  /* AI ------------------------------------------------------------------- */
  handle('ai:status', async () => {
    const cfg = await getAiConfig()
    return { enabled: !!cfg.enabled, configured: !!(cfg.baseUrl && cfg.apiKey), model: cfg.model || null, baseUrl: cfg.baseUrl || null }
  })
  handle('ai:analyseImage', (payload) => aiAnalyseImage(payload))

  /* Updates & lifecycle --------------------------------------------------- */
  handle('updates:check', () => checkForUpdate())
  handle('updates:download', (asset) => stageUpdate(asset))
  handle('updates:run', async (filePath) => {
    if (!filePath || !fs.existsSync(filePath)) throw new Error('The downloaded file is no longer available.')
    const ext = path.extname(filePath).toLowerCase()
    if (ext === '.exe') {
      const problem = await shell.openPath(filePath)
      if (problem) throw new Error(problem)
      setTimeout(() => app.quit(), 1500)
      return { ok: true, launched: true }
    }
    shell.showItemInFolder(filePath)
    return { ok: true, launched: false, revealed: true }
  })
  handle('updates:releasePage', async () => {
    const res = await checkForUpdate()
    if (res.htmlUrl) await shell.openExternal(res.htmlUrl)
    return { ok: !!res.htmlUrl, url: res.htmlUrl || null }
  })
  handle('lifecycle:info', async () => ({
    appVersion: APP_VERSION,
    schemaVersion: db.SCHEMA_VERSION,
    dataDir,
    marker: lifecycle.readMarker(dataDir),
    stamp: lifecycle.readVersionStamp(dataDir),
    lifecycle: await lifecycle.readLifecycle(db),
    backups: lifecycle.listBackups(dataDir),
    startup: startupReport,
    repo: updateRepo(),
  }))
  handle('lifecycle:openUpgradeLog', async () => {
    const p = path.join(dataDir, 'upgrade.log')
    if (!fs.existsSync(p)) return { ok: false, reason: 'No upgrade has been recorded yet.' }
    await shell.openPath(p)
    return { ok: true }
  })
  handle('lifecycle:openBackup', async (folder) => {
    await shell.openPath(folder)
    return true
  })
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    try {
      dbReady = bootSequence()
      await dbReady
      if (isDev) console.log('[EndoReport] startup:', JSON.stringify(startupReport))
    } catch (err) {
      console.error('[EndoReport] startup failed:', err)
      await dialog.showMessageBox({
        type: 'error',
        title: 'EndoReport could not start',
        message: 'The local database could not be opened.',
        detail: `${err.message}\n\nData folder: ${dataDir}\n\nNo records have been deleted. If you have just updated the application, a copy of the database was saved in the "backups" folder inside the data folder.`,
      })
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
