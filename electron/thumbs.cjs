/**
 * thumbs.cjs — small cached previews for the picture rail and the picker.
 *
 * A 4K endoscopic frame is roughly 1900 x 1080 and several megabytes; loading
 * twenty of them as base64 data URLs just to paint a 90 px thumbnail is what
 * makes a gallery feel slow. Electron's nativeImage resizes the file in the
 * main process and the result is cached next to the media, so the report plate
 * can keep using the untouched full-resolution original.
 */

const fs = require('node:fs')
const path = require('node:path')
const { nativeImage } = require('electron')

const cache = new Map()
const MAX_CACHE = 400

function thumbPath(dataDir, id, filePath, width) {
  const stat = fs.statSync(filePath)
  const safe = String(id || path.basename(filePath)).replace(/[^\w.-]/g, '_')
  const dir = path.join(dataDir, 'cache', 'thumbs')
  fs.mkdirSync(dir, { recursive: true })
  // The width is part of the name: the rail, the picker and the report plate
  // each ask for a different size, and they must not share one file.
  return { dir, file: path.join(dir, `${safe}-w${width}-${stat.mtimeMs | 0}.jpg`) }
}

/**
 * @returns {{ dataUrl: string, width: number, height: number, source: {width:number,height:number} }}
 */
function makeThumb(dataDir, filePath, id, width = 320) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('The picture file could not be found.')

  const key = `${filePath}:${width}`
  const cached = cache.get(key)
  if (cached) return cached

  const { file } = thumbPath(dataDir, id, filePath, width)
  let buf
  let w = width
  let h = width

  if (fs.existsSync(file)) {
    buf = fs.readFileSync(file)
  } else {
    const image = nativeImage.createFromPath(filePath)
    if (image.isEmpty()) throw new Error('This file could not be read as a picture.')
    const size = image.getSize()
    const scale = Math.min(1, width / Math.max(1, size.width))
    const resized = scale < 1 ? image.resize({ width: Math.round(size.width * scale), quality: 'good' }) : image
    buf = resized.toJPEG(84)
    fs.writeFileSync(file, buf)
    w = resized.getSize().width
    h = resized.getSize().height
  }

  const result = {
    dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`,
    width: w,
    height: h,
    bytes: buf.length,
  }

  if (cache.size > MAX_CACHE) cache.clear()
  cache.set(key, result)
  return result
}

/** Intrinsic pixel size of the stored original — used for the sharpness badge. */
function sourceSize(filePath) {
  try {
    const image = nativeImage.createFromPath(filePath)
    if (image.isEmpty()) return null
    const { width, height } = image.getSize()
    return { width, height }
  } catch {
    return null
  }
}

module.exports = { makeThumb, sourceSize }
