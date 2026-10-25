/**
 * anatomy.js
 * ---------------------------------------------------------------------------
 * Anatomical section catalogue for Upper GI Endoscopy (OGD) and Colonoscopy.
 *
 * Every procedure report is built by walking these sections in order. When the
 * endoscopist selects a section and ticks findings inside it, the report text
 * is generated automatically (see lib/autoReport.js).
 *
 * `expect: true` marks a section that a complete report is normally expected to
 * document. Sections flagged `expect: true` take part in the completeness audit
 * that powers "auto problem detection".
 */

export const PROCEDURE_TYPES = [
  {
    id: 'ogd',
    label: 'Upper GI Endoscopy (OGD)',
    short: 'OGD',
    accent: '#2f7ef2',
  },
  {
    id: 'colonoscopy',
    label: 'Colonoscopy',
    short: 'Colonoscopy',
    accent: '#12a594',
  },
  {
    id: 'both',
    label: 'Panendoscopy + Colonoscopy (Both)',
    short: 'Both',
    accent: '#8b5cf6',
  },
]

/* -------------------------------------------------------------------------- */
/* Upper GI Endoscopy                                                          */
/* -------------------------------------------------------------------------- */

export const OGD_SECTIONS = [
  {
    id: 'oesophagus',
    label: 'Oesophagus',
    expect: true,
    hint: 'Mucosa, peristalsis, lumen, Z-line distance from incisors.',
  },
  {
    id: 'gej',
    label: 'Gastro-oesophageal junction',
    expect: true,
    hint: 'Z-line, squamocolumnar junction, hiatus hernia, retroflexion.',
  },
  {
    id: 'fundus',
    label: 'Stomach — Fundus',
    expect: true,
    hint: 'Mucosa, folds, retroflexed view of cardia.',
  },
  {
    id: 'body',
    label: 'Stomach — Body',
    expect: true,
    hint: 'Rugal folds, mucosal pattern, atrophy.',
  },
  {
    id: 'antrum',
    label: 'Stomach — Antrum',
    expect: true,
    hint: 'Peristalsis, mucosal erythema, erosions, ulcer.',
  },
  {
    id: 'pylorus',
    label: 'Pylorus',
    expect: true,
    hint: 'Patency, deformity, opening.',
  },
  {
    id: 'd1',
    label: 'Duodenum — 1st part (bulb)',
    expect: true,
    hint: 'Bulb mucosa, deformity, ulcer.',
  },
  {
    id: 'd2',
    label: 'Duodenum — 2nd part (D2)',
    expect: true,
    hint: 'Papilla, medial wall, D2 mucosa, extent of examination.',
  },
]

/* -------------------------------------------------------------------------- */
/* Colonoscopy                                                                 */
/* -------------------------------------------------------------------------- */

export const COLON_SECTIONS = [
  {
    id: 'rectum',
    label: 'Rectum',
    expect: true,
    hint: 'Retroflexion, mucosa, mass, haemorrhoids.',
  },
  {
    id: 'sigmoid',
    label: 'Sigmoid colon',
    expect: true,
    hint: 'Diverticula, mucosa, polyps, lumen.',
  },
  {
    id: 'descending',
    label: 'Descending colon',
    expect: true,
    hint: 'Mucosa, diverticula, polyps.',
  },
  {
    id: 'splenic',
    label: 'Splenic flexure',
    expect: false,
    hint: 'Mucosa, angulation, polyps.',
  },
  {
    id: 'transverse',
    label: 'Transverse colon',
    expect: true,
    hint: 'Mucosa, polyps, redundant loops.',
  },
  {
    id: 'hepatic',
    label: 'Hepatic flexure',
    expect: false,
    hint: 'Mucosa, angulation, polyps.',
  },
  {
    id: 'ascending',
    label: 'Ascending colon',
    expect: true,
    hint: 'Mucosa, polyps, diverticula.',
  },
  {
    id: 'caecum',
    label: 'Caecum',
    expect: true,
    hint: 'Appendiceal orifice, tri-radiate fold, pool of fluid.',
  },
  {
    id: 'icv',
    label: 'Ileocaecal valve',
    expect: false,
    hint: 'Appearance, competence, intubation.',
  },
  {
    id: 'ti',
    label: 'Terminal ileum',
    expect: false,
    hint: 'Only if intubated. Mucosa, lymphoid hyperplasia, ulcers.',
  },
  {
    id: 'anal',
    label: 'Anal canal / perianal',
    expect: true,
    hint: 'Haemorrhoids, fissure, skin tags, mass.',
  },
]

export const SECTIONS_BY_PROCEDURE = {
  ogd: OGD_SECTIONS,
  colonoscopy: COLON_SECTIONS,
}

/** Which section list a procedure type needs — "both" merges both sets. */
export function sectionsForProcedure(type) {
  if (type === 'ogd') return OGD_SECTIONS
  if (type === 'colonoscopy') return COLON_SECTIONS
  if (type === 'both') {
    return [
      ...OGD_SECTIONS.map((s) => ({ ...s, group: 'OGD' })),
      ...COLON_SECTIONS.map((s) => ({ ...s, group: 'Colonoscopy' })),
    ]
  }
  return OGD_SECTIONS
}

/** Extent-reached options for colonoscopy documentation. */
export const COLON_EXTENT = [
  'Rectum only',
  'Sigmoid colon',
  'Descending colon',
  'Splenic flexure',
  'Transverse colon',
  'Hepatic flexure',
  'Ascending colon',
  'Caecum',
  'Caecum + terminal ileum',
]

/** Boston Bowel Preparation Scale — per segment 0..3. */
export const BBPS_SCALE = [
  { value: 0, label: '0 — Unprepared, mucosa not seen' },
  { value: 1, label: '1 — Portion of mucosa seen, others not seen' },
  { value: 2, label: '2 — Minor residue, mucosa well seen' },
  { value: 3, label: '3 — Entire mucosa well seen' },
]

export const BBPS_SEGMENTS = [
  { id: 'right', label: 'Right colon (caecum / ascending)' },
  { id: 'transverse', label: 'Transverse colon' },
  { id: 'left', label: 'Left colon (descending / sigmoid / rectum)' },
]
