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
