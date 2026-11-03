/*
 * Test probe: enables "Both", renames the second test to SIGMOIDOSCOPY, saves,
 * then reports what was actually created.
 */
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  const type = (el, v) => {
    el.focus()
    setValue.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  await wait(900)

  const both = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Both')
  if (!both) return 'no-both'
  both.focus()
  both.click()
  await wait(400)

  const inputAfter = (label) => {
    const lab = [...document.querySelectorAll('.np-label')].find((x) => x.textContent.trim() === label)
    return lab?.nextElementSibling?.querySelector('input') || null
  }

  const nameInput = document.querySelector('.np-wrap .ac input')
  type(nameInput, 'Both Names Test')
  await wait(200)

  const second = inputAfter('Test 2')
  if (!second) return 'no-test2'
  type(second, 'SIGMOIDOSCOPY')
  await wait(300)

  const add = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Add both reports'))
  if (!add) return 'no-add'
  add.focus()
  add.click()
  await wait(3000)

  const list = await window.endoreport.patients.list('Both Names', 5)
  if (!list.length) return 'no-patient'
  const procs = await window.endoreport.procedures.list({ patientId: list[0].id, limit: 10 })
  const out = []
  for (const p of procs) {
    const full = await window.endoreport.procedures.get(p.id)
    out.push(`${full.testName}:${full.procedureLabel || '(none)'}`)
  }
  return out
})()
