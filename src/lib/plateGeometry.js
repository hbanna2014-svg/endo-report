/**
 * plateGeometry.js — sizes a picture plate so that whatever number of pictures
 * the report carries, they fill the page instead of clustering in one corner.
 *
 * The old plate used one fixed cell (55.88 × 50.8 mm) for every count, so six
 * pictures covered only the top third of an A4 sheet. The rule here is the one
 * a printer would apply: try every column count, keep the grid cells at the
 * picture's own aspect ratio, and pick the arrangement that covers the largest
 * share of the available area. Four pictures become a 2 × 2 block, six become
 * 2 × 3, eight become 2 × 4 — each scaled up to the edges of the page.
 *
 * Pure geometry, in millimetres, so the screen (96 dpi), the printed sheet and
 * the .docx file can all use the same numbers.
 */

export const A4 = { width: 210, height: 297 }

/**
 * @param {object} o
 * @param {number} o.count    pictures actually on the plate
 * @param {number} o.aspect   width / height of a picture (4/3, 0.755 for portrait)
 * @param {number} o.widthMm  usable width
 * @param {number} o.heightMm usable height
 * @param {number} [o.gapX]   horizontal gap in mm
 * @param {number} [o.gapY]   vertical gap in mm
 * @param {number} [o.maxCols]
 * @returns {{cols:number, rows:number, cellW:number, cellH:number, blockW:number, blockH:number, fill:number}}
 */
export function plateGeometry({
  count,
  aspect = 4 / 3,
  widthMm,
  heightMm,
  gapX = 6,
  gapY = 6,
  maxCols = 4,
}) {
  const n = Math.max(1, Math.round(Number(count) || 1))
  const a = Math.min(3, Math.max(0.4, Number(aspect) || 4 / 3))

  let best = null
  const limit = Math.min(maxCols, n)

  for (let cols = 1; cols <= limit; cols += 1) {
    const rows = Math.ceil(n / cols)

    // Width-first: the cell spans its column, then the height follows the
    // picture's aspect.
    let cellW = (widthMm - (cols - 1) * gapX) / cols
    let cellH = cellW / a

    // If that makes the block taller than the page, the height is the limit and
    // the cells are narrowed to keep the aspect.
    if (rows * cellH + (rows - 1) * gapY > heightMm) {
      cellH = (heightMm - (rows - 1) * gapY) / rows
      cellW = cellH * a
    }

    if (!(cellW > 4) || !(cellH > 4)) continue

    const fill = (n * cellW * cellH) / (widthMm * heightMm)
    // Tiny tie-break so a wider block wins when two arrangements cover the same
    // area; without it a four-column strip could beat a 2 × 2 square.
    const score = fill + (cols * cellW) / (widthMm * 1e4)

    if (!best || score > best.score) {
      best = {
        cols,
        rows,
        cellW,
        cellH,
        blockW: cols * cellW + (cols - 1) * gapX,
        blockH: rows * cellH + (rows - 1) * gapY,
        fill,
        score,
      }
    }
  }

  if (!best) {
    // Degenerate page box — fall back to a single column that at least fits.
    const cellW = Math.max(10, widthMm)
    const cellH = Math.max(10, Math.min(heightMm, cellW / a))
    return { cols: 1, rows: n, cellW, cellH, blockW: cellW, blockH: cellH * n, fill: 0 }
  }

  delete best.score
  return best
}

/**
 * The picture aspect to plan with.
 *
 * Every frame from one processor is the same shape, so the first picture that
 * reports a size is representative; 4:3 is the fallback for records captured
 * before the size was stored.
 */
export function dominantAspect(images, fallback = 4 / 3) {
  for (const m of images || []) {
    const w = Number(m?.width)
    const h = Number(m?.height)
    if (w > 0 && h > 0) return w / h
  }
  return fallback
}

/** Millimetres to the CSS pixels the A4 preview is drawn in (96 dpi). */
export const mmToPx = (mm) => (mm * 96) / 25.4
