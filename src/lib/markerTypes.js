/**
 * markerTypes.js
 * ---------------------------------------------------------------------------
 * The vocabulary of image markers, plus the two bits of geometry the editor and
 * the compositor must agree on: where an automatic marker lands, and how it is
 * drawn into the pixels.
 *
 * IMPORTANT — what "automatic marking" means here
 * -----------------------------------------------
 * The software does not analyse the pixels and it does not diagnose. When the
 * endoscopist has already documented a polyp / ulcer / erythema in a section,
 * the marker for that finding is placed on the frame at a sensible position and
 * labelled, so the printed picture carries the same finding the text does. It
 * is a documentation aid, not a detection model. The doctor can always drag the
 * marker to the true location, or place one by hand.
 */

export const MARKER_TYPES = [
  { id: 'polyp', label: 'Polyp', short: 'Polyp', color: '#f59e0b' },
  { id: 'ulcer', label: 'Ulcer', short: 'Ulcer', color: '#ef4444' },
  { id: 'erosion', label: 'Erosion', short: 'Erosion', color: '#fb923c' },
  { id: 'erythema', label: 'Erythema / inflammation', short: 'Erythema', color: '#ec4899' },
  { id: 'bleeding', label: 'Bleeding', short: 'Bleeding', color: '#dc2626' },
  { id: 'varices', label: 'Varices', short: 'Varices', color: '#8b5cf6' },
  { id: 'mass', label: 'Mass / growth', short: 'Mass', color: '#7c3aed' },
  { id: 'other', label: 'Other', short: 'Other', color: '#0ea5e9' },
]

export const MARKER_BY_ID = Object.fromEntries(MARKER_TYPES.map((t) => [t.id, t]))

export function markerColor(type) {
  return MARKER_BY_ID[type]?.color || '#0ea5e9'
}

export function markerLabel(type) {
  return MARKER_BY_ID[type]?.short || 'Mark'
}

/**
 * Maps a finding from the report to a marker type by looking at its id, its
 * label and its tags. Deliberately generous: "antral_ulcer", "duodenal_ulcer"
 * and "gastric ulcer (Forrest IIa)" all come out as an ulcer.
 */
export function markerTypeForFinding(finding) {
  const hay = `${finding?.id || ''} ${finding?.label || ''} ${(finding?.tags || []).join(' ')}`.toLowerCase()
  if (/polyp|adenoma|lst/.test(hay)) return 'polyp'
  if (/varice|varix/.test(hay)) return 'varices'
  if (/ulcer/.test(hay)) return 'ulcer'
  if (/erosion/.test(hay)) return 'erosion'
  if (/bleed|blood|haemorrh|hemat/.test(hay)) return 'bleeding'
  if (/erythema|gastritis|oesophagitis|esophagitis|colitis|duodenitis|inflam/.test(hay)) return 'erythema'
  if (/mass|malignan|cancer|carcinoma|tumour|tumor|growth|neoplas/.test(hay)) return 'mass'
  return 'other'
}

/**
 * Where the n-th automatic marker goes. A gentle arc across the middle of the
 * frame — endoscopic lesions cluster there — with a jitter derived from the
 * finding id so that the same finding always lands in the same place and two
 * markers never sit exactly on top of each other.
 */
const SLOTS = [
  [0.5, 0.47],
  [0.64, 0.55],
  [0.36, 0.55],
  [0.56, 0.35],
  [0.43, 0.66],
  [0.7, 0.4],
  [0.3, 0.42],
  [0.72, 0.64],
  [0.28, 0.63],
  [0.5, 0.7],
]

function hash(text) {
  let h = 0
  for (let i = 0; i < String(text).length; i += 1) h = (h * 31 + String(text).charCodeAt(i)) % 1000
  return h
}

export function autoPosition(seed, index) {
  const slot = SLOTS[index % SLOTS.length]
  const h = hash(`${seed}:${index}`)
  const dx = ((h % 13) - 6) / 100
  const dy = ((Math.floor(h / 13) % 11) - 5) / 100
  return {
    x: Math.min(0.93, Math.max(0.07, slot[0] + dx)),
    y: Math.min(0.9, Math.max(0.1, slot[1] + dy)),
  }
}

/**
 * Draws the markers (and a one-line legend) into a canvas over the source
 * image. Used to produce the copy that goes into Word and onto paper, because
 * neither can render a live overlay.
 */
export function composeMarkedImage(image, markers, options = {}) {
  const maxWidth = options.maxWidth || 1800
  const naturalW = image.naturalWidth || image.width || 800
  const naturalH = image.naturalHeight || image.height || 600
  const scale = Math.min(1, maxWidth / naturalW)
  const w = Math.max(1, Math.round(naturalW * scale))
  const h = Math.max(1, Math.round(naturalH * scale))

  const list = (markers || []).filter((m) => Number.isFinite(m.x) && Number.isFinite(m.y))
  const legendH = list.length ? Math.round(Math.max(46, h * 0.075)) : 0

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h + legendH
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0, w, h)

  const r = Math.max(13, Math.round(w * 0.022))
  const fontSize = Math.max(13, Math.round(r * 1.05))

  list.forEach((m, index) => {
    const cx = m.x * w
    const cy = m.y * h
    const color = markerColor(m.type)

    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.globalAlpha = 0.88
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.lineWidth = Math.max(2, r * 0.16)
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()

    ctx.fillStyle = '#ffffff'
    ctx.font = `700 ${fontSize}px "Segoe UI", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(index + 1), cx, cy + 1)
  })

  if (legendH) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, h, w, legendH)
    ctx.strokeStyle = '#d8dee9'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, h + 0.5)
    ctx.lineTo(w, h + 0.5)
    ctx.stroke()

    const pad = Math.round(w * 0.012)
    let x = pad
    const y = h + legendH / 2
    const dot = Math.max(5, Math.round(r * 0.45))
    const fSize = Math.max(11, Math.round(w * 0.0135))
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.font = `600 ${fSize}px "Segoe UI", system-ui, sans-serif`

    list.forEach((m, index) => {
      const text = `${index + 1}  ${m.label || markerLabel(m.type)}`
      ctx.beginPath()
      ctx.arc(x + dot, y, dot, 0, Math.PI * 2)
      ctx.fillStyle = markerColor(m.type)
      ctx.fill()
      x += dot * 2 + Math.round(fSize * 0.5)
      ctx.fillStyle = '#0f172a'
      ctx.fillText(text, x, y)
      x += ctx.measureText(text).width + Math.round(fSize * 1.6)
    })
  }

  return canvas.toDataURL('image/png')
}
