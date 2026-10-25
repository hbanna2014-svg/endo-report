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
  // A report that came from the clinic's own Word file prints as that file.
  if (model?.reportDoc?.custom) return buildDocPrintHtml(model)
  // The unit's own paper form (letterhead, patient grid, 3 + 4 pictures).
  if ((model?.template?.layout?.style || 'standard') === 'hospital') return buildHospitalPrintHtml(model)

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
  .sheet-side figure img { width: 100%; height: auto; aspect-ratio: 4 / 3; object-fit: cover; border: 1px solid #c9d1db; }
  .sheet-side figcaption { text-align: center; }
  .sheet-top { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin: 3mm 0 4mm; }
  .sheet-top figure img { width: 100%; height: auto; aspect-ratio: 4 / 3; object-fit: cover; border: 1px solid #c9d1db; }
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
  const layout = model.template.layout || {}
  const font = layout.fontFamily || 'Arial'

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
    .map(
      (b) =>
        `<p class="fb"><b><i>${esc(b.heading)}:-</i></b> ${esc(b.text)}</p>`,
    )
    .join('')

  const comments = f.comments.length
    ? `<div class="comments"><span class="lbl">COMMENTS :</span> ${f.comments.map(esc).join('<br>')}</div>`
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

  const sideFigures = f.side.map((m) => figure(m, 'side')).join('')

  /* Optional trailing picture sheet: six frames on a 2 x 3 plate. */
  let extraSheets = ''
  if (layout.extraImageSheet) {
    const all = (model.media || []).filter((m) => m.kind === 'image')
    for (let i = 0; i < all.length; i += 6) {
      const chunk = all.slice(i, i + 6)
      extraSheets += `<div class="sheet">
        ${header}
        <div class="band"><h1>${esc(f.title)}</h1></div>
        <div class="plus-row">
          ${[1, 2, 3, 4, 6].map((n) => `<span class="plus"><i class="${n === 6 ? 'on' : ''}"></i> Image Plus ${n}</span>`).join('')}
        </div>
        <div class="plate6">
          ${Array.from({ length: 6 })
            .map((_, k) => (chunk[k] ? figure({ ...chunk[k], dataUrl: chunk[k].dataUrl }) : `<figure class="empty"><div class="noimg">No Preview Available</div></figure>`))
            .join('')}
        </div>
      </div>`
    }
  }

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
  .sheet {
    position: relative;
    width: 210mm;
    min-height: 297mm;
    padding: 6mm 7mm 9mm;
    page-break-after: always;
    overflow: hidden;
  }
  .sheet:last-child { page-break-after: auto; }

  /* letterhead ---------------------------------------------------------- */
  .lh { display: flex; align-items: center; gap: 5mm; padding-bottom: 1.6mm; }
  .lh .logo { width: 23mm; height: 23mm; object-fit: contain; flex: 0 0 23mm; }
  .lh-txt { flex: 1; text-align: center; }
  .h-name { font-size: 16.5pt; font-weight: 800; letter-spacing: .1px; line-height: 1.12; }
  .h-addr { font-size: 10pt; font-weight: 700; margin-top: .5mm; }
  .h-phone { font-size: 7.8pt; margin-top: .5mm; }

  /* patient grid -------------------------------------------------------- */
  table.pgrid { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.pgrid td {
    border: 1px solid #000;
    padding: 1.05mm 1.6mm;
    font-size: 8.5pt;
    line-height: 1.2;
    vertical-align: middle;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  td.k { width: 16.5%; font-weight: 700; }
  td.v { width: 33.5%; font-weight: 700; }
  td.k2 { width: 14.5%; font-weight: 700; }
  td.v2 { width: 35.5%; }

  /* title band ---------------------------------------------------------- */
  .band {
    border-top: 1.3px solid #000;
    border-bottom: 1.3px solid #000;
    margin-top: 1.4mm;
    padding: 1.1mm 0 .9mm;
    text-align: center;
  }
  .band h1 {
    margin: 0;
    font-size: 12.5pt;
    font-weight: 700;
    letter-spacing: .40em;
    text-indent: .40em;
    line-height: 1.1;
  }

  /* two-column body ----------------------------------------------------- */
  .cols { display: grid; grid-template-columns: 1fr 56mm; gap: 3.2mm; margin-top: 2.4mm; align-items: start; }
  .top3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2.4mm; }

  figure { margin: 0; }
  figure img {
    display: block; width: 100%; background: #000;
    aspect-ratio: 4 / 3; object-fit: contain;
  }
  .top3 figure img { aspect-ratio: 4 / 3; }
  figcaption { text-align: center; font-size: 6.6pt; margin-top: .7mm; color: #111; }
  .noimg {
    display: flex; align-items: center; justify-content: center;
    aspect-ratio: 4 / 3; background: #eef3f7; color: #6b7280; font-size: 7pt;
    border: 1px solid #cbd5e1;
  }

  .side4 { display: grid; gap: 2.4mm; }
  .side4 figure img { aspect-ratio: 4 / 3; }

  /* text ---------------------------------------------------------------- */
  .line { margin: 2.6mm 0 0; font-size: 9pt; line-height: 1.3; }
  .lbl { font-weight: 700; }
  .fh { font-weight: 700; font-size: 9.4pt; margin: 3.2mm 0 1mm; }
  .fb { margin: 0 0 1.5mm; font-size: 8.9pt; line-height: 1.3; text-align: justify; }
  .fb b i { font-weight: 700; }
  .comments { margin-top: 3.4mm; font-size: 9pt; line-height: 1.35; }

  /* signature ----------------------------------------------------------- */
  .sign { position: absolute; left: 7mm; bottom: 9mm; width: 88mm; }
  .sign .nm {
    font-size: 10pt; font-weight: 700; font-style: italic;
    border-top: .7px solid #000; padding-top: 1mm;
  }
  .sign .dg { font-size: 7.4pt; line-height: 1.28; }
  .sign .af { font-size: 7.4pt; font-style: italic; font-weight: 700; margin-top: .5mm; }

  /* picture sheet ------------------------------------------------------- */
  .plus-row { display: flex; gap: 6mm; justify-content: center; margin: 1.4mm 0 1.6mm; font-size: 7.6pt; }
  .plus { display: inline-flex; align-items: center; gap: 1.2mm; }
  .plus i {
    width: 2.6mm; height: 2.6mm; border: .8px solid #000; border-radius: 50%;
    display: inline-block;
  }
  .plus i.on { background: #000; box-shadow: inset 0 0 0 1px #fff; }
  .plate6 { display: grid; grid-template-columns: 1fr 1fr; gap: 2.6mm; }
  .plate6 figure { break-inside: avoid; }
  .plate6 figure img { aspect-ratio: 4 / 3; }
  .plate6 figure.empty .noimg { aspect-ratio: 4 / 3; }
</style>
</head>
<body>
  <div class="sheet">
    ${header}
    <div class="band"><h1>${esc(f.title)}</h1></div>
    <div class="cols">
      <div class="col-left">
        <div class="top3">${f.top.map((m) => figure(m)).join('')}</div>
        <p class="line"><span class="lbl">Procedure :</span> <span class="val">${esc(f.procedure)}</span></p>
        <p class="line"><span class="lbl">Indication :</span> <span class="val">${esc(f.indication)}</span></p>
        <p class="line"><span class="lbl">Medication :</span> <span class="val">${esc(f.medication)}</span></p>
        <div class="fh">FINDINGS :</div>
        ${findings}
        ${comments}
      </div>
      <div class="col-right">
        <div class="side4">${sideFigures}</div>
      </div>
    </div>

    <div class="sign">
      <div class="nm">${esc(f.signature.name || '\u00a0')}</div>
      ${f.signature.degrees ? `<div class="dg">${esc(f.signature.degrees)}</div>` : ''}
      ${f.signature.designation ? `<div class="dg">${esc(f.signature.designation)}</div>` : ''}
      ${f.signature.affiliation ? `<div class="af">${esc(f.signature.affiliation)}</div>` : ''}
    </div>
  </div>
  ${extraSheets}
</body>
</html>`
}
