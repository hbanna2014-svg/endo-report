/**
 * verify-word-template.mjs — proves the clinic's own .docx can be used as the
 * report template.
 *
 * Builds a small Word file that looks like a letterhead with {{TOKENS}}, parses
 * it the way the upload button does, renders a report into it and checks that
 * the letterhead survived while the tokens were replaced.
 *
 *   node scripts/verify-word-template.mjs
 */

import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { buildReportModel, DEFAULT_TEMPLATE } from '../src/lib/reportModel.js'
import { emptyProcedure } from '../src/lib/autoReport.js'

const require = createRequire(import.meta.url)
const { Document, Packer, Paragraph, TextRun } = require('docx')
const JSZip = require('jszip')
const tpl = require('../electron/docxTemplate.cjs')

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'endo-word-'))

/* A stand-in for the clinic's own report, with its letterhead and tokens. */
const source = new Document({
  sections: [
    {
      children: [
        new Paragraph({ children: [new TextRun({ text: 'CITY ENDOSCOPY CENTRE', bold: true, size: 32 })] }),
        new Paragraph({ children: [new TextRun({ text: '12 Hospital Road, Dhaka — 01700 000000' })] }),
        new Paragraph(''),
        new Paragraph('Patient: {{PATIENT_NAME}}    Age/Sex: {{PATIENT_AGE_SEX}}'),
        new Paragraph('Registration: {{REG_NO}}    Date: {{PROCEDURE_DATE}}'),
        new Paragraph('Procedure: {{PROCEDURE}}'),
        new Paragraph('Referred by: {{REFERRED_BY}}'),
        new Paragraph(''),
        new Paragraph('FINDINGS'),
        new Paragraph('{{FINDINGS}}'),
        new Paragraph(''),
        new Paragraph('IMPRESSION'),
        new Paragraph('{{IMPRESSION}}'),
      ],
    },
  ],
})

const tplPath = path.join(tmp, 'clinic-report.docx')
fs.writeFileSync(tplPath, await Packer.toBuffer(source))

const parsed = await tpl.parseDocxFile(tplPath)
check('the uploaded .docx is parsed', parsed.bytes > 0 && !!parsed.base64, `${parsed.paragraphs} paragraph(s)`)
check(
  'tokens are detected in the file',
  ['PATIENT_NAME', 'PROCEDURE', 'FINDINGS', 'IMPRESSION'].every((t) => (parsed.tokens || []).includes(t)),
  `detected: ${(parsed.tokens || []).join(', ')}`,
)
check('no unknown tokens are reported', (parsed.unknownTokens || []).length === 0, (parsed.unknownTokens || []).join(', '))

/* A finished procedure to pour into it. */
const patient = {
  id: 'p1',
  name: 'Rahima Begum',
  age: '42',
  ageUnit: 'years',
  sex: 'Female',
  regNo: 'ER2026-0002',
  referredBy: 'Dr. S. Akter',
}
const procedure = {
  ...emptyProcedure('ogd'),
  procedureDate: '2026-10-26',
  performingDoctor: 'Dr. B. Hossain',
  entries: [
    { sectionId: 'antrum', findingId: 'antral_gastritis_erythematous', values: { severity: 'Mild' }, notes: '' },
    { sectionId: 'd2', findingId: 'normal_d2', values: {}, notes: '' },
  ],
}
const model = buildReportModel(patient, procedure, { ...DEFAULT_TEMPLATE, layout: { ...DEFAULT_TEMPLATE.layout, style: 'hospital' } })

const out = await tpl.renderDocxTemplate(parsed.base64, model)
const outPath = path.join(tmp, 'rendered.docx')
fs.writeFileSync(outPath, out)

const zip = await JSZip.loadAsync(out)
const xml = await zip.file('word/document.xml').async('string')
const text = xml.replace(/<[^>]+>/g, '')

check('the clinic letterhead is preserved', text.includes('CITY ENDOSCOPY CENTRE'))
check('the address line is preserved', text.includes('12 Hospital Road'))
check('the patient token is filled', text.includes('Rahima Begum'))
check('the age / sex token is filled', /42/.test(text) && /Female/i.test(text))
check('the findings token is filled', /antral gastritis/i.test(text))
check('no unfilled token is left behind', !/\{\{[A-Z_]+\}\}/.test(text), (text.match(/\{\{[A-Z_]+\}\}/g) || []).join(', '))
check('the rendered file is a real Word package', out.length > 2000 && zip.file('word/document.xml') !== null, `${(out.length / 1024).toFixed(0)} KB`)

console.log(`\n  template: ${tplPath}\n  rendered: ${outPath}\n`)
console.log(failures === 0 ? 'ALL WORD TEMPLATE CHECKS PASSED' : `${failures} WORD TEMPLATE CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
