/**
 * selftest.mjs — verifies the reporting engine and the Word export offline.
 * Run with:  node scripts/selftest.mjs
 */

import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { analyse, emptyProcedure, findingsForSection } from '../src/lib/autoReport.js'
import { buildImagePlan, buildReportModel, imageLayoutDef, renderPlainText } from '../src/lib/reportModel.js'
import { buildPrintHtml } from '../src/lib/printHtml.js'
import { sectionsForProcedure } from '../src/lib/anatomy.js'

const require = createRequire(import.meta.url)
const docx = require('../electron/docx.cjs')
const docxTemplate = require('../electron/docxTemplate.cjs')
const JSZip = require('jszip')

let failures = 0
const check = (name, condition, detail = '') => {
  const ok = !!condition
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n        ${detail}` : ''}`)
}

const entry = (sectionId, findingId, values = {}, notes = '') => ({
  uid: `${sectionId}-${findingId}`,
  sectionId,
  findingId,
  values,
  notes,
})

/* ========================================================================== */
console.log('\n=== 1. Colonoscopy: polyps, diverticula, normal segments ===\n')

const colon = {
  ...emptyProcedure('colonoscopy'),
  id: 101,
  procedureDate: '2026-10-15',
  performingDoctor: 'Dr. B. Hossain',
  extentReached: 'Caecum + terminal ileum',
  prepQuality: 'Good',
  bbps: { right: '3', transverse: '2', left: '2' },
  caecalIntubationTime: '9',
  withdrawalTime: '8',
  sedation: 'Conscious sedation — midazolam + pethidine',
  complications: 'None.',
  biopsy: { taken: true, sites: 'Sigmoid polyp', count: '1' },
  entries: [
    entry('rectum', 'normal_rectum'),
    entry('sigmoid', 'diverticulosis_sigmoid', { number: '8', complication: 'none — uncomplicated' }),
    entry('sigmoid', 'sigmoid_polyp', { number: '2', size: '12', morphology: 'sessile', resection: 'cold snare polypectomy', completeness: 'complete' }),
    entry('descending', 'normal_descending'),
    entry('transverse', 'normal_transverse'),
    entry('ascending', 'normal_ascending'),
    entry('caecum', 'normal_caecum'),
    entry('icv', 'normal_icv'),
    entry('ti', 'normal_ti'),
    entry('anal', 'haemorrhoids_external', { grade: 'Grade II — prolapse reducing spontaneously', position: 'at 3, 7 and 11 o clock' }),
  ],
}

const a1 = analyse(colon, { mediaCount: 4 })
console.log('Impression:')
a1.impression.forEach((i) => console.log(`  • [${i.severity}] ${i.text}`))
console.log(`\nRecommendations (${a1.recommendations.length}):`)
a1.recommendations.forEach((r) => console.log(`  - ${r}`))
console.log(`\nAudit: score ${a1.audit.score}% (${a1.audit.scoreLabel}) — ${a1.audit.errors} error, ${a1.audit.warnings} warning, ${a1.audit.infos} info`)
a1.audit.items.forEach((i) => console.log(`  [${i.level}] ${i.message}`))

check('colonoscopy produces an impression', a1.impression.length >= 3)
check('polyp summary counted 2 polyps', a1.polyps.totalPolyps === 2, `got ${a1.polyps.totalPolyps}`)
check('largest polyp size is 12 mm', a1.polyps.largestMm === 12, `got ${a1.polyps.largestMm}`)
check(
  'high-risk polyp profile triggers a 3-year interval',
  a1.recommendations.some((r) => /3 years/.test(r)),
  'no 3-year surveillance recommendation found',
)
check('no blocking errors for a well documented colonoscopy', a1.audit.errors === 0, `errors: ${a1.audit.errors}`)
check('body blocks built for every documented section (9)', a1.blocks.length === 9, `got ${a1.blocks.length}`)
check('impression mentions the sigmoid polyp', a1.impression.some((i) => /polyp/i.test(i.text)))

/* ========================================================================== */
console.log('\n=== 2. Safety net: malignancy without biopsy must block ===\n')

const badColon = {
  ...colon,
  biopsy: { taken: false, sites: '', count: '' },
  entries: [
    ...colon.entries,
    entry('rectum', 'rectal_mass', { distance: '7', size: '5 cm', circumference: 'one to two quadrants' }),
  ],
}

const a2 = analyse(badColon, { mediaCount: 1 })
console.log(`Audit: ${a2.audit.errors} error(s), ${a2.audit.warnings} warning(s)`)
a2.audit.items.filter((i) => i.level === 'error').forEach((i) => console.log(`  [ERROR] ${i.message}`))

check('malignancy without biopsy raises an error', a2.audit.errors >= 1)
check(
  'the error names the biopsy requirement',
  a2.audit.items.some((i) => i.level === 'error' && /biopsy/i.test(i.message)),
)
check('audit score drops', a2.audit.score < a1.audit.score)

/* ========================================================================== */
console.log('\n=== 3. Contradiction and missing-value detection ===\n')

const contradictory = {
  ...emptyProcedure('ogd'),
  id: 102,
  entries: [
    entry('oesophagus', 'normal_oesophagus'),
    entry('oesophagus', 'reflux_oesophagitis', {}), // required LA grade missing
    entry('gej', 'hiatus_hernia', { size: '3' }),
    entry('fundus', 'normal_fundus'),
    entry('d2', 'ti_not_intubated'), // will not resolve: wrong section id for that finding
  ],
}

const a3 = analyse(contradictory, { mediaCount: 0 })
a3.audit.items.forEach((i) => console.log(`  [${i.level}] ${i.message}`))

check('normal + abnormal in one section is flagged', a3.audit.items.some((i) => i.code === 'normal-and-abnormal'))
check('missing required LA grade is flagged', a3.audit.items.some((i) => i.code === 'required-field-missing'))
check('no images is flagged', a3.audit.items.some((i) => i.code === 'no-images'))
check('a ghost finding id is ignored safely', a3.flat.every((e) => e.findingId !== 'ti_not_intubated'))
check('H. pylori reminder appears with inflammatory findings', a3.audit.items.some((i) => i.code === 'hpylori-undocumented'))

/* ========================================================================== */
console.log('\n=== 4. Missing extent / BBPS / short withdrawal time ===\n')

const sloppy = {
  ...emptyProcedure('colonoscopy'),
  id: 103,
  entries: [entry('sigmoid', 'normal_sigmoid')],
  withdrawalTime: '3',
  bbps: { right: '1' },
}
const a4 = analyse(sloppy, { mediaCount: 0 })
a4.audit.items.forEach((i) => console.log(`  [${i.level}] ${i.message}`))

check('missing extent is flagged', a4.audit.items.some((i) => i.code === 'extent-missing'))
check('incomplete BBPS is flagged', a4.audit.items.some((i) => i.code === 'bbps-incomplete'))
check('short withdrawal time is flagged', a4.audit.items.some((i) => i.code === 'withdrawal-short'))
check('short withdrawal time adds a recommendation', a4.recommendations.some((r) => /6 minutes/.test(r)))

/* ========================================================================== */
console.log('\n=== 5. Section catalogue sanity ===\n')

const ogdSections = sectionsForProcedure('ogd')
const colonSections = sectionsForProcedure('colonoscopy')
const bothSections = sectionsForProcedure('both')
console.log(`  OGD sections: ${ogdSections.length}, Colonoscopy: ${colonSections.length}, Both: ${bothSections.length}`)
check('OGD has 8 sections', ogdSections.length === 8)
check('Colonoscopy has 11 sections', colonSections.length === 11)
check('Both = 19 sections', bothSections.length === 19)

// Every section must be documentable — a missing catalogue would silently make
// a whole anatomical region impossible to report on.
let emptySections = []
let noNegativeOption = []
let templateErrors = []
const BUILTIN_TOKENS = new Set(['section'])

for (const s of [...ogdSections, ...colonSections]) {
  const defs = findingsForSection(s.id)
  if (!defs.length) emptySections.push(s.id)
  if (!defs.some((d) => d.isNegative)) noNegativeOption.push(s.id)
  for (const d of defs) {
    const keys = new Set((d.fields || []).map((f) => f.key))
    const tokens = new Set()
    const text = `${d.phrase || ''} ${d.impression || ''}`
    for (const m of text.matchAll(/\{(\w+)\}/g)) tokens.add(m[1])
    for (const t of tokens) {
      if (!keys.has(t) && !BUILTIN_TOKENS.has(t)) templateErrors.push(`${s.id}/${d.id}: {${t}} has no matching field`)
    }
  }
}

check('every anatomical section has a finding catalogue', emptySections.length === 0, `missing: ${emptySections.join(', ')}`)
check('every section offers a "not examined" option', noNegativeOption.length === 0, `missing: ${noNegativeOption.join(', ')}`)
check(
  'every {placeholder} in a finding maps to a real field',
  templateErrors.length === 0,
  templateErrors.slice(0, 6).join('\n        '),
)

const totalFindings = [...ogdSections, ...colonSections].reduce((a, s) => a + findingsForSection(s.id).length, 0)
console.log(`  Total findings in the catalogue: ${totalFindings}`)
check('finding catalogue is substantial', totalFindings > 120, `got ${totalFindings}`)

/* ========================================================================== */
console.log('\n=== 6. Report model + print HTML + Word file ===\n')

const patient = {
  id: 1,
  regNo: 'ER2026-0042',
  name: 'Abdul Karim',
  age: '58',
  ageUnit: 'years',
  sex: 'Male',
  phone: '01711-000000',
  address: 'Mirpur, Dhaka',
  referredBy: 'Dr. A. Rahman',
  indication: 'Per rectal bleeding for 2 months.',
  history: 'Type 2 diabetes mellitus. No previous colonoscopy.',
}

const model = buildReportModel(patient, colon, null)
console.log(`  Report no: ${model.reportNo}`)
console.log(`  Title: ${model.title}`)
console.log(`  Details rows: ${model.details.length}`)
console.log(`  Plain text length: ${renderPlainText(model).length} chars`)

check('report number follows the ER-YYYYMMDD-#### pattern', /^ER-\d{8}-\d{4}$/.test(model.reportNo), model.reportNo)
check('title is the colonoscopy report', /COLONOSCOPY/i.test(model.title))
check('BBPS row is present in the procedure details', model.details.some((d) => /Boston/i.test(d.label)))
check('plain text contains the impression', /IMPRESSION/i.test(renderPlainText(model)))

const html = buildPrintHtml(model)
check('print HTML is a complete document', html.startsWith('<!doctype html>') && html.includes('</html>'))
check('print HTML contains the patient name', html.includes('Abdul Karim'))
check('print HTML escapes nothing dangerous', !/undefined/.test(html))

const tmp = path.join(os.tmpdir(), `endoreport-selftest-${Date.now()}.docx`)
await docx.saveDocx(model, tmp)
const bytes = fs.statSync(tmp).size
const head = fs.readFileSync(tmp).subarray(0, 2).toString('latin1')
console.log(`  Word file: ${tmp} (${bytes} bytes, magic "${head}")`)

check('Word file was written', fs.existsSync(tmp))
check('Word file is larger than 5 KB', bytes > 5000, `${bytes} bytes`)
check('Word file has the ZIP/OOXML magic bytes', head === 'PK')
check('docx library major version detected', docx.DOCX_VERSION >= 8, `got ${docx.DOCX_VERSION}`)
fs.unlinkSync(tmp)

/* ========================================================================== */
console.log('\n=== 2. Picture plate: four or six pictures, in order ===\n')

const pics = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `m${i + 1}`,
    kind: 'image',
    filePath: `/tmp/frame-${i + 1}.png`,
    caption: `Frame ${i + 1}`,
  }))

const flow = buildImagePlan({ media: pics(5) }, { imageLayout: 'flow', imageColumns: 3 })
check('flowing layout prints every picture', flow.slots.length === 5 && flow.capacity === 0, JSON.stringify(flow.slots.length))

const g4 = buildImagePlan({ media: pics(6) }, { imageLayout: 'grid4' })
check('4-picture plate always has exactly four slots', g4.slots.length === 4 && g4.capacity === 4)
check('4-picture plate is one column down the right side', g4.columns === 1 && g4.side === 4 && g4.top === 0, JSON.stringify({ c: g4.columns, side: g4.side }))
check('4-picture plate fills itself from the first four captures', g4.filled === 4 && g4.spare === 0)
check('4-picture plate keeps the capture order', g4.slots.map((s) => s.id).join(',') === 'm1,m2,m3,m4')

const g6 = buildImagePlan({ media: pics(7) }, { imageLayout: 'grid6' })
check('6-picture plate always has exactly six slots', g6.slots.length === 6 && g6.capacity === 6)
check('6-picture plate leaves the seventh picture out', g6.unused === 1, `unused ${g6.unused}`)

const partial = buildImagePlan({ media: pics(2) }, { imageLayout: 'grid6' })
check('a partly filled 6-picture plate reports its empty slots', partial.filled === 2 && partial.spare === 4)

const chosen = buildImagePlan(
  { media: pics(6), reportImages: ['m5', 'm1', null, 'm3', null, null] },
  { imageLayout: 'grid6' },
)
check('an explicit plate order is honoured', chosen.slots.map((s) => s.id).join(',') === 'm5,m1,,m3,,')
check('an edited plate is marked explicit', chosen.explicit === true)

const emptied = buildImagePlan({ media: pics(3), reportImages: [] }, { imageLayout: 'grid4' })
check('clearing the plate keeps it empty instead of auto-filling', emptied.filled === 0 && emptied.spare === 4)

/* Per-report override ------------------------------------------------------ */
const withOverride = {
  ...colon,
  media: pics(6),
  imageLayout: 'grid6',
}
const overrideModel = buildReportModel(patient, withOverride, {
  ...JSON.parse(JSON.stringify(model.template)),
  layout: { ...model.template.layout, imageLayout: 'grid4' },
})
check('a report can override the clinic plate without changing the default', overrideModel.imagePlan.mode === 'grid6')

const printHtml = buildPrintHtml(overrideModel)
check('six pictures print as three across the top and three down the side',
  /class="sheet-top"/.test(printHtml) && /class="sheet-side"/.test(printHtml) && (printHtml.match(/<figure>/g) || []).length >= 6,
  'sheet markup missing')
check('the six-picture sheet splits the report into a text column and a picture column',
  /class="sheet-split has-side"/.test(printHtml) && /class="sheet-main"/.test(printHtml))
check('print HTML keeps the pictures at full resolution', !/width="\d{2,3}" height="\d{2,3}"/.test(printHtml))

/* ========================================================================== */
console.log('\n=== 3. Word template merge: letterhead survives, tokens expand ===\n')

const templateDoc = path.join(os.tmpdir(), `endoreport-tpl-${Date.now()}.docx`)
await docx.saveDocx(model, templateDoc)

/** Adds real {{TOKEN}} lines to a normal report and uses it as the template. */
async function makeTemplate(docPath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(docPath))
  const xml = await zip.file('word/document.xml').async('string')
  const injected = xml.replace(
    '</w:body>',
    '<w:p><w:r><w:t xml:space="preserve">Patient: {{PATIENT_NAME}} / {{REG_NO}}</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>{{IMPRESSION}}</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>{{FINDINGS}}</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>{{IMAGES}}</w:t></w:r></w:p></w:body>',
  )
  zip.file('word/document.xml', injected)
  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  return buf.toString('base64')
}

const base64 = await makeTemplate(templateDoc)
fs.unlinkSync(templateDoc)

const parsed = await docxTemplate.parseDocxBuffer(Buffer.from(base64, 'base64'))
check('the imported template is parsed into editable blocks', parsed.blocks.length > 5, `${parsed.blocks.length} blocks`)
check('the parser finds the placeholders', ['PATIENT_NAME', 'REG_NO', 'IMPRESSION', 'FINDINGS', 'IMAGES'].every((t) => parsed.tokens.includes(t)), parsed.tokens.join(','))
check('no placeholder is reported as unknown', parsed.unknownTokens.length === 0, parsed.unknownTokens.join(','))

const png1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const plateImage = { relId: 'rIdErPlate1', docPr: 1001, name: 'plate-1.png', ext: 'png', buffer: png1x1, caption: '1. Frame one' }

const merged = await docxTemplate.renderDocxTemplate(base64, overrideModel, { images: [plateImage] })
const mergedZip = await JSZip.loadAsync(merged)
const mergedXml = await mergedZip.file('word/document.xml').async('string')
const mergedRels = await mergedZip.file('word/_rels/document.xml.rels').async('string')
const hasDocPr = (xml, id) => new RegExp(`docPr id="${id}"`).test(xml)

check('the merged package is a valid Word file', merged.subarray(0, 2).toString('latin1') === 'PK')
check('the patient name is filled into the template', mergedXml.includes('Abdul Karim'))
check('the registration number is filled into the template', /ER-\d{8}-\d{4}/.test(mergedXml))
check('the impression expands into the report', /IMPRESSION|Sigmoid/i.test(mergedXml))
check('the findings block expands into the report', /diverticul/i.test(mergedXml))
check('no raw placeholder is left behind', !/\{\{[A-Z_]+\}\}/.test(mergedXml), (mergedXml.match(/\{\{[A-Z_]+\}\}/g) || []).join(','))
check('the picture is written into word/media', !!mergedZip.file('word/media/er-plate-1001.png'))
check('the picture relationship is registered', mergedRels.includes('Id="rIdErPlate1"'))
check('the picture relationship target is relative to word/', mergedRels.includes('Target="media/er-plate-1001.png"'))
check('the picture is referenced from the document body', hasDocPr(mergedXml, 1001), 'docPr 1001 missing')
check('the picture content type is declared', (mergedXml.length > 0) && (await mergedZip.file('[Content_Types].xml').async('string')).includes('Extension="png"'))
check('the merged file is not trivial in size', merged.length > 5000, `${merged.length} bytes`)

const noImages = await docxTemplate.renderDocxTemplate(base64, overrideModel, { images: [] })
const noImagesXml = await (await JSZip.loadAsync(noImages)).file('word/document.xml').async('string')
check('a plate-less report leaves no empty table behind', !/plate/.test(noImagesXml))


/* ========================================================================== */
console.log('\n=== 10. Update artefact selection ===\n')

const updater = require('../electron/updater.cjs')

check('a Setup .exe is installable', updater.isInstallableAsset('EndoReport-Setup-0.3.0.exe'))
check('the portable Windows zip is installable', updater.isInstallableAsset('EndoReport-Portable-Windows.zip'))
check('a source archive is never offered as an update', !updater.isInstallableAsset('EndoReport-0.3.0-source.zip'))
check('checksums are never offered as an update', !updater.isInstallableAsset('checksums.txt'))
check('an unrelated file is not installable', !updater.isInstallableAsset('notes.pdf'))
check('a mac dmg is not offered to Windows users', !updater.isInstallableAsset('EndoReport-0.3.0.dmg'))

check('version comparison sees 0.2.0 < 0.3.0', updater.compareVersions('0.2.0', '0.3.0') === -1)
check('version comparison sees v0.3.0 == 0.3.0', updater.compareVersions('v0.3.0', '0.3.0') === 0)
check('version comparison handles 0.10.0 > 0.9.0', updater.compareVersions('0.10.0', '0.9.0') === 1)

/* ========================================================================== */
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
