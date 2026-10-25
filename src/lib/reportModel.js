/**
 * reportModel.js
 * ---------------------------------------------------------------------------
 * Single source of truth for the finished report.
 *
 * The on-screen preview, the printed page and the exported .docx file are all
 * rendered from this one model, so the three outputs can never drift apart.
 */

import { analyse, interpolate } from './autoReport.js'
import { BBPS_SEGMENTS, PROCEDURE_TYPES } from './anatomy.js'

/* -------------------------------------------------------------------------- */
/* Default template — editable from Settings ▸ Report template                 */
/* -------------------------------------------------------------------------- */

export const DEFAULT_TEMPLATE = {
  id: 'standard',
  name: 'Standard Endoscopy Report',
  isDefault: true,
  clinic: {
    name: 'Endoscopy & Colonoscopy Centre',
    address: 'Department of Gastroenterology',
    phone: '',
    email: '',
    logoDataUrl: '',
    doctorName: '',
    doctorDegrees: '',
    doctorDesignation: 'Consultant Gastroenterologist',
    doctorRegNo: '',
  },
  layout: {
    /** 'standard' = narrative report · 'hospital' = the unit's own paper form */
    style: 'standard',
    showLogo: true,
    showImages: true,
    /** 'flow' = as many images as captured · 'grid4' = fixed 2x2 · 'grid6' = fixed 2x3 */
    imageLayout: 'grid4',
    imageColumns: 3,
    showImageCaptions: true,
    /** print a separate 6-picture sheet after the report page */
    extraImageSheet: false,
    showImpression: true,
    showRecommendation: true,
    showAudit: false,
    showProcedureDetails: true,
    showPatientBlock: true,
    fontFamily: 'Arial',
    fontSize: 11,
    accentColor: '#1d4ed8',
    footerText: 'This report is generated from a structured endoscopy record and must be reviewed and signed by the endoscopist.',
    signatureLabel: 'Endoscopist signature',
    confidentialNote: 'CONFIDENTIAL MEDICAL RECORD',
  },
}

/**
 * Fixed picture plates the clinic can print: a 2x2 plate (four pictures) and a
 * 2x3 plate (six pictures). Both use two columns so the anatomy reads large on
 * an A4 sheet — this mirrors the paper forms most endoscopy units already use.
 */
export const IMAGE_LAYOUTS = [
  { id: 'form7', label: 'Seven pictures — three on top, four on the right', capacity: 7, columns: 3, top: 3, side: 4 },
  { id: 'grid4', label: 'Four pictures — full-height right column', capacity: 4, columns: 1, top: 0, side: 4 },
  { id: 'grid6', label: 'Six pictures — three on top, three on the right', capacity: 6, columns: 3, top: 3, side: 3 },
  { id: 'flow', label: 'All captured images (automatic)', capacity: 0, columns: 3, top: 0, side: 0 },
]

export function imageLayoutDef(id) {
  return IMAGE_LAYOUTS.find((l) => l.id === id) || IMAGE_LAYOUTS[0]
}

/**
 * Works out which pictures occupy the report plate.
 *
 * `procedure.reportImages` holds the operator's explicit choice (media ids, in
 * reading order). When it has never been touched the first N pictures are used,
 * so a plate is already populated the moment the images are captured.
 */
export function buildImagePlan(procedure, layout) {
  const all = (procedure?.media || []).filter((m) => m.kind === 'image')
  const def = imageLayoutDef(layout?.imageLayout)
  const cap = def.capacity

  if (!cap) {
    return {
      mode: 'flow',
      columns: Math.max(1, Math.min(4, Number(layout?.imageColumns) || 3)),
      capacity: 0,
      top: 0,
      side: 0,
      slots: all.map((m, i) => ({ no: i + 1, id: m.id, media: m })),
      filled: all.length,
      spare: 0,
      explicit: false,
    }
  }

  const explicit = Array.isArray(procedure?.reportImages)
  const picked = explicit ? procedure.reportImages : all.slice(0, cap).map((m) => m.id)
  const slots = []
  for (let i = 0; i < cap; i += 1) {
    const id = picked[i] || null
    const media = id ? all.find((m) => m.id === id) || null : null
    slots.push({ no: i + 1, id: media ? media.id : null, media })
  }
  return {
    mode: def.id,
    columns: def.columns,
    capacity: cap,
    top: def.top || 0,
    side: def.side || 0,
    slots,
    filled: slots.filter((s) => s.media).length,
    spare: slots.filter((s) => !s.media).length,
    explicit,
    unused: all.filter((m) => !slots.some((s) => s.id === m.id)).length,
  }
}


const escHtml = (t) =>
  String(t == null ? '' : t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

/**
 * The Findings block can be edited like a word processor on the report page
 * itself. `procedure.reportHtml` holds that edit; when it is absent the block is
 * generated from the ticked findings.
 */
/* -------------------------------------------------------------------------- */
/* Hospital paper form                                                        */
/* -------------------------------------------------------------------------- */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** "17 October, 2026" — the format used on the printed form. */
export function fmtLongDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}, ${d.getFullYear()}`
}

export function procedureLine(testName) {
  if (testName === 'colonoscopy') return 'COLONOSCOPY.'
  if (testName === 'both') return 'UPPER G.I. TRACT ENDOSCOPY & COLONOSCOPY.'
  return 'UPPER G.I. TRACT ENDOSCOPY.'
}

/** Section labels collapse to the organ name the printed form uses. */
function organOf(heading) {
  const base = String(heading || '').split(' — ')[0].trim()
  const map = {
    'Gastro-oesophageal junction': 'Oesophagus',
    'Stomach — Fundus': 'Stomach',
    'Duodenum — 1st part (bulb)': 'Duodenum',
    'Duodenum — 2nd part (D2)': 'Duodenum',
    'Anal canal / perianal': 'Anal canal',
  }
  return map[heading] || base
}

const ORGAN_ORDER = [
  'Oesophagus', 'Stomach', 'Duodenum',
  'Rectum', 'Sigmoid colon', 'Descending colon', 'Splenic flexure',
  'Transverse colon', 'Hepatic flexure', 'Ascending colon', 'Caecum',
  'Ileocaecal valve', 'Terminal ileum', 'Anal canal',
]

/**
 * Everything the paper form needs, in the order it appears on the page.
 * The HTML printer, the Word exporter and the on-screen preview all read this
 * one object, so the three outputs cannot drift apart.
 */
export function buildHospitalForm(model) {
  const template = model.template || {}
  const clinic = template.clinic || {}
  const patient = model.patient || {}
  const procedure = model.procedure || {}

  const identityNo = String(procedure.identityNo || patient.identityNo || '').trim()
  const visitId = String(procedure.visitId || patient.visitId || '').trim()
  const identity = [identityNo || patient.regNo || '', visitId].filter(Boolean).join('   ')

  const ageSex = [patient.age, patient.sex].filter(Boolean).join(' / ')
  const history = String(patient.history || procedure.history || '').trim()

  const rows = [
    [
      { label: 'Identity No.', value: identity },
      { label: 'Visit Date', value: fmtLongDate(procedure.procedureDate) },
    ],
    [
      { label: 'Patient Name', value: patient.name || '' },
      { label: 'Age / Sex', value: ageSex },
    ],
    [
      { label: 'History', value: history || 'N/A' },
      { label: 'Instrument', value: procedure.scopeModel || 'N/A' },
    ],
    [
      { label: 'Referrer', value: procedure.referredBy || patient.referredBy || '' },
      { label: 'Bed', value: procedure.bed || 'OPD' },
    ],
  ]

  // Findings: merge the per-section blocks into organ bullets, in form order.
  // A segment reported as normal is dropped when the same organ also has an
  // abnormality — otherwise the bullet reads "was normal … erythema was seen".
  const blocks = model.analysis?.blocks?.length
    ? model.analysis.blocks.map((b) => ({ heading: b.label, text: b.text, severity: b.severity }))
    : (model.narrative?.findings || []).map((b) => ({ ...b, severity: 'unknown' }))

  const merged = new Map()
  for (const block of blocks) {
    const organ = organOf(block.heading)
    const entry = merged.get(organ) || { texts: [], severities: [] }
    entry.texts.push({ text: block.text, severity: block.severity })
    entry.severities.push(block.severity)
    merged.set(organ, entry)
  }

  const findings = [...merged.entries()]
    .sort((a, b) => {
      const ia = ORGAN_ORDER.indexOf(a[0])
      const ib = ORGAN_ORDER.indexOf(b[0])
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
    .map(([heading, entry]) => {
      const abnormal = entry.severities.some((sv) => sv && sv !== 'normal' && sv !== 'unknown')
      const keep = abnormal ? entry.texts.filter((t) => t.severity !== 'normal') : entry.texts
      return { heading, text: keep.map((t) => t.text).join(' ').trim() }
    })
    .filter((row) => row.text)

  const biopsy = procedure.biopsy?.taken
    ? `Taken${procedure.biopsy.sites ? ` — ${procedure.biopsy.sites}` : ''}${procedure.biopsy.count ? ` (${procedure.biopsy.count} specimen(s))` : ''}.`
    : 'Not taken.'
  findings.push({ heading: 'Biopsy', text: biopsy })

  const comments = String(procedure.comments || '').trim() || String(model.narrative?.diagnosis || '').trim()
  const commentLines = comments
    .split('\n')
    .map((l) => l.replace(/^[•*-]\s*/, '').trim())
    .filter(Boolean)

  const doctorName =
    procedure.performingDoctor || patient.performingDoctor || clinic.doctorName || ''
  const degrees = procedure.performingDoctorDegrees || clinic.doctorDegrees || ''
  const designation = procedure.performingDoctorDesignation || clinic.doctorDesignation || ''
  const affiliation = procedure.performingDoctorAffiliation || clinic.name || ''

  const plan = model.imagePlan || { slots: [] }
  const top = plan.slots.filter((s) => s.no <= 3 && s.media).map((s) => ({ ...s.media, no: s.no }))
  const side = plan.slots.filter((s) => s.no > 3 && s.media).map((s) => ({ ...s.media, no: s.no }))

  return {
    header: {
      logo: clinic.logoDataUrl || '',
      name: clinic.name || '',
      address: clinic.address || '',
      phones: [clinic.phone, clinic.email].filter(Boolean).join(', '),
    },
    rows,
    title: 'ENDOSCOPIC PROCEDURE REPORT',
    procedure: procedureLine(procedure.testName),
    indication: String(procedure.indication || patient.indication || '').trim() || 'N/A',
    medication: String(procedure.medication || procedure.sedation || '').trim() || 'N/A',
    findings,
    comments: commentLines,
    top,
    side,
    extraImages: plan.slots.filter((s) => s.no > 7 && s.media).map((s) => ({ ...s.media, no: s.no })),
    signature: { name: doctorName, degrees, designation, affiliation },
    footer: {
      reportNo: model.reportNo,
      printedAt: model.generatedLine,
    },
  }
}

export function buildRichFindings(narrative, procedure) {
  const generated = (narrative.findings || [])
    .map((b) => `<p><strong>${escHtml(b.heading)}:-</strong> ${escHtml(b.text)}</p>`)
    .join('')
  const custom = String(procedure?.reportHtml || '').trim()
  const html = custom || generated
  return { html, text: htmlToText(html), custom: !!custom, generated }
}

/**
 * The report can be a Word file the doctor opened. Its text is kept as HTML and
 * patient tokens are filled in on the way out, so one uploaded form serves every
 * patient.
 */
export function buildReportDoc(procedure, patient, model) {
  const html = String(procedure?.docHtml || '')
  if (!html.trim()) return { html: '', custom: false, name: '' }
  const map = {
    PATIENT_NAME: patient?.name,
    AGE: patient?.age,
    SEX: patient?.sex,
    REG_NO: patient?.regNo,
    REFERRED_BY: procedure?.referredBy,
    PERFORMED_BY: procedure?.performingDoctor || patient?.performingDoctor,
    DATE: procedure?.procedureDate,
    PROCEDURE: model?.title,
    REPORT_NO: model?.reportNo,
    INDICATION: procedure?.indication,
    HISTORY: procedure?.history,
  }
  const out = html.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (whole, key) => {
    const v = map[key]
    return v === undefined || v === null || v === '' ? whole : escHtml(v)
  })
  return { html: out, custom: true, name: procedure?.docName || '' }
}

export function htmlToText(html) {
  return String(html || '')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function reportTitles(testName) {
  const t = PROCEDURE_TYPES.find((p) => p.id === testName)
  if (testName === 'colonoscopy') return { title: 'COLONOSCOPY REPORT', short: 'Colonoscopy' }
  if (testName === 'both') return { title: 'PANENDOSCOPY & COLONOSCOPY REPORT', short: 'Panendoscopy + Colonoscopy' }
  return { title: 'UPPER GI ENDOSCOPY (OGD) REPORT', short: t?.short || 'OGD' }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function ageSex(patient) {
  const bits = []
  if (patient.age) bits.push(`${patient.age} ${patient.ageUnit || 'years'}`)
  if (patient.sex) bits.push(patient.sex)
  return bits.join(' / ')
}

function fmtDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`
}

function fmtDateTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const pad = (n) => String(n).padStart(2, '0')
  let h = d.getHours()
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${fmtDate(value)} ${pad(h)}:${pad(d.getMinutes())} ${ap}`
}

export function makeReportNo(patient, procedure) {
  const raw = procedure?.procedureDate || procedure?.createdAt || new Date().toISOString()
  const d = new Date(raw)
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = Number.isNaN(d.getTime())
    ? '00000000'
    : `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const seq = String(procedure?.id || patient?.id || 0).replace(/\D/g, '').slice(-4).padStart(4, '0')
  return `ER-${stamp}-${seq}`
}

/* -------------------------------------------------------------------------- */
/* Model                                                                       */
/* -------------------------------------------------------------------------- */

export function buildReportModel(patient, procedure, templateInput, options = {}) {
  const template = {
    ...DEFAULT_TEMPLATE,
    ...(templateInput || {}),
    clinic: { ...DEFAULT_TEMPLATE.clinic, ...(templateInput?.clinic || {}) },
    layout: { ...DEFAULT_TEMPLATE.layout, ...(templateInput?.layout || {}) },
  }

  const analysis = analyse(procedure, { mediaCount: (procedure.media || []).length })
  const { title, short } = reportTitles(procedure.testName)

  const diagnosis =
    (procedure.impressionOverride || '').trim() ||
    analysis.impression.map((i) => i.text).join('\n')

  const recommendation =
    (procedure.recommendationOverride || '').trim() ||
    analysis.recommendations.map((r) => `• ${r}`).join('\n')

  const details = []
  if (template.layout.showProcedureDetails) {
    details.push({ label: 'Procedure', value: short })
    details.push({ label: 'Date of procedure', value: fmtDate(procedure.procedureDate) })
    details.push({ label: 'Endoscopist', value: procedure.performingDoctor || patient.performingDoctor || '' })
    details.push({ label: 'Assistant / attending', value: procedure.assistant || patient.assistant || '' })
    details.push({ label: 'Referred by', value: patient.referredBy || '' })
    details.push({ label: 'Scope used', value: procedure.scopeModel || '' })
    details.push({ label: 'Sedation / anaesthesia', value: procedure.sedation || '' })
    details.push({ label: 'Total procedure time', value: procedure.totalProcedureTime ? `${procedure.totalProcedureTime} min` : '' })

    if (procedure.testName !== 'ogd') {
      details.push({ label: 'Extent of examination', value: procedure.extentReached || '' })
      details.push({ label: 'Caecal intubation time', value: procedure.caecalIntubationTime ? `${procedure.caecalIntubationTime} min` : '' })
      details.push({ label: 'Withdrawal time', value: procedure.withdrawalTime ? `${procedure.withdrawalTime} min` : '' })
      details.push({ label: 'Bowel preparation', value: procedure.prepQuality || '' })
      const bbpsParts = BBPS_SEGMENTS.map((s) => {
        const v = procedure.bbps?.[s.id]
        return v === undefined || v === '' ? null : `${s.label.split(' ')[0]} ${v}`
      }).filter(Boolean)
      if (bbpsParts.length) {
        const total = BBPS_SEGMENTS.reduce((a, s) => a + Number(procedure.bbps?.[s.id] || 0), 0)
        details.push({ label: 'Boston Bowel Prep Scale', value: `${bbpsParts.join(' · ')} (total ${total}/9)` })
      }
      details.push({ label: 'Retroflexion performed', value: procedure.retroflexionPerformed || '' })
    }
    details.push({
      label: 'Biopsy / histology',
      value: procedure.biopsy?.taken
        ? `Yes${procedure.biopsy.count ? ` — ${procedure.biopsy.count} specimen(s)` : ''}${procedure.biopsy.sites ? ` from ${procedure.biopsy.sites}` : ''}`
        : 'No',
    })
    if (procedure.hpylori?.tested) {
      details.push({ label: 'H. pylori', value: `Tested — ${procedure.hpylori.method || 'method not stated'}${procedure.hpylori.result ? `: ${procedure.hpylori.result}` : ''}` })
    }
    details.push({ label: 'Complications', value: procedure.complications?.trim() || '' })
  }

  const narrative = {
    indication: (procedure.indication || patient.indication || '').trim(),
    history: (patient.history || '').trim(),
    findings: analysis.blocks.map((b) => ({ heading: b.label, text: b.text })),
    diagnosis,
    recommendation,
    additionalFindings: (procedure.additionalFindings || '').trim(),
  }

  const media = (procedure.media || []).map((m, idx) => ({
    ...m,
    index: idx + 1,
    caption: m.caption || '(no caption)',
  }))

  // A report may pin its own plate (4 / 6 pictures) without changing the
  // clinic's default layout for every other report.
  const layout = template.layout || {}
  const plateLayout = procedure.imageLayout ? { ...layout, imageLayout: procedure.imageLayout } : layout
  const imagePlan = buildImagePlan({ ...procedure, media }, plateLayout)

  const reportNo = makeReportNo(patient, procedure)

  const base = {
    template,
    title,
    short,
    reportNo,
    generatedAt: new Date().toISOString(),
    patient,
    procedure,
    patientLine: {
      name: patient.name || '',
      ageSex: ageSex(patient),
      regNo: patient.regNo || '',
      sex: patient.sex || '',
      age: patient.age || '',
      phone: patient.phone || '',
      address: patient.address || '',
      referredBy: patient.referredBy || '',
      performedBy: procedure.performingDoctor || patient.performingDoctor || '',
      procedureDate: fmtDate(procedure.procedureDate),
    },
    generatedLine: fmtDateTime(new Date().toISOString()),
    details,
    narrative,
    reportRich: buildRichFindings(narrative, procedure),
    reportDoc: buildReportDoc(procedure, patient, { title, reportNo }),
    analysis,
    media,
    imagePlan,
    audit: analysis.audit,
    signature: {
      name: procedure.performingDoctor || patient.performingDoctor || '',
      degrees: template.clinic.doctorDegrees,
      designation: procedure.performingDoctorDesignation || template.clinic.doctorDesignation,
      regNo: template.clinic.doctorRegNo,
    },
    disclaimer: template.layout.footerText,
    confidentialNote: template.layout.confidentialNote,
    options: { forPrint: !!options.forPrint },
  }

  // The paper-form variant is built from the finished model, so the printer,
  // the Word exporter and the preview all receive identical content.
  return { ...base, hospital: buildHospitalForm(base) }
}

/** Plain-text rendering used by the print window and clipboard copy. */
export function renderPlainText(model) {
  const L = []
  const t = model.template
  if (t.clinic.name) L.push(t.clinic.name.toUpperCase())
  if (t.clinic.address) L.push(t.clinic.address)
  L.push('')
  L.push(model.title)
  L.push(`Report no: ${model.reportNo}`)
  L.push('')
  L.push(`Patient        : ${model.patientLine.name}`)
  L.push(`Age / Sex      : ${model.patientLine.ageSex}`)
  if (model.patientLine.regNo) L.push(`Registration no: ${model.patientLine.regNo}`)
  if (model.patientLine.referredBy) L.push(`Referred by    : ${model.patientLine.referredBy}`)
  L.push(`Performed by   : ${model.patientLine.performedBy}`)
  L.push(`Date           : ${model.patientLine.procedureDate}`)
  L.push('')
  if (model.narrative.indication) {
    L.push('INDICATION')
    L.push(model.narrative.indication)
    L.push('')
  }
  L.push('FINDINGS')
  for (const b of model.narrative.findings) {
    L.push(`${b.heading}:`)
    L.push(b.text)
    L.push('')
  }
  L.push('IMPRESSION')
  L.push(model.narrative.diagnosis)
  L.push('')
  if (model.narrative.recommendation) {
    L.push('RECOMMENDATION')
    L.push(model.narrative.recommendation.replace(/^•\s*/gm, '- '))
  }
  return L.join('\n')
}

export { interpolate }
