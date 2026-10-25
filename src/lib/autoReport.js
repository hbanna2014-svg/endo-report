/**
 * autoReport.js
 * ---------------------------------------------------------------------------
 * The reporting engine.
 *
 * It turns a structured procedure (sections + ticked findings + values) into:
 *   1. body paragraphs   — the "Findings" narrative of the report
 *   2. impression lines  — the auto-generated "Impression / Diagnosis" block
 *   3. recommendations   — evidence-informed follow-up suggestions, de-duplicated
 *   4. problems          — the completeness / safety audit ("auto problem detection")
 *
 * Everything here is deterministic and runs fully offline. The optional AI
 * image analyser (lib/ai.js) feeds additional *suggested* findings back into
 * this same pipeline — it never writes directly into the final report.
 */

import { OGD_FINDINGS } from './findings-ogd.js'
import { COLON_FINDINGS } from './findings-colon.js'
import { sectionsForProcedure, BBPS_SEGMENTS } from './anatomy.js'

export const ALL_FINDINGS = { ...OGD_FINDINGS, ...COLON_FINDINGS }

export const SEVERITY_ORDER = {
  critical: 0,
  severe: 1,
  moderate: 2,
  mild: 3,
  normal: 4,
  unknown: 5,
}

export const SEVERITY_COLORS = {
  critical: '#dc2626',
  severe: '#ea580c',
  moderate: '#d97706',
  mild: '#0891b2',
  normal: '#16a34a',
  unknown: '#64748b',
}

const NOT_RECORDED = '[not recorded]'

/* -------------------------------------------------------------------------- */
/* Lookups                                                                     */
/* -------------------------------------------------------------------------- */

export function findingsForSection(sectionId) {
  return ALL_FINDINGS[sectionId] || []
}

export function findFindingDef(sectionId, findingId) {
  return findingsForSection(sectionId).find((f) => f.id === findingId) || null
}

export function emptyProcedure(testName = 'ogd') {
  return {
    testName,
    extentReached: '',
    scopeModel: '',
    sedation: '',
    prepQuality: '',
    bbps: {},
    caecalIntubationTime: '',
    withdrawalTime: '',
    totalProcedureTime: '',
    retroflexionPerformed: '',
    entries: [],
    sectionNotes: {},
    biopsy: { taken: false, sites: '', count: '' },
    hpylori: { tested: false, method: '', result: '' },
    complications: '',
    additionalFindings: '',
    impressionOverride: '',
    recommendationOverride: '',
    status: 'draft',
    media: [],
    /** Explicit picture-plate order (media ids). null = never touched, use first N. */
    reportImages: null,
    /** Per-report plate override: '' | 'grid4' | 'grid6' | 'flow'. */
    imageLayout: '',
  }
}

/* -------------------------------------------------------------------------- */
/* Interpolation                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Replaces {token} placeholders with the value the endoscopist entered.
 * Missing values render as a visible marker so the report can never silently
 * omit a clinically important detail.
 */
export function interpolate(template, values = {}, extra = {}) {
  if (!template) return ''
  return String(template).replace(/\{(\w+)\}/g, (_m, key) => {
    if (Object.prototype.hasOwnProperty.call(extra, key)) {
      const ev = extra[key]
      if (ev === undefined || ev === null || ev === '') return NOT_RECORDED
      return String(ev)
    }
    const v = values[key]
    if (v === undefined || v === null || v === '') return NOT_RECORDED
    return String(v)
  })
}

/* -------------------------------------------------------------------------- */
/* Flattening                                                                  */
/* -------------------------------------------------------------------------- */

/** Returns every ticked finding as a flat, fully-resolved record. */
export function flatten(procedure) {
  const sections = sectionsForProcedure(procedure.testName)
  const out = []
  for (const section of sections) {
    for (const entry of procedure.entries || []) {
      if (entry.sectionId !== section.id) continue
      const def = findFindingDef(section.id, entry.findingId)
      if (!def) continue
      out.push({
        uid: entry.uid,
        sectionId: section.id,
        sectionLabel: section.label,
        findingId: def.id,
        finding: def,
        values: entry.values || {},
        notes: entry.notes || '',
        severity: def.severity || 'unknown',
      })
    }
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* Body / impression / recommendation                                          */
/* -------------------------------------------------------------------------- */

/** Finds the "normal" and "not examined" entries in a section, if ticked. */
function sectionState(flat, sectionId) {
  const items = flat.filter((e) => e.sectionId === sectionId)
  return {
    items,
    hasNormal: items.some((e) => e.finding.isNormal),
    hasNegative: items.some((e) => e.finding.isNegative),
    hasAbnormal: items.some((e) => !e.finding.isNormal && !e.finding.isNegative),
  }
}

/** Builds the ordered Findings narrative, one block per documented section. */
export function buildBodyBlocks(procedure) {
  const sections = sectionsForProcedure(procedure.testName)
  const flat = flatten(procedure)
  const blocks = []

  for (const section of sections) {
    const { items, hasAbnormal } = sectionState(flat, section.id)
    const sectionNote = (procedure.sectionNotes || {})[section.id]?.trim()
    if (!items.length && !sectionNote) continue

    // "Normal X" ticked alongside an abnormality is contradictory. The audit
    // flags it; for the narrative we prefer the abnormal description.
    const usable = hasAbnormal ? items.filter((e) => !e.finding.isNormal) : items

    const sentences = usable.map((e) => {
      const text = interpolate(e.finding.phrase, e.values, { section: e.sectionLabel })
      const extras = []
      if (e.notes && e.notes.trim()) extras.push(e.notes.trim())
      const measured = measurementSuffix(e)
      return [text, measured, extras.join(' ')].filter(Boolean).join(' ')
    })

    blocks.push({
      sectionId: section.id,
      label: section.label,
      text: [sentences.join(' '), sectionNote].filter(Boolean).join(' '),
      severity: highestSeverity(usable),
      items: usable,
    })
  }
  return blocks
}

/** Appends a compact measurements sentence when a finding records numbers. */
function measurementSuffix(entry) {
  const f = entry.finding
  if (!f.fields) return ''
  const bits = []
  for (const field of f.fields) {
    if (field.type !== 'number') continue
    const v = entry.values?.[field.key]
    if (v === undefined || v === null || v === '') continue
    bits.push(`${field.label.replace(/\s*\(.*?\)\s*/g, ' ').trim()}: ${v}`)
  }
  if (!bits.length) return ''
  return `(Recorded measurements — ${bits.join('; ')}.)`
}

function highestSeverity(items) {
  if (!items.length) return 'unknown'
  return items
    .map((i) => i.severity)
    .sort((a, b) => (SEVERITY_ORDER[a] ?? 9) - (SEVERITY_ORDER[b] ?? 9))[0]
}

/** Auto-generated impression lines, most significant first. */
export function buildImpression(procedure) {
  const flat = flatten(procedure)
  const lines = []
  const seen = new Set()

  const abnormal = flat.filter((e) => !e.finding.isNormal && !e.finding.isNegative)
  const sorted = [...abnormal].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  )

  for (const e of sorted) {
    if (!e.finding.impression) continue
    const line = interpolate(e.finding.impression, e.values, { section: e.sectionLabel }).trim()
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    lines.push({ text: line, severity: e.severity, sectionId: e.sectionId })
  }

  if (!lines.length) {
    const normalBlurb =
      procedure.testName === 'colonoscopy'
        ? 'Normal colonoscopy — no abnormality detected.'
        : procedure.testName === 'both'
          ? 'Normal panendoscopy (upper GI endoscopy and colonoscopy) — no abnormality detected.'
          : 'Normal upper GI endoscopy — no abnormality detected.'
    lines.push({ text: normalBlurb, severity: 'normal', sectionId: null })
  }
  return lines
}

/** Recommendation lines gathered from every ticked finding, de-duplicated. */
export function buildRecommendations(procedure) {
  const flat = flatten(procedure)
  const out = []
  const seen = new Set()

  const ordered = [...flat].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  )

  for (const e of ordered) {
    for (const advice of e.finding.advice || []) {
      const key = advice.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(advice)
    }
  }

  for (const global of globalRecommendations(procedure, flat)) {
    const key = global.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(global)
  }

  return out
}

/* -------------------------------------------------------------------------- */
/* Polyp / surveillance logic                                                  */
/* -------------------------------------------------------------------------- */

export function summarisePolyps(flat) {
  const polypEntries = flat.filter((e) => (e.finding.tags || []).includes('polyp'))
  let total = 0
  let largest = 0
  let depressed = false
  let lst = false
  for (const e of polypEntries) {
    const n = Number(e.values?.number)
    total += Number.isFinite(n) && n > 0 ? n : 1
    const size = Number(e.values?.size)
    if (Number.isFinite(size)) largest = Math.max(largest, size)
    const morph = String(e.values?.morphology || '')
    if (morph.includes('depressed')) depressed = true
    if (morph.includes('laterally spreading')) lst = true
  }
  return { totalPolyps: total, largestMm: largest, depressed, lst, hasPolyps: polypEntries.length > 0 }
}

/**
 * Post-polypectomy surveillance interval, based on the widely used BSG / ESGE
 * style risk stratification. This is decision *support* only — the endoscopist
 * and the eventual histology report take precedence.
 */
export function surveillanceRecommendation(procedure, flat) {
  const p = summarisePolyps(flat)
  if (!p.hasPolyps) return null

  const highRisk = (p.totalPolyps >= 5) || (p.totalPolyps >= 2 && p.largestMm >= 10)
  const lines = []

  if (highRisk) {
    lines.push(
      `High-risk polyp profile (${p.totalPolyps} polyp(s), largest ${p.largestMm || '?'} mm) — surveillance colonoscopy in 3 years, pending histology.`,
    )
  } else if (p.largestMm >= 10) {
    lines.push(
      `Polyp ≥ 10 mm (largest ${p.largestMm} mm) — surveillance colonoscopy in 3 years, pending histology.`,
    )
  } else {
    lines.push(
      `Low-risk polyp profile (${p.totalPolyps} polyp(s), all < 10 mm) — no routine surveillance colonoscopy is usually required; return to the appropriate screening pathway, contingent on histology.`,
    )
  }

  if (p.depressed || p.lst) {
    lines.push(
      'Flat depressed or laterally spreading morphology — ensure the resection site is documented photographically and consider referral for ESD/EMR assessment of residual tissue.',
    )
  }
  lines.push('Surveillance interval must be confirmed once the histopathology report is available (adenoma vs sessile serrated vs hyperplastic).')
  return lines
}

function globalRecommendations(procedure, flat) {
  const out = []
  const tags = new Set(flat.flatMap((e) => e.finding.tags || []))
  const isColon = procedure.testName === 'colonoscopy' || procedure.testName === 'both'

  const surveillance = surveillanceRecommendation(procedure, flat)
  if (surveillance) out.push(...surveillance)

  if (tags.has('inflammatory') && !procedure.biopsy?.taken) {
    out.push('Consider mucosal biopsy to establish a histological diagnosis before starting long-term treatment.')
  }
  if (isColon && Number(procedure.withdrawalTime) > 0 && Number(procedure.withdrawalTime) < 6) {
    out.push('Withdrawal time was under 6 minutes — a slower, systematic withdrawal is recommended to reduce missed adenomas.')
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* Auto problem detection                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Returns an audit of the procedure. Each item is:
 *   { level: 'error' | 'warning' | 'info', code, message, sectionId? }
 *
 * 'error'   blocks finalisation of the report
 * 'warning' should be reviewed by the endoscopist
 * 'info'    optional documentation improvement
 */
export function detectProblems(procedure, extra = {}) {
  const problems = []
  const flat = flatten(procedure)
  const sections = sectionsForProcedure(procedure.testName)
  const isColon = procedure.testName === 'colonoscopy' || procedure.testName === 'both'
  const isOgd = procedure.testName === 'ogd' || procedure.testName === 'both'
  const push = (level, code, message, sectionId) => problems.push({ level, code, message, sectionId })

  /* 1. Required values missing on a ticked finding ------------------------- */
  for (const e of flat) {
    for (const field of e.finding.fields || []) {
      if (!field.required) continue
      const v = e.values?.[field.key]
      if (v === undefined || v === null || v === '') {
        const blocking = (e.finding.tags || []).includes('biopsy-required')
        push(
          blocking ? 'error' : 'warning',
          'required-field-missing',
          `"${e.finding.label}" in ${e.sectionLabel}: "${field.label}" has not been recorded.`,
          e.sectionId,
        )
      }
    }
  }

  /* 2. Contradictory entries inside one section ---------------------------- */
  for (const section of sections) {
    const st = sectionState(flat, section.id)
    if (st.hasNormal && st.hasAbnormal) {
      push(
        'warning',
        'normal-and-abnormal',
        `${section.label}: both "normal" and an abnormal finding are ticked. Remove the one that does not apply — the report will describe the abnormality.`,
        section.id,
      )
    }
    if (st.hasNegative && (st.hasAbnormal || st.hasNormal)) {
      push(
        'warning',
        'not-examined-conflict',
        `${section.label}: "not examined" is ticked together with another finding. These cannot both be true.`,
        section.id,
      )
    }
  }

  /* 3. Sections a complete report should document -------------------------- */
  for (const section of sections) {
    const st = sectionState(flat, section.id)
    const hasNote = (procedure.sectionNotes || {})[section.id]?.trim()
    if (section.expect && !st.items.length && !hasNote) {
      push(
        'info',
        'section-undocumented',
        `${section.label}: nothing documented. A complete report normally records this segment.`,
        section.id,
      )
    }
  }

  /* 4. Colonoscopy-specific ------------------------------------------------ */
  if (isColon) {
    if (!procedure.extentReached) {
      push('warning', 'extent-missing', 'The extent of examination (where the scope reached) has not been documented.')
    }
    const bbps = procedure.bbps || {}
    const scored = BBPS_SEGMENTS.filter((s) => bbps[s.id] !== undefined && bbps[s.id] !== '')
    if (scored.length < BBPS_SEGMENTS.length) {
      push('warning', 'bbps-incomplete', `Bowel preparation score is incomplete — ${scored.length}/${BBPS_SEGMENTS.length} segments scored (Boston Bowel Preparation Scale).`)
    } else {
      const total = BBPS_SEGMENTS.reduce((a, s) => a + Number(bbps[s.id] || 0), 0)
      const worst = Math.min(...BBPS_SEGMENTS.map((s) => Number(bbps[s.id] || 0)))
      if (total < 6 || worst < 2) {
        push('warning', 'bbps-poor', `Bowel preparation is inadequate (total BBPS ${total}/9, lowest segment ${worst}/3). Consider a repeat examination at an interval — inadequate preparation increases the miss rate.`)
      }
    }
    if (procedure.extentReached && procedure.extentReached !== 'Rectum only' && procedure.extentReached !== 'Sigmoid colon' && procedure.extentReached !== 'Descending colon' && procedure.extentReached !== 'Splenic flexure' && procedure.extentReached !== 'Transverse colon') {
      if (!procedure.withdrawalTime) {
        push('info', 'withdrawal-not-recorded', 'Withdrawal time was not recorded. Recording it supports quality assurance (target ≥ 6 minutes).')
      }
    }
    if (Number(procedure.withdrawalTime) > 0 && Number(procedure.withdrawalTime) < 6) {
      push('warning', 'withdrawal-short', `Withdrawal time was ${procedure.withdrawalTime} minutes. A withdrawal time of at least 6 minutes is associated with a significantly lower adenoma miss rate.`)
    }
    if (!procedure.prepQuality) {
      push('info', 'prep-quality-missing', 'Overall bowel preparation quality has not been recorded.')
    }
    if (procedure.extentReached && procedure.extentReached !== 'Caecum' && procedure.extentReached !== 'Caecum + terminal ileum') {
      const caecumDoc = flat.some((e) => e.sectionId === 'caecum' && (e.finding.isNormal || e.findingId === 'caecal_polyp'))
      if (caecumDoc) {
        push('warning', 'caecum-contradiction', `Caecal findings are documented but the extent reached is recorded as "${procedure.extentReached}". Correct one of these.`)
      }
      const tiDoc = flat.some((e) => e.sectionId === 'ti' && e.findingId === 'normal_ti')
      if (tiDoc) {
        push('error', 'ti-without-intubation', 'The terminal ileum is documented as normal but the recorded extent reached does not include the terminal ileum.')
      }
    }
    const tiNormal = flat.some((e) => e.findingId === 'normal_ti')
    const tiNotDone = flat.some((e) => e.findingId === 'ti_not_intubated')
    if (procedure.extentReached === 'Caecum + terminal ileum' && tiNotDone) {
      push('error', 'ti-contradiction', 'Extent reached is recorded as "Caecum + terminal ileum" but the terminal ileum is also recorded as "not intubated".')
    }
    if (tiNormal && tiNotDone) {
      push('error', 'ti-both-normal-and-not-done', 'The terminal ileum cannot be both normal and not intubated.')
    }
    if (procedure.extentReached === 'Caecum + terminal ileum' && !tiNormal && !tiNotDone) {
      push('warning', 'ti-not-documented', 'The terminal ileum was reached but no finding has been recorded for it.')
    }
  }

  /* 5. OGD-specific -------------------------------------------------------- */
  if (isOgd) {
    const d2Reached = flat.some((e) => e.sectionId === 'd2')
    const stoppedEarly = flat.some((e) => e.findingId === 'oesophageal_stricture' || e.findingId === 'oesophageal_mass' || e.findingId === 'food_residue' || e.findingId === 'fundal_mass')
    if (!d2Reached && !stoppedEarly) {
      push('info', 'd2-not-documented', 'The second part of the duodenum (D2) has not been documented. Standard complete OGD reports the extent of examination.')
    }
    const gastritisTags = flat.some((e) => (e.finding.tags || []).includes('inflammatory') && e.sectionId !== 'ti')
    if (gastritisTags && !procedure.hpylori?.tested && !procedure.biopsy?.taken) {
      push('info', 'hpylori-undocumented', 'Inflammatory gastric findings are recorded but H. pylori status has not been documented. Record a rapid urease test, histology, stool antigen or urea breath test.')
    }
    if (flat.some((e) => e.findingId === 'oesophageal_candidiasis')) {
      push('info', 'candida-risk', 'Oesophageal candidiasis documented — record whether diabetes and immunosuppression (including HIV) have been screened for.')
    }
    if (flat.some((e) => e.findingId === 'oesophageal_varices' || e.findingId === 'gastric_varices')) {
      push('info', 'varices-followup', 'Varices documented — record portal hypertension aetiology, platelet count, LFT and ultrasound findings so band ligation can be arranged.')
    }
  }

  /* 6. Safety / medico-legal ---------------------------------------------- */
  const malignancy = flat.filter((e) => (e.finding.tags || []).includes('malignancy'))
  for (const m of malignancy) {
    if (!procedure.biopsy?.taken) {
      push('error', 'malignancy-no-biopsy', `"${m.finding.label}" (${m.sectionLabel}) is documented but no biopsy has been recorded. Histological confirmation is required.`)
    }
  }
  const biopsyRequired = flat.filter((e) => (e.finding.tags || []).includes('biopsy-required'))
  if (biopsyRequired.length && !procedure.biopsy?.taken) {
    push('warning', 'biopsy-advised', `${biopsyRequired.length} finding(s) typically require histological confirmation (e.g. Barrett, colitis) but no biopsy has been recorded.`)
  }
  if (procedure.biopsy?.taken && (!procedure.biopsy.sites || !String(procedure.biopsy.sites).trim())) {
    push('warning', 'biopsy-sites-missing', 'Biopsy is recorded as taken but the biopsy sites have not been documented.')
  }
  const activeBleeding = flat.some((e) => /active bleeding|spontaneous bleeding|bleeding on contact|pus extruding/i.test(String(e.values?.stigmata || '') + ' ' + String(e.values?.severity || '')))
  if (activeBleeding) {
    push('error', 'active-bleeding', 'Active or spontaneous bleeding is documented. Record whether haemostasis was achieved and what method was used before finalising the report.')
  }
  if (!String(procedure.complications || '').trim()) {
    push('info', 'complications-blank', 'The complications field is blank. Record "none" explicitly — an empty field is not the same as "no complication".')
  }
  if (!procedure.sedation) {
    push('info', 'sedation-missing', 'Sedation / anaesthesia details have not been recorded.')
  }
  if (extra.mediaCount === 0) {
    push('info', 'no-images', 'No images have been captured for this procedure.')
  }
  if (flat.some((e) => (e.finding.tags || []).includes('polyp'))) {
    const p = summarisePolyps(flat)
    if (!p.largestMm) {
      push('error', 'polyp-size-missing', 'Polyps are recorded but no size has been entered. Polyp size determines the surveillance interval and is part of the minimum reporting dataset.')
    }
  }
  if (!String(procedure.additionalFindings || '').trim() && flat.some((e) => e.finding.isNegative)) {
    push('info', 'partial-exam-note', 'Part of the examination was incomplete. Consider recording the reason and whether a repeat examination is planned.')
  }

  /* 7. Report level -------------------------------------------------------- */
  if (!flat.length) {
    push('warning', 'no-findings', 'No findings have been recorded at all. Tick the relevant findings before finalising.')
  }

  const errors = problems.filter((p) => p.level === 'error').length
  const warnings = problems.filter((p) => p.level === 'warning').length
  const infos = problems.filter((p) => p.level === 'info').length

  const scored = problemScore(procedure, problems, sections, flat)
  return { items: problems, errors, warnings, infos, score: scored.score, scoreLabel: scored.label }
}

function problemScore(procedure, problems, sections, flat) {
  const documented = new Set(flat.map((e) => e.sectionId)).size
  const expected = sections.filter((s) => s.expect).length || 1
  const coverage = Math.min(1, documented / expected)
  const penalty = problems.filter((p) => p.level === 'error').length * 8 + problems.filter((p) => p.level === 'warning').length * 3
  const raw = Math.round(coverage * 100 - penalty)
  const score = Math.max(0, Math.min(100, raw))
  const label = score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 55 ? 'Needs review' : 'Incomplete'
  return { score, label }
}

/* -------------------------------------------------------------------------- */
/* Master entry point                                                          */
/* -------------------------------------------------------------------------- */

export function analyse(procedure, extra = {}) {
  const flat = flatten(procedure)
  const blocks = buildBodyBlocks(procedure)
  const impression = buildImpression(procedure)
  const recommendations = buildRecommendations(procedure)
  const audit = detectProblems(procedure, extra)
  const polyps = summarisePolyps(flat)

  return {
    flat,
    blocks,
    impression,
    recommendations,
    audit,
    polyps,
    counts: {
      documented: new Set(flat.map((e) => e.sectionId)).size,
      expected: sectionsForProcedure(procedure.testName).filter((s) => s.expect).length,
      findings: flat.filter((e) => !e.finding.isNormal && !e.finding.isNegative).length,
    },
  }
}
