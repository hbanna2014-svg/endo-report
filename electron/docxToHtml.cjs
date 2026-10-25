/**
 * docxToHtml.cjs — turn a Word document into editable HTML.
 *
 * The clinic already has its report as a Word file. Instead of asking them to
 * rebuild it, the app opens the file and hands back HTML that looks like the
 * original: same paragraphs, same bold/italic/underline, same alignment, same
 * font and size, tables, and any pictures already in the file.
 *
 * This is deliberately a *report-grade* converter, not a full Word engine:
 * every construct it does not understand degrades to plain text rather than
 * breaking the document.
 */

const path = require('node:path')
const JSZip = require('jszip')

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  emf: 'image/emf',
  wmf: 'image/wmf',
}

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

const attr = (s) => esc(s).replace(/"/g, '&quot;')

/** Pull every relationship of the main document: rId → target. */
async function readRels(zip) {
  const rels = new Map()
  const file = zip.file('word/_rels/document.xml.rels')
  if (!file) return rels
  const xml = await file.async('string')
  const re = /<Relationship\b[^>]*>/g
  let m
  while ((m = re.exec(xml))) {
    const tag = m[0]
    const id = /Id="([^"]+)"/.exec(tag)
    const target = /Target="([^"]+)"/.exec(tag)
    if (id && target) rels.set(id[1], target[1])
  }
  return rels
}

/** Load every picture once, as a data URL, so the HTML is self-contained. */
async function readMedia(zip) {
  const out = new Map()
  const names = Object.keys(zip.files).filter((n) => n.startsWith('word/media/') && !zip.files[n].dir)
  for (const name of names) {
    const ext = path.extname(name).slice(1).toLowerCase()
    const buf = await zip.file(name).async('nodebuffer')
    out.set(name.replace(/^word\//, ''), `data:${MIME[ext] || 'image/png'};base64,${buf.toString('base64')}`)
  }
  return out
}

const val = (tag, name) => {
  const m = new RegExp(`<w:${name}\\b[^>]*w:val="([^"]*)"`).exec(tag)
  return m ? m[1] : null
}

/** Convert one `w:r` run into a span with the formatting Word recorded. */
function runToHtml(runXml, media, rels) {
  // A run can hold a picture instead of (or as well as) text.
  const drawings = runXml.match(/<w:drawing\b[\s\S]*?<\/w:drawing>/g) || []
  let imgs = ''
  for (const d of drawings) {
    const embed = /r:embed="([^"]+)"/.exec(d)
    if (!embed) continue
    const target = rels.get(embed[1])
    if (!target) continue
    const url = media.get(String(target).replace(/^\.?\//, '').replace(/^word\//, ''))
    if (!url) continue
    const ext = /<wp:extent\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(d)
    const w = ext ? Math.max(60, Math.round(Number(ext[1]) / 9525)) : 0
    imgs += `<img src="${url}" alt=""${w ? ` style="width:${Math.min(w, 640)}px"` : ''}>`
  }

  const textParts = []
  const tRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|\s*<w:tab\/>|\s*<w:br\/>/g
  let m
  while ((m = tRe.exec(runXml))) {
    if (m[0].includes('<w:tab')) textParts.push('\t')
    else if (m[0].includes('<w:br')) textParts.push('<br>')
    else textParts.push(esc(m[1]))
  }
  const text = textParts.join('')

  const rPr = (/<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(runXml) || [])[1] || ''
  const styles = []
  if (/<w:b\b(?!\w)/.test(rPr) && !/w:val="(0|false)"/.test((/<w:b\b[^>]*>/.exec(rPr) || [''])[0])) styles.push('font-weight:bold')
  if (/<w:i\b(?!\w)/.test(rPr) && !/w:val="(0|false)"/.test((/<w:i\b[^>]*>/.exec(rPr) || [''])[0])) styles.push('font-style:italic')
  if (/<w:u\b/.test(rPr) && !/w:val="none"/.test(rPr)) styles.push('text-decoration:underline')
  if (/<w:strike\b/.test(rPr)) styles.push('text-decoration:line-through')

  const sz = /<w:sz\b[^>]*w:val="(\d+)"/.exec(rPr)
  if (sz) styles.push(`font-size:${(Number(sz[1]) / 2).toFixed(1)}pt`)
  const color = /<w:color\b[^>]*w:val="([0-9A-Fa-f]{6})"/.exec(rPr)
  if (color) styles.push(`color:#${color[1]}`)
  const font = /<w:rFonts\b[^>]*w:ascii="([^"]+)"/.exec(rPr)
  if (font) styles.push(`font-family:'${font[1].replace(/'/g, '')}'`)

  const inner = `${text}${imgs}`
  if (!inner) return ''
  return styles.length ? `<span style="${styles.join(';')}">${inner}</span>` : inner
}

function paraToHtml(pXml, media, rels) {
  const pPr = (/<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(pXml) || [])[1] || ''
  const jc = /<w:jc\b[^>]*w:val="([^"]+)"/.exec(pPr)
  const align = jc ? { both: 'justify', left: 'left', right: 'right', center: 'center' }[jc[1]] : null

  const isList = /<w:numPr>/.test(pPr)
  const heading = /<w:pStyle\b[^>]*w:val="Heading(\d)"/.exec(pPr)

  const runs = pXml.match(/<w:r\b[\s\S]*?<\/w:r>/g) || []
  let html = runs.map((r) => runToHtml(r, media, rels)).join('')

  // Pictures with no text make a paragraph that should not collapse.
  if (!html.trim()) html = ''

  const style = align ? ` style="text-align:${align}"` : ''
  if (heading) return `<h${Math.min(4, Number(heading[1]) + 1)}${style}>${html || '&nbsp;'}</h${Math.min(4, Number(heading[1]) + 1)}>`
  if (isList) return `<ul><li>${html || '&nbsp;'}</li></ul>`
  return `<p${style}>${html || '&nbsp;'}</p>`
}

function tableToHtml(tblXml, media, rels) {
  const rows = tblXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || []
  const body = rows
    .map((tr) => {
      const cells = tr.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) || []
      const tds = cells
        .map((tc) => {
          const paras = tc.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []
          const inner = paras.map((p) => paraToHtml(p, media, rels)).join('')
          const span = /<w:gridSpan\b[^>]*w:val="(\d+)"/.exec(tc)
          return `<td${span && Number(span[1]) > 1 ? ` colspan="${span[1]}"` : ''}>${inner}</td>`
        })
        .join('')
      return `<tr>${tds}</tr>`
    })
    .join('')
  return `<table class="doc-tbl"><tbody>${body}</tbody></table>`
}

/** Walk the body in order so tables and paragraphs keep their place. */
function bodyToHtml(docXml, media, rels) {
  const bodyMatch = /<w:body>([\s\S]*)<\/w:body>/.exec(docXml)
  const body = bodyMatch ? bodyMatch[1] : docXml

  const tokens = body.match(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>|<w:sectPr\b[\s\S]*?<\/w:sectPr>/g) || []
  return tokens
    .map((t) => {
      if (t.startsWith('<w:tbl')) return tableToHtml(t, media, rels)
      if (t.startsWith('<w:sectPr')) return ''
      return paraToHtml(t, media, rels)
    })
    .join('')
}

async function convertDocxBuffer(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const docFile = zip.file('word/document.xml')
  if (!docFile) throw new Error('This file is not a Word document (.docx).')
  const xml = await docFile.async('string')
  const rels = await readRels(zip)
  const media = await readMedia(zip)
  const html = bodyToHtml(xml, media, rels)

  // Page setup, so the preview and the print-out keep the clinic's margins.
  const sect = /<w:sectPr\b[\s\S]*?<\/w:sectPr>/.exec(xml)
  const margins = {}
  if (sect) {
    const m = sect[0]
    for (const [k, key] of [['top', 'top'], ['right', 'right'], ['bottom', 'bottom'], ['left', 'left']]) {
      const v = new RegExp(`w:${k}="(\\d+)"`).exec(m) || new RegExp(`<w:${k}\\b[^>]*w:w="(\\d+)"`).exec(m)
      margins[key] = v ? Math.round(Number(v[1]) / 56.7) : null
    }
  }
  return { html, margins, bytes: buffer.length }
}

module.exports = { convertDocxBuffer }
