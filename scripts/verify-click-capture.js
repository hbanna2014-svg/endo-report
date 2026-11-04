/*
 * verify-click-capture.js — drives the real UI to prove the two capture
 * triggers the clinic asked for:
 *
 *   1. clicking the live picture takes a still;
 *   2. the key the endoscope's own capture button sends takes a still
 *      (learned once through the "Learn" control, then remembered).
 *
 * Run together with the synthetic camera:
 *
 *   ENDOREPORT_EVAL="$(cat scripts/fake-camera.js)" \
 *   ENDOREPORT_CAPTURE_JS="$(cat scripts/verify-click-capture.js)" \
 *   ENDOREPORT_CAPTURE=/tmp/after-click.png \
 *   xvfb-run -a npx electron . --no-sandbox --disable-gpu
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const clickByText = (selector, re) => {
    const el = [...document.querySelectorAll(selector)].find((e) => re.test(e.textContent.trim()))
    if (el) el.click()
    return !!el
  }
  const countThumbs = () => document.querySelectorAll('.media-rail img, .media-rail .thumb, .captured-strip img').length
  const pressKey = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

  // 1. Open the first report in the archive.
  clickByText('.nav-item', /Patient Archive/)
  await sleep(700)
  const opened = clickByText('tbody tr button', /^Open$/)
  await sleep(1600)

  // 2. The console opens the card by itself; "Start live view" is only there
  //    when it did not.
  clickByText('button', /Start live view/)
  await sleep(2200)

  const stage = document.querySelector('.capture-stage')
  if (!stage) return JSON.stringify({ ok: false, reason: 'no capture stage', opened })

  const video = stage.querySelector('video')
  const live = !!video && !!video.srcObject && video.videoWidth > 0

  // 3. Click the picture itself.
  const before = countThumbs()
  const rect = stage.getBoundingClientRect()
  stage.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + Math.round(rect.width / 2),
      clientY: rect.top + Math.round(rect.height / 2),
    }),
  )
  await sleep(1900)
  const afterClick = countThumbs()
  const clickToast = /Image captured/i.test(document.body.innerText)

  // 4. The endoscope's button: teach F2 through Learn, then press it again.
  clickByText('button', /^Learn$/)
  await sleep(350)
  pressKey('F2')
  await sleep(500)
  const learnedKey = [...document.querySelectorAll('select')].map((s) => s.value).find((v) => v === 'F2') || null

  pressKey('F2')
  await sleep(1900)
  const afterKey = countThumbs()

  return JSON.stringify({
    ok: live && afterClick > before && afterKey > afterClick,
    opened,
    live,
    frameSize: video ? `${video.videoWidth}x${video.videoHeight}` : null,
    thumbs: { before, afterClick, afterKey },
    clickCaptured: afterClick > before && clickToast,
    learnedKey,
    keyCaptured: afterKey > afterClick,
    hintVisible: !!document.querySelector('.capture-hint'),
    scopeControl: /Scope button/i.test(document.body.innerText),
  })
})()
