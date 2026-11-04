/*
 * verify-scope-capture.js — proves the endoscope's capture button path:
 * Learn a key, then press it again and check a still was taken.
 *
 *   ENDOREPORT_EVAL="$(cat scripts/fake-camera.js)" \
 *   ENDOREPORT_CAPTURE_JS="$(cat scripts/verify-scope-capture.js)" \
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

  clickByText('.nav-item', /Patient Archive/)
  await sleep(700)
  clickByText('tbody tr button', /^Open$/)
  await sleep(2000)
  clickByText('button', /Start live view/)
  await sleep(1800)

  const stage = document.querySelector('.capture-stage')
  const video = stage?.querySelector('video')
  const live = !!video && !!video.srcObject && video.videoWidth > 0

  // Learn F2 the way the clinic would: press Learn, press the scope button.
  const learnClicked = clickByText('button', /^Learn$/)
  await sleep(350)
  pressKey('F2')
  await sleep(600)
  const learned = [...document.querySelectorAll('select')].some((s) => s.value === 'F2')

  const before = countThumbs()
  pressKey('F2')
  await sleep(2000)
  const after = countThumbs()

  return JSON.stringify({
    ok: live && learnClicked && learned && after > before,
    live,
    learnClicked,
    learned,
    thumbsBefore: before,
    thumbsAfter: after,
    captured: /Image captured/i.test(document.body.innerText),
  })
})()
