# Changelog

All notable changes to EndoReport. Versions follow [semantic versioning](https://semver.org/).

---

## 0.5.2 — 2026-10-25

### Fixed

- **Pictures were missing from Print and Save PDF.** The report model copied each picture slot
  before the image data was read from disk, so the printer received slots with no image and
  printed "No Preview Available". Slots are now resolved against the hydrated media at print
  time. Verified by printing the report to PDF and counting the embedded images: 7 of 7.
- **"memory access out of bounds" when saving a patient.** PGlite is a single-threaded WASM
  build of PostgreSQL; concurrent statements from different IPC handlers could exhaust its
  memory. All statements now run through one queue, with a single retry for a transient WASM
  fault.

### Added

- **Patient Archive** replaces the plain Patients list (navigation and page title), with edit,
  new report and delete on every row and the full report history in the detail panel.
- **Register a new patient** rebuilt to the unit's own layout: name, MRN, hospital identity,
  visit/file no., visit date, age, sex, **bed**, **procedure**, referrer, doctor, assistant,
  phone, address, town, district, post code, indication, history, allergy, medication, notes.
- **Save & open capture** — registers the patient, creates the procedure with the chosen test
  and lands directly in the live console.
- Address parts (town, district, post code) on the patient record — schema v5.

## 0.5.1 — 2026-10-25

**Fix: an existing data folder could not be opened ("column identity_no does not exist").**

The base schema created the `patients(identity_no)` index *before* the migrations that add
that column, so any database written by an earlier release aborted on startup with
`column "identity_no" does not exist`. Indexes are now created after migrations run.

- Existing records were never at risk: the pre-upgrade copy is taken before the database opens.
- Verified end to end: a database shaped like an older release (new columns removed, schema
  version rewound to 1) opens, migrates through v2 → v3 → v4, keeps its records, and accepts
  edits that use the new fields. `npm run test:legacy` reproduces the exact scenario.
- The packaged build was then booted against such a database and reached the dashboard.

## 0.5.0 — 2026-10-25

**Theme: the sheet matches the paper form exactly, and the doctor's seal is one click away.**

### Page geometry

- A **border around the whole sheet**, top and bottom, as on the printed form.
- Pictures are exactly **2.2 in × 2 in** (55.88 mm × 50.8 mm): three across the top, and the
  right-hand column runs **to the bottom border** with four frames.
- The on-screen sheet is now laid out at true A4 geometry (793.7 × 1122.5 px) and scaled with a
  CSS transform, so the console preview, the full report and the printed page share one
  geometry instead of three approximations.
- The Word export mirrors the same geometry: bordered frame, 2.2 × 2 in pictures, four-frame
  column to the foot of the page.

### Doctor signature seals

- Doctors gain **degrees**, **affiliation**, a **signature stamp image** and a **default** flag
  (schema v4).
- **Settings ▸ Doctors** uploads the stamp (normalised to PNG) and warns when no doctor is
  marked default.
- The report screen has a **Signature & seal** selector that fills the name, degrees,
  designation, affiliation and stamp in one click. Reports that only carry a doctor's name are
  matched to the record automatically; new reports start with the default endoscopist.
- The stamp prints above the signature rule in the preview, the PDF and the `.docx`.

### Image Plus

- **Print pictures only** prints the hospital header, the patient particulars and **4 or 6
  pictures** at 2.2 × 2 in — no findings, no report text.
- The picture-only sheet carries the same border and letterhead as the report.

### Fixes

- The picture-plate selector now offers the seven-picture hospital layout (it previously fell
  back to the first option).
- `api.patients.update` is exposed, so in-place edits on the report sheet persist.

### Database

Schema v3 → v4: `doctors.degrees`, `doctors.affiliation`, `doctors.seal_path`,
`doctors.is_default`. Existing records are preserved; the database is copied before the upgrade.

---

## 0.4.0 — 2026-10-25

**Theme: the report now prints on the unit's own paper form.**

### Hospital paper form

- New **Hospital paper form** report style that reproduces the printed form endoscopy units already
  use: letterhead with logo, the identity / visit date / patient / age–sex / history / instrument /
  referrer / bed grid, the letter-spaced `ENDOSCOPIC PROCEDURE REPORT` band, **three pictures
  across the top and four down the right-hand column**, organ-grouped findings with
  `Oesophagus:-` style headings, a `COMMENTS` block and the endoscopist's signature with degrees,
  designation and hospital at the foot of the page.
- Identical geometry in three renderers — the on-screen preview (`HospitalForm.jsx`), the printer
  and PDF (`buildHospitalPrintHtml`) and the Word file (`buildHospitalDocument`) — all driven by
  one `model.hospital` object, so they cannot drift apart.
- New seven-picture plate (`form7`) used by the form; the four- and six-picture plates remain for
  the narrative report.
- Optional trailing **6-picture sheet** ("Image Plus 1–6") on a 2 × 3 grid.
- Organ-grouped findings drop a "was normal" sentence when another segment of the same organ is
  abnormal, so a bullet never reads "was normal … erythema was seen".
- The style is selectable in **Report template**, and a Hospital paper form template is created
  automatically on first run and marked default.

### Patient and procedure fields for the printed header

- `patients.identity_no` and `patients.visit_id` (hospital identity and file numbers), with inputs
  on the patient form; either can be overridden per report.
- New procedure fields: `bed`, `medication` (e.g. `2% Jascocaine jelly`) and `comments` (the
  `COMMENTS :` line), plus per-report `identityNo` / `visitId`.
- `api.patients.update` was referenced by the console but never exposed; it now maps to save so
  in-place edits on the report sheet persist.

### Fixes

- First-run template seeding could create the standard template *after* the hospital form and
  silently take over the default; the template list is now re-read before that fallback.
- Word export now falls back to an inline `dataUrl` when the media file is not on disk.

### Database

Schema v2 → v3: `patients.identity_no`, `patients.visit_id` and an identity index. Existing
records are preserved; the upgrade is automatic and the database is copied first.

### Tooling

- `npm run preview:hospital` writes `preview/hospital.html` and `.docx` from sample data.
- `scripts/render-html.cjs` screenshots any local HTML file with Electron (used to check the print
  layout without a printer).

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
