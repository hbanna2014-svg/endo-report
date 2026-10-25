# Changelog

All notable changes to EndoReport. Versions follow [semantic versioning](https://semver.org/).

---

## 0.3.0 — 2026-10-25

**Theme: an update can never cost you a patient record.**

### Data safety on update

- **Schema migrations.** The database now carries an explicit schema version and an ordered
  migration list. Each step runs inside a transaction, so a failure rolls back and leaves the
  records untouched instead of half-migrating them. Opening a data folder written by a *newer*
  build is refused with a clear message rather than risking corruption.
- **Automatic pre-upgrade copy.** If the application version is newer than the version that last
  opened the data folder, a copy of `db/` is written to `<DataFolder>/backups/` before any
  migration runs. The six most recent copies are kept, each with `BACKUP-INFO.json` describing how
  to roll back.
- **Data folder marker.** `<DataFolder>/.endoreport-data.json` records a folder id, the last
  application version and the last schema version. If the marker is present but the database is
  missing — a disconnected drive, or a moved folder — startup stops and asks you to locate the
  folder instead of silently creating a new, empty database.
- **Upgrade log.** Every upgrade, including a failed pre-upgrade copy, is appended to
  `<DataFolder>/upgrade.log`.
- **Startup diagnostics.** A failed migration now shows the database path, the reason, and where
  the pre-upgrade copy is, rather than a bare error.

### Updates

- New **Settings ▸ Updates** screen: installed version, database schema version, data folder id,
  update check against GitHub Releases, release notes, download with progress, checksum
  verification, and the history of upgrades and automatic database copies.
- **Help ▸ Check for updates…** menu entry.
- Downloads are verified by size and, when the release publishes `checksums.txt`, by SHA-256.
  A checksum mismatch is reported loudly and the Run button is disabled.
- `.exe` installers are launched directly (they upgrade in place); `.zip` builds are revealed in
  the folder with instructions.

### Fixes

- Fixed a crash in the Word export: the picture-width calculation referenced undefined `grid4` /
  `grid6` variables, so exporting any report that contained images threw a `ReferenceError`.
- `procedures.finalised_at` is now back-filled for reports that were already final.

### Infrastructure

- `scripts/checksums.mjs` writes `checksums.txt` for the release assets.
- `npm run release:win` builds and publishes to GitHub Releases.
- 20 new end-to-end checks covering the migration, the marker and the pre-upgrade copy.

### Database schema

v1 → v2. Adds `media.thumb_path`, `procedures.finalised_at`, and two indexes. Existing records are
preserved; the migration is automatic on first launch.

---

## 0.2.0 — 2026-10-18

- Live console: capture, live endoscopic image and report side by side, without tab switching.
- Import the clinic's own `.docx` as a report template and write into it, preserving the
  letterhead, fonts and page setup.
- 4- and 6-picture report plates laid out like the clinic's own form.
- Portable Windows build published as a release asset.

---

## 0.1.0 — 2026-10-17

- First build: 19 anatomical sections, 121 structured findings, automatic narrative, impression
  and recommendations, a 25-rule completeness audit, offline image/video capture, Word/PDF/print
  output, patient register, backup and restore.
