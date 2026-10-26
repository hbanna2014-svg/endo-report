/**
 * printImages.js — prepares captured frames for printing.
 *
 * A capture card stores lossless PNG at the sensor's own size. Seven of those
 * is 40–60 MB once base64-encoded, and Chromium refuses to print a document
 * that heavy — the job fails, or the picture plate comes out blank while the
 * text prints normally.
 *
 * Print output never needs more than ~300 dpi across a 2.5 inch frame, so each
 * picture is downscaled to a sane pixel width and re-encoded as JPEG. A seven
 * picture plate drops from ~55 MB to ~1.5 MB and still prints at full quality.
 * The stored original is never touched.
 */

export const PRINT_MAX_WIDTH = 1200
export const PRINT_JPEG_QUALITY = 0.88

/** Downscale a data URL for print. Falls back to the original on any failure. */
export function downscaleForPrint(dataUrl, maxWidth = PRINT_MAX_WIDTH) {
  return new Promise((resolve) => {
    if (!dataUrl) {
      resolve(dataUrl)
      return
    }
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, maxWidth / (img.naturalWidth || maxWidth))
        // Already small and light: leave it alone.
        if (scale >= 1 && dataUrl.length < 500_000) {
          resolve(dataUrl)
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
        const ctx = canvas.getContext('2d')
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', PRINT_JPEG_QUALITY))
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

/**
 * Attach print-ready data URLs to every image in `media`.
 * Returns the media list plus the ids that could not be read, so the caller can
 * warn the operator instead of silently printing empty frames.
 */
export async function hydratePrintImages(media, readFile) {
  const failed = []
  const out = await Promise.all(
    (media || []).map(async (m) => {
      if (m.kind !== 'image') return m
      try {
        const { dataUrl } = await readFile(m.filePath)
        return { ...m, dataUrl: await downscaleForPrint(dataUrl) }
      } catch {
        failed.push(m.id)
        return m
      }
    }),
  )
  return { media: out, failed }
}
