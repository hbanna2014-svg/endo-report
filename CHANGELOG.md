# Changelog

All notable changes to EndoReport. Versions follow [semantic versioning](https://semver.org/).

---

## 0.5.12 — 2026-11-02

### Changed

- **Generated headings disappear when the clinic brings its own Word report.** With a document in
  the writing area, `FINDINGS :`, `Biopsy :- …` and `COMMENTS : …` repeated what the document
  already said and are now left out. Without a document they still print, otherwise the sheet
  would have no findings at all.
- **The writing area runs down to the signature rule.** The left column is now a flex column and
  the editor takes every pixel between `Medication :` and the grey rule above the signature.
- **Pictures are pinned to the page.** A long findings text can no longer push the plate down or
  spill the report onto a second sheet: the columns share a fixed height and clip, and the picture
  column divides whatever height is left.
- **The plate arranges itself by picture count**, always on one page:

  | Pictures | Arrangement |
  |---|---|
  | 1–3 | one row across the top |
  | 4 | an **“I”** — a single column down the right |
  | 5–7 | an inverted **“L”** — three across, the rest down the right |

  Frames share the available height equally with a **1.8 mm** gap (under the 2 mm the form allows),
  so no picture is squeezed and none is pushed off the page. The printed page and the Word file
  follow the same arrangement as the screen.

## 0.5.11 — 2026-11-02

### Fixed

- **The capture card could not be opened** — the device appeared in the list but pressing
  *Start live view* failed with “Could not start video source”. A video processor only supports
  a fixed set of modes (a PAL unit answers 720×576), and the app asked for 4K first, which the
  driver rejected outright. Opening is now staged:
  1. the chosen device at the chosen resolution,
  2. the chosen device at its own default mode,
  3. the device id without `exact`,
  4. any camera.
  `NotReadableError` is retried once after 650 ms, because a card that was just released by the
  endoscopy unit software needs a moment. When the card opens at its own mode the app says so
  instead of pretending the requested resolution was used.
- **Camera permission is now granted explicitly.** The renderer is a `file://` page; without a
  `setPermissionRequestHandler` a card can be enumerated but never opened. Only `media` is
  allowed, every other permission stays denied.
- **The error message is now actionable** and the panel offers *Try again* and *Rescan devices*.
  Each failure is explained in clinic language — card held by another program (OBS, the
  endoscopy unit software, Teams, Zoom), wrong resolution, driver refused to start, device
  unplugged.
- The capture toolbar no longer wraps its rescan button onto a second row when the report column
  is wide; the button sits inside the device field.

### Added

- **Report page** — a full-page view of the report sheet, laid out the way the clinic's previous
  endoscopy software does it: patient band, the 3-pictures-on-top + 4-down-the-right plate, the
  findings and comments text, and an action rail on the right (*Back to capture*, *Image Plus*,
  *Update report*, *Print report*, *Export report*, *Save as PDF*, *Close report*). Clicking an
  empty slot on the sheet places a captured frame in it.
- The sheet is the **same component that prints**, so the page on screen is exactly what the
  printer and the Word export produce — no separate preview to drift out of step.
- The live console's report column widened from a fixed 430–600 px to 390 px–44 % of the working
  area, so the plate is readable beside the live picture.

## 0.5.10 — 2026-11-01

### Fixed

- **Patient details edited on the report sheet were never saved.** Changing the name, age, sex
  or registration number directly on the report updated the on-screen preview but the write
  always failed — the edit disappeared as soon as the report was reopened. The call passed
  `(id, patient)` to a bridge function that takes only the patient object, and the rejection was
  swallowed. It is now written to the patient record, debounced by 400 ms so typing does not
  hammer the database.
- **"Unsaved changes…" appeared the moment a report was opened.** Linking an older report to a
  doctor record (to pick up the degrees and the signature seal) was treated as an operator edit,
  so every open marked the report dirty and fired an autosave three seconds later. That link is
  bookkeeping now: it updates the screen and is persisted quietly in the background without
  touching the dirty indicator.
- **The report template preview printed `[not recorded]`.** The built-in sample left out the
  value its example finding requires, so the live sample read "…[not recorded] mucosal erythema"
  and "Antral gastritis ([not recorded])". The sample now carries `extent: 'patchy antral'`.
- **`npm run test:legacy` crashed** with `The "path" argument must be of type string`. The script
  expects `<stage> <dir>` on the command line and the npm script passed neither. With no
  arguments it now creates a temporary folder and runs the create → open journey itself, in two
  processes (a single process can only hold one PGlite instance).
- **Capture toolbar values were clipped** — the device picker read "No capture de…" and the
  quality picker "Highest the device s…". The three pickers have a 170 px basis with a 140 px
  minimum and wrap to a second line instead of truncating; the quality labels are shorter
  ("Highest available", "Full HD 1920×1080", "HD 1280×720", "PAL 720×576") and the empty state
  reads "No device found".

### Added

- Headless diagnostics for the automated UI check: `ENDOREPORT_CAPTURE_JS` runs a snippet after
  the scripted clicks and logs its awaited result, so an interaction can be proven to reach the
  database rather than just looking right on screen. The capture hook now also reports renderer
  console warnings and errors.

## 0.5.9 — 2026-10-26

### Live capture

- The live picture now follows the capture card's own aspect ratio and sits centred in the
  stage, so the whole endoscopic frame is visible instead of being squeezed into a fixed
  4:3 box with dark bands above and below.
- New **Trim black border** option (on by default). Many capture cards pad the frame with a
  uniform black surround; the still is now cropped to the picture itself, so nothing black
  ends up in the report. It only removes near-uniform black lines, never more than a quarter
  of the frame from any edge, so a genuinely dark lumen is left alone.

### Writing on the form

- The blank half of the hospital form is now a live editor. Open a Word file, or click and
  type: the text sits exactly where it will print.
- Full formatting is available there — bold, italic, underline, strike-through, bulleted and
  numbered lists, four alignments, font family, font size, text colour, indent, undo/redo
  and clear formatting — plus an **insert symbol** list (° ± ≥ ≤ µ → × ÷ ½ Δ Ω …) and
  **insert picture**, so a small diagram or a marked-up frame can go on the page.
- Text is saved as you type, so pressing Print without leaving the box still prints the new
  words.
- If the text no longer fits the blank area, the printed report keeps the pictures on page
  one with a "continued on the next page" line, and the whole note prints on page two —
  nothing is cut off mid-sentence.

### Capture starts instantly

- The capture card is opened as soon as a procedure is opened, not when Capture is first
  pressed, so the live picture is already running when the console appears.
- The stream stays open while moving between Live console, Findings and Procedure details.
  Leaving the screen used to close the device, so every return paid the card's one-to-two
  second start-up again; leaving the patient (or pressing Stop) closes it.
- The picture is shown the moment the stream attaches instead of waiting for `play()` to
  resolve, and the frame size is read from the first decoded frame.

### Word report

- The **REPORT** panel now has a **Word template** row. Upload the clinic's own `.docx` and
  the **Word** button fills that file instead of the built-in layout — the letterhead,
  fonts, margins and logos of the uploaded document are kept, and only the `{{TOKENS}}`
  inside it are replaced. The attachment is stored on the report template, so it applies to
  every new report until it is replaced or removed.
- The file picker now lists `.doc` files as well and offers **All files**, so a folder that
  previously looked empty now shows its Word documents. Choosing an old binary `.doc`
  explains how to save it as `.docx` instead of failing silently.

### Printed pictures

- All seven frames now print at **one size** (56 × 42 mm, 4:3). The four down the right
  column used to be squeezed to fit and came out smaller than the three across the top; at
  the previous size the seventh frame was also clipped off the bottom of the page.

### Live console

- The **Captured** strip is one column of large square frames. Frames keep a fixed size
  however many are captured, and the strip scrolls with the mouse wheel, so a hundred
  frames stay readable and clickable instead of shrinking to slivers.
- Entering the procedure workspace now folds the left menu down to a 66 px icon rail, so
  the live capture and the report get the width. A chevron button on the menu expands it
  again at any time; every other screen shows the full menu.

### Printed pictures

- Pictures are printed on white with a single thin rule — the black mat is gone.
- The frame size is now a template setting (default **2.5 × 2 in / 63.5 × 50.8 mm**) with a
  choice of **Fill the frame** (default, no bands) or **Whole picture** (never crops).

### Printing with pictures — fixed

- Printing a report with pictures could produce a page with the text but an empty plate.
  The print window now waits until every picture has actually decoded instead of relying on
  a fixed 350 ms delay.
- Large cases failed outright: seven full-resolution PNG frames (2 in each) make a ~55 MB
  document, which Chromium refuses to print at all. Print copies are now downscaled to 1400 px
  and re-encoded as JPEG (~7 MB for the same seven pictures). The stored originals are
  untouched; only the print copy is resized.
- If a picture file cannot be read, the operator is now told which frames will print blank
  instead of the failure being silent.

## 0.5.8 — 2026-10-26

### Dashboard

- The large welcome banner is gone. In its place is a compact bordered box holding only
  **New patient · All reports · Backup**, with no heading or description text. The dashboard
  starts straight at the day's patient list.

## 0.5.7 — 2026-10-26

### Dashboard

- The daily patient list now has a **doctor selector** beside the date: "All doctors" by
  default, listing only the consultants who actually have a patient on that date. Picking one
  narrows the list and the subtitle shows the count and the name; an empty result offers
  *Show all doctors*.
- Changing the date clears the doctor filter.

## 0.5.6 — 2026-10-26

### Dashboard

- The dashboard now opens on **the day's patient list** — date picker, count, and every patient
  with name, age/sex, registration, procedure, doctor and status; a row opens the report.
- A new **Last 30 days** button in the header reveals the workload card **on the left**: the
  Endoscopy / Colonoscopy / Both / Polypectomy / Biopsy / Total tiles, the 30-day chart and the
  last-7-days list.
- The consultant panel sits under the workload card while that panel is open, and below the day
  list when it is closed.

## 0.5.5 — 2026-10-26

### Dashboard

- **Procedures in the last 30 days** moved to the wide left column and now answers "what was
  done on a given date": a date picker plus tiles for **Endoscopy · Colonoscopy · Both ·
  Polypectomy · Biopsy · Total**, a clickable 30-day chart and a last-7-days list.
- **Quick actions removed**; the space now carries the daily workload detail.
- **Consultant panel** — search the endoscopists who have recorded procedures, tick one, and
  every procedure of that consultant is listed with date, patient and type; clicking a row
  opens the report. `Clear` resets it.
- Polypectomy counts are derived from the structured record (a polyp documented **and**
  resected), so a therapeutic act is counted even though it is not a separate procedure type.

## 0.5.4 — 2026-10-26

### Changed

- **Colourful desktop background.** The flat grey canvas is replaced by a soft four-colour wash
  (blue, violet, teal, rose) that stays behind the content, with a frosted top bar and a deeper
  navigation panel carrying a faint blue/teal bloom.
- Cards, tables and the report sheet stay pure white so contrast and print output are unaffected.

## 0.5.3 — 2026-10-25

### Changed

- **New Patient** now follows the unit's original dialog exactly: a right-aligned label column
  with Patient Name · Age / Sex (age field + Male/Female radios) · MRN | Bed · Procedure ·
  Referrer · Doctor · Indication, a rule, then Visit Date · Address · Town | State ·
  Post Code | Phone.
- Doctor and referrer keep the **+** picker; the procedure field keeps the red **×** clear button.
- Hospital identity, visit/file number, assistant, history, allergy, medication and notes moved
  into a collapsed *Report header & clinical details* strip, so the first screen is unchanged
  from the original while the report still gets everything it prints.
- Footer is **Close** and **Add**, with **Save & open capture** beside it.

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
