/**
 * set-hospital-preview.cjs — prepares a demo data folder for the UI check of
 * the editable Procedure / Indication / Medication lines.
 *
 * It switches the report template to the hospital paper form and gives the first
 * draft a patient whose registration already carries an indication and a
 * medication, the way "New patient" saves them.
 */

const { app } = require('electron')
const db = require('../electron/db.cjs')

async function run() {
  const dir = process.env.ENDOREPORT_DATA_DIR
  await db.init(dir)

  const templates = await db.listTemplates()
  for (const t of templates) {
    await db.saveTemplate({ ...t, layout: { ...(t.layout || {}), style: 'hospital' } })
  }

  const patients = await db.listPatients('', 10)
  const target = patients.find((p) => p.name === 'Md. Jahangir Alam') || patients[0]
  if (target) {
    await db.savePatient({
      ...target,
      indication: 'Dysphagia to solids for 2 months with weight loss',
      medication: 'Omeprazole 20 mg BD, Domperidone 10 mg TDS',
    })
    const procs = await db.listProcedures({ patientId: target.id })
    const draft = procs.find((p) => p.status === 'draft') || procs[0]
    if (draft) {
      await db.saveProcedure(target.id, {
        ...draft,
        indication: target.indication,
        medication: target.medication,
      })
    }
  }

  console.log('[PREP] hospital template + patient indication/medication ready')
}

app.whenReady().then(async () => {
  try {
    await run()
    app.exit(0)
  } catch (err) {
    console.error(err)
    app.exit(1)
  }
})
