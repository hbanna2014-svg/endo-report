/**
 * docx.cjs — generates a real Microsoft Word (.docx) report, fully offline.
 *
 * The layout mirrors the on-screen preview: clinic letterhead, patient block,
 * procedure details table, narrative findings, auto impression, recommendations,
 * captured images with their captions and a signature block.
 */

const fs = require('node:fs')
const path = require('node:path')

const docxPkg = require('docx')
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  ImageRun,
  BorderStyle,
  Header,
  Footer,
  PageNumber,
  VerticalAlign,
} = docxPkg

/** docx v9 requires an explicit image `type`; v8 rejects unknown keys. */
function detectDocxMajor() {
  try {
    let dir = path.dirname(require.resolve('docx'))
    for (let i = 0; i < 6; i += 1) {
      const pkgPath = path.join(dir, 'package.json')
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
        if (pkg.name === 'docx') return Number(String(pkg.version).split('.')[0]) || 8
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch {
    /* fall through */
  }
  return 8
}

const DOCX_VERSION = detectDocxMajor()

/* -------------------------------------------------------------------------- */
/* Colour helpers                                                             */
/* -------------------------------------------------------------------------- */

function hex(color, fallback = '1D4ED8') {
  const c = String(color || '').replace('#', '').trim()
  return /^[0-9a-fA-F]{6}$/.test(c) ? c.toUpperCase() : fallback
}

function tint(color, amount = 0.9) {
  const c = hex(color)
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  const mix = (v) => Math.round(v + (255 - v) * amount)
  return [mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}

/* -------------------------------------------------------------------------- */
/* Image helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Reads intrinsic pixel dimensions from a PNG / JPEG buffer. */
function imageSize(buf) {
  try {
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), type: 'png' }
    }
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let off = 2
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) {
          off++
          continue
        }
        const marker = buf[off + 1]
        const len = buf.readUInt16BE(off + 2)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7), type: 'jpg' }
        }
        off += 2 + len
      }
    }
  } catch {
    /* fall through to default */
  }
  return null
}

function fitBox(buf, maxWidth, maxHeight) {
  const size = imageSize(buf)
  if (!size || !size.width || !size.height) {
    return { width: maxWidth, height: Math.round(maxWidth * 0.7), type: 'png' }
  }
  const scale = Math.min(maxWidth / size.width, maxHeight / size.height)
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
    type: size.type,
  }
}

function makeImageRun(buf, maxWidth, maxHeight) {
  const box = fitBox(buf, maxWidth, maxHeight)
  const options = {
    data: buf,
    transformation: { width: box.width, height: box.height },
  }
  // docx v9 requires an explicit image type; v8 does not.
  if (DOCX_VERSION >= 9) options.type = box.type
  return new ImageRun(options)
}

/* -------------------------------------------------------------------------- */
/* Small building blocks                                                      */
/* -------------------------------------------------------------------------- */

const FONT = (model) => model?.template?.layout?.fontFamily || 'Arial'
const SIZE = (model) => Math.round((model?.template?.layout?.fontSize || 11) * 2)
const ACCENT = (model) => hex(model?.template?.layout?.accentColor)

const NO_BORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
}

const LIGHT = { style: BorderStyle.SINGLE, size: 2, color: 'D5DBE3' }

function p(text, opts = {}) {
  const { bold, italics, size, color, align, spacing, font, underline } = opts
  return new Paragraph({
    alignment: align,
    spacing: spacing || { after: 80 },
    children: [
      new TextRun({
        text: text === undefined || text === null ? '' : String(text),
        bold: !!bold,
        italics: !!italics,
        underline: underline ? {} : undefined,
        size: size || undefined,
        color: color || undefined,
        font: font || undefined,
      }),
    ],
  })
}

function sectionHeading(text, model) {
  return new Paragraph({
    spacing: { before: 220, after: 90 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT(model), space: 2 } },
    children: [
      new TextRun({
        text: String(text).toUpperCase(),
        bold: true,
        size: SIZE(model) + 2,
        color: ACCENT(model),
        font: FONT(model),
      }),
    ],
  })
}

function infoTable(rows, model, opts = {}) {
  const border = opts.bordered ? LIGHT : NO_BORDER
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: rows.map(
      ([label, value]) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 30, type: WidthType.PERCENTAGE },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 60, bottom: 60, left: 80, right: 80 },
              borders: border,
              shading: opts.bordered ? { fill: 'F5F7FA' } : undefined,
              children: [p(label, { bold: true, font: FONT(model), size: SIZE(model), color: '374151' })],
            }),
            new TableCell({
              width: { size: 70, type: WidthType.PERCENTAGE },
              verticalAlign: VerticalAlign.CENTER,
              margins: { top: 60, bottom: 60, left: 80, right: 80 },
              borders: border,
              children: [p(value || '—', { font: FONT(model), size: SIZE(model) })],
            }),
          ],
        }),
    ),
  })
}

function divider(model) {
  return new Paragraph({
    spacing: { before: 60, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT(model), space: 1 } },
    children: [new TextRun({ text: '' })],
  })
}

/* -------------------------------------------------------------------------- */
/* Document                                                                   */
/* -------------------------------------------------------------------------- */

function buildDocument(model) {
  const font = FONT(model)
  const size = SIZE(model)
  const clinic = model.template.clinic || {}
  const layout = model.template.layout || {}
  const children = []

  /* Letterhead --------------------------------------------------------- */
  if (layout.showLogo && clinic.logoDataUrl) {
    const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(clinic.logoDataUrl)
    if (m) {
      const buf = Buffer.from(m[2], 'base64')
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [makeImageRun(buf, 130, 70)],
        }),
      )
    }
  }
  if (clinic.name) {
    children.push(
      p(clinic.name, { bold: true, align: AlignmentType.CENTER, size: size + 8, color: ACCENT(model), font }),
    )
  }
  if (clinic.address) {
    children.push(p(clinic.address, { align: AlignmentType.CENTER, size: size - 1, color: '4B5563', font, spacing: { after: 40 } }))
  }
  const contact = [clinic.phone, clinic.email].filter(Boolean).join('  |  ')
  if (contact) {
    children.push(p(contact, { align: AlignmentType.CENTER, size: size - 1, color: '4B5563', font, spacing: { after: 60 } }))
  }
  children.push(divider(model))

  /* Title -------------------------------------------------------------- */
  children.push(
    p(model.title, { bold: true, align: AlignmentType.CENTER, size: size + 4, font, spacing: { after: 60 } }),
  )
  children.push(
    p(`Report No: ${model.reportNo}    |    Generated: ${model.generatedLine}`, {
      align: AlignmentType.CENTER,
      size: size - 2,
      color: '6B7280',
      font,
      spacing: { after: 160 },
    }),
  )

  /* Patient block ------------------------------------------------------ */
  if (layout.showPatientBlock) {
    const rows = [
      ['Patient name', model.patientLine.name],
      ['Age / Sex', model.patientLine.ageSex],
    ]
    if (model.patientLine.regNo) rows.push(['Registration no', model.patientLine.regNo])
    if (model.patientLine.phone) rows.push(['Contact', model.patientLine.phone])
    if (model.patientLine.address) rows.push(['Address', model.patientLine.address])
    if (model.patientLine.referredBy) rows.push(['Referred by', model.patientLine.referredBy])
    rows.push(['Procedure done by', model.patientLine.performedBy])
    rows.push(['Date of procedure', model.patientLine.procedureDate])
    children.push(infoTable(rows, model, { bordered: true }))
  }

  /* Indication / history ---------------------------------------------- */
  if (model.narrative.indication) {
    children.push(sectionHeading('Indication', model))
    children.push(p(model.narrative.indication, { font, size }))
  }
  if (model.narrative.history) {
    children.push(sectionHeading('Relevant history', model))
    children.push(p(model.narrative.history, { font, size }))
  }

  /* Procedure details -------------------------------------------------- */
  if (layout.showProcedureDetails && model.details.length) {
    children.push(sectionHeading('Procedure details', model))
    children.push(
      infoTable(
        model.details.filter((d) => d.value).map((d) => [d.label, d.value]),
        model,
        { bordered: true },
      ),
    )
  }

  /* Findings ----------------------------------------------------------- */
  children.push(sectionHeading('Findings', model))
  if (!model.narrative.findings.length) {
    children.push(p('No findings recorded.', { italics: true, color: '6B7280', font, size }))
  }
  for (const block of model.narrative.findings) {
    children.push(p(block.heading, { bold: true, size, font, spacing: { before: 120, after: 40 }, color: '111827' }))
    children.push(p(block.text, { size, font, align: AlignmentType.JUSTIFIED }))
  }
  if (model.narrative.additionalFindings) {
    children.push(p('Additional notes', { bold: true, size, font, spacing: { before: 120, after: 40 } }))
    children.push(p(model.narrative.additionalFindings, { size, font, align: AlignmentType.JUSTIFIED }))
  }

  /* Impression --------------------------------------------------------- */
  if (layout.showImpression) {
    children.push(sectionHeading('Impression / Diagnosis', model))
    const lines = String(model.narrative.diagnosis || '').split('\n').filter((l) => l.trim())
    if (!lines.length) children.push(p('Normal study.', { font, size }))
    for (const line of lines) {
      children.push(
        p(line.trim(), { bold: true, size, font, spacing: { after: 60 }, color: '111827' }),
      )
    }
  }

  /* Recommendation ----------------------------------------------------- */
  if (layout.showRecommendation && String(model.narrative.recommendation || '').trim()) {
    children.push(sectionHeading('Recommendation / Plan', model))
    for (const line of String(model.narrative.recommendation).split('\n')) {
      const t = line.replace(/^•\s*/, '').trim()
      if (!t) continue
      children.push(p(`•  ${t}`, { size, font, spacing: { after: 60 }, align: AlignmentType.JUSTIFIED }))
    }
  }

  /* Images ------------------------------------------------------------- */
  if (layout.showImages && model.media.length) {
    const plan = model.imagePlan || null
    const byId = new Map(model.media.map((m) => [m.id, m]))
    const usable = plan
      ? plan.slots
          .map((s) => (s.media ? { ...(byId.get(s.media.id) || s.media), plateNo: s.no } : null))
          .filter(Boolean)
      : model.media.filter((m) => m.kind === 'image').map((m, i) => ({ ...m, plateNo: i + 1 }))

    if (usable.length) {
      children.push(sectionHeading('Endoscopic images', model))
      const cols = plan && plan.capacity ? plan.columns : Math.max(1, Math.min(4, Number(layout.imageColumns) || 3))
      // A4 with 720-twip margins leaves 10466 twips (~698 px at 96 dpi) of usable width.
      const mode = plan?.mode
      const picWidth = mode === 'grid4' ? 300 : mode === 'grid6' ? 200 : Math.max(140, Math.floor(698 / cols) - 16)
      const picHeight = plan && plan.mode === 'grid6' ? 200 : plan && plan.mode === 'grid4' ? 300 : 330
      const showCaption = layout.showImageCaptions !== false
      const cellWidth = Math.floor(100 / cols)

      for (let i = 0; i < usable.length; i += cols) {
        const slice = usable.slice(i, i + cols)
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: NO_BORDER,
              bottom: NO_BORDER,
              left: NO_BORDER,
              right: NO_BORDER,
              insideHorizontal: NO_BORDER,
              insideVertical: NO_BORDER,
            },
            rows: [
              new TableRow({
                children: slice.map(
                  (m) =>
                    new TableCell({
                      width: { size: cellWidth, type: WidthType.PERCENTAGE },
                      margins: { top: 60, bottom: 60, left: 60, right: 60 },
                      borders: NO_BORDER,
                      children: [
                        new Paragraph({
                          alignment: AlignmentType.CENTER,
                          spacing: { after: showCaption ? 20 : 80 },
                          children: m.__buffer
                            ? [makeImageRun(m.__buffer, picWidth, picHeight)]
                            : [
                                new TextRun({
                                  text: '[image file missing]',
                                  italics: true,
                                  size: size - 2,
                                  color: 'B91C1C',
                                  font,
                                }),
                              ],
                        }),
                        ...(showCaption
                          ? [
                              new Paragraph({
                                alignment: AlignmentType.CENTER,
                                children: [
                                  new TextRun({
                                    text: `${m.plateNo}. ${m.caption}`,
                                    size: size - 3,
                                    color: '4B5563',
                                    font,
                                  }),
                                ],
                              }),
                            ]
                          : []),
                      ],
                    }),
                ),
              }),
            ],
          }),
        )
      }
      if (model.media.some((m) => m.kind === 'video')) {
        children.push(
          p('Video recordings are stored with the patient record and are not embedded in this document.', {
            italics: true,
            size: size - 2,
            color: '6B7280',
            font,
            spacing: { before: 120 },
          }),
        )
      }
    }
  }

  /* Audit (optional) --------------------------------------------------- */
  if (layout.showAudit && model.audit?.items?.length) {
    children.push(sectionHeading('Documentation audit (internal)', model))
    children.push(
      p(`Completeness score: ${model.audit.score}% (${model.audit.scoreLabel})`, {
        size: size - 1,
        font,
        bold: true,
      }),
    )
    for (const item of model.audit.items) {
      children.push(
        p(`[${item.level.toUpperCase()}] ${item.message}`, {
          size: size - 2,
          font,
          color: item.level === 'error' ? 'B91C1C' : item.level === 'warning' ? 'B45309' : '4B5563',
          spacing: { after: 40 },
        }),
      )
    }
  }

  /* Signature ---------------------------------------------------------- */
  children.push(new Paragraph({ spacing: { before: 400 }, children: [] }))
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 55, type: WidthType.PERCENTAGE },
              borders: NO_BORDER,
              children: [
                p('____________________________', { font, size }),
                p(model.signature.name || ' ', { bold: true, font, size }),
                p(model.signature.designation || '', { font, size: size - 1, color: '4B5563' }),
                p(model.signature.regNo ? `Reg. No: ${model.signature.regNo}` : '', { font, size: size - 2, color: '6B7280' }),
              ],
            }),
            new TableCell({
              width: { size: 45, type: WidthType.PERCENTAGE },
              borders: NO_BORDER,
              children: [
                p('Date: ______________________', { font, size }),
                p('Signature: __________________', { font, size, spacing: { before: 240 } }),
              ],
            }),
          ],
        }),
      ],
    }),
  )

  if (model.disclaimer) {
    children.push(
      p(model.disclaimer, {
        italics: true,
        size: size - 2,
        color: '6B7280',
        font,
        spacing: { before: 260 },
        align: AlignmentType.JUSTIFIED,
      }),
    )
  }

  /* Header & footer ---------------------------------------------------- */
  const header = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            text: `${clinic.name || 'Endoscopy Centre'} — ${model.short} report`,
            size: size - 3,
            color: '9CA3AF',
            font,
          }),
        ],
      }),
    ],
  })

  const footerChildren = []
  if (layout.confidentialNote) {
    footerChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: layout.confidentialNote, size: size - 3, bold: true, color: '9CA3AF', font })],
      }),
    )
  }
  footerChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: `${model.reportNo}   •   Page `, size: size - 3, color: '9CA3AF', font }),
        new TextRun({ children: [PageNumber.CURRENT], size: size - 3, color: '9CA3AF', font }),
        new TextRun({ text: ' of ', size: size - 3, color: '9CA3AF', font }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], size: size - 3, color: '9CA3AF', font }),
      ],
    }),
  )

  return new Document({
    creator: clinic.name || 'EndoReport',
    title: `${model.title} — ${model.patientLine.name}`,
    description: `Report ${model.reportNo}`,
    styles: {
      default: {
        document: { run: { font, size } },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } },
        },
        headers: { default: header },
        footers: { default: new Footer({ children: footerChildren }) },
        children,
      },
    ],
  })
}

/** Loads every image file referenced by the model into memory. */

/* -------------------------------------------------------------------------- */
/* Hospital paper form                                                        */
/* -------------------------------------------------------------------------- */

const BLACK_BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' }
const BLACK_ALL = {
  top: BLACK_BORDER, bottom: BLACK_BORDER, left: BLACK_BORDER, right: BLACK_BORDER,
  insideHorizontal: BLACK_BORDER, insideVertical: BLACK_BORDER,
}

/** Twips (1/1440 inch) → the pixel units docx uses for image sizing. */
const mmToPx = (mm) => Math.round((mm / 25.4) * 96)

function hospitalImage(buf, widthMm, heightMm) {
  if (!buf) return null
  return makeImageRun(buf, mmToPx(widthMm), mmToPx(heightMm || (widthMm * 3) / 4))
}

/* The printed form uses 2.2 in x 2 in pictures. */
const PIC_W = 55.88
const PIC_H = 50.8
/* Four of them must reach the bottom border, so the side column is shorter. */
const SIDE_H = 39.5

function cell(text, opts = {}) {
  const { bold, italic, size = 17, width, borders = BLACK_BORDER, align, spacing } = opts
  return new TableCell({
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    borders,
    margins: { top: 40, bottom: 40, left: 70, right: 70 },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: align,
        spacing: spacing || { before: 0, after: 0 },
        children: [
          new TextRun({
            text: text === undefined || text === null ? '' : String(text),
            bold: !!bold,
            italics: !!italic,
            size,
            font: 'Arial',
          }),
        ],
      }),
    ],
  })
}

function figureParagraph(buf, caption, widthMm, heightMm) {
  const run = hospitalImage(buf, widthMm, heightMm)
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 0 },
      children: run
        ? [run]
        : [new TextRun({ text: 'No Preview Available', size: 14, color: '6B7280', font: 'Arial' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 20, after: 90 },
      children: [new TextRun({ text: caption || '(Image Title)', size: 13, font: 'Arial' })],
    }),
  ]
}

/**
 * Word version of the unit's paper form. Built from `model.hospital`, the same
 * object the printer and the on-screen preview use.
 */
function buildHospitalDocument(model) {
  const f = model && model.hospital
  if (!f) return buildDocument(model)

  const byId = new Map((model.media || []).map((m) => [m.id, m]))
  const bufFor = (m) => (m ? byId.get(m.id)?.__buffer || null : null)

  /* letterhead ---------------------------------------------------------- */
  let logoRun = null
  if (f.header.logo) {
    const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(f.header.logo)
    if (m) {
      const buf = Buffer.from(m[2], 'base64')
      logoRun = makeImageRun(buf, mmToPx(23), mmToPx(23))
    }
  }

  const letterhead = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    columnWidths: [1300, 9600],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 1300, type: WidthType.DXA },
            borders: NO_BORDER,
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: logoRun ? [logoRun] : [new TextRun({ text: '', size: 2 })],
              }),
            ],
          }),
          new TableCell({
            width: { size: 9600, type: WidthType.DXA },
            borders: NO_BORDER,
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 20 },
                children: [new TextRun({ text: f.header.name, bold: true, size: 33, font: 'Arial' })],
              }),
              f.header.address
                ? new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 20 },
                    children: [new TextRun({ text: f.header.address, bold: true, size: 20, font: 'Arial' })],
                  })
                : null,
              f.header.phones
                ? new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 0 },
                    children: [new TextRun({ text: f.header.phones, size: 15, font: 'Arial' })],
                  })
                : null,
            ].filter(Boolean),
          }),
        ],
      }),
    ],
  })

  /* patient grid -------------------------------------------------------- */
  const gridRows = f.rows.map(
    ([left, right]) =>
      new TableRow({
        children: [
          cell(left.label, { bold: true, width: 1850 }),
          cell(left.value, { bold: true, width: 3750 }),
          cell(right.label, { bold: true, width: 1600 }),
          cell(right.value, { width: 3900 }),
        ],
      }),
  )

  const patientGrid = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [1850, 3750, 1600, 3900],
    borders: BLACK_ALL,
    rows: gridRows,
  })

  /* title band ---------------------------------------------------------- */
  const band = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 90, after: 90 },
    border: {
      top: { style: BorderStyle.SINGLE, size: 8, color: '000000', space: 3 },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: '000000', space: 3 },
    },
    children: [
      new TextRun({ text: f.title, bold: true, size: 25, characterSpacing: 80, font: 'Arial' }),
    ],
  })

  /* pictures ------------------------------------------------------------ */
  const topRow = new TableRow({
    children: [0, 1, 2].map((i) => {
      const m = f.top[i]
      return new TableCell({
        width: { size: 2500, type: WidthType.DXA },
        borders: NO_BORDER,
        margins: { top: 0, bottom: 40, left: 40, right: 40 },
        children: m ? figureParagraph(bufFor(m), m.caption, PIC_W, PIC_H) : figureParagraph(null, '', PIC_W, PIC_H),
      })
    }),
  })
  const topTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [2500, 2500, 2500],
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: [topRow],
  })

  const sideCellChildren = []
  for (let i = 0; i < 4; i += 1) {
    const m = f.side[i]
    sideCellChildren.push(...figureParagraph(bufFor(m), m ? m.caption : '', PIC_W, SIDE_H))
  }

  /* text column --------------------------------------------------------- */
  const line = (label, value) =>
    new Paragraph({
      spacing: { before: 90, after: 20 },
      children: [
        new TextRun({ text: `${label} `, bold: true, size: 18, font: 'Arial' }),
        new TextRun({ text: value || '', size: 18, font: 'Arial' }),
      ],
    })

  const findingsChildren = [
    new Paragraph({
      spacing: { before: 120, after: 40 },
      children: [new TextRun({ text: 'FINDINGS :', bold: true, size: 19, font: 'Arial' })],
    }),
    ...f.findings.map(
      (b) =>
        new Paragraph({
          spacing: { before: 0, after: 50 },
          children: [
            new TextRun({ text: `${b.heading}:-`, bold: true, italics: true, size: 18, font: 'Arial' }),
            new TextRun({ text: `  ${b.text}`, size: 18, font: 'Arial' }),
          ],
        }),
    ),
  ]

  const commentChildren = f.comments.length
    ? [
        new Paragraph({
          spacing: { before: 140, after: 20 },
          children: [
            new TextRun({ text: 'COMMENTS : ', bold: true, size: 18, font: 'Arial' }),
            new TextRun({ text: f.comments[0] || '', size: 18, font: 'Arial' }),
          ],
        }),
        ...f.comments.slice(1).map(
          (c) =>
            new Paragraph({
              spacing: { before: 0, after: 0 },
              indent: { left: 1450 },
              children: [new TextRun({ text: c, size: 18, font: 'Arial' })],
            }),
        ),
      ]
    : []

  const body = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [7700, 3120],
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 7700, type: WidthType.DXA },
            borders: NO_BORDER,
            margins: { top: 0, bottom: 0, left: 0, right: 140 },
            children: [
              topTable,
              line('Procedure :', f.procedure),
              line('Indication :', f.indication),
              line('Medication :', f.medication),
              ...findingsChildren,
              ...commentChildren,
            ],
          }),
          new TableCell({
            width: { size: 3120, type: WidthType.DXA },
            borders: NO_BORDER,
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            children: sideCellChildren,
          }),
        ],
      }),
    ],
  })

  /* signature ----------------------------------------------------------- */
  const signature = [
    new Paragraph({ spacing: { before: 1750 }, children: [] }),
    f.signature.sealDataUrl
      ? new Paragraph({
          spacing: { before: 0, after: 20 },
          children: (() => {
            const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(f.signature.sealDataUrl)
            if (!m) return [new TextRun({ text: '' })]
            return [makeImageRun(Buffer.from(m[2], 'base64'), mmToPx(32), mmToPx(16))]
          })(),
        })
      : null,
    new Paragraph({
      spacing: { before: 0, after: 0 },
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: '000000', space: 2 } },
      children: [new TextRun({ text: f.signature.name || ' ', bold: true, italics: true, size: 21, font: 'Arial' })],
    }),
    f.signature.degrees
      ? new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: f.signature.degrees, size: 15, font: 'Arial' })] })
      : null,
    f.signature.designation
      ? new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: f.signature.designation, size: 15, font: 'Arial' })] })
      : null,
    f.signature.affiliation
      ? new Paragraph({ spacing: { before: 30, after: 0 }, children: [new TextRun({ text: f.signature.affiliation, bold: true, italics: true, size: 15, font: 'Arial' })] })
      : null,
  ]

  const signatureBody = [...signature].filter(Boolean)

  /* The whole sheet carries a border, as on the paper form. */
  const frame = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: BLACK_ALL,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: BLACK_ALL,
            margins: { top: 110, bottom: 110, left: 110, right: 110 },
            children: [letterhead, patientGrid, band, body, ...signatureBody],
          }),
        ],
      }),
    ],
  })

  const signatureTable = new Table({
    width: { size: 58, type: WidthType.PERCENTAGE },
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: NO_BORDER,
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            children: signatureBody,
          }),
        ],
      }),
    ],
  })


  return new Document({
    creator: f.header.name || 'EndoReport',
    title: `${f.title} — ${model.patientLine?.name || ''}`,
    description: `Report ${model.reportNo}`,
    styles: { default: { document: { run: { font: 'Arial', size: 18 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 340, bottom: 510, left: 397, right: 397 },
          },
        },
        children: [frame],
      },
    ],
  })
}

function attachImageBuffers(model) {
  const media = (model.media || []).map((m) => {
    if (m.kind !== 'image') return m
    try {
      if (m.filePath && fs.existsSync(m.filePath)) {
        return { ...m, __buffer: fs.readFileSync(m.filePath) }
      }
    } catch {
      /* fall through to the inline copy */
    }
    // A report model built for preview carries the picture inline.
    const inline = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(String(m.dataUrl || ''))
    if (inline) {
      try {
        return { ...m, __buffer: Buffer.from(inline[1], 'base64') }
      } catch {
        /* leave without buffer */
      }
    }
    return m
  })
  return { ...model, media }
}

async function buildDocxBuffer(model) {
  const withImages = attachImageBuffers(model)
  const style = model?.template?.layout?.style || 'standard'
  const doc = style === 'hospital' ? buildHospitalDocument(withImages) : buildDocument(withImages)
  return Packer.toBuffer(doc)
}

async function saveDocx(model, filePath) {
  const buf = await buildDocxBuffer(model)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, buf)
  return { filePath, bytes: buf.length }
}

module.exports = { buildDocxBuffer, saveDocx, imageSize, DOCX_VERSION }
