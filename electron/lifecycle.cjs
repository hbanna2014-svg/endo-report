/**
 * lifecycle.cjs — makes application updates safe for patient data.
 *
 * The clinic's records live **outside** the application folder, in
 * `<Documents>/EndoReportData`. That alone means replacing the program files
 * never touches a single record. This module adds the second layer of safety:
 *
 *   1. a marker file that identifies the data folder, so a missing or swapped
 *      folder is detected instead of silently creating an empty database;
 *   2. a copy of `db/` taken automatically *before* the schema is migrated;
 *   3. a small lifecycle record (first run, last run, version history) kept
 *      inside the database and mirrored to `upgrade.log`.
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const MARKER = '.endoreport-data.json'
const BACKUP_DIR = 'backups'
const KEEP_BACKUPS = 6

/* -------------------------------------------------------------------------- */
/* Data folder marker                                                          */
/* -------------------------------------------------------------------------- */

function markerPath(dataDir) {
  return path.join(dataDir, MARKER)
}

function readMarker(dataDir) {
  try {
    const p = markerPath(dataDir)
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/** Creates the marker on first run; returns the existing one otherwise. */
function ensureMarker(dataDir) {
  const existing = readMarker(dataDir)
  if (existing && existing.dataId) return existing
  const marker = {
    app: 'EndoReport',
    dataId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    note: 'This folder holds the EndoReport patient database. Keep it out of the application folder and back it up regularly.',
  }
  fs.writeFileSync(markerPath(dataDir), JSON.stringify(marker, null, 2), 'utf8')
  return marker
}

/**
 * Remembers which application/schema version last opened this folder. It lives
 * in the marker file (not the database) so it can be read *before* the database
 * is opened — which is exactly when the pre-upgrade copy has to be taken.
 */
function readVersionStamp(dataDir) {
  const marker = readMarker(dataDir)
  if (!marker) return null
  return {
    appVersion: marker.lastAppVersion || null,
    schemaVersion: marker.lastSchemaVersion ?? null,
    lastRunAt: marker.lastRunAt || null,
  }
}

function writeVersionStamp(dataDir, { appVersion, schemaVersion }) {
  const marker = readMarker(dataDir) || ensureMarker(dataDir)
  const next = {
    ...marker,
    lastAppVersion: appVersion,
    lastSchemaVersion: schemaVersion,
    lastRunAt: new Date().toISOString(),
  }
  fs.writeFileSync(markerPath(dataDir), JSON.stringify(next, null, 2), 'utf8')
  return next
}

/**
 * Is this folder an EndoReport data folder, and does it still contain a
 * database? Used at startup so that a disconnected drive or a deleted folder
 * produces a warning instead of a brand-new empty database.
 */
function inspect(dataDir) {
  const marker = readMarker(dataDir)
  const dbDir = path.join(dataDir, 'db')
  const pgVersion = path.join(dbDir, 'PG_VERSION')
  const hasDb = fs.existsSync(pgVersion)
  const mediaDir = path.join(dataDir, 'media')
  let mediaCount = 0
  try {
    if (fs.existsSync(mediaDir)) {
      mediaCount = fs.readdirSync(mediaDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length
    }
  } catch {
    /* unreadable media folder is not fatal */
  }
  return {
    dataDir,
    exists: fs.existsSync(dataDir),
    marker,
    hasDb,
    mediaPatients: mediaCount,
    // A folder that has a marker but no database has lost its database, or the
    // database folder was moved. Either way we must not create a fresh one.
    looksOrphaned: !!marker && !hasDb,
  }
}

/* -------------------------------------------------------------------------- */
/* Pre-upgrade database snapshot                                               */
/* -------------------------------------------------------------------------- */

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}

/** Rough size of a folder, so the UI can say "2.4 MB" before copying. */
function dirSize(dir) {
  let total = 0
  const walk = (d) => {
    let entries = []
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        try {
          total += fs.statSync(p).size
        } catch {
          /* ignore */
        }
      }
    }
  }
  walk(dir)
  return total
}

function pruneBackups(dataDir) {
  const root = path.join(dataDir, BACKUP_DIR)
  try {
    const items = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('db-before-v'))
      .map((d) => ({ name: d.name, at: fs.statSync(path.join(root, d.name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
    for (const old of items.slice(KEEP_BACKUPS)) {
      fs.rmSync(path.join(root, old.name), { recursive: true, force: true })
    }
  } catch {
    /* nothing to prune */
  }
}

/**
 * Copies `db/` before a schema migration runs. The media folder is not copied:
 * migrations only ever change the database, and copying gigabytes of video on
 * every upgrade would be both slow and pointless.
 */
function snapshotBeforeUpgrade(dataDir, fromVersion, toVersion) {
  const src = path.join(dataDir, 'db')
  if (!fs.existsSync(src)) return null

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const name = `db-before-v${fromVersion ?? '0'}-to-v${toVersion}-${stamp}`
  const dest = path.join(dataDir, BACKUP_DIR, name)

  copyDir(src, dest)
  fs.writeFileSync(
    path.join(dest, 'BACKUP-INFO.json'),
    JSON.stringify(
      {
        reason: 'Automatic copy taken before the database schema was upgraded.',
        fromSchema: fromVersion,
        toSchema: toVersion,
        createdAt: new Date().toISOString(),
        restore:
          'To roll back, close EndoReport, rename the current "db" folder to "db.broken", then rename this folder to "db".',
      },
      null,
      2,
    ),
    'utf8',
  )
  pruneBackups(dataDir)
  return { dir: dest, bytes: dirSize(dest) }
}

function listBackups(dataDir) {
  const root = path.join(dataDir, BACKUP_DIR)
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const full = path.join(root, d.name)
        let info = null
        try {
          info = JSON.parse(fs.readFileSync(path.join(full, 'BACKUP-INFO.json'), 'utf8'))
        } catch {
          /* older backup without info */
        }
        let at = 0
        try {
          at = fs.statSync(full).mtimeMs
        } catch {
          /* ignore */
        }
        return { name: d.name, path: full, at, bytes: dirSize(full), info }
      })
      .sort((a, b) => b.at - a.at)
  } catch {
    return []
  }
}

/* -------------------------------------------------------------------------- */
/* Lifecycle record                                                            */
/* -------------------------------------------------------------------------- */

const LIFECYCLE_KEY = 'app.lifecycle'

function defaultLifecycle() {
  return {
    appVersion: null,
    schemaVersion: null,
    firstRunAt: null,
    lastRunAt: null,
    lastUpgradeAt: null,
    lastUpgradeFrom: null,
    upgradeHistory: [],
  }
}

async function readLifecycle(db) {
  const value = await db.getSetting(LIFECYCLE_KEY, null)
  return { ...defaultLifecycle(), ...(value || {}) }
}

async function writeLifecycle(db, patch) {
  const current = await readLifecycle(db)
  const next = { ...current, ...patch }
  await db.setSetting(LIFECYCLE_KEY, next)
  return next
}

function appendUpgradeLog(dataDir, entry) {
  try {
    const line = `${new Date().toISOString()}  ${JSON.stringify(entry)}\n`
    fs.appendFileSync(path.join(dataDir, 'upgrade.log'), line, 'utf8')
  } catch {
    /* logging must never block startup */
  }
}

module.exports = {
  MARKER,
  BACKUP_DIR,
  markerPath,
  readMarker,
  ensureMarker,
  inspect,
  readVersionStamp,
  writeVersionStamp,
  snapshotBeforeUpgrade,
  listBackups,
  dirSize,
  readLifecycle,
  writeLifecycle,
  appendUpgradeLog,
  LIFECYCLE_KEY,
}
