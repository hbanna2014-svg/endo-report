/**
 * docxTemplate.cjs — use the clinic's own Microsoft Word file as the report
 * template.
 *
 * Reading:  word/document.xml is walked and each paragraph / table row is
 *           exposed as an editable block, together with any {{TOKENS}} found.
 * Writing:  the ORIGINAL package is kept and only the text nodes are rewritten,
 *           so the letterhead, fonts, spacing, logos and page setup of the
 *           hospital's Word file survive untouched. Report data is poured into
 *           the {{TOKENS}}; {{FINDINGS}}, {{IMPRESSION}}, {{RECOMMENDATION}},
 *           {{DETAILS}} and {{IMAGES}} expand into real content.
 */

const fs = require('node:fs')
const path = require('node:path')
const JSZip = require('jszip')

const { imageSize } = require('./docx.cjs')

/* -------------------------------------------------------------------------- */
/* Tokens                                                                     */
/* -------------------------------------------------------------------------- */

const TOKENS = [
  { key: 'CLINIC_NAME', label: 'Clinic name' },
  { key: 'CLINIC_ADDRESS', label: 'Clinic address' },
  { key: 'CLINIC_PHONE', label: 'Clinic phone / e-mail' },
  { key: 'PATIENT_NAME', label: 'Patient name' },
  { key: 'PATIENT_AGE', label: 'Patient age' },
  { key: 'PATIENT_SEX', label: 'Patient sex' },
  { key: 'PATIENT_AGE_SEX', label: 'Age / sex (combined)' },
  { key: 'REG_NO', label: 'Registration number' },
  { key: 'REPORT_NO', label: 'Report number' },
  { key: 'PROCEDURE', label: 'Procedure name' },
  { key: 'PROCEDURE_DATE', label: 'Date of procedure' },
  { key: 'REFERRED_BY', label: 'Referred by' },
  { key: 'PERFORMED_BY', label: 'Endoscopist' },
  { key: 'INDICATION', label: 'Indication' },
  { key: 'HISTORY', label: 'Relevant history' },
  { key: 'FINDINGS', label: 'Findings (expands)' },
  { key: 'IMPRESSION', label: 'Impression (expands)' },
  { key: 'RECOMMENDATION', label: 'Recommendation (expands)' },
  { key: 'DETAILS', label: 'Procedure details table (expands)' },
  { key: 'IMAGES', label: 'Picture plate (expands)' },
  { key: 'SIGNATURE', label: 'Signature block (expands)' },
  { key: 'DOCTOR_NAME', label: 'Doctor name' },
  { key: 'DOCTOR_DEGREES', label: 'Doctor degrees' },
  { key: 'DOCTOR_DESIGNATION', label: 'Doctor designation' },
  { key: 'DOCTOR_REG_NO', label: 'Doctor registration no' },
  { key: 'GENERATED_AT', label: 'Generated date / time' },
]

const BLOCK_TOKENS = new Set(['FINDINGS', 'IMPRESSION', 'RECOMMENDATION', 'DETAILS', 'IMAGES', 'SIGNATURE'])

const TOKEN_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g

/* -------------------------------------------------------------------------- */
/* Tiny XML helpers                                                           */
/* -------------------------------------------------------------------------- */

function esc(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function unesc(v) {
  return String(v || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
}

function paraText(pXml) {
  let out = ''
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
  let m
  while ((m = re.exec(pXml))) out += unesc(m[1])
  if (/<w:(?:br|cr)\s*\/>/.test(pXml)) out += ' '
  if (/<w:drawing\b/.test(pXml)) out += ' [picture]'
  return out.replace(/\s+/g, ' ').trim()
}

function firstRPr(pXml) {
  const m = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(pXml)
  return m ? m[0] : ''
}

/**
 * Returns the XML of one balanced <tag>…</tag> element starting at `start`.
 * The lookahead `[\s/>]` is what keeps <w:p> from swallowing <w:pPr> and
 * <w:tbl> from swallowing <w:tblPr> / <w:tblGrid>.
 */
function readBalanced(str, start, tag) {
  const openRe = new RegExp(`<${tag}(?=[\\s/>])([^>]*)>`, 'g')
  const closeRe = new RegExp(`</${tag}>`, 'g')
  let depth = 0
  let cursor = start
  while (cursor < str.length) {
    openRe.lastIndex = cursor
    closeRe.lastIndex = cursor
    const om = openRe.exec(str)
    const cm = closeRe.exec(str)
    if (!cm) return { xml: str.slice(start), end: str.length }
    if (om && om.index < cm.index) {
      const selfClosing = /\/\s*$/.test(om[1])
      if (selfClosing && depth === 0) {
        const end = om.index + om[0].length
        return { xml: str.slice(start, end), end }
      }
      if (!selfClosing) depth += 1
      cursor = om.index + om[0].length
    } else {
      depth -= 1
      cursor = cm.index + cm[0].length
      if (depth <= 0) return { xml: str.slice(start, cursor), end: cursor }
    }
  }
  return { xml: str.slice(start), end: str.length }
}

/**
 * Walks the body and yields the top-level blocks, numbering every <w:p> so the
 * editor and the writer agree on which line is which.
 */
function walkBody(xml, visit) {
  const bodyStart = xml.indexOf('<w:body')
  if (bodyStart < 0) return
  const open = xml.indexOf('>', bodyStart) + 1
  const bodyEnd = xml.lastIndexOf('</w:body>')
  const body = xml.slice(open, bodyEnd < 0 ? xml.length : bodyEnd)

  let i = 0
  let pNo = 0

  while (i < body.length) {
    const pAt = body.indexOf('<w:p', i)
    const tAt = body.indexOf('<w:tbl', i)
    let next = -1
    let kind = null
    if (pAt >= 0 && (tAt < 0 || pAt < tAt)) {
      next = pAt
      kind = 'p'
    } else if (tAt >= 0) {
      next = tAt
      kind = 'tbl'
    }
    if (next < 0 || kind === null) break

    if (kind === 'p') {
      const { xml: pXml, end } = readBalanced(body, next, 'w:p')
      pNo += 1
      visit({ kind: 'paragraph', pNo, xml: pXml, text: paraText(pXml) })
      i = end
    } else {
      const { xml: tblXml, end } = readBalanced(body, next, 'w:tbl')
      const cells = []
      const trRe = /<w:tr\b[\s\S]*?<\/w:tr>/g
      let tr
      while ((tr = trRe.exec(tblXml))) {
        const row = []
        const tcRe = /<w:tc\b[\s\S]*?<\/w:tc>/g
        let tc
        while ((tc = tcRe.exec(tr[0]))) {
          const pRe = /<w:p\b[\s\S]*?<\/w:p>/g
          let pp
          while ((pp = pRe.exec(tc[0]))) pNo += 1
          row.push(paraText(tc[0]))
        }
        if (row.length) cells.push(row)
      }
      visit({ kind: 'table', pNo: null, xml: tblXml, rows: cells })
      i = end
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

async function parseDocxBuffer(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error('This file is not a Word .docx document (word/document.xml is missing).')
  const xml = await docFile.async('string')

  const blocks = []
  let n = 0
  walkBody(xml, (b) => {
    n += 1
    if (b.kind === 'paragraph') {
      blocks.push({ id: `b${n}`, kind: 'paragraph', pNo: b.pNo, text: b.text, original: b.text })
    } else if (b.rows.length) {
      blocks.push({ id: `b${n}`, kind: 'table', rows: b.rows, original: b.rows })
    }
  })

  const found = new Set()
  let m
  // eslint-disable-next-line no-cond-assign
  while ((m = TOKEN_RE.exec(xml))) found.add(m[1].toUpperCase())
  TOKEN_RE.lastIndex = 0

  const known = new Set(TOKENS.map((t) => t.key))
  const tokens = [...found]
  const unknownTokens = tokens.filter((t) => !known.has(t))

  return {
    blocks,
    tokens,
    unknownTokens,
    paragraphs: blocks.filter((b) => b.kind === 'paragraph').length,
    tables: blocks.filter((b) => b.kind === 'table').length,
    wordCount: blocks.reduce((a, b) => a + (b.kind === 'paragraph' ? b.text.split(/\s+/).filter(Boolean).length : 0), 0),
  }
}

async function parseDocxFile(filePath) {
  const buffer = await fs.promises.readFile(filePath)
  const parsed = await parseDocxBuffer(buffer)
  return {
    ...parsed,
    fileName: path.basename(filePath),
    bytes: buffer.length,
    base64: buffer.toString('base64'),
  }
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                    */
/* -------------------------------------------------------------------------- */

function setParaText(pXml, text) {
  const rPr = firstRPr(pXml)
  const hasT = /<w:t(?:\s[^>]*)?>/.test(pXml) || /<w:t\s*\/>/.test(pXml)
  if (!hasT) {
    return pXml.replace(/<\/w:p>\s*$/, `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`)
  }
  let first = true
  return pXml.replace(/<w:t(\s[^>]*)?\/>|<w:t(\s[^>]*)?>[\s\S]*?<\/w:t>/g, (whole, a1, a2) => {
    const attrs = a1 || a2 || ''
    if (first) {
      first = false
      const clean = attrs.replace(/\sxml:space="[^"]*"/g, '')
      return `<w:t${clean} xml:space="preserve">${esc(text)}</w:t>`
    }
    return `<w:t${attrs.replace(/\sxml:space="[^"]*"/g, '')} xml:space="preserve"></w:t>`
  })
}

function runsToParas(lines, rPr) {
  return lines
    .map((line) => {
      const r = `<w:r>${rPr}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`
      return `<w:p>${r}</w:p>`
    })
    .join('')
}

function drawing(xmlRelId, cx, cy, id, name) {
  const ns = [
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  ].join(' ')
  return (
    `<w:drawing><wp:inline ${ns} distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${id}" name="${esc(name)}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${xmlRelId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing>`
  )
}

/** A borderless 2-column table holding the picture plate. */
function plateTable(images, cols, maxWidthEmu) {
  const colW = Math.floor(maxWidthEmu / cols)
  const cellXml = images.map((img) => {
    const size = imageSize(img.buffer) || { width: 4, height: 3 }
    const ratio = size.width && size.height ? size.height / size.width : 0.75
    let cx = colW - 120000
    let cy = Math.round(cx * ratio)
    const maxH = Math.round((maxWidthEmu / cols) * 0.8)
    if (cy > maxH) {
      cy = maxH
      cx = Math.round(cy / ratio)
    }
    return (
      `<w:tc><w:tcPr><w:tcW w:w="${Math.round(colW / 635)}" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>` +
      `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="40" w:after="20"/></w:pPr><w:r>${drawing(img.relId, cx, cy, img.docPr, img.name)}</w:r></w:p>` +
      (img.caption ? `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="4B5563"/></w:rPr><w:t xml:space="preserve">${esc(img.caption)}</w:t></w:r></w:p>` : '') +
      `</w:tc>`
    )
  })
  const rows = []
  for (let i = 0; i < cellXml.length; i += cols) rows.push(`<w:tr>${cellXml.slice(i, i + cols).join('')}</w:tr>`)
  const tblPr =
    '<w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/>' +
    '<w:tblBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
    '<w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
    '<w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
    '<w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
    '<w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
    '<w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders>' +
    '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="40" w:type="dxa"/>' +
    '<w:bottom w:w="40" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr>'
  const grid = `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${Math.round(colW / 635)}"/>`).join('')}</w:tblGrid>`
  return `<w:tbl>${tblPr}${grid}${rows.join('')}</w:tbl><w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>`
}

function detailsTable(details, rPr) {
  const rows = details
    .map(
      (d) =>
        `<w:tr><w:tc><w:tcPr><w:tcW w:w="2200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F5F7FA"/></w:tcPr>` +
        `<w:p><w:r>${rPr}<w:t xml:space="preserve">${esc(d.label)}</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:tcPr><w:tcW w:w="4600" w:type="dxa"/></w:tcPr>` +
        `<w:p><w:r>${rPr}<w:t xml:space="preserve">${esc(d.value)}</w:t></w:r></w:p></w:tc></w:tr>`,
    )
    .join('')
  const border = (n) =>
    `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="D5DBE3"/>`
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>` +
    `<w:tblBorders>${border('top')}${border('left')}${border('bottom')}${border('right')}${border('insideH')}${border('insideV')}</w:tblBorders>` +
    `<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="2200"/><w:gridCol w:w="4600"/></w:tblGrid>${rows}</w:tbl>` +
    `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>`
  )
}

/**
 * Builds the merged .docx.
 *
 * @param {string} base64   the original Word file
 * @param {object} model    the report model (same one used for print / PDF)
 * @param {object} opts     { edits: { [pNo]: text }, images: [{ relId, buffer, caption, name, docPr }] }
 */
async function renderDocxTemplate(base64, model, opts = {}) {
  const zip = await JSZip.loadAsync(Buffer.from(base64, 'base64'))
  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error('The stored Word template is damaged.')
  const original = await docFile.async('string')

  const edits = opts.edits || {}
  const images = opts.images || []
  const layout = model.template?.layout || {}
  const c = model.template?.clinic || {}

  const vars = {
    CLINIC_NAME: c.name || '',
    CLINIC_ADDRESS: c.address || '',
    CLINIC_PHONE: [c.phone, c.email].filter(Boolean).join('  |  '),
    PATIENT_NAME: model.patientLine.name,
    PATIENT_AGE: model.patientLine.age ? `${model.patientLine.age}` : '',
    PATIENT_SEX: model.patientLine.sex || '',
    PATIENT_AGE_SEX: model.patientLine.ageSex,
    REG_NO: model.patientLine.regNo || '',
    REPORT_NO: model.reportNo,
    PROCEDURE: model.short || '',
    PROCEDURE_DATE: model.patientLine.procedureDate || '',
    REFERRED_BY: model.patientLine.referredBy || '',
    PERFORMED_BY: model.patientLine.performedBy || '',
    INDICATION: model.narrative.indication || '',
    HISTORY: model.narrative.history || '',
    DOCTOR_NAME: model.signature.name || '',
    DOCTOR_DEGREES: model.signature.degrees || '',
    DOCTOR_DESIGNATION: model.signature.designation || '',
    DOCTOR_REG_NO: model.signature.regNo || '',
    GENERATED_AT: model.generatedLine || '',
  }

  const impressionLines = String(model.narrative.diagnosis || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const buildBlock = (token, rPr) => {
    switch (token) {
      case 'FINDINGS': {
        const lines = []
        for (const b of model.narrative.findings || []) {
          lines.push(`${b.heading}`)
          lines.push(b.text)
        }
        if (!lines.length) lines.push('No findings recorded.')
        return runsToParas(lines, rPr)
      }
      case 'IMPRESSION':
        return runsToParas(impressionLines.length ? impressionLines : ['Normal study'], rPr)
      case 'RECOMMENDATION': {
        const lines = String(model.narrative.recommendation || '')
          .split('\n')
          .map((l) => l.replace(/^•\s*/, '').trim())
          .filter(Boolean)
        return lines.length ? runsToParas(lines.map((l) => `•  ${l}`), rPr) : ''
      }
      case 'DETAILS':
        return (model.details || []).filter((d) => d.value).length
          ? detailsTable(
              model.details.filter((d) => d.value),
              rPr,
            )
          : ''
      case 'IMAGES':
        return images.length ? plateTable(images, layout.imageLayout === 'flow' ? 3 : 2, 6_300_000) : ''
      case 'SIGNATURE':
        return runsToParas(
          ['', `____________________________`, model.signature.name || '', model.signature.designation || ''],
          rPr,
        )
      default:
        return ''
    }
  }

  const replaceInline = (text) => {
    TOKEN_RE.lastIndex = 0
    return text.replace(TOKEN_RE, (_all, key) => {
      const k = String(key).toUpperCase()
      if (BLOCK_TOKENS.has(k)) return ''
      return vars[k] !== undefined ? String(vars[k]) : `{{${key}}}`
    })
  }

  const transformPara = (pXml, pNo, depth) => {
    const rPr = firstRPr(pXml)
    const current = paraText(pXml)
    const edited = edits[pNo] !== undefined && edits[pNo] !== current ? edits[pNo] : null

    // Which block token, if any, lives on this line?
    let blockToken = null
    TOKEN_RE.lastIndex = 0
    let m
    while ((m = TOKEN_RE.exec(current))) {
      const k = String(m[1]).toUpperCase()
      if (BLOCK_TOKENS.has(k)) {
        blockToken = k
        break
      }
    }

    if (blockToken && depth === 0) {
      const generated = buildBlock(blockToken, rPr)
      if (!generated) return ''
      return generated
    }

    const base = edited !== null ? edited : current
    const filled = replaceInline(base)
    if (blockToken) {
      // Inside a table cell we cannot drop the paragraph, so render the lines inline.
      return setParaText(pXml, buildBlock(blockToken, rPr).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    }
    if (filled === current && edited === null) return pXml
    return setParaText(pXml, filled)
  }

  /* Rebuild the body in one pass so paragraph numbers stay aligned. -------- */
  const bodyStart = original.indexOf('<w:body')
  const bodyOpenEnd = original.indexOf('>', bodyStart) + 1
  const bodyEnd = original.lastIndexOf('</w:body>')
  const head = original.slice(0, bodyOpenEnd)
  const body = original.slice(bodyOpenEnd, bodyEnd)
  const tail = original.slice(bodyEnd)

  const out = []
  let i = 0
  let pNo = 0

  while (i < body.length) {
    const pAt = body.indexOf('<w:p', i)
    const tAt = body.indexOf('<w:tbl', i)
    let next = -1
    let kind = null
    if (pAt >= 0 && (tAt < 0 || pAt < tAt)) {
      next = pAt
      kind = 'p'
    } else if (tAt >= 0) {
      next = tAt
      kind = 'tbl'
    }
    if (next < 0) {
      out.push(body.slice(i))
      break
    }
    out.push(body.slice(i, next))

    if (kind === 'p') {
      const { xml: pXml, end } = readBalanced(body, next, 'w:p')
      pNo += 1
      out.push(transformPara(pXml, pNo, 0))
      i = end
    } else {
      const { xml: tblXml, end } = readBalanced(body, next, 'w:tbl')
      // Rewrite the text of every cell paragraph in place (no block expansion).
      const rewritten = tblXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (cellP) => {
        pNo += 1
        return transformPara(cellP, pNo, 1)
      })
      out.push(rewritten)
      i = end
    }
  }

  let xml = head + out.join('') + tail

  /* Images ---------------------------------------------------------------- */
  if (images.length) {
    const relsPath = 'word/_rels/document.xml.rels'
    let rels = zip.file(relsPath) ? await zip.file(relsPath).async('string') : ''
    if (!rels) {
      rels =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
    }
    let ct = (await zip.file('[Content_Types].xml').async('string')) || ''
    const addDefault = (ext, mime) => {
      if (!new RegExp(`Extension="${ext}"`, 'i').test(ct)) {
        ct = ct.replace('</Types>', `<Default Extension="${ext}" ContentType="${mime}"/></Types>`)
      }
    }

    const relsAdd = []
    for (const img of images) {
      const ext = img.ext || 'png'
      addDefault(ext, ext === 'jpg' ? 'image/jpeg' : `image/${ext}`)
      const target = `media/er-plate-${img.docPr}.${ext}`
      zip.file(`word/${target}`, img.buffer, { binary: true })
      relsAdd.push(
        // Target is relative to word/ — a leading slash makes Word look for
        // /media/... at package root and the picture silently disappears.
        `<Relationship Id="${img.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`,
      )
    }
    rels = rels.replace('</Relationships>', `${relsAdd.join('')}</Relationships>`)

    zip.file(relsPath, rels)
    zip.file('[Content_Types].xml', ct)
  }

  zip.file('word/document.xml', xml)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

/* -------------------------------------------------------------------------- */

module.exports = {
  TOKENS,
  BLOCK_TOKENS,
  parseDocxFile,
  parseDocxBuffer,
  renderDocxTemplate,
  paraText,
}
