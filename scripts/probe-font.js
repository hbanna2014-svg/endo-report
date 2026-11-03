/*
 * Test probe: opens a draft report, then drives the Font and Size dropdowns
 * exactly as a click would and reports what the editor HTML became.
 */
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const setInput = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  // Narrow the register to a draft, then open the first row.
  const search = document.querySelector('input[placeholder*="Search"]')
  if (search) {
    setInput(search, 'Typed Proc')
    await wait(600)
  }
  const open = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Open')
  if (!open) return 'no-open'
  open.click()
  await wait(1200)

  const tab = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Report page')
  if (tab) {
    tab.click()
    await wait(700)
  }

  const ed = document.querySelector('.rich-edit')
  if (!ed) return 'no-editor'

  // A freshly generated report can still be blank; type something so the font
  // command has text to act on.
  if (!ed.innerHTML.trim()) {
    ed.focus()
    document.execCommand('insertText', false, 'Sample findings text for the font test')
    await wait(400)
  }

  ed.focus()
  const range = document.createRange()
  range.selectNodeContents(ed)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  await wait(150)

  const setValue = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  const fire = (el, v) => {
    setValue.call(el, v)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  const font = document.querySelector('.fmt-font')
  const size = document.querySelector('.fmt-size')
  if (!font || !size) return 'no-select'

  fire(font, 'Georgia')
  await wait(300)
  const afterFont = ed.innerHTML

  ed.focus()
  sel.removeAllRanges()
  sel.addRange(range)
  fire(size, '6')
  await wait(300)
  const afterSize = ed.innerHTML

  // Isolate the two halves: does the engine apply the command at all, and did
  // React's change handler run?
  ed.focus()
  sel.removeAllRanges()
  sel.addRange(range)
  let directError = ''
  let direct = false
  try {
    direct = document.execCommand('fontName', false, 'Georgia')
  } catch (err) {
    directError = String(err && err.message)
  }
  const afterDirect = ed.innerHTML

  return {
    fontApplied: /georgia/i.test(afterFont),
    sizeApplied: /font-size/i.test(afterSize) || /<font[^>]+size/i.test(afterSize),
    directOk: direct,
    directApplied: /georgia/i.test(afterDirect),
    directError,
    sample: afterSize.slice(0, 120),
  }
})()
