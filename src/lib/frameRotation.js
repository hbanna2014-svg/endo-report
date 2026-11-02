/**
 * frameRotation.js
 * ---------------------------------------------------------------------------
 * Everything about turning a capture card's frame the right way up.
 *
 * A video processor can hand over its picture in a portrait buffer (for
 * example 1080 × 1430) even though the endoscopist is looking at a landscape
 * monitor — the image then appears sideways. Two things fix that:
 *
 *   • `effectiveRotation()` decides the angle: "auto" watches the frame shape,
 *     a fixed value is obeyed as-is.
 *   • `rotateCanvas()` bakes the same angle into the saved PNG, so the printed
 *     picture matches what was on screen at the moment of capture.
 *
 * The rotation is applied once, at capture time, and never again — the stored
 * file is already upright, so thumbnails, the Word export and the print plate
 * all agree without knowing anything about capture hardware.
 */

export const ROTATION_OPTIONS = [
  { value: 'auto', label: 'Auto (detect)' },
  { value: '0', label: '0° — normal' },
  { value: '90', label: '90° — sideways' },
  { value: '180', label: '180° — upside down' },
  { value: '270', label: "270° — other side" },
]

export const ROTATION_ANGLES = [0, 90, 180, 270]

/** Normalises any input to one of 0 / 90 / 180 / 270. */
export function normaliseAngle(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  const snapped = Math.round(n / 90) * 90
  return ((snapped % 360) + 360) % 360
}

/**
 * "auto" means: if the card hands over a portrait buffer, the picture is almost
 * certainly a landscape image that arrived rotated — so turn it a quarter turn.
 * A small tolerance stops a 1080 × 1090 quirk from being treated as portrait.
 */
export function effectiveRotation(frameSize, setting = 'auto') {
  if (setting === 'auto' || setting === undefined || setting === null) {
    const w = Number(frameSize?.width) || 0
    const h = Number(frameSize?.height) || 0
    if (!w || !h) return 0
    return h > w * 1.05 ? 90 : 0
  }
  return normaliseAngle(setting)
}

/** Width and height after a quarter-turn swap. */
export function rotatedSize(width, height, rotation) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  const r = normaliseAngle(rotation)
  return r % 180 === 0 ? { width: w, height: h } : { width: h, height: w }
}

/**
 * Largest box with the given content aspect that fits inside `box`, so the
 * whole frame is visible and never cropped.
 */
export function fitWithin(box, contentWidth, contentHeight) {
  const bw = Number(box?.width) || 0
  const bh = Number(box?.height) || 0
  const cw = Number(contentWidth) || 0
  const ch = Number(contentHeight) || 0
  if (bw <= 0 || bh <= 0 || cw <= 0 || ch <= 0) return { width: 0, height: 0 }
  const scale = Math.min(bw / cw, bh / ch)
  return {
    width: Math.max(1, Math.floor(cw * scale)),
    height: Math.max(1, Math.floor(ch * scale)),
  }
}

/**
 * Returns a new canvas with the picture turned by `rotation`. Returns the input
 * untouched at 0°, so a normal capture costs nothing extra.
 */
export function rotateCanvas(source, rotation) {
  const r = normaliseAngle(rotation)
  if (!r) return source
  const { width, height } = rotatedSize(source.width, source.height, r)
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const ctx = out.getContext('2d', { alpha: false })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(width / 2, height / 2)
  ctx.rotate((r * Math.PI) / 180)
  ctx.drawImage(source, -source.width / 2, -source.height / 2)
  return out
}

/** Human-readable note for the live badge, e.g. " · 90°". */
export function rotationBadge(rotation) {
  const r = normaliseAngle(rotation)
  return r ? ` · ${r}°` : ''
}
