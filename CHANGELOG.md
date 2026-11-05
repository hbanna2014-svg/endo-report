# Changelog

All notable changes to EndoReport. Versions follow [semantic versioning](https://semver.org/).

---

## 0.5.17 — 2026-11-05

### Added

- **Two sessions side by side.** The workspace can hold a second, fully
  independent pane: capture patient A while typing patient B's report, or capture
  the colonoscopy on the right while the OGD report is finished on the left. Each
  pane has its own patient, procedure, findings, media and camera controls; the
  bar at the top adds a second session, swaps the two, or collapses back to one.
  * *Second session* opens a picker: search a patient, reopen any of their
    reports, or start a fresh one.
  * *Endoscopy + colonoscopy, side by side* starts both reports for one patient
    and opens them in the two panes — the same-day draft is reused instead of
    duplicated.
  * Only one pane can hold the capture card; starting the camera in one pane
    releases it in the other, and closing a pane no longer kills the stream the
    remaining pane is using.

- **Markers on captured pictures.** Every frame can carry numbered markers:
  * *Mark findings* places a marker for each finding already recorded in that
    section — polyp, ulcer, erosion, erythema, bleeding, varices, mass — using the
    colour of that finding. This is a documentation aid: the software is not
    reading the pixels and not diagnosing.
  * Click the picture to drop a marker by hand, drag it to the true spot, delete
    it, or clear them all. Eight marker types are available.
  * The markers are stored as data (so they stay editable) **and** composited
    into a `-marked.png` beside the original, because Word and the printer cannot
    overlay live markup. The original capture is never modified.
  * The composite carries a numbered legend strip (`1 Polyp · 2 Ulcer`), so the
    printed picture explains itself.
  * Thumbnails, the report plate, the print preview and the Word file all use the
    marked copy automatically.

### Database

- Schema v7: `media.annotations` (JSONB) and `media.marked_path`.

---

## 0.5.16 — 2026-11-05

### Added

- **Every patient gets a sequential ID: 01, 02, 03 …** The number is issued when
  the patient is registered, in arrival order, and is shown in the patient list,
  on the registration form (read-only, so it cannot be typed over), in the
  workspace header and on the printed / Word report.

  The number comes from a counter stored in the database, **not** from
  `COUNT(*)`. That distinction is the whole point: counting the rows means that
  deleting patient 03 hands the number 03 to the next arrival, and every paper
  report already filed under 03 now points at a different person. The counter
  only ever moves forward, so deleting a patient in the middle leaves a gap —
  exactly as a hospital register should — and nobody is ever renumbered.

  Numbers are two digits (`01` … `09`) until the hundredth patient and then grow
  naturally (`100`, `101`), so nothing has to be re-padded later.

  Existing records are numbered once, in the order they were entered
  (`created_at`), so the first patient ever registered becomes 01. The migration
  is idempotent and runs inside a transaction; the database is copied before it
  runs, as with every schema change.

- **A dedicated *Serial No* column.** The archive and the patient register now show
  the serial in its own column instead of hiding it under the patient's name, so the
  number is scannable down the page.

- **MRN is back under the patient's name.** The clinic's own hospital number is shown
  as `MRN …` beneath the patient name, exactly where it used to sit, and it is still
  stored, searchable and printed on the report. It is no longer copied from the serial:
  a patient with no MRN simply shows none, and the two identifiers stay distinct.

- **The register now reads newest-first.** The patient entered last sits at the top
  of the list and 01 moves down to the bottom, so the on-screen order always matches
  the serial order. Editing an older record no longer pulls it to the top, which is
  what the previous `updated_at` ordering did.

- Patient search now accepts the ID (`01`, `1`, `001` all find the same record).

### Database

- Schema v6: `patients.serial_no` (unique index) and the `counters` table.

---

## 0.5.15 — 2026-11-04

### Added

- **The Image Plus sheet now fills the page for any number of pictures.** Four, six,
  seven and eight frames are no longer dropped into one fixed 55.88 × 50.8 mm cell, which
  left six pictures covering the top third of the sheet. The grid is solved for the page:
  every column count is tried, the cells keep the picture's own aspect ratio, and the
  arrangement that covers the most area wins. Six pictures become 2 × 3 at 94 × 70.5 mm
  (2.3× the old area, 96% of the sheet width); eight become 2 × 4 at 76 × 57 mm; four
  become 2 × 2 at the largest size that fits. Pictures are never cropped — a portrait page
  simply cannot fill its height with four landscape frames, so the block is centred.
- **Procedure, Indication and Medication are editable on the report page.** Click any of
  the three lines on the hospital form to rewrite it; each field drops down the values the
  clinic has used before (plus the three standard procedure lines). The lists build
  themselves from the database, so whatever was saved while registering a patient is
  already offered on the next report. The procedure line is stored as `procedureText`, so
  the standard wording is still the default whenever nothing was typed.

- **Click the picture to take a still.** During a procedure the live stage is the biggest
  thing on screen, so a click anywhere on it now captures — crosshair cursor, a
  “Click the picture to capture” hint on hover, and a short white flash when the frame is
  taken. This also covers the processors whose capture button emulates a mouse click.
- **The endoscope's own capture button.** Most video processors forward that button to the
  PC as an ordinary keystroke. A new **Scope button** control in the capture toolbar learns
  the key: press **Learn**, press the button on the scope once, and the key is saved with
  the other capture preferences. A fixed key can also be chosen from the list (F1–F12,
  Print Screen, Insert, Enter, Space), and **Any key** works when the processor's key is
  not on the list. In “Any key” mode typing into a patient field never fires the camera.
- **Capture driver switch for stubborn cards.** The error banner now names the driver in
  use and offers **Restart with DirectShow**. Windows 10/11 opens USB video through Media
  Foundation; older endoscopy grabbers (the LB725 class) often refuse there with
  “Could not start video source” even when nothing else holds the device. The switch sets
  Chromium's `MediaFoundationVideoCapture` off and restarts, which is what those cards need.
  It is remembered per installation, and **Back to standard driver** undoes it.

### Fixed

- **The live picture could stay black while the console said “Camera live”.** The stage's
  `<video>` element is re-created when the console layout changes; the stream stayed on the
  old node, so the picture went black and every capture failed with “no video frame”. The
  stream is now attached through a callback ref, so it follows the element and re-attaches
  instantly after a tab switch. This was also why a capture could silently do nothing on
  some computers.
- **A capture card is found again after the folder is copied to another computer.** Device
  ids are per profile, so the remembered id meant nothing on a second machine and the app
  fell back to the first camera it saw — on a laptop, its own webcam. The device is now
  remembered by label as well, and on a fresh machine the app prefers a device whose name
  looks like a capture card over the built-in camera.
- **Medication entered at registration reached the report as "N/A".** Starting a report now
  carries both the indication and the medication from the patient record, so the
  "Medication :" line opens with what the clinic already typed instead of an empty default.
- **More retries before giving up on a card that is still being released.** Three spaced
  attempts (0.5 s, 1.2 s, 2 s) instead of one, and the resolution ladder now walks PAL
  720×576 and NTSC 720×480 explicitly, which is the mode most endoscopy processors
  actually send. An unsupported mode is skipped immediately instead of being retried.

---

## 0.5.14 — 2026-11-03

### Added

- **The two "Both" reports can be named.** With *Both* on, **Test 1** and **Test 2** are editable
  fields (defaults `ENDOSCOPY` and `COLONOSCOPY`). The clinical template follows the words typed —
  anything naming the colon gets the colonoscopy sections — and each report prints its own name on
  the band. The two fields sit in a colour-coded panel — blue for the upper GI test, teal for the colon — and the same pair appears in the *New report* dialog.
- **Every text box in the patient form remembers what was saved.** Name, phone, address, town,
  state, post code, identity number, doctor and referrer all suggest previously entered values as
  you type — two or three letters are enough. Picking a suggestion fills the box and leaves the text
  editable, so a name can be extended or trimmed afterwards.

### Changed

- **Six pictures is now the default plate** for every report, and changing the plate affects only
  the report you changed it on.
- **The sidebar is shorter.** The separate patient register is gone and **Reports is now called
  Patient Archive**, so there is one archive instead of two similar screens.
- **Dashboard → New patient opens the registration form immediately**, with no list in between.
- **Image Plus prints instead of closing.** The *Done* button is now **Print**: the pictures arranged
  on the plate go straight to one A4 sheet, in the order they are shown. Plates for **4, 6, 7 and 8**
  pictures are all offered.
- **The top toolbar is shorter.** *Save* and *Word* were removed; the Word export still lives on the
  Report card. **Print now saves the report and completes it** — the Finalise button turns green and
  reads "Finalised" as the sheet leaves the printer.
- **The Report card lost two buttons.** *Copy text* and *Save PDF* are gone; Word and Print remain.
- **The New Patient card is colour-washed.** A deep blue-violet-teal gradient rims the dialog, with a
  matching strip along the top, a tinted title bar, a colour wash behind the fields and a tinted footer;
  the divider between the patient and visit blocks blends the same three colours. Inside this card the
  text is set larger — 18px title, 15px fields, 13.5px labels — with a wider label column.

### Fixed

- **The suggestion list no longer drops open by itself.** It opened as soon as the form appeared,
  covering the fields underneath; it now opens only once something has been typed.
- **Font and Size in the report editor did nothing.** The format bar cancelled the mouse-down event
  for everything inside it, which also stopped the native `<select>` dropdowns from opening at all.
  The bar no longer cancels that event, the format buttons keep the caret themselves, and the editor
  remembers its selection so a font or size still applies after a dropdown has taken the focus.

---

## 0.5.13 — 2026-11-02

### Fixed

- **The whole camera picture is visible again.** The live stage used a fixed 4:3 box and an inline
  aspect ratio that fought the flex layout, so a card sending a tall frame showed a letterboxed
  slice of it. The stage now measures the space it actually has and draws the largest picture that
  keeps the card's own aspect ratio — nothing is cropped, and no black bars are added beyond the
  card's own shape.

- **A sideways picture can be turned upright, and stays that way.** New **Orientation** control on
  the capture panel: `Auto (detect)`, `0°`, `90°`, `180°`, `270°`, plus a one-click quarter-turn
  button next to it. `Auto` turns a portrait buffer (for example 1080 × 1430) a quarter turn, which
  is what a capture card that hands over a landscape picture on its side looks like.

- **The rotation is baked into the saved picture.** The PNG is turned before it is written, so the
  thumbnail, the report plate, the printed sheet and the Word export all show the same upright
  image — no viewer has to know about capture hardware.

- **Capture preferences survive a restart.** Orientation, resolution, black-border trim,
  auto-caption and the last device are stored in the database instead of being reset every time the
  application starts.

### Fixed — printing

- **The print copy is shown before printing.** Electron's Windows print dialog cannot render a
  preview pane and displays *"This app doesn't support print preview"* where the page should be.
  **Print** now opens an in-app A4 preview that renders the exact document handed to the printer,
  with a printer picker, a copy count and a **Print** button that sends the job straight to the
  chosen device. The system dialog is still reachable from the preview if a special job needs it.

- The preview is used from the reporting console, from the **Image Plus** picture sheet and from
  the report register, so every print path behaves the same way.

### Added — fields you can type in, that remember

- **The Procedure box is now free text with suggestions.** Type a name the clinic actually uses
  (`UPPER G.I. ENDOSCOPY`, `ERCP`, `LOWER GI`), or pick one of the built-in entries. Anything saved
  with a report is offered again next time, filtered as soon as two or three letters are typed.
- **The Referrer box works the same way.** It suggests every name already saved on a patient plus
  the active doctor directory, so the list builds itself and never needs maintaining.
- Both boxes accept a brand-new value: it is saved with the record and appears in the list the next
  time, with a clear “New name — saved for the next patient” row while it is still unknown.
- Searching also matches the description, so typing `upp` finds *ENDOSCOPY (upper GI)* and `lower`
  finds *COLONOSCOPY*.
- The clinical template is worked out from the words typed — a name mentioning the colon is a
  colonoscopy, a name mentioning the upper GI tract (or an unfamiliar name such as ERCP) is an upper
  GI study, and a name mentioning both is a combined study — so a typed name can never silently
  attach the wrong set of sections.
- A typed procedure name is printed on the report band as
  `<NAME> PROCEDURE REPORT`; a name that already ends in “REPORT” is used exactly as typed.

### Added — one patient, two studies

- **A “Both” button on the New Patient screen** creates two separate reports for the same person —
  **ENDOSCOPY** and **COLONOSCOPY** — each with its own id, its own picture folder and its own
  printout, instead of one combined report. The Procedure field shows
  “Endoscopy + Colonoscopy (two separate reports)” while it is on, and the footer buttons become
  *Add both reports* / *Save & open both*.
- The same option is available from **New report** on an existing patient, so a second study can be
  added later without re-registering anybody.
- Opening either id captures pictures into that id's folder, which is what keeps the two studies
  apart on the plate and in the archive.

### Fixed — duplicate records

- **Re-registering somebody who is already on file no longer creates a copy.** A new registration is
  matched against the archive by phone number, or by name together with age and sex. When it
  matches, the existing record is reused and the form's newly typed values are merged in — fields
  that were left blank keep what was already stored. A toast says
  “Existing patient reused — no duplicate created”.
- **Starting a report that already exists no longer copies it.** If a draft of the same procedure,
  for the same patient, on the same date is already open, that draft is opened instead of a second
  one being created.
- The patient register now refreshes its report count immediately after two reports are created, so
  the row no longer shows “0” until the next reload.

### Changed

- **The band across the form now names the procedure.** It read
  `ENDOSCOPIC PROCEDURE REPORT` for every study. It now follows what was selected:
  `COLONOSCOPY PROCEDURE REPORT` for a colonoscopy, `ENDOSCOPY & COLONOSCOPY PROCEDURE REPORT`
  for a combined case, and the original `ENDOSCOPIC PROCEDURE REPORT` for an upper GI endoscopy.
  The on-screen sheet, the printed page and the Word export all read from one string, so they
  cannot disagree.

### Fixed — picture plate

- **Choosing six pictures now shows all six picture boxes.** The plate worked out its shape from
  how many pictures were *already placed* instead of the layout chosen in the dropdown. With
  "6 pictures · 2 × 3" selected, only the top row appeared and the right-hand column stayed
  empty — which made the layout impossible to fill, because the missing boxes are exactly where
  the remaining pictures have to go. The shape now follows the chosen plate: 6 → three on top and
  three on the right, 7 → three and four, 4 → a single full-height right column. Empty slots in
  both rows are visible and clickable.

- **Side pictures are now the same size as the top row.** Both use the same 211.2 × 158.4 box, so
  a picture looks identical wherever it sits on the sheet. The column still shrinks rather than
  pushing the report past one page when four pictures plus captions do not fit.

- Printing and the Word export follow the same split, so what is arranged on screen is what
  comes out of the printer.

### Added

- `src/lib/frameRotation.js` — angle normalisation, auto-detection, aspect-preserving fit and
  canvas rotation, covered by 13 new self-test checks.

- `scripts/pad-images.cjs` — tops a procedure up to a given number of pictures and sets the plate
  layout, so the plate can be checked at the clinic's real capacity without capturing by hand.

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
