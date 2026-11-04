/**
 * verify-imageplus.cjs — proves that the Image Plus sheet puts four, six, seven
 * or eight pictures across the whole page instead of in one corner.
 *
 * It renders the real print HTML in a window the exact size of an A4 sheet at
 * 96 dpi, then measures the picture boxes in the page and compares them with the
 * frame the sheet leaves for pictures.
 *
 *   xvfb-run -a npx electron scripts/verify-imageplus.cjs --no-sandbox
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '..')
const esmImport = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`)
}

/* ------------------------------------------------------------------ images --- */

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

function noisePng(w, h) {
  const stride = w * 3 + 1
  const raw = Buffer.alloc(stride * h)
  const noise = crypto.randomBytes(stride * h)
  for (let y = 0; y < h; y += 1) {
    raw[y * stride] = 0
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

/* --------------------------------------------------------------------- run --- */

async function run() {
  const { buildReportModel } = await esmImport('src/lib/reportModel.js')
  const { buildImagePlusHtml } = await esmImport('src/lib/printHtml.js')

  const png = noisePng(480, 360)
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`

  const patient = { id: 'p1', name: 'Plate Check', regNo: 'ER-0001', age: '50', sex: 'Male' }
  const media = Array.from({ length: 8 }, (_, i) => ({
    id: `m${i + 1}`,
    kind: 'image',
    caption: `Frame ${i + 1}`,
    width: 480,
    height: 360,
    filePath: '/tmp/none.png',
    dataUrl,
  }))

  const outDir = path.join(os.tmpdir(), `endoreport-plate-${Date.now()}`)
  fs.mkdirSync(outDir, { recursive: true })

  const win = new BrowserWindow({ width: 794, height: 1123, show: false, webPreferences: { offscreen: true } })

  for (const count of [4, 6, 7, 8]) {
    const procedure = {
      id: 'x',
      testName: 'ogd',
      procedureDate: '2026-11-04',
      performingDoctor: 'Dr. Check',
      media,
      imageLayout: 'grid6',
      status: 'final',
    }
    const model = buildReportModel(patient, procedure, { layout: { style: 'hospital' } }, { media })
    const html = buildImagePlusHtml(model, { count, images: media })

    const file = path.join(outDir, `image-plus-${count}.html`)
    fs.writeFileSync(file, html, 'utf8')

    // eslint-disable-next-line no-await-in-loop
    await win.loadURL(pathToFileURL(file).href)
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 700))

    // eslint-disable-next-line no-await-in-loop
    const box = await win.webContents.executeJavaScript(
      `(() => {
         const imgs = [...document.querySelectorAll('.plate figure img')];
         if (!imgs.length) return { n: 0 };
         let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
         let minW = Infinity, maxW = 0;
         for (const i of imgs) {
           const r = i.getBoundingClientRect();
           left = Math.min(left, r.left + scrollX); top = Math.min(top, r.top + scrollY);
           right = Math.max(right, r.right + scrollX); bottom = Math.max(bottom, r.bottom + scrollY);
           minW = Math.min(minW, r.width); maxW = Math.max(maxW, r.width);
         }
         const sheet = document.querySelector('.frame').getBoundingClientRect();
         return { n: imgs.length, left, top, right, bottom, minW, maxW,
                  sheetW: sheet.width, sheetH: sheet.height };
       })()`,
      true,
    )

    const usedH = (box.bottom - box.top) / box.sheetH
    const usedW = (box.right - box.left) / box.sheetW
    console.log(
      `  ${count} pictures: ${box.n} drawn, ${Math.round(box.minW)} px wide, ` +
        `block covers ${(usedW * 100).toFixed(0)}% width × ${(usedH * 100).toFixed(0)}% height`,
    )

    // The old plate put every picture in a 55.88 x 50.8 mm cell, so this is the
    // number the clinic actually feels: how much bigger the pictures got.
    const oldAreaMm2 = count * 55.88 * 50.8
    const newAreaMm2 = count * (box.minW * 25.4 / 96) * ((box.bottom - box.top) / Math.ceil(count / 2) * 25.4 / 96)
    const growth = newAreaMm2 / oldAreaMm2

    check(`${count} pictures are all drawn`, box.n === count, `drawn ${box.n}`)
    check(`${count} pictures use at least 70% of the sheet width`, usedW >= 0.7, `${(usedW * 100).toFixed(0)}%`)
    // Four landscape pictures cannot fill the height of a portrait page without
    // cropping them, so the floor is set where the geometry can actually reach.
    check(`${count} pictures use at least 50% of the sheet height`, usedH >= 0.5, `${(usedH * 100).toFixed(0)}%`)
    check(`${count} pictures are noticeably larger than the old plate`, growth > 1.4, `${growth.toFixed(2)}x the old area`)

    // eslint-disable-next-line no-await-in-loop
    const shot = await win.webContents.capturePage()
    fs.writeFileSync(path.join(outDir, `image-plus-${count}.png`), shot.toPNG())
  }

  console.log(`\n  screenshots: ${outDir}\n`)
  console.log(failures === 0 ? 'ALL PLATE CHECKS PASSED' : `${failures} PLATE CHECK(S) FAILED`)
  return failures
}

app.whenReady().then(async () => {
  let code = 1
  try {
    code = await run()
  } catch (err) {
    console.error(err)
    code = 1
  }
  app.exit(code === 0 ? 0 : 1)
})
