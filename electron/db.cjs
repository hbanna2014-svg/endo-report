/**
 * db.cjs — local, fully offline database layer.
 *
 * Uses PGlite (PostgreSQL compiled to WebAssembly) so the clinic gets a real
 * SQL database with JSONB support without needing to install or run a database
 * server. Everything lives in a single folder under the user's data directory
 * which makes backup and restore a simple folder copy.
 */

const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')

/**
 * Bump this whenever the schema changes and add a matching entry to MIGRATIONS.
 * Existing clinics are upgraded in place; their data is never recreated.
 */
const SCHEMA_VERSION = 4

/**
 * Ordered, idempotent schema migrations. Each entry moves a database from
 * `to - 1` to `to`. Migrations run inside a transaction: if one fails the
 * database is left exactly as it was and startup aborts with a clear error
 * rather than half-migrating a clinic's records.
 */
const MIGRATIONS = [
  {
    to: 2,
    name: 'thumbnail path, report finalisation timestamp, faster media lookup',
    up: async (db) => {
      await db.exec(`ALTER TABLE media ADD COLUMN IF NOT EXISTS thumb_path TEXT`)
      await db.exec(`ALTER TABLE procedures ADD COLUMN IF NOT EXISTS finalised_at TIMESTAMPTZ`)
      await db.exec(
        `UPDATE procedures SET finalised_at = updated_at
         WHERE finalised_at IS NULL AND report_status = 'final'`,
      )
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_media_taken ON media(taken_at)`)
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_procedures_status ON procedures(report_status)`)
    },
  },
  {
    to: 3,
    name: 'hospital identity / visit numbers on the patient record',
    up: async (db) => {
      await db.exec(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS identity_no TEXT`)
      await db.exec(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS visit_id TEXT`)
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_patients_identity ON patients(identity_no)`)
    },
  },
  {
    to: 4,
    name: 'doctor signature seals',
    up: async (db) => {
      await db.exec(`ALTER TABLE doctors ADD COLUMN IF NOT EXISTS degrees TEXT`)
      await db.exec(`ALTER TABLE doctors ADD COLUMN IF NOT EXISTS affiliation TEXT`)
      await db.exec(`ALTER TABLE doctors ADD COLUMN IF NOT EXISTS seal_path TEXT`)
      await db.exec(`ALTER TABLE doctors ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false`)
    },
  },
]

let PGliteCtor = null
let db = null
let readyPromise = null
let dataDir = null
let lastMigration = null

async function loadPglite() {
  if (PGliteCtor) return PGliteCtor
  const mod = await import('@electric-sql/pglite')
  PGliteCtor = mod.PGlite
  return PGliteCtor
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  reg_no TEXT UNIQUE,
  identity_no TEXT,
  visit_id TEXT,
  name TEXT NOT NULL,
  age TEXT,
  age_unit TEXT DEFAULT 'years',
  sex TEXT,
  phone TEXT,
  address TEXT,
  referred_by TEXT,
  performing_doctor TEXT,
  assistant TEXT,
  indication TEXT,
  history TEXT,
  allergy TEXT,
  medication TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS procedures (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  test_name TEXT NOT NULL,
  procedure_date TEXT,
  performing_doctor TEXT,
  assistant TEXT,
  report_status TEXT NOT NULL DEFAULT 'draft',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  procedure_id TEXT NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  section TEXT,
  caption TEXT,
  file_path TEXT NOT NULL,
  mime TEXT,
  bytes INTEGER DEFAULT 0,
  duration_sec REAL,
  taken_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS doctors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  designation TEXT,
  role TEXT DEFAULT 'endoscopist',
  reg_no TEXT,
  phone TEXT,
  degrees TEXT,
  affiliation TEXT,
  seal_path TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_procedures_patient ON procedures(patient_id);
CREATE INDEX IF NOT EXISTS idx_procedures_date ON procedures(procedure_date);
CREATE INDEX IF NOT EXISTS idx_media_procedure ON media(procedure_id);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(name);
CREATE INDEX IF NOT EXISTS idx_patients_identity ON patients(identity_no);
`

function newId() {
  return crypto.randomUUID()
}

async function readSchemaVersion() {
  const res = await db.query(`SELECT value FROM schema_meta WHERE key = 'version'`)
  if (!res.rows.length) return null
  const n = Number(res.rows[0].value)
  return Number.isFinite(n) ? n : null
}

async function writeSchemaVersion(v) {
  await db.query(
    `INSERT INTO schema_meta (key, value) VALUES ('version', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [String(v)],
  )
}

/**
 * Brings an existing database up to SCHEMA_VERSION without touching user data.
 * Returns a summary so the caller can log / show what happened on an upgrade.
 */
async function migrate() {
  const from = await readSchemaVersion()

  if (from === null) {
    // Brand new database — record the current version and move on.
    await writeSchemaVersion(SCHEMA_VERSION)
    lastMigration = { from: null, to: SCHEMA_VERSION, applied: [], fresh: true }
    return lastMigration
  }

  if (from > SCHEMA_VERSION) {
    throw new Error(
      `This data folder was created by a newer version of EndoReport (database v${from}, this build supports v${SCHEMA_VERSION}). ` +
        'Update the application first — opening it with an older build could damage the records.',
    )
  }

  if (from === SCHEMA_VERSION) {
    lastMigration = { from, to: from, applied: [], fresh: false }
    return lastMigration
  }

  const pending = MIGRATIONS.filter((m) => m.to > from).sort((a, b) => a.to - b.to)
  const applied = []

  for (const step of pending) {
    await db.exec('BEGIN')
    try {
      await step.up(db)
      await db.exec('COMMIT')
      applied.push({ to: step.to, name: step.name })
      console.log(`[db] migrated to schema v${step.to}: ${step.name}`)
    } catch (err) {
      try {
        await db.exec('ROLLBACK')
      } catch {
        /* the transaction may already be aborted */
      }
      throw new Error(
        `Database migration to v${step.to} failed: ${err.message}. ` +
          'Your records were not changed — a copy of the database was saved before the upgrade.',
      )
    }
  }

  await writeSchemaVersion(SCHEMA_VERSION)
  lastMigration = { from, to: SCHEMA_VERSION, applied, fresh: false }
  return lastMigration
}

async function init(dir) {
  if (readyPromise) return readyPromise
  dataDir = dir
  fs.mkdirSync(path.join(dataDir, 'db'), { recursive: true })
  fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true })
  fs.mkdirSync(path.join(dataDir, 'exports'), { recursive: true })

  readyPromise = (async () => {
    const PGlite = await loadPglite()
    db = await PGlite.create({ dataDir: path.join(dataDir, 'db') })
    await db.exec(SCHEMA)
    await migrate()
    // Seed settings on first run.
    const existing = await db.query(`SELECT key FROM settings WHERE key = 'clinic'`)
    if (!existing.rows.length) {
      await db.query(`INSERT INTO settings (key, value) VALUES ('clinic', $1)`, [
        JSON.stringify({
          clinicName: 'Endoscopy & Colonoscopy Centre',
          clinicAddress: '',
          clinicPhone: '',
          clinicEmail: '',
          doctorName: '',
          doctorDegrees: '',
          doctorDesignation: 'Consultant Gastroenterologist',
          doctorRegNo: '',
          logoDataUrl: '',
        }),
      ])
      await db.query(`INSERT INTO settings (key, value) VALUES ('prefs', $1)`, [
        JSON.stringify({ reportStatus: 'draft', imageColumns: 3, autoImpressions: true, language: 'en' }),
      ])
    }
    return db
  })()

  return readyPromise
}

function requireDb() {
  if (!db) throw new Error('Database has not been initialised yet.')
  return db
}

async function q(sql, params = []) {
  const res = await requireDb().query(sql, params)
  return res.rows
}

/* -------------------------------------------------------------------------- */
/* Patients                                                                    */
/* -------------------------------------------------------------------------- */

function rowToPatient(r) {
  if (!r) return null
  return {
    id: r.id,
    regNo: r.reg_no,
    identityNo: r.identity_no,
    visitId: r.visit_id,
    name: r.name,
    age: r.age,
    ageUnit: r.age_unit,
    sex: r.sex,
    phone: r.phone,
    address: r.address,
    referredBy: r.referred_by,
    performingDoctor: r.performing_doctor,
    assistant: r.assistant,
    indication: r.indication,
    history: r.history,
    allergy: r.allergy,
    medication: r.medication,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

async function nextRegNo() {
  const year = new Date().getFullYear()
  const rows = await q(
    `SELECT COUNT(*)::int AS c FROM patients WHERE reg_no LIKE $1`,
    [`ER${year}-%`],
  )
  const n = (rows[0]?.c || 0) + 1
  return `ER${year}-${String(n).padStart(4, '0')}`
}

const PATIENT_COLUMNS = [
  ['reg_no', 'regNo'],
  ['identity_no', 'identityNo'],
  ['visit_id', 'visitId'],
  ['name', 'name'],
  ['age', 'age'],
  ['age_unit', 'ageUnit'],
  ['sex', 'sex'],
  ['phone', 'phone'],
  ['address', 'address'],
  ['referred_by', 'referredBy'],
  ['performing_doctor', 'performingDoctor'],
  ['assistant', 'assistant'],
  ['indication', 'indication'],
  ['history', 'history'],
  ['allergy', 'allergy'],
  ['medication', 'medication'],
  ['notes', 'notes'],
]

async function savePatient(input) {
  const id = input.id || newId()
  const regNo = input.regNo && String(input.regNo).trim() ? String(input.regNo).trim() : await nextRegNo()
  const existing = await q(`SELECT id FROM patients WHERE id = $1`, [id])
  if (existing.length) {
    const sets = PATIENT_COLUMNS.map(([col], i) => `${col} = $${i + 2}`).join(', ')
    await q(
      `UPDATE patients SET ${sets}, updated_at = now() WHERE id = $1`,
      [id, regNo, ...PATIENT_COLUMNS.slice(1).map(([, key]) => input[key] ?? null)],
    )
  } else {
    const cols = PATIENT_COLUMNS.map(([c]) => c)
    const placeholders = cols.map((_, i) => `$${i + 2}`)
    await q(
      `INSERT INTO patients (id, ${cols.join(', ')})
       VALUES ($1, ${placeholders.join(', ')})`,
      [id, regNo, ...PATIENT_COLUMNS.slice(1).map(([, key]) => input[key] ?? null)],
    )
  }
  return getPatient(id)
}

async function getPatient(id) {
  const rows = await q(`SELECT * FROM patients WHERE id = $1`, [id])
  return rowToPatient(rows[0])
}

async function listPatients(search = '', limit = 500) {
  const term = `%${String(search || '').trim()}%`
  const rows = await q(
    `SELECT p.*,
            (SELECT COUNT(*)::int FROM procedures pr WHERE pr.patient_id = p.id) AS procedure_count,
            (SELECT MAX(pr.procedure_date) FROM procedures pr WHERE pr.patient_id = p.id) AS last_procedure
     FROM patients p
     WHERE p.name ILIKE $1 OR COALESCE(p.reg_no,'') ILIKE $1 OR COALESCE(p.phone,'') ILIKE $1
        OR COALESCE(p.referred_by,'') ILIKE $1
     ORDER BY p.updated_at DESC
     LIMIT $2`,
    [term, limit],
  )
  return rows.map((r) => ({ ...rowToPatient(r), procedureCount: r.procedure_count, lastProcedure: r.last_procedure }))
}

async function deletePatient(id) {
  await q(`DELETE FROM patients WHERE id = $1`, [id])
  return true
}

/* -------------------------------------------------------------------------- */
/* Procedures                                                                  */
/* -------------------------------------------------------------------------- */

/** jsonb columns come back decoded from PGlite but as text from a raw query. */
function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function rowToProcedure(r, withPayload = true) {
  if (!r) return null
  const base = {
    id: r.id,
    patientId: r.patient_id,
    testName: r.test_name,
    procedureDate: r.procedure_date,
    performingDoctor: r.performing_doctor,
    assistant: r.assistant,
    reportStatus: r.report_status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
  if (!withPayload) return base
  const payload = parseJson(r.payload, {})
  return { ...base, ...payload, id: r.id, patientId: r.patient_id, testName: r.test_name }
}

async function saveProcedure(patientId, payload) {
  const id = payload.id || newId()
  const existing = await q(`SELECT id FROM procedures WHERE id = $1`, [id])
  const p = { ...payload }
  delete p.id
  delete p.patientId
  const json = JSON.stringify(p)

  if (existing.length) {
    await q(
      `UPDATE procedures SET test_name = $2, procedure_date = $3, performing_doctor = $4,
              assistant = $5, report_status = $6, payload = $7, updated_at = now()
       WHERE id = $1`,
      [
        id,
        payload.testName || 'ogd',
        payload.procedureDate || null,
        payload.performingDoctor || null,
        payload.assistant || null,
        payload.status || 'draft',
        json,
      ],
    )
  } else {
    await q(
      `INSERT INTO procedures (id, patient_id, test_name, procedure_date, performing_doctor, assistant, report_status, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        patientId,
        payload.testName || 'ogd',
        payload.procedureDate || null,
        payload.performingDoctor || null,
        payload.assistant || null,
        payload.status || 'draft',
        json,
      ],
    )
  }
  await q(`UPDATE patients SET updated_at = now() WHERE id = $1`, [patientId])
  return getProcedure(id)
}

async function getProcedure(id) {
  const rows = await q(`SELECT * FROM procedures WHERE id = $1`, [id])
  if (!rows.length) return null
  const proc = rowToProcedure(rows[0])
  proc.media = await listMedia(id)
  return proc
}

async function listProcedures({ patientId = null, search = '', testName = null, status = null, from = null, to = null, limit = 500 } = {}) {
  const where = []
  const params = []
  let i = 1
  if (patientId) {
    where.push(`pr.patient_id = $${i++}`)
    params.push(patientId)
  }
  if (testName && testName !== 'all') {
    where.push(`pr.test_name = $${i++}`)
    params.push(testName)
  }
  if (status && status !== 'all') {
    where.push(`pr.report_status = $${i++}`)
    params.push(status)
  }
  if (from) {
    where.push(`pr.procedure_date >= $${i++}`)
    params.push(from)
  }
  if (to) {
    where.push(`pr.procedure_date <= $${i++}`)
    params.push(to)
  }
  if (search) {
    where.push(`(p.name ILIKE $${i} OR COALESCE(p.reg_no,'') ILIKE $${i})`)
    params.push(`%${search}%`)
    i++
  }
  params.push(limit)
  const rows = await q(
    `SELECT pr.*, p.name AS patient_name, p.reg_no AS patient_reg, p.age AS patient_age, p.sex AS patient_sex
     FROM procedures pr JOIN patients p ON p.id = pr.patient_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY COALESCE(pr.procedure_date, pr.created_at::text) DESC
     LIMIT $${i}`,
    params,
  )
  return rows.map((r) => ({
    ...rowToProcedure(r, false),
    patientName: r.patient_name,
    patientReg: r.patient_reg,
    patientAge: r.patient_age,
    patientSex: r.patient_sex,
  }))
}

async function deleteProcedure(id) {
  await q(`DELETE FROM procedures WHERE id = $1`, [id])
  return true
}

/* -------------------------------------------------------------------------- */
/* Media                                                                       */
/* -------------------------------------------------------------------------- */

function rowToMedia(r) {
  return {
    id: r.id,
    procedureId: r.procedure_id,
    patientId: r.patient_id,
    kind: r.kind,
    section: r.section,
    caption: r.caption,
    filePath: r.file_path,
    mime: r.mime,
    bytes: r.bytes,
    durationSec: r.duration_sec,
    takenAt: r.taken_at,
    sortOrder: r.sort_order,
  }
}

async function addMedia(record) {
  const id = record.id || newId()
  const orderRows = await q(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM media WHERE procedure_id = $1`,
    [record.procedureId],
  )
  const order = record.sortOrder ?? orderRows[0]?.next ?? 0
  await q(
    `INSERT INTO media (id, procedure_id, patient_id, kind, section, caption, file_path, mime, bytes, duration_sec, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      record.procedureId,
      record.patientId,
      record.kind || 'image',
      record.section || null,
      record.caption || '',
      record.filePath,
      record.mime || null,
      record.bytes || 0,
      record.durationSec || null,
      order,
    ],
  )
  return { ...record, id, sortOrder: order }
}

async function listMedia(procedureId) {
  const rows = await q(
    `SELECT * FROM media WHERE procedure_id = $1 ORDER BY sort_order ASC, taken_at ASC`,
    [procedureId],
  )
  return rows.map(rowToMedia)
}

async function updateMedia(id, patch) {
  const map = {
    caption: 'caption',
    section: 'section',
    sortOrder: 'sort_order',
  }
  const sets = []
  const params = [id]
  let i = 2
  for (const [key, col] of Object.entries(map)) {
    if (key in patch) {
      sets.push(`${col} = $${i++}`)
      params.push(patch[key])
    }
  }
  if (sets.length) await q(`UPDATE media SET ${sets.join(', ')} WHERE id = $1`, params)
  const rows = await q(`SELECT * FROM media WHERE id = $1`, [id])
  return rows.length ? rowToMedia(rows[0]) : null
}

async function deleteMedia(id) {
  await q(`DELETE FROM media WHERE id = $1`, [id])
  return true
}

async function listAllMedia(procedureIds) {
  if (!procedureIds.length) return []
  const rows = await q(
    `SELECT * FROM media WHERE procedure_id = ANY($1) ORDER BY sort_order ASC`,
    [procedureIds],
  )
  return rows.map(rowToMedia)
}

/* -------------------------------------------------------------------------- */
/* Doctors                                                                     */
/* -------------------------------------------------------------------------- */

async function listDoctors(activeOnly = false) {
  const rows = await q(
    `SELECT * FROM doctors ${activeOnly ? 'WHERE active = true' : ''} ORDER BY name ASC`,
  )
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    designation: r.designation,
    role: r.role,
    regNo: r.reg_no,
    phone: r.phone,
    degrees: r.degrees,
    affiliation: r.affiliation,
    sealPath: r.seal_path,
    isDefault: r.is_default,
    active: r.active,
  }))
}

async function saveDoctor(d) {
  const id = d.id || newId()
  const existing = await q(`SELECT id FROM doctors WHERE id = $1`, [id])
  if (d.isDefault) await q(`UPDATE doctors SET is_default = false`)
  const params = [
    id,
    d.name,
    d.designation || null,
    d.role || 'endoscopist',
    d.regNo || null,
    d.phone || null,
    d.degrees || null,
    d.affiliation || null,
    d.sealPath || null,
    !!d.isDefault,
    d.active !== false,
  ]
  if (existing.length) {
    await q(
      `UPDATE doctors SET name=$2, designation=$3, role=$4, reg_no=$5, phone=$6,
         degrees=$7, affiliation=$8, seal_path=$9, is_default=$10, active=$11
       WHERE id=$1`,
      params,
    )
  } else {
    await q(
      `INSERT INTO doctors (id, name, designation, role, reg_no, phone, degrees, affiliation, seal_path, is_default, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      params,
    )
  }
  const rows = await q(`SELECT * FROM doctors WHERE id = $1`, [id])
  const r = rows[0]
  return {
    id: r.id,
    name: r.name,
    designation: r.designation,
    role: r.role,
    regNo: r.reg_no,
    phone: r.phone,
    degrees: r.degrees,
    affiliation: r.affiliation,
    sealPath: r.seal_path,
    isDefault: r.is_default,
    active: r.active,
  }
}

/** Stores the uploaded stamp image and points the doctor record at it. */
async function setDoctorSeal(dataDir, id, buffer, ext) {
  const dir = path.join(dataDir, 'seals')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${id}.${ext}`)
  fs.writeFileSync(file, buffer)
  await q(`UPDATE doctors SET seal_path = $2 WHERE id = $1`, [id, file])
  return file
}

async function deleteDoctor(id) {
  await q(`DELETE FROM doctors WHERE id = $1`, [id])
  return true
}

/* -------------------------------------------------------------------------- */
/* Templates & settings                                                        */
/* -------------------------------------------------------------------------- */

async function listTemplates() {
  const rows = await q(`SELECT * FROM templates ORDER BY is_default DESC, name ASC`)
  return rows.map((r) => ({
    ...parseJson(r.payload, {}),
    id: r.id,
    name: r.name,
    isDefault: r.is_default,
  }))
}

async function saveTemplate(t) {
  const id = t.id || newId()
  const payload = JSON.stringify({ ...t, id })
  const existing = await q(`SELECT id FROM templates WHERE id = $1`, [id])
  if (t.isDefault) await q(`UPDATE templates SET is_default = false`)
  if (existing.length) {
    await q(`UPDATE templates SET name=$2, is_default=$3, payload=$4, updated_at=now() WHERE id=$1`, [
      id,
      t.name || 'Template',
      !!t.isDefault,
      payload,
    ])
  } else {
    await q(`INSERT INTO templates (id, name, is_default, payload) VALUES ($1,$2,$3,$4)`, [
      id,
      t.name || 'Template',
      !!t.isDefault,
      payload,
    ])
  }
  const rows = await q(`SELECT * FROM templates WHERE id = $1`, [id])
  // PGlite hands back jsonb columns already decoded; a text column would arrive
  // as a string. Handle both so the call site never has to care.
  return { ...parseJson(rows[0].payload, {}), isDefault: rows[0].is_default }
}

async function deleteTemplate(id) {
  await q(`DELETE FROM templates WHERE id = $1`, [id])
  return true
}

async function getSetting(key, fallback = null) {
  const rows = await q(`SELECT value FROM settings WHERE key = $1`, [key])
  if (!rows.length) return fallback
  return parseJson(rows[0].value, fallback)
}

async function setSetting(key, value) {
  await q(
    `INSERT INTO settings (key, value) VALUES ($1,$2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  )
  return value
}

/* -------------------------------------------------------------------------- */
/* Maintenance                                                                 */
/* -------------------------------------------------------------------------- */

async function stats() {
  const [p] = await q(`SELECT COUNT(*)::int AS c FROM patients`)
  const [pr] = await q(`SELECT COUNT(*)::int AS c FROM procedures`)
  const [m] = await q(`SELECT COUNT(*)::int AS c FROM media WHERE kind='image'`)
  const [v] = await q(`SELECT COUNT(*)::int AS c FROM media WHERE kind='video'`)
  const [draft] = await q(`SELECT COUNT(*)::int AS c FROM procedures WHERE report_status='draft'`)
  return {
    patients: p?.c || 0,
    procedures: pr?.c || 0,
    images: m?.c || 0,
    videos: v?.c || 0,
    drafts: draft?.c || 0,
  }
}

async function maintenanceSummary(days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  const rows = await q(
    `SELECT COALESCE(pr.procedure_date, pr.created_at::text) AS d,
            COUNT(*)::int AS c
     FROM procedures pr
     WHERE COALESCE(pr.procedure_date, pr.created_at::text) >= $1
     GROUP BY 1 ORDER BY 1 ASC`,
    [since],
  )
  const byType = await q(
    `SELECT test_name, COUNT(*)::int AS c FROM procedures GROUP BY test_name`,
  )
  return { daily: rows, byType }
}

module.exports = {
  init,
  q,
  newId,
  getDataDir: () => dataDir,
  nextRegNo,
  savePatient,
  getPatient,
  listPatients,
  deletePatient,
  saveProcedure,
  getProcedure,
  listProcedures,
  deleteProcedure,
  addMedia,
  listMedia,
  listAllMedia,
  updateMedia,
  deleteMedia,
  listDoctors,
  saveDoctor,
  deleteDoctor,
  setDoctorSeal,
  listTemplates,
  saveTemplate,
  deleteTemplate,
  getSetting,
  setSetting,
  stats,
  maintenanceSummary,
  migrate,
  readSchemaVersion,
  getLastMigration: () => lastMigration,
  SCHEMA_VERSION,
  MIGRATIONS,
}
