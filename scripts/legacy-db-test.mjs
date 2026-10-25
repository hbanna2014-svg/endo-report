/**
 * legacy-db-test.mjs — reproduces the "column identity_no does not exist"
 * startup failure that hit the first 0.5 build, and proves it is fixed.
 *
 *   node scripts/legacy-db-test.mjs create <dir>
 *   node scripts/legacy-db-test.mjs open <dir>
 *
 * `create` writes a database shaped like an older release (no identity_no,
 * no seal_path …) and rewinds the schema version to 1. `open` then starts the
 * current build against it, exactly as the application does.
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const db = require(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'electron', 'db.cjs'))

const [stage, dir] = process.argv.slice(2)
let failures = 0
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS ' : 'FAIL '} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

if (stage === 'create') {
  await db.init(dir)
  for (const sql of [
    `ALTER TABLE patients DROP COLUMN IF EXISTS identity_no`,
    `ALTER TABLE patients DROP COLUMN IF EXISTS visit_id`,
    `ALTER TABLE media DROP COLUMN IF EXISTS thumb_path`,
    `ALTER TABLE procedures DROP COLUMN IF EXISTS finalised_at`,
    `ALTER TABLE doctors DROP COLUMN IF EXISTS degrees`,
    `ALTER TABLE doctors DROP COLUMN IF EXISTS affiliation`,
    `ALTER TABLE doctors DROP COLUMN IF EXISTS seal_path`,
    `ALTER TABLE doctors DROP COLUMN IF EXISTS is_default`,
    `UPDATE schema_meta SET value = '1' WHERE key = 'version'`,
  ]) {
    await db.q(sql)
  }
  await db.q(
    `INSERT INTO patients (id, reg_no, name, age, sex) VALUES ('legacy-1','OLD-1','Legacy Patient','61','Male')`,
  )
  console.log('LEGACY DATABASE PREPARED')
  process.exit(0)
}

// The call that used to throw before the indexes were moved behind migrations.
await db.init(dir)

const version = await db.readSchemaVersion()
check('legacy database opens without error', true)
check('schema upgraded to the current version', version === db.SCHEMA_VERSION, `version=${version}`)

const cols = await db.q(`SELECT column_name FROM information_schema.columns WHERE table_name='patients'`)
check('patients.identity_no added', cols.some((c) => c.column_name === 'identity_no'))
check('patients.visit_id added', cols.some((c) => c.column_name === 'visit_id'))

const docCols = await db.q(`SELECT column_name FROM information_schema.columns WHERE table_name='doctors'`)
check('doctors.seal_path added', docCols.some((c) => c.column_name === 'seal_path'))

const saved = await db.getPatient('legacy-1')
check('the old record survived', saved && saved.name === 'Legacy Patient')
const updated = await db.savePatient({ ...saved, identityNo: 'C1853174' })
check('the old record can be edited with the new fields', updated.identityNo === 'C1853174')

// The regression itself: no index may reference a migrated column before the
// migrations have had a chance to add it.
check(
  'the base schema creates no index on a migrated column',
  !/CREATE INDEX[^;]*identity_no/i.test(db.SCHEMA),
)
check('the index is created after migration instead', db.INDEXES.includes('idx_patients_identity'))

console.log(failures === 0 ? 'ALL LEGACY CHECKS PASSED' : `${failures} LEGACY CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
