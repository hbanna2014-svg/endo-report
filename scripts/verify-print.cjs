/**
 * verify-print.cjs — proves that a report printed from the app really carries
 * its pictures.
 *
 * It builds a report with three full-size (noisy, therefore heavy) PNG frames,
 * renders the same HTML the app sends to the printer, waits for the pictures to
 * decode and writes a PDF. The PDF is then inspected for embedded image
 * objects, which is the only reliable proof that the plate is not blank.
 *
 *   xvfb-run -a npx electron scripts/verify-print.cjs --no-sandbox
 */

const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')

const db = require('../electron/db.cjs')

const COUNT = Number(process.env.VERIFY_PICTURES || 3)
const ROOT = path.join(__dirname, '..')
const esmImport = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`)
}

/* ---------------------------------------------------------------- PNG maker --- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** A noise RGB PNG — incompressible, so it behaves like a real camera frame. */
function noisePng(w, h) {
  const stride = w * 3 + 1
  const raw = Buffer.alloc(stride * h)
  const noise = crypto.randomBytes(stride * h)
  for (let y = 0; y < h; y += 1) {
    raw[y * stride] = 0                       // filter byte
    noise.copy(raw, y * stride + 1, y * stride, y * stride + w * 3)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* --------------------------------------------------------------- print wait --- */

async function waitForImages(win, timeoutMs = 15000) {
  const started = Date.now()
  const deadline = started + timeoutMs
  let last = { total: 0, pending: 0 }
  let readyAt = null
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    last = await win.webContents.executeJavaScript(
      `(() => {
         const imgs = Array.from(document.images || []);
         return { total: imgs.length, pending: imgs.filter((i) => !i.complete || i.naturalWidth === 0).length };
       })()`,
      true,
    )
    if (last.pending === 0 && readyAt === null) readyAt = Date.now() - started
    if (last.pending === 0) return { ...last, readyAt }
    if (Date.now() >= deadline) return { ...last, readyAt: null }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 100))
  }
}

/* ---------------------------------------------------------------------- run --- */

async function run() {
  const dataDir = path.join(os.tmpdir(), `endoreport-print-${Date.now()}`)
  console.log(`\nData directory: ${dataDir}\n`)
  await db.init(dataDir)

  const { emptyProcedure } = await esmImport('src/lib/autoReport.js')
  const { buildReportModel, DEFAULT_TEMPLATE } = await esmImport('src/lib/reportModel.js')
  const { buildPrintHtml } = await esmImport('src/lib/printHtml.js')

  const patient = await db.savePatient({
    name: 'Print Verification Patient',
    age: '51',
    ageUnit: 'years',
    sex: 'Male',
    referredBy: 'Dr. Referrer',
    performingDoctor: 'Dr. Operator',
    indication: 'Dyspepsia for evaluation',
    history: 'Nil significant',
  })

  const procedure = {
    ...emptyProcedure('ogd'),
    procedureDate: '2026-10-26',
    performingDoctor: 'Dr. Operator',
    performingDoctorDegrees: 'MBBS, FCPS',
    sedation: 'Conscious sedation',
    complications: 'None.',
    biopsy: { taken: false, sites: '', count: '' },
    entries: [
      { sectionId: 'antrum', findingId: 'antral_gastritis_erythematous', values: {}, notes: '' },
      { sectionId: 'd2', findingId: 'normal_d2', values: {}, notes: '' },
    ],
  }
  // Optional free text in the blank half of the form.
  if (process.env.VERIFY_NOTES) {
    const long = process.env.VERIFY_NOTES === 'long'
    procedure.docHtml = long
      ? Array.from({ length: 26 })
          .map((_, i) => `<p>Line ${i + 1}: the patient was reviewed after the procedure and advised on diet, medication and follow-up.</p>`)
          .join('')
      : '<p><b>ADDENDUM:</b> Patient tolerated the procedure well. Review in two weeks.</p>'
    procedure.docOverflow = long
  }

  const saved = await db.saveProcedure(patient.id, procedure)

  // Three heavy frames, exactly like a capture card produces.
  const mediaDir = path.join(dataDir, 'media', patient.id, saved.id)
  fs.mkdirSync(mediaDir, { recursive: true })
  const media = []
  for (let i = 0; i < COUNT; i += 1) {
    const file = path.join(mediaDir, `frame-${i + 1}.png`)
    const png = noisePng(1920, 1080)
    fs.writeFileSync(file, png)
    media.push(
      await db.addMedia({
        patientId: patient.id,
        procedureId: saved.id,
        kind: 'image',
        section: 'antrum',
        caption: `Antrum — view ${i + 1}`,
        filePath: file,
        mime: 'image/png',
        bytes: png.length,
      }),
    )
  }
  const totalMb = media.reduce((s, m) => s + (m.bytes || 0), 0) / 1024 / 1024
  console.log(`  three frames written, ${totalMb.toFixed(1)} MB in total\n`)

  const loaded = await db.getProcedure(saved.id)
  const template = {
    ...DEFAULT_TEMPLATE,
    layout: { ...DEFAULT_TEMPLATE.layout, style: 'hospital', imageLayout: 'form7' },
  }
  const model = buildReportModel(patient, loaded, template, {})
  check(`the plate plans ${COUNT} pictures`, model.imagePlan.filled === COUNT, `filled=${model.imagePlan.filled}`)

  // Mirror src/lib/printImages.js: downscale to 1400px and re-encode as JPEG.
  const PRINT_MAX_WIDTH = 1200
  const enriched = media.map((m) => {
    const img = nativeImage.createFromPath(m.filePath)
    const size = img.getSize()
    const scale = Math.min(1, PRINT_MAX_WIDTH / size.width)
    const out = scale < 1 ? img.resize({ width: Math.round(size.width * scale), quality: 'good' }) : img
    return { ...m, dataUrl: `data:image/jpeg;base64,${out.toJPEG(88).toString('base64')}` }
  })
  const html = buildPrintHtml({ ...model, media: enriched })

  const embeds = (html.match(/src="data:image\/[a-z]+;base64,/g) || []).length
  check('print HTML embeds every picture', embeds === COUNT, `found ${embeds}`)
  check('pictures print on white with a border, never on black', !html.includes('background: #000') && html.includes('background: #fff; border: .8px solid #000'))

  const tmpFile = path.join(dataDir, 'print.html')
  fs.writeFileSync(tmpFile, html, 'utf8')
  console.log(`  print HTML: ${(fs.statSync(tmpFile).size / 1024 / 1024).toFixed(1)} MB\n`)

  const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true } })
  await win.loadURL(pathToFileURL(tmpFile).href)

  const ready = await waitForImages(win)
  check('every picture decodes before printing', ready.pending === 0 && ready.total === COUNT, `total=${ready.total} pending=${ready.pending}`)
  console.log(`  pictures were ready after ${ready.readyAt} ms (the old code printed at a fixed 350 ms)\n`)

  const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
  win.destroy()

  const pdfPath = path.join(dataDir, 'report.pdf')
  fs.writeFileSync(pdfPath, pdf)
  const asText = pdf.toString('latin1')
  const imageObjects = (asText.match(/\/Subtype\s*\/Image/g) || []).length
  check('the PDF really contains embedded pictures', imageObjects >= COUNT, `/Subtype /Image count = ${imageObjects}`)
  check('the PDF has a page', /\/Type\s*\/Page[^s]/.test(asText))

  console.log(`\n  PDF: ${pdfPath} (${(pdf.length / 1024).toFixed(0)} KB)\n`)
  console.log(failures === 0 ? 'ALL PRINT CHECKS PASSED' : `${failures} PRINT CHECK(S) FAILED`)
  return failures
}

app.whenReady().then(async () => {
  try {
    const failed = await run()
    app.exit(failed === 0 ? 0 : 1)
  } catch (err) {
    console.error('FAILED:', err)
    app.exit(1)
  }
})
