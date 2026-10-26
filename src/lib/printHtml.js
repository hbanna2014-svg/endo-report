/**
 * printHtml.js — builds a complete, standalone HTML document for the report.
 *
 * Used for (a) the system print dialog, (b) "Save as PDF" and (c) exporting a
 * self-contained .html copy that a clinic can email. Images must already be
 * supplied as data URLs on `model.media[].dataUrl`.
 */

function esc(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function nl2p(text) {
  return String(text || '')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => `<p>${esc(l.trim())}</p>`)
    .join('')
}

export function buildPrintHtml(model) {
  // The unit's own paper form always wins: text opened from a Word file belongs
  // in the blank half of that form, not on a page of its own.
  if ((model?.template?.layout?.style || 'standard') === 'hospital') return buildHospitalPrintHtml(model)
  // Anywhere else, a report that came from the clinic's own Word file prints as
  // that file.
  if (model?.reportDoc?.custom) return buildDocPrintHtml(model)

  const t = model.template
  const c = t.clinic
  const layout = t.layout
  const accent = layout.accentColor || '#1d4ed8'
  const ink = '#111827'

  const plan = model.imagePlan || { mode: 'flow', columns: 3, slots: [] }
  const byId = new Map((model.media || []).map((m) => [m.id, m]))
  const images = plan.slots
    .map((s) => {
      const m = s.media ? byId.get(s.media.id) || s.media : null
      return m ? { ...m, no: s.no } : null
    })
    .filter(Boolean)
  const cols = plan.columns || 3
  const fixedPlate = plan.mode === 'grid4' || plan.mode === 'grid6'
  const showCaptions = layout.showImageCaptions !== false

  const fig = (m) => `<figure>
      ${m.dataUrl ? `<img src="${m.dataUrl}" alt="">` : `<div class="missing">image file not available</div>`}
      ${showCaptions ? `<figcaption>${esc(m.no)}. ${esc(m.caption)}</figcaption>` : ''}
    </figure>`

  const topImgs = plan.mode === 'grid6' ? images.filter((m) => m.no <= 3) : []
  const sideImgs =
    plan.mode === 'grid6' ? images.filter((m) => m.no > 3)
      : plan.mode === 'grid4' ? images.filter((m) => m.no <= 4)
        : []

  const topPlate = topImgs.length
    ? `<div class="sheet-top">${topImgs.map(fig).join('')}</div>`
    : ''
  const sidePlate = sideImgs.length
    ? `<aside class="sheet-side">${sideImgs.map(fig).join('')}</aside>`
    : ''

  const imageGrid = images.length
    ? `<section class="block">
        <h2>Endoscopic images</h2>
        <div class="plate${fixedPlate ? ` fixed ${plan.mode}` : ''}" style="grid-template-columns: repeat(${cols}, 1fr);">
          ${images
            .map(
              (m) => `<figure>
                 ${m.dataUrl ? `<img src="${m.dataUrl}" alt="">` : `<div class="missing">image file not available</div>`}
                 ${showCaptions ? `<figcaption>${esc(m.no)}. ${esc(m.caption)}</figcaption>` : ''}
               </figure>`,
            )
            .join('')}
        </div>
        ${
          (model.media || []).some((m) => m.kind === 'video')
            ? '<p class="muted"><em>Video recordings are stored with the patient record and are not embedded in this document.</em></p>'
            : ''
        }
      </section>`
    : ''

  const auditBlock =
    layout.showAudit && model.audit?.items?.length
      ? `<section class="block">
          <h2>Documentation audit (internal)</h2>
          <p><strong>Completeness score: ${model.audit.score}% (${esc(model.audit.scoreLabel)})</strong></p>
          <ul class="audit">
            ${model.audit.items
              .map((i) => `<li class="${i.level}"><span class="tag">${i.level}</span> ${esc(i.message)}</li>`)
              .join('')}
          </ul>
        </section>`
      : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(model.reportNo)} — ${esc(model.patientLine.name)}</title>
<style>
  @page { size: A4; margin: 14mm 14mm 16mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ${layout.fontFamily || 'Arial'}, "Segoe UI", Roboto, sans-serif;
    font-size: ${layout.fontSize || 11}pt;
    color: ${ink};
    line-height: 1.45;
    padding: 8mm 6mm;
    background: #fff;
  }
  .sheet { max-width: 190mm; margin: 0 auto; }
  header.letterhead { text-align: center; border-bottom: 2px solid ${accent}; padding-bottom: 6px; margin-bottom: 10px; }
  header.letterhead img { max-height: 62px; max-width: 150px; }
  .clinic-name { font-size: 17pt; font-weight: 700; color: ${accent}; letter-spacing: .2px; }
  .clinic-meta { font-size: 9.5pt; color: #4b5563; }
  h1.title { text-align: center; font-size: 13.5pt; letter-spacing: 1px; margin: 10px 0 4px; text-transform: uppercase; }
  .report-meta { text-align: center; font-size: 9pt; color: #6b7280; margin-bottom: 12px; }
  h2 {
    font-size: 10.5pt; text-transform: uppercase; letter-spacing: .6px; color: ${accent};
    border-bottom: 1px solid ${accent}; padding-bottom: 2px; margin: 14px 0 6px;
  }
  table.meta { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  table.meta td { border: 1px solid #d5dbe3; padding: 4px 7px; vertical-align: top; font-size: 10pt; }
  table.meta td.k { width: 30%; background: #f5f7fa; font-weight: 600; color: #374151; }
  .block p { margin: 4px 0; text-align: justify; }
  .finding h3 { font-size: 10.5pt; margin: 8px 0 2px; }
  ul.impression { margin: 4px 0; padding-left: 18px; }
  ul.impression li { font-weight: 700; margin-bottom: 3px; }
  ul.reco { margin: 4px 0; padding-left: 18px; }
  ul.reco li { margin-bottom: 3px; }
  .plate { display: grid; gap: 7px; align-items: start; }
  .plate.fixed figure { background: #f8fafc; border: 1px solid #d5dbe3; border-radius: 4px; padding: 2px; }
  figure { margin: 0; text-align: center; page-break-inside: avoid; break-inside: avoid; }
  figure img {
    width: 100%; max-width: 100%; height: auto; display: block; margin: 0 auto;
    border: 1px solid #d5dbe3; border-radius: 3px;
    /* never let the printer resample a full-resolution frame */
    image-rendering: auto; -ms-interpolation-mode: bicubic;
  }
  .plate.fixed figure img { width: 100%; object-fit: contain; border: none; }

  /* The report sheet: text on the left, the pictures standing down the right
     (four pictures), or three across the top and three down the right (six). */
  .sheet-split { display: block; }
  .sheet-split.has-side { display: grid; grid-template-columns: 1fr 58mm; gap: 5mm; align-items: start; }
  .sheet-main { min-width: 0; }
  .sheet-side { display: flex; flex-direction: column; gap: 3.5mm; }
  .sheet-side figure img { width: 100%; height: auto; object-fit: contain; object-position: center; background: #fff; border: 1px solid #9aa6b2; }
  .sheet-side figcaption { text-align: center; }
  .sheet-top { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin: 3mm 0 4mm; }
  .sheet-top figure img { width: 100%; height: auto; object-fit: contain; object-position: center; background: #fff; border: 1px solid #9aa6b2; }
  .sheet-top figcaption { text-align: center; }
  .rich-static p { margin: 0 0 5px; text-align: justify; }
  .rich-static ul, .rich-static ol { margin: 4px 0; padding-left: 18px; }
  figure .missing { border: 1px dashed #f0a3a3; border-radius: 4px; padding: 18px 6px; color: #b91c1c; font-size: 9pt; }
  figcaption { font-size: 8.5pt; color: #4b5563; margin-top: 3px; line-height: 1.3; }
  .muted { color: #6b7280; font-size: 9pt; }
  ul.audit { list-style: none; padding: 0; font-size: 9pt; }
  ul.audit li { margin-bottom: 3px; }
  ul.audit li.error { color: #b91c1c; }
  ul.audit li.warning { color: #b45309; }
  ul.audit li.info { color: #4b5563; }
  .tag { display: inline-block; font-size: 7.5pt; text-transform: uppercase; border: 1px solid currentColor; border-radius: 3px; padding: 0 3px; margin-right: 4px; }
  .sign { margin-top: 34px; display: flex; justify-content: space-between; font-size: 10pt; }
  .sign .line { border-top: 1px solid #9ca3af; width: 62mm; padding-top: 3px; }
  .disclaimer { margin-top: 20px; font-size: 8.5pt; color: #6b7280; text-align: justify; }
  footer.sheet-footer { margin-top: 12px; border-top: 1px solid #e5e7eb; padding-top: 5px; text-align: center; font-size: 8pt; color: #9ca3af; }
  @media print { body { padding: 0; } .sheet { max-width: none; } figure { break-inside: avoid; } section.block { break-inside: auto; } h2 { break-after: avoid; } }
</style>
</head>
<body>
<div class="sheet">
  <header class="letterhead">
    ${layout.showLogo && c.logoDataUrl ? `<img src="${c.logoDataUrl}" alt="">` : ''}
    <div class="clinic-name">${esc(c.name)}</div>
    ${c.address ? `<div class="clinic-meta">${esc(c.address)}</div>` : ''}
    ${c.phone || c.email ? `<div class="clinic-meta">${esc([c.phone, c.email].filter(Boolean).join('  |  '))}</div>` : ''}
  </header>

  <h1 class="title">${esc(model.title)}</h1>
  <div class="report-meta">Report No: <strong>${esc(model.reportNo)}</strong> &nbsp;|&nbsp; Generated: ${esc(model.generatedLine)}</div>

  ${topPlate}

  <div class="sheet-split${sidePlate ? ' has-side' : ''}">
  <div class="sheet-main">

  ${
    layout.showPatientBlock
      ? `<section class="block">
          <h2>Patient</h2>
          <table class="meta">
            <tr><td class="k">Patient name</td><td>${esc(model.patientLine.name)}</td></tr>
            <tr><td class="k">Age / Sex</td><td>${esc(model.patientLine.ageSex)}</td></tr>
            ${model.patientLine.regNo ? `<tr><td class="k">Registration no</td><td>${esc(model.patientLine.regNo)}</td></tr>` : ''}
            ${model.patientLine.phone ? `<tr><td class="k">Contact</td><td>${esc(model.patientLine.phone)}</td></tr>` : ''}
            ${model.patientLine.address ? `<tr><td class="k">Address</td><td>${esc(model.patientLine.address)}</td></tr>` : ''}
            ${model.patientLine.referredBy ? `<tr><td class="k">Referred by</td><td>${esc(model.patientLine.referredBy)}</td></tr>` : ''}
            <tr><td class="k">Procedure done by</td><td>${esc(model.patientLine.performedBy)}</td></tr>
            <tr><td class="k">Date of procedure</td><td>${esc(model.patientLine.procedureDate)}</td></tr>
          </table>
        </section>`
      : ''
  }

  ${model.narrative.indication ? `<section class="block"><h2>Indication</h2>${nl2p(model.narrative.indication)}</section>` : ''}
  ${model.narrative.history ? `<section class="block"><h2>Relevant history</h2>${nl2p(model.narrative.history)}</section>` : ''}

  ${
    layout.showProcedureDetails && model.details.filter((d) => d.value).length
      ? `<section class="block">
          <h2>Procedure details</h2>
          <table class="meta">
            ${model.details
              .filter((d) => d.value)
              .map((d) => `<tr><td class="k">${esc(d.label)}</td><td>${esc(d.value)}</td></tr>`)
              .join('')}
          </table>
        </section>`
      : ''
  }

  <section class="block">
    <h2>Findings</h2>
    ${
      model.reportRich && model.reportRich.custom
        ? `<div class="rich-static">${model.reportRich.html}</div>`
        : model.narrative.findings.length
        ? model.narrative.findings
            .map((b) => `<div class="finding"><h3>${esc(b.heading)}</h3><p>${esc(b.text)}</p></div>`)
            .join('')
        : '<p class="muted"><em>No findings recorded.</em></p>'
    }
    ${
      model.narrative.additionalFindings
        ? `<div class="finding"><h3>Additional notes</h3><p>${esc(model.narrative.additionalFindings)}</p></div>`
        : ''
    }
  </section>

  ${
    layout.showImpression
      ? `<section class="block">
          <h2>Impression / Diagnosis</h2>
          <ul class="impression">
            ${
              String(model.narrative.diagnosis || '')
                .split('\n')
                .filter((l) => l.trim())
                .map((l) => `<li>${esc(l.trim())}</li>`)
                .join('') || '<li>Normal study</li>'
            }
          </ul>
        </section>`
      : ''
  }

  ${
    layout.showRecommendation && String(model.narrative.recommendation || '').trim()
      ? `<section class="block">
          <h2>Recommendation / Plan</h2>
          <ul class="reco">
            ${String(model.narrative.recommendation)
              .split('\n')
              .map((l) => l.replace(/^•\s*/, '').trim())
              .filter(Boolean)
              .map((l) => `<li>${esc(l)}</li>`)
              .join('')}
          </ul>
        </section>`
      : ''
  }

  ${layout.showImages && plan.mode === 'flow' ? imageGrid : ''}

  </div>
  ${sidePlate}
  </div>

  ${auditBlock}

  <div class="sign">
    <div>
      <div style="height:34px"></div>
      <div class="line"><strong>${esc(model.signature.name || '\u00a0')}</strong><br>
        ${esc(model.signature.designation || '')}${model.signature.regNo ? `<br>Reg. No: ${esc(model.signature.regNo)}` : ''}
      </div>
    </div>
    <div>
      <div style="height:34px"></div>
      <div class="line">Date: ______________________</div>
    </div>
  </div>

  ${model.disclaimer ? `<p class="disclaimer">${esc(model.disclaimer)}</p>` : ''}

  <footer class="sheet-footer">
    ${layout.confidentialNote ? `${esc(layout.confidentialNote)}<br>` : ''}
    ${esc(model.reportNo)}
  </footer>
</div>
</body>
</html>`
}


/**
 * Print an opened Word report exactly as it reads on screen. The HTML already
 * carries Word's own bold/italic/alignment/font choices, so only the page has to
 * be described here.
 */
export function buildDocPrintHtml(model) {
  const title = `${model.title} · ${model.reportNo}`
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  @page { size: A4; margin: 12mm 11mm; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, "Segoe UI", sans-serif; font-size: 10.5pt; color: #111827; line-height: 1.45; }
  .sheet { max-width: 192mm; margin: 0 auto; }
  p { margin: 0 0 5px; }
  h1, h2, h3, h4 { margin: 8px 0 4px; }
  table.doc-tbl { width: 100%; border-collapse: collapse; margin: 6px 0; }
  table.doc-tbl td { border: 1px solid #b9c2cc; padding: 4px 6px; vertical-align: top; }
  img { max-width: 100%; height: auto; }
  ul, ol { margin: 4px 0; padding-left: 20px; }
  @media print { .sheet { max-width: none; } }
</style></head>
<body><div class="sheet">${model.reportDoc.html}</div></body></html>`
}

/* -------------------------------------------------------------------------- */
/* Hospital paper form                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Reproduces the endoscopy unit's own printed form: letterhead, the identity /
 * visit / patient / instrument grid, the "ENDOSCOPIC PROCEDURE REPORT" band,
 * three pictures across the top, four down the right-hand column, the findings
 * and comments on the left, and the endoscopist's signature block.
 *
 * Every value comes from `model.hospital`, the same object the Word exporter and
 * the on-screen preview use.
 */
export function buildHospitalPrintHtml(model) {
  const f = model.hospital
  if (!f) return ''

  // Pictures are hydrated with data URLs only at print time, so resolve every
  // slot against the media list that came with the model instead of trusting
  // the copy made when the report was built.
  const mediaById = new Map((model.media || []).map((m) => [m.id, m]))
  const pick = (slot) => (slot && slot.id && mediaById.has(slot.id) ? { ...slot, ...mediaById.get(slot.id) } : slot)
  const topFigures = (f.top || []).map(pick)
  const sideFigures = (f.side || []).map(pick)
  const layout = model.template.layout || {}
  const font = layout.fontFamily || 'Arial'
  // Picture frame size in millimetres (default 2.5in × 2in — landscape, which
  // suits both the endoscopic frame and the three-across plate).
  const picW = Number(layout.pictureW) > 10 ? Number(layout.pictureW) : 56
  const picH = Number(layout.pictureH) > 10 ? Number(layout.pictureH) : 42
  const picFit = layout.pictureFit === 'contain' ? 'contain' : 'cover'

  const figure = (m, cls = '') => `<figure class="${cls}">
      ${m.dataUrl ? `<img src="${m.dataUrl}" alt="">` : '<div class="noimg">No Preview Available</div>'}
      <figcaption>${esc(m.caption && m.caption !== '(no caption)' ? m.caption : '(Image Title)')}</figcaption>
    </figure>`

  const grid = f.rows
    .map(
      ([left, right]) => `<tr>
        <td class="k">${esc(left.label)}</td>
        <td class="v">${esc(left.value)}</td>
        <td class="k2">${esc(right.label)}</td>
        <td class="v2">${esc(right.value)}</td>
      </tr>`,
    )
    .join('')

  const findings = f.findings
    .map((b) => `<p class="fb"><b><i>${esc(b.heading)}:-</i></b> ${esc(b.text)}</p>`)
    .join('')

  const comments = f.comments.length
    ? `<div class="comments"><span class="lbl">COMMENTS :</span> ${f.comments.map(esc).join('<br>')}</div>`
    : ''

  /* Free text typed in the blank half of the form, or opened from a Word file.
     When it cannot fit, the whole block moves to a second page instead of being
     guillotined at the frame edge. */
  const notes = f.notesHtml
    ? `<div class="notes">${f.notesOverflow ? '' : f.notesHtml}</div>`
    : ''
  const notesContinued = f.notesOverflow
    ? `<div class="notes-cont">continued on the next page &rarr;</div>`
    : ''

  const header = `
    <div class="lh">
      ${f.header.logo ? `<img class="logo" src="${f.header.logo}" alt="">` : ''}
      <div class="lh-txt">
        <div class="h-name">${esc(f.header.name)}</div>
        ${f.header.address ? `<div class="h-addr">${esc(f.header.address)}</div>` : ''}
        ${f.header.phones ? `<div class="h-phone">${esc(f.header.phones)}</div>` : ''}
      </div>
    </div>
    <table class="pgrid">${grid}</table>`

  const seal = f.signature.sealDataUrl
    ? `<img class="seal" src="${f.signature.sealDataUrl}" alt="">`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(model.reportNo)} — ${esc(model.patientLine.name)}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: ${font}, "Segoe UI", Arial, sans-serif;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* one bordered A4 sheet ------------------------------------------------ */
  .sheet {
    width: 210mm; height: 297mm; padding: 5mm;
    page-break-after: always; overflow: hidden;
  }
  .sheet:last-child { page-break-after: auto; }
  .frame {
    position: relative;
    width: 100%; height: 100%;
    border: 1.2px solid #000;
    padding: 4mm;
    display: flex; flex-direction: column;
  }

  /* letterhead ---------------------------------------------------------- */
  .lh { display: flex; align-items: center; gap: 5mm; padding-bottom: 1.4mm; }
  .lh .logo { width: 20mm; height: 20mm; object-fit: contain; flex: 0 0 20mm; }
  .lh-txt { flex: 1; text-align: center; }
  .h-name { font-size: 15.5pt; font-weight: 800; line-height: 1.1; }
  .h-addr { font-size: 9.6pt; font-weight: 700; margin-top: .4mm; }
  .h-phone { font-size: 7.5pt; margin-top: .4mm; }

  /* patient grid -------------------------------------------------------- */
  table.pgrid { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.pgrid td {
    border: 1px solid #000; padding: .95mm 1.5mm;
    font-size: 8.2pt; line-height: 1.18; vertical-align: middle;
    overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  }
  td.k { width: 16.5%; font-weight: 700; }
  td.v { width: 33.5%; font-weight: 700; }
  td.k2 { width: 14.5%; font-weight: 700; }
  td.v2 { width: 35.5%; }

  /* title band ---------------------------------------------------------- */
  .band {
    border-top: 1.3px solid #000; border-bottom: 1.3px solid #000;
    margin-top: 1.2mm; padding: .95mm 0 .8mm; text-align: center;
  }
  .band h1 {
    margin: 0; font-size: 12pt; font-weight: 700;
    letter-spacing: .38em; text-indent: .38em; line-height: 1.05;
  }

  /* pictures ------------------------------------------------------------
     Each frame is the picture on white, held by a single thin rule — no black
     mat around it. The size comes from the report template so the clinic can
     match its own paper form without a rebuild. */
  :root { --pic-w: ${picW}mm; --pic-h: ${picH}mm; --pic-fit: ${picFit}; }
  .top3 {
    display: grid; grid-template-columns: repeat(3, var(--pic-w));
    justify-content: space-between; margin-top: 2mm;
  }
  figure { margin: 0; }
  figure img {
    display: block; width: var(--pic-w); height: var(--pic-h);
    object-fit: var(--pic-fit); object-position: center;
    background: #fff; border: .8px solid #000;
  }
  figcaption { text-align: center; font-size: 6.4pt; margin-top: .6mm; color: #111; }
  .noimg {
    display: flex; align-items: center; justify-content: center;
    width: var(--pic-w); height: var(--pic-h);
    background: #eef3f7; color: #6b7280; font-size: 6.8pt; border: 1px solid #cbd5e1;
  }

  /* free text in the blank half of the form ----------------------------- */
  .notes {
    flex: 1 1 auto; min-height: 0; overflow: hidden;
    font-size: 10.2pt; line-height: 1.34; margin-top: 3mm;
  }
  .notes-cont { font-size: 7.6pt; font-style: italic; color: #444; margin-top: 1mm; }
  .notes p { margin: 0 0 1.6mm; }
  .notes h1, .notes h2, .notes h3 { font-size: 11pt; margin: 2mm 0 1mm; }
  .notes img, .notes-full img { max-width: 100%; height: auto; }
  .notes ul, .notes ol, .notes-full ul, .notes-full ol { margin: 0 0 1.6mm 4mm; padding: 0; }
  .notes-page .frame.flow { height: auto; min-height: 279mm; }
  .np-head { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 1.2px solid #000; padding-bottom: 2mm; margin-bottom: 3mm; }
  .np-patient { font-size: 8.6pt; color: #222; }
  .np-title { font-weight: 700; font-size: 12pt; }
  .notes-full { font-size: 10.6pt; line-height: 1.42; }
  .notes-full p { margin: 0 0 2mm; }

  /* two columns; the picture column runs to the bottom border ------------ */
  .cols {
    flex: 1 1 auto; display: grid; grid-template-columns: 1fr var(--pic-w);
    gap: 4.5mm; margin-top: 2.2mm; min-height: 0;
  }
  .col-left { min-width: 0; padding-bottom: 24mm; }
  .side4 { display: flex; flex-direction: column; justify-content: space-between; height: 100%; gap: 1.8mm; }
  .side4 figure { flex: 0 0 auto; display: flex; flex-direction: column; }
  .side4 figure img { width: var(--pic-w); height: var(--pic-h); object-fit: var(--pic-fit); object-position: center; background: #fff; border: .8px solid #000; }
  .side4 .noimg { flex: 1 1 auto; height: auto; min-height: 0; }
  .side4 figcaption { flex: 0 0 auto; }

  /* text ---------------------------------------------------------------- */
  .line { margin: 2.1mm 0 0; font-size: 8.8pt; line-height: 1.28; }
  .lbl { font-weight: 700; }
  .fh { font-weight: 700; font-size: 9.2pt; margin: 2.8mm 0 .9mm; }
  .fb { margin: 0 0 1.4mm; font-size: 8.7pt; line-height: 1.3; text-align: justify; }
  .fb b i { font-weight: 700; }
  .comments { margin-top: 3mm; font-size: 8.8pt; line-height: 1.35; }

  /* signature ----------------------------------------------------------- */
  .sign { position: absolute; left: 4mm; bottom: 4mm; width: 92mm; }
  .seal { position: absolute; left: 0; bottom: 100%; height: 17mm; margin-bottom: 1mm; }
  .sign .nm { font-size: 9.8pt; font-weight: 700; font-style: italic; border-top: .7px solid #000; padding-top: .9mm; }
  .sign .dg { font-size: 7.2pt; line-height: 1.26; }
  .sign .af { font-size: 7.2pt; font-style: italic; font-weight: 700; margin-top: .4mm; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="frame">
      ${header}
      <div class="band"><h1>${esc(f.title)}</h1></div>

      <div class="top3">${topFigures.map((m) => figure(m)).join('')}</div>

      <div class="cols">
        <div class="col-left">
          <p class="line"><span class="lbl">Procedure :</span> <span class="val">${esc(f.procedure)}</span></p>
          <p class="line"><span class="lbl">Indication :</span> <span class="val">${esc(f.indication)}</span></p>
          <p class="line"><span class="lbl">Medication :</span> <span class="val">${esc(f.medication)}</span></p>
          <div class="fh">FINDINGS :</div>
          ${findings}
          ${comments}
          ${notes}
          ${notesContinued}
        </div>
        <div class="side4">${sideFigures.map((m) => figure(m, 'side')).join('')}</div>
      </div>

      <div class="sign">
        ${seal}
        <div class="nm">${esc(f.signature.name || '\u00a0')}</div>
        ${f.signature.degrees ? `<div class="dg">${esc(f.signature.degrees)}</div>` : ''}
        ${f.signature.designation ? `<div class="dg">${esc(f.signature.designation)}</div>` : ''}
        ${f.signature.affiliation ? `<div class="af">${esc(f.signature.affiliation)}</div>` : ''}
      </div>
    </div>
  </div>
  ${
    f.notesOverflow
      ? `<div class="sheet notes-page">
           <div class="frame flow">
             <div class="np-head">
               <div class="np-patient">${esc(model.patientLine?.name || '')} &nbsp;·&nbsp; ${esc(model.reportNo || '')}</div>
               <div class="np-title">Additional notes</div>
             </div>
             <div class="notes-full">${f.notesHtml}</div>
           </div>
         </div>`
      : ''
  }
</body>
</html>`
}

/* -------------------------------------------------------------------------- */
/* Image Plus — pictures only                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The "Image Plus" printout: the patient particulars and nothing but pictures.
 * The clinic picks four or six frames; no findings, no report text.
 */
export function buildImagePlusHtml(model, options = {}) {
  const f = model.hospital
  if (!f) return ''
  const count = options.count === 6 ? 6 : 4
  const chosen = (options.images || model.media || []).filter((m) => m.kind === 'image').slice(0, count)
  const font = (model.template.layout || {}).fontFamily || 'Arial'
  const cols = count === 6 ? 2 : 2
  const rows = Math.ceil(count / cols)

  const cells = Array.from({ length: count })
    .map((_, i) => {
      const m = chosen[i]
      if (!m) {
        return `<figure><div class="noimg">No Preview Available</div><figcaption>&nbsp;</figcaption></figure>`
      }
      return `<figure>
        ${m.dataUrl ? `<img src="${m.dataUrl}" alt="">` : '<div class="noimg">No Preview Available</div>'}
        <figcaption>${esc(m.caption && m.caption !== '(no caption)' ? m.caption : '(Image Title)')}</figcaption>
      </figure>`
    })
    .join('')

  const grid = f.rows
    .map(
      ([left, right]) => `<tr>
        <td class="k">${esc(left.label)}</td>
        <td class="v">${esc(left.value)}</td>
        <td class="k2">${esc(right.label)}</td>
        <td class="v2">${esc(right.value)}</td>
      </tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Image Plus — ${esc(model.patientLine.name)}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: ${font}, "Segoe UI", Arial, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { width: 210mm; height: 297mm; padding: 5mm; }
  .frame { width: 100%; height: 100%; border: 1.2px solid #000; padding: 4mm; display: flex; flex-direction: column; }
  .lh { display: flex; align-items: center; gap: 5mm; padding-bottom: 1.4mm; }
  .lh .logo { width: 20mm; height: 20mm; object-fit: contain; flex: 0 0 20mm; }
  .lh-txt { flex: 1; text-align: center; }
  .h-name { font-size: 15.5pt; font-weight: 800; line-height: 1.1; }
  .h-addr { font-size: 9.6pt; font-weight: 700; margin-top: .4mm; }
  .h-phone { font-size: 7.5pt; margin-top: .4mm; }
  table.pgrid { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.pgrid td { border: 1px solid #000; padding: .95mm 1.5mm; font-size: 8.2pt; line-height: 1.18; vertical-align: middle; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  td.k { width: 16.5%; font-weight: 700; }
  td.v { width: 33.5%; font-weight: 700; }
  td.k2 { width: 14.5%; font-weight: 700; }
  td.v2 { width: 35.5%; }
  .band { border-top: 1.3px solid #000; border-bottom: 1.3px solid #000; margin-top: 1.6mm; padding: 1mm 0 .9mm; text-align: center; }
  .band h1 { margin: 0; font-size: 11.5pt; font-weight: 700; letter-spacing: .34em; text-indent: .34em; }
  .plate { flex: 1 1 auto; display: grid; grid-template-columns: repeat(${cols}, 55.88mm); grid-auto-rows: 50.8mm; justify-content: center; align-content: start; gap: 6mm 8mm; margin-top: 4mm; }
  figure { margin: 0; }
  figure img { display: block; width: 55.88mm; height: 50.8mm; object-fit: contain; object-position: center; background: #fff; border: .8px solid #000; }
  figcaption { text-align: center; font-size: 6.6pt; margin-top: .8mm; }
  .noimg { display: flex; align-items: center; justify-content: center; width: 55.88mm; height: 50.8mm; background: #eef3f7; color: #6b7280; font-size: 6.8pt; border: 1px solid #cbd5e1; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="frame">
      <div class="lh">
        ${f.header.logo ? `<img class="logo" src="${f.header.logo}" alt="">` : ''}
        <div class="lh-txt">
          <div class="h-name">${esc(f.header.name)}</div>
          ${f.header.address ? `<div class="h-addr">${esc(f.header.address)}</div>` : ''}
          ${f.header.phones ? `<div class="h-phone">${esc(f.header.phones)}</div>` : ''}
        </div>
      </div>
      <table class="pgrid">${grid}</table>
      <div class="band"><h1>IMAGE PLUS — ${count} PICTURES</h1></div>
      <div class="plate">${cells}</div>
    </div>
  </div>
</body>
</html>`
}
