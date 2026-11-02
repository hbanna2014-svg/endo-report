/*
 * A synthetic capture card for the automated UI check.
 *
 * Installed through ENDOREPORT_EVAL, it replaces getUserMedia with a canvas
 * stream in the same 1080 × 1430 portrait mode that real hardware reports, and
 * paints unambiguous markers so the screenshot proves two things at once:
 *   • the whole frame is visible (the blue TOP band and the green bottom band
 *     must both be on screen), and
 *   • the orientation is applied (a 90° turn moves the blue band to the right).
 */
(() => {
  if (window.__fakeCam) return 'already-installed'
  const W = 1080
  const H = 1430
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')

  ctx.fillStyle = '#0b1220'
  ctx.fillRect(0, 0, W, H)

  // Top band — carries the word TOP.
  ctx.fillStyle = '#2563eb'
  ctx.fillRect(0, 0, W, 220)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 130px sans-serif'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText('TOP', 70, 40)

  // Bottom band.
  ctx.fillStyle = '#16a34a'
  ctx.fillRect(0, H - 190, W, 190)

  // Red strip down the left edge.
  ctx.fillStyle = '#ef4444'
  ctx.fillRect(0, 0, 64, H)

  // Centre disc with the frame size, so the mode is readable in the picture.
  ctx.fillStyle = '#e2e8f0'
  ctx.beginPath()
  ctx.arc(W / 2, H / 2, 220, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#0b1220'
  ctx.font = 'bold 84px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('1080 × 1430', W / 2, H / 2)

  // A static canvas often yields a single frame; a moving dot keeps the stream
  // genuinely live so the <video> element paints.
  let tick = 0
  const paint = () => {
    tick += 1
    const x = 70 + ((tick * 9) % (W - 140))
    ctx.fillStyle = '#f59e0b'
    ctx.beginPath()
    ctx.arc(x, H - 95, 26, 0, Math.PI * 2)
    ctx.fill()
  }
  setInterval(() => {
    paint()
    // Repaint the bands the dot may have covered.
    if (tick % 40 === 0) {
      ctx.fillStyle = '#16a34a'
      ctx.fillRect(0, H - 190, W, 150)
    }
  }, 90)

  const stream = c.captureStream(12)
  window.__fakeCam = { stream, W, H }

  const md = navigator.mediaDevices
  if (md) {
    md.enumerateDevices = async () => [
      { deviceId: 'fake-hd', groupId: 'fake', kind: 'videoinput', label: 'Synthetic 1080 × 1430' },
    ]
    md.getUserMedia = async () => stream
  }

  return `patched ${W}x${H}`
})()
