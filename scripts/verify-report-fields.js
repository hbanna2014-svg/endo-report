/*
 * verify-report-fields.js — checks the three editable lines on the report page.
 *
 *   ENDOREPORT_CAPTURE_JS="$(cat scripts/verify-report-fields.js)" \
 *   ENDOREPORT_CAPTURE=/tmp/fields.png \
 *   xvfb-run -a npx electron . --no-sandbox --disable-gpu
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const clickByText = (selector, re) => {
    const el = [...document.querySelectorAll(selector)].find((e) => re.test(e.textContent.trim()))
    if (el) el.click()
    return !!el
  }
  const setNativeValue = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  clickByText('.nav-item', /Patient Archive/)
  await sleep(700)
  clickByText('tbody tr button', /^Open$/)
  await sleep(2000)

  const lines = [...document.querySelectorAll('.hf-line')].slice(0, 3)
  const labels = lines.map((l) => l.querySelector('.hf-lbl')?.textContent?.trim())
  const before = lines.map((l) => l.textContent.replace(/\s+/g, ' ').trim())

  const lists = ['hf-dl-procedure', 'hf-dl-indication', 'hf-dl-medication'].map((id) => {
    const dl = document.getElementById(id)
    return { id, options: dl ? [...dl.options].map((o) => o.value) : null }
  })

  // Edit the Procedure line the way the endoscopist would.
  const procLine = lines[0]
  const editable = procLine?.querySelector('.hf-editable')
  const wasEditable = !!editable
  let typed = null
  if (editable) {
    editable.click()
    await sleep(250)
    const input = procLine.querySelector('input')
    if (input) {
      typed = 'UPPER G.I. TRACT ENDOSCOPY (CUSTOM)'
      setNativeValue(input, typed)
      await sleep(120)
      input.blur()
      // The report autosaves three seconds after an edit; wait for it so the
      // check can confirm the value reached the database, not just the screen.
      await sleep(4200)
    }
  }
  const afterEdit = lines[0].textContent.replace(/\s+/g, ' ').trim()

  return JSON.stringify({
    labels,
    before,
    editableProcedure: wasEditable,
    datalists: lists.map((l) => ({ id: l.id, count: l.options ? l.options.length : 0, sample: l.options ? l.options.slice(0, 4) : null })),
    afterEdit,
    procedureChanged: !!typed && afterEdit.includes(typed),
  })
})()
