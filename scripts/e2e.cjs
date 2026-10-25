/**
 * e2e.cjs — end-to-end check that runs inside the real Electron runtime.
 *
 * Verifies the local database, the media pipeline and the Word export exactly
 * as the shipped application uses them.
 *
 * Run with:
 *   xvfb-run -a npx electron scripts/e2e.cjs --no-sandbox      (Linux/CI)
 *   npx electron scripts/e2e.cjs                                (Windows)
 */

const { app } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const db = require('../electron/db.cjs')
const docx = require('../electron/docx.cjs')
const docxTemplate = require('../electron/docxTemplate.cjs')
const JSZip = require('jszip')

const ROOT = path.join(__dirname, '..')
const esmImport = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n        ${detail}` : ''}`)
}

/** 2x2 red PNG — the smallest valid image we can push through the media path. */
const PNG_2x2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DAwMDAwMDEwMDAwAAAHAABcq6GzwAAAABJRU5ErkJggg==',
  'base64',
)

async function run() {
  const dataDir = path.join(os.tmpdir(), `endoreport-e2e-${Date.now()}`)
  console.log(`\nData directory: ${dataDir}\n`)

  console.log('--- 1. Database initialisation ---')
  await db.init(dataDir)
  const stats0 = await db.stats()
  console.log(`  stats: ${JSON.stringify(stats0)}`)
  check('database opens and schema is created', stats0.patients === 0 && stats0.procedures === 0)
  check('db folder exists on disk', fs.existsSync(path.join(dataDir, 'db', 'PG_VERSION')))

  const settings = await db.getSetting('clinic', null)
  check('clinic settings are seeded on first run', settings && typeof settings === 'object')

  const { emptyProcedure } = await esmImport('src/lib/autoReport.js')
  const { buildReportModel } = await esmImport('src/lib/reportModel.js')
  check('ESM reporting engine is importable from the main process', typeof emptyProcedure === 'function')
  check('the report model is importable from the main process', typeof buildReportModel === 'function')

  console.log('\n--- 2. Patient CRUD ---')
  const regNo = await db.nextRegNo()
  console.log(`  generated registration number: ${regNo}`)
  check('registration number follows ER<year>-####', /^ER\d{4}-\d{4}$/.test(regNo), regNo)

  const patient = await db.savePatient({
    name: 'E2E Test Patient',
    age: '54',
    ageUnit: 'years',
    sex: 'Female',
    phone: '01700-000000',
    address: 'Test address',
    referredBy: 'Dr. Referrer',
    performingDoctor: 'Dr. Operator',
    indication: 'Screening colonoscopy',
    history: 'Nil significant',
  })
  check('patient saved with an id', !!patient.id)
  check('patient received a registration number', !!patient.regNo)

  const updated = await db.savePatient({ ...patient, phone: '01999-111111' })
  check('patient update preserves the id', updated.id === patient.id)
  check('patient update changed the phone', updated.phone === '01999-111111')

  const found = await db.listPatients('E2E')
  check('patient is findable by name search', found.length === 1 && found[0].id === patient.id)

  console.log('\n--- 3. Procedure + findings persistence ---')
  const procedure = {
    ...emptyProcedure('colonoscopy'),
    procedureDate: '2026-10-16',
    performingDoctor: 'Dr. Operator',
    extentReached: 'Caecum',
    prepQuality: 'Good',
    bbps: { right: '3', transverse: '3', left: '3' },
    withdrawalTime: '9',
    sedation: 'Conscious sedation — midazolam + pethidine',
    complications: 'None.',
    biopsy: { taken: true, sites: 'Sigmoid polyp', count: '1' },
    entries: [
      { uid: 'u1', sectionId: 'sigmoid', findingId: 'sigmoid_polyp', values: { number: '1', size: '8', morphology: 'sessile', resection: 'cold snare polypectomy', completeness: 'complete' }, notes: '' },
      { uid: 'u2', sectionId: 'caecum', findingId: 'normal_caecum', values: {}, notes: '' },
    ],
  }
  const savedProc = await db.saveProcedure(patient.id, procedure)
  check('procedure saved and readable', savedProc && savedProc.id)
  check('JSONB payload round-trips', savedProc.entries?.length === 2, JSON.stringify(savedProc?.entries))
  check('nested biopsy object round-trips', savedProc.biopsy?.taken === true && savedProc.biopsy.sites === 'Sigmoid polyp')

  const listed = await db.listProcedures({ patientId: patient.id })
  check('procedure appears in the register', listed.length === 1 && listed[0].patientName === 'E2E Test Patient')

  console.log('\n--- 4. Media pipeline ---')
  const mediaDir = path.join(dataDir, 'media', patient.id, savedProc.id)
  fs.mkdirSync(mediaDir, { recursive: true })
  const imgPath = path.join(mediaDir, 'shot.png')
  fs.writeFileSync(imgPath, PNG_2x2)
  const media = await db.addMedia({
    patientId: patient.id,
    procedureId: savedProc.id,
    kind: 'image',
    section: 'sigmoid',
    caption: 'Sigmoid polyp before resection',
    filePath: imgPath,
    mime: 'image/png',
    bytes: PNG_2x2.length,
  })
  check('media record saved', !!media.id)

  const mediaList = await db.listMedia(savedProc.id)
  check('media is attached to the procedure', mediaList.length === 1)
  const withMedia = await db.getProcedure(savedProc.id)
  check('getProcedure returns the attached media', withMedia.media.length === 1)

  const dims = docx.imageSize(PNG_2x2)
  check('image dimensions are parsed from the PNG', dims && dims.width === 2 && dims.height === 2, JSON.stringify(dims))

  const renamed = await db.updateMedia(media.id, { caption: 'Sigmoid polyp — post polypectomy' })
  check('media caption can be edited', renamed.caption === 'Sigmoid polyp — post polypectomy')

  console.log('\n--- 4b. The 4 / 6 picture plate travels with the report ---')
  await db.saveProcedure(patient.id, { ...savedProc, reportImages: [media.id], imageLayout: 'grid6' })
  const reloaded = await db.getProcedure(savedProc.id)
  check('the plate order is persisted in the JSONB payload', Array.isArray(reloaded.reportImages) && reloaded.reportImages[0] === media.id)
  check('the per-report plate choice is persisted', reloaded.imageLayout === 'grid6')

  const plateModel = buildReportModel(patient, reloaded, null)
  check('the saved plate drives the report model', plateModel.imagePlan.mode === 'grid6' && plateModel.imagePlan.capacity === 6)
  check('the saved picture sits in slot 1', plateModel.imagePlan.slots[0].id === media.id)
  check('the plate reports five empty slots', plateModel.imagePlan.spare === 5, `spare ${plateModel.imagePlan.spare}`)

  console.log('\n--- 5. Word export through the real model ---')
  const model = buildReportModel(patient, { ...reloaded, media: mediaList }, null)
  const docxPath = path.join(dataDir, 'exports', 'e2e-report.docx')
  const res = await docx.saveDocx(model, docxPath)
  const size = fs.statSync(docxPath).size
  const magic = fs.readFileSync(docxPath).subarray(0, 2).toString('latin1')
  console.log(`  wrote ${docxPath} (${size} bytes)`)
  check('Word document written', res.bytes > 5000)
  check('Word document is a valid OOXML zip', magic === 'PK')
  check('model recorded the auto impression', model.narrative.diagnosis.length > 10)

  const extracted = magic === 'PK'
  const hasDocXml = (() => {
    // Minimal check: the OOXML package must contain the document part.
    const raw = fs.readFileSync(docxPath).toString('latin1')
    return raw.includes('[Content_Types].xml') && raw.includes('word/document.xml')
  })()
  check('Word package contains document.xml', extracted && hasDocXml)

  console.log('\n--- 5b. Opening a Word report back into the editor ---')
  const { convertDocxBuffer } = require('../electron/docxToHtml.cjs')
  const converted = await convertDocxBuffer(fs.readFileSync(docxPath))
  check('Word file converts back to editable HTML', !!(converted && converted.html && converted.html.length > 50))
  check('the converted report keeps the patient name', String(converted.html).includes('E2E Test Patient'))
  check('the converted report keeps the findings text', /Impression|FINDINGS|Findings/i.test(String(converted.html)))

  console.log('\n--- 6. Doctors, templates and settings ---')
  const doc = await db.saveDoctor({
    name: 'Dr. Test Endoscopist',
    designation: 'Consultant',
    degrees: 'MBBS, MD (Gastro)',
    affiliation: 'Test Medical College',
    role: 'endoscopist',
    isDefault: true,
  })
  check('doctor saved', !!doc.id && (await db.listDoctors()).length === 1)
  check('doctor degrees and affiliation stored', doc.degrees === 'MBBS, MD (Gastro)' && doc.affiliation === 'Test Medical College')
  check('doctor marked as default', doc.isDefault === true)

  const sealFile = await db.setDoctorSeal(dataDir, doc.id, Buffer.from('89504e470d0a1a0a', 'hex'), 'png')
  check('doctor seal written to disk', fs.existsSync(sealFile))
  const withSeal = (await db.listDoctors()).find((d) => d.id === doc.id)
  check('doctor seal path persisted', withSeal.sealPath === sealFile)
  const second = await db.saveDoctor({ name: 'Dr. Second', role: 'endoscopist', isDefault: true })
  const defaults = (await db.listDoctors()).filter((d) => d.isDefault)
  check('only one doctor is the default', defaults.length === 1 && defaults[0].id === second.id)
  await db.deleteDoctor(second.id)

  const { DEFAULT_TEMPLATE } = await esmImport('src/lib/reportModel.js')
  const tpl = await db.saveTemplate({ ...DEFAULT_TEMPLATE, id: null, isDefault: true })
  check('template saved', !!tpl.id)
  const tplList = await db.listTemplates()
  check('template listed with its layout', tplList.length === 1 && !!tplList[0].layout)
  check('template marked default', tplList[0].isDefault === true)

  console.log('\n--- 6b. A Word template stored in the layout ---')
  const tplZip = await JSZip.loadAsync(fs.readFileSync(docxPath))
  const docXml = await tplZip.file('word/document.xml').async('string')
  tplZip.file(
    'word/document.xml',
    docXml.replace(
      '</w:body>',
      '<w:p><w:r><w:t xml:space="preserve">Name: {{PATIENT_NAME}} — {{REG_NO}}</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>{{FINDINGS}}</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>{{IMAGES}}</w:t></w:r></w:p></w:body>',
    ),
  )
  const tplBuf = await tplZip.generateAsync({ type: 'nodebuffer' })
  const tplBase64 = tplBuf.toString('base64')
  const tplParsed = await docxTemplate.parseDocxBuffer(tplBuf)
  check('the Word file is parsed into editable lines', tplParsed.blocks.length > 3)
  check('the placeholders in it are found', tplParsed.tokens.includes('IMAGES') && tplParsed.tokens.includes('PATIENT_NAME'), tplParsed.tokens.join(','))

  const tplWithWord = await db.saveTemplate({
    ...tpl,
    layout: {
      ...tpl.layout,
      wordTemplate: {
        fileName: 'letterhead.docx',
        bytes: tplBuf.length,
        base64: tplBase64,
        blocks: tplParsed.blocks,
        tokens: tplParsed.tokens,
      },
    },
  })
  check('a Word template saves into the layout', !!tplWithWord.layout.wordTemplate.fileName)
  const tplBack = (await db.listTemplates())[0]
  check('the Word file survives the JSONB round-trip byte for byte', tplBack.layout.wordTemplate.base64 === tplBase64)
  check('the parsed lines survive the round-trip', tplBack.layout.wordTemplate.blocks.length === tplParsed.blocks.length)

  const mergeModel = { ...model, template: { ...model.template, layout: tplBack.layout } }
  const mergedBuf = await docxTemplate.renderDocxTemplate(tplBack.layout.wordTemplate.base64, mergeModel, {
    images: [{ relId: 'rIdErPlate1', docPr: 1001, name: 'plate-1.png', ext: 'png', buffer: PNG_2x2, caption: '1. Sigmoid polyp' }],
  })
  const mz = await JSZip.loadAsync(mergedBuf)
  const mXml = await mz.file('word/document.xml').async('string')
  const mRels = await mz.file('word/_rels/document.xml.rels').async('string')
  check('the report is written into the clinic Word file', mergedBuf.subarray(0, 2).toString('latin1') === 'PK' && mXml.includes('E2E Test Patient'))
  check('the findings expand inside the Word file', /polyp/i.test(mXml))
  check('the plate picture lands in word/media', !!mz.file('word/media/er-plate-1001.png'))
  check('the picture relationship resolves from word/', mRels.includes('Target="media/er-plate-1001.png"'))
  check('no placeholder is left in the merged file', !/\{\{[A-Z_]+\}\}/.test(mXml))

  await db.setSetting('prefs', { imageColumns: 3, language: 'en' })
  const prefs = await db.getSetting('prefs', null)
  check('settings round-trip', prefs?.imageColumns === 3)

  console.log('\n--- 7. Schema migration safety ---')
  // Make one report 'final' so the back-fill path is actually exercised.
  await db.q(`UPDATE procedures SET report_status = 'final' WHERE id = $1`, [savedProc.id])
  await db.q(`ALTER TABLE media DROP COLUMN IF EXISTS thumb_path`)
  await db.q(`ALTER TABLE procedures DROP COLUMN IF EXISTS finalised_at`)
  await db.q(`UPDATE schema_meta SET value = '1' WHERE key = 'version'`)

  const migrated = await db.migrate()
  check('legacy v1 database is detected', migrated.from === 1, JSON.stringify(migrated))
  check('migration reached the current schema version', migrated.to === db.SCHEMA_VERSION)
  check('every pending migration step was applied', migrated.applied.length === db.SCHEMA_VERSION - 1, JSON.stringify(migrated.applied))

  const mediaCols = await db.q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'media'`)
  check('media.thumb_path exists after migration', mediaCols.some((c) => c.column_name === 'thumb_path'))
  const procCols = await db.q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'procedures'`)
  check('procedures.finalised_at exists after migration', procCols.some((c) => c.column_name === 'finalised_at'))

  const patientCols = await db.q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'patients'`)
  check('patients.identity_no added by migration 3', patientCols.some((c) => c.column_name === 'identity_no'))
  check('patients.visit_id added by migration 3', patientCols.some((c) => c.column_name === 'visit_id'))

  const doctorCols = await db.q(`SELECT column_name FROM information_schema.columns WHERE table_name = 'doctors'`)
  check('doctors.seal_path added by migration 4', doctorCols.some((c) => c.column_name === 'seal_path'))
  check('doctors.is_default added by migration 4', doctorCols.some((c) => c.column_name === 'is_default'))

  const stillThere = await db.listProcedures({ patientId: patient.id })
  check('records survive the migration', stillThere.length === 1, `${stillThere.length} found`)
  const backfilled = await db.q(`SELECT finalised_at FROM procedures WHERE id = $1`, [savedProc.id])
  check('final reports are back-filled with a finalisation timestamp', !!backfilled[0]?.finalised_at)

  const again = await db.migrate()
  check('running the migration twice is a no-op', again.from === db.SCHEMA_VERSION && again.applied.length === 0)

  console.log('\n--- 8. Upgrade safety (marker + pre-upgrade copy) ---')
  const lifecycle = require('../electron/lifecycle.cjs')
  const marker = lifecycle.ensureMarker(dataDir)
  check('data folder marker created with an id', !!marker.dataId)
  check('marker is readable back', lifecycle.readMarker(dataDir)?.dataId === marker.dataId)
  lifecycle.writeVersionStamp(dataDir, { appVersion: '0.2.0', schemaVersion: 1 })
  const stamp = lifecycle.readVersionStamp(dataDir)
  check('version stamp records the last run version', stamp.appVersion === '0.2.0' && stamp.schemaVersion === 1)

  const snap = lifecycle.snapshotBeforeUpgrade(dataDir, 1, 2)
  check('pre-upgrade database copy created', !!snap && fs.existsSync(path.join(snap.dir, 'PG_VERSION')), JSON.stringify(snap))
  check('copy has restore instructions', fs.existsSync(path.join(snap.dir, 'BACKUP-INFO.json')))
  check('backup list exposes the copy', lifecycle.listBackups(dataDir).length >= 1)

  console.log('\n--- 9. Maintenance and deletions ---')
  const stats1 = await db.stats()
  console.log(`  stats: ${JSON.stringify(stats1)}`)
  check('stats count one patient and one report', stats1.patients === 1 && stats1.procedures === 1)
  check('stats count one image', stats1.images === 1)

  const maint = await db.maintenanceSummary(30)
  check('maintenance summary returns daily buckets', Array.isArray(maint.daily))

  await db.deleteProcedure(savedProc.id)
  const afterProc = await db.listProcedures({ patientId: patient.id })
  check('procedure deleted', afterProc.length === 0)
  const afterMedia = await db.listMedia(savedProc.id)
  check('media cascaded away with the procedure', afterMedia.length === 0)

  await db.deletePatient(patient.id)
  const afterPatient = await db.listPatients('E2E')
  check('patient deleted', afterPatient.length === 0)

  console.log(`\n${failures === 0 ? 'ALL END-TO-END CHECKS PASSED' : `${failures} END-TO-END CHECK(S) FAILED`}\n`)
  return failures
}

app.disableHardwareAcceleration()

app
  .whenReady()
  .then(run)
  .then((f) => {
    app.exit(f === 0 ? 0 : 1)
  })
  .catch((err) => {
    console.error('\nE2E RUN CRASHED:', err)
    app.exit(2)
  })
