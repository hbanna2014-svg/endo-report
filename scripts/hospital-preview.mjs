/**
 * hospital-preview.mjs — renders a sample hospital-form report.
 *
 *   node scripts/hospital-preview.mjs
 *
 * Writes preview/hospital.html and preview/hospital.docx so the printed layout
 * can be inspected (and screenshotted) without opening the application.
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'

import { buildReportModel, DEFAULT_TEMPLATE } from '../src/lib/reportModel.js'
import { emptyProcedure } from '../src/lib/autoReport.js'
import { buildPrintHtml, buildImagePlusHtml } from '../src/lib/printHtml.js'

const require = createRequire(import.meta.url)
const docx = require('../electron/docx.cjs')

/* ---------------------------------------------------------------- images -- */

let CRC = null
function crc32(buf) {
  if (!CRC) {
    CRC = new Int32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC[n] = c
    }
  }
  let c = -1
  for (let i = 0; i < buf.length; i += 1) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return c ^ -1
}

/** A 320x240 endoscopic-looking frame so the plate is not just grey boxes. */
function frame(tint = 0) {
  const W = 320
  const H = 240
  const raw = Buffer.alloc((W * 3 + 1) * H)
  let p = 0
  for (let y = 0; y < H; y += 1) {
    raw[p++] = 0
    for (let x = 0; x < W; x += 1) {
      const dx = (x - W / 2) / (W / 2)
      const dy = (y - H / 2) / (H / 2)
      const r2 = dx * dx + dy * dy
      const inside = r2 < 0.92 ? 1 : 0
      const base = inside ? 1 - r2 * 0.55 : 0
      const r = Math.round(base * (150 + 60 * Math.sin(tint + x / 45)) + 20)
      const g = Math.round(base * (70 + 30 * Math.cos(tint + y / 38)) + 12)
      const b = Math.round(base * (75 + 35 * Math.sin((x + y) / 70)) + 18)
      raw[p++] = Math.max(0, Math.min(255, r))
      raw[p++] = Math.max(0, Math.min(255, g))
      raw[p++] = Math.max(0, Math.min(255, b))
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const t = Buffer.from(type, 'latin1')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0)
    return Buffer.concat([len, t, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const CAPTIONS = [
  'Lower oesophagus — normal Z-line',
  'Antrum — erythematous mucosa',
  'Gastric body — normal folds',
  'Duodenal bulb',
  'D2 — normal villous pattern',
  'Retroflexion — cardia',
  'Pylorus',
]

/* ---------------------------------------------------------------- sample -- */

const patient = {
  id: 'preview-patient',
  regNo: '00053211',
  identityNo: '00053211',
  visitId: 'C1853940',
  name: 'SAROWER HOSSAIN',
  age: '70',
  ageUnit: 'years',
  sex: 'Female',
  phone: '01711-000000',
  address: 'Mirpur, Dhaka',
  referredBy: 'Dr. Mohammed Reazuddin Danish',
  history: 'N/A',
  indication: 'N/A',
}

const procedure = {
  ...emptyProcedure('ogd'),
  id: 'preview-procedure',
  procedureDate: '2026-10-17',
  performingDoctor: 'Dr. Mohammed Reazuddin Danish',
  performingDoctorDegrees: 'MD (Gastroenterology), MRCP (UK), MACP (USA)',
  performingDoctorDesignation: 'Asst. Prof. Gastroenterology & Medicine',
  performingDoctorAffiliation: 'Ibn Sina Medical College & Hospital',
  scopeModel: 'OLYMPUS CV-1500',
  medication: '2% Jascocaine jelly',
  bed: 'OPD',
  sedation: 'Conscious sedation — midazolam',
  complications: 'None.',
  biopsy: { taken: false, sites: '', count: '' },
  entries: [
    { uid: 'a', sectionId: 'oesophagus', findingId: 'normal_oesophagus', values: {}, notes: '' },
    { uid: 'b', sectionId: 'antrum', findingId: 'antral_gastritis_erythematous', values: { extent: 'patchy antral' }, notes: 'Food materials are seen.' },
    { uid: 'c', sectionId: 'body', findingId: 'normal_body', values: {}, notes: '' },
    { uid: 'd', sectionId: 'd1', findingId: 'normal_d1', values: {}, notes: '' },
    { uid: 'e', sectionId: 'd2', findingId: 'normal_d2', values: {}, notes: '' },
  ],
  comments: 'Antral Gastritis',
}

const media = CAPTIONS.map((caption, i) => ({
  id: `img-${i + 1}`,
  kind: 'image',
  caption,
  filePath: `/preview/img-${i + 1}.png`,
  dataUrl: `data:image/png;base64,${frame(i * 0.9).toString('base64')}`,
  section: 'oesophagus',
}))

const template = {
  ...DEFAULT_TEMPLATE,
  id: 'hospital',
  name: 'Hospital paper form',
  layout: { ...DEFAULT_TEMPLATE.layout, style: 'hospital', imageLayout: 'form7' },
  clinic: {
    ...DEFAULT_TEMPLATE.clinic,
    name: 'IBN SINA MEDICAL COLLEGE HOSPITAL',
    address: '1/1-B, Kallyanpur, Mirpur Road, Dhaka-1216',
    phone: 'Phone : 9010396, 8091332-6, For Serial : 01703-725590, Customer Care : 01844-141713',
    doctorDegrees: 'MD (Gastroenterology), MRCP (UK), MACP (USA)',
    doctorDesignation: 'Asst. Prof. Gastroenterology & Medicine',
  },
}

const model = buildReportModel(patient, { ...procedure, media }, template)

const outDir = path.resolve('preview')
fs.mkdirSync(outDir, { recursive: true })

const html = buildPrintHtml(model)
fs.writeFileSync(path.join(outDir, 'hospital.html'), html, 'utf8')

// Image Plus: pictures only, six to a sheet.
const mediaWithData = media.map((m) => ({ ...m, dataUrl: m.dataUrl }))
fs.writeFileSync(
  path.join(outDir, 'imageplus.html'),
  buildImagePlusHtml({ ...model, media: mediaWithData }, { count: 6, images: mediaWithData }),
  'utf8',
)

const docxPath = path.join(outDir, 'hospital.docx')
await docx.saveDocx(model, docxPath)

console.log('wrote preview/hospital.html', html.length, 'bytes')
console.log('wrote preview/hospital.docx', fs.statSync(docxPath).size, 'bytes')
console.log('images on plate:', model.imagePlan.filled, '/', model.imagePlan.capacity)
console.log('findings rows:', model.hospital.findings.map((f) => f.heading).join(', '))
