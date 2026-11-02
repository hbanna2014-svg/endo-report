/**
 * pad-images.cjs — test helper.
 *
 * Tops a procedure up to N pictures and sets the plate layout, so the report
 * plate can be checked at the exact capacity the clinic uses (six pictures)
 * without capturing anything by hand.
 *
 *   ENDOREPORT_DATA_DIR=<folder> npx electron scripts/pad-images.cjs --no-sandbox
 */

const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const db = require('../electron/db.cjs')

async function run() {
  const dataDir = process.env.ENDOREPORT_DATA_DIR
  const target = Number(process.env.PAD_TO || 6)
  const layout = process.env.PAD_LAYOUT || 'grid6'
  if (!dataDir) {
    console.error('[PAD] set ENDOREPORT_DATA_DIR')
    app.exit(2)
    return
  }

  await db.init(dataDir)
  const procedures = await db.listProcedures({ limit: 10 })
  if (!procedures.length) {
    console.error('[PAD] no procedure found — run seed-demo.cjs first')
    app.exit(2)
    return
  }

  const wanted = process.env.PAD_TEST || 'colonoscopy'
  const summary = procedures.find((p) => p.testName === wanted) || procedures[0]
  const proc = await db.getProcedure(summary.id)
  const existing = proc.media || []
  if (!existing.length) {
    console.error('[PAD] procedure has no pictures to copy')
    app.exit(2)
    return
  }

  const source = existing[0].filePath
  const dir = path.dirname(source)
  const before = existing.length

  for (let i = existing.length; i < target; i += 1) {
    const file = path.join(dir, `pad-${i + 1}.png`)
    fs.copyFileSync(source, file)
    // eslint-disable-next-line no-await-in-loop
    await db.addMedia({
      patientId: proc.patientId,
      procedureId: proc.id,
      kind: 'image',
      section: 'sigmoid',
      caption: `Additional view ${i + 1}`,
      filePath: file,
      mime: 'image/png',
      bytes: fs.statSync(file).size,
    })
  }

  const { media, ...payload } = proc
  await db.saveProcedure(proc.patientId, {
    ...payload,
    imageLayout: layout,
    // Optional: move the study to the top of the register so an automated check
    // can open it by clicking the first "Open".
    ...(process.env.PAD_DATE ? { procedureDate: process.env.PAD_DATE } : {}),
  })

  const after = await db.listMedia(proc.id)
  console.log(`[PAD] ${before} -> ${after.length} pictures · layout ${layout} · ${proc.id}`)
  app.exit(0)
}

app.disableHardwareAcceleration()

app
  .whenReady()
  .then(run)
  .catch((err) => {
    console.error('[PAD] failed:', err)
    app.exit(1)
  })
