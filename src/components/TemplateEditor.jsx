/**
 * TemplateEditor.jsx — controls the look of the printed / Word report and lets
 * the clinic keep several report layouts (for example one per hospital).
 */

import React, { useEffect, useMemo, useState } from 'react'
import { Plus, Copy, Trash2, Save, Star, FileText, Info, Upload, RotateCcw, ClipboardPaste } from 'lucide-react'

import { api } from '../lib/api.js'
import { DEFAULT_TEMPLATE, IMAGE_LAYOUTS, buildReportModel, reportTitles } from '../lib/reportModel.js'
import { emptyProcedure } from '../lib/autoReport.js'
import { Topbar } from './Dashboard.jsx'
import { Banner, Button, Card, CheckRow, Chip, ConfirmDialog, Field, Input, Select, Textarea, useToast } from './ui.jsx'

const FONTS = ['Arial', 'Calibri', 'Georgia', 'Times New Roman', 'Tahoma', 'Verdana', 'Segoe UI']
const ACCENTS = ['#1d4ed8', '#0f766e', '#7c3aed', '#b91c1c', '#0e7490', '#374151', '#c2410c', '#065f46']

/**
 * The placeholders a Word template may contain. Written as {{TOKEN}} inside the
 * .docx — the main process replaces them when the report is exported, so the
 * clinic's letterhead, fonts and page setup survive untouched.
 * Keep in sync with TOKENS in electron/docxTemplate.cjs.
 */
const WORD_TOKENS = [
  'CLINIC_NAME', 'CLINIC_ADDRESS', 'CLINIC_PHONE',
  'PATIENT_NAME', 'PATIENT_AGE', 'PATIENT_SEX', 'PATIENT_AGE_SEX', 'REG_NO',
  'REPORT_NO', 'PROCEDURE', 'PROCEDURE_DATE', 'REFERRED_BY', 'PERFORMED_BY',
  'INDICATION', 'HISTORY',
  'FINDINGS', 'IMPRESSION', 'RECOMMENDATION', 'DETAILS', 'IMAGES', 'SIGNATURE',
  'DOCTOR_NAME', 'DOCTOR_DEGREES', 'DOCTOR_DESIGNATION', 'DOCTOR_REG_NO', 'GENERATED_AT',
]

const MAX_TEMPLATE_BYTES = 8 * 1024 * 1024
function kb(n) {
  if (!n && n !== 0) return ''
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
}

function blankTemplate(name) {
  return {
    ...JSON.parse(JSON.stringify(DEFAULT_TEMPLATE)),
    id: null,
    name: name || 'New report layout',
    isDefault: false,
  }
}

/** A tiny live sample so the layout choices are tangible. */
function sampleModel(template) {
  const patient = {
    id: 'sample',
    regNo: 'ER2026-0001',
    name: 'Md. Example Patient',
    age: '46',
    ageUnit: 'years',
    sex: 'Male',
    referredBy: 'Dr. A. Rahman',
    indication: 'Epigastric pain for 3 months, not responding to proton pump inhibitor.',
    history: 'Hypertensive, on amlodipine. No previous endoscopy.',
  }
  const procedure = {
    ...emptyProcedure('ogd'),
    id: 'sample',
    procedureDate: new Date().toISOString().slice(0, 10),
    performingDoctor: 'Dr. B. Hossain',
    sedation: 'Conscious sedation — midazolam + pethidine',
    complications: 'None.',
    biopsy: { taken: true, sites: 'Antrum 2, body 2', count: '2' },
    entries: [
      { uid: 'a', sectionId: 'antrum', findingId: 'antral_gastritis_erythematous', values: {}, notes: '' },
      { uid: 'b', sectionId: 'oesophagus', findingId: 'normal_oesophagus', values: {}, notes: '' },
    ],
    status: 'draft',
  }
  const t = { ...template, layout: { ...template.layout, showImages: false } }
  return buildReportModel(patient, procedure, t)
}

export default function TemplateEditor({ templates, onChanged }) {
  const toast = useToast()
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => {
    if (!templates.length) return
    const def = templates.find((t) => t.isDefault) || templates[0]
    setSelectedId((cur) => cur || def.id)
  }, [templates])

  useEffect(() => {
    const t = templates.find((x) => x.id === selectedId)
    if (t) setDraft(JSON.parse(JSON.stringify(t)))
  }, [selectedId, templates])

  const preview = useMemo(() => {
    if (!draft) return null
    try {
      return sampleModel(draft)
    } catch {
      return null
    }
  }, [draft])

  const patchLayout = (key, value) => setDraft((d) => ({ ...d, layout: { ...d.layout, [key]: value } }))

  const save = async () => {
    if (!draft) return
    try {
      const saved = await api.templates.save(draft)
      setSelectedId(saved.id)
      toast.push({ tone: 'ok', title: 'Report layout saved', body: saved.name })
      await onChanged?.()
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not save the layout', body: err.message })
    }
  }

  const duplicate = async () => {
    if (!draft) return
    try {
      const copy = { ...JSON.parse(JSON.stringify(draft)), id: null, name: `${draft.name} (copy)`, isDefault: false }
      const saved = await api.templates.save(copy)
      setSelectedId(saved.id)
      toast.push({ tone: 'ok', title: 'Layout duplicated' })
      await onChanged?.()
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not duplicate', body: err.message })
    }
  }

  const createNew = async () => {
    try {
      const saved = await api.templates.save(blankTemplate())
      setSelectedId(saved.id)
      await onChanged?.()
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not create a layout', body: err.message })
    }
  }

  const remove = async () => {
    if (!confirmDelete) return
    try {
      await api.templates.remove(confirmDelete.id)
      setSelectedId(null)
      setConfirmDelete(null)
      toast.push({ tone: 'ok', title: 'Layout deleted' })
      await onChanged?.()
    } catch (err) {
      toast.push({ tone: 'err', title: 'Delete failed', body: err.message })
    }
  }

  return (
    <>
      <Topbar title="Report template" crumb="Controls the printed, PDF and Word output">
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" icon={Plus} onClick={createNew}>
            New layout
          </Button>
          <Button size="sm" icon={Save} variant="primary" onClick={save} disabled={!draft}>
            Save
          </Button>
        </div>
      </Topbar>

      <div className="content">
        <div style={{ display: 'grid', gridTemplateColumns: '290px minmax(0, 1fr) 330px', gap: 16, alignItems: 'start' }}>
          <Card title="Report layouts" bodyClass="tight">
            <div>
              {templates.map((t) => (
                <div
                  key={t.id}
                  className={`listitem ${selectedId === t.id ? 'active' : ''}`}
                  onClick={() => setSelectedId(t.id)}
                >
                  <FileText size={17} className="muted" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                    <div className="tiny muted">{t.isDefault ? 'Default layout' : 'Alternate layout'}</div>
                  </div>
                  {t.isDefault ? <Star size={14} style={{ color: 'var(--warn)' }} /> : null}
                </div>
              ))}
              {!templates.length ? <div className="small muted" style={{ padding: 12 }}>No layout yet.</div> : null}
            </div>
            {draft ? (
              <div className="panel-foot row" style={{ gap: 6 }}>
                <Button size="sm" icon={Copy} onClick={duplicate}>
                  Duplicate
                </Button>
                <div className="spacer" />
                <Button size="sm" variant="danger" icon={Trash2} onClick={() => setConfirmDelete(draft)}>
                  Delete
                </Button>
              </div>
            ) : null}
          </Card>

          {draft ? (
            <div>
              <Card title="Layout identity">
                <div className="grid c2">
                  <Field label="Layout name" required>
                    <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  </Field>
                  <Field label="Use as the default layout">
                    <div style={{ paddingTop: 6 }}>
                      <CheckRow
                        checked={!!draft.isDefault}
                        onChange={(v) => setDraft({ ...draft, isDefault: v })}
                        label="Yes — use this layout for new reports"
                      />
                    </div>
                  </Field>
                </div>
              </Card>

              <WordTemplateCard draft={draft} setDraft={setDraft} toast={toast} />

              <Card title="Report style" subtitle="Which page layout is printed">
                <div className="grid c2">
                  <button
                    type="button"
                    className={`style-option${(draft.layout.style || 'standard') === 'standard' ? ' on' : ''}`}
                    onClick={() => setDraft({ ...draft, layout: { ...draft.layout, style: 'standard' } })}
                  >
                    <strong>Narrative report</strong>
                    <span className="tiny muted">
                      Letterhead, patient table, findings, impression, recommendations and a picture plate.
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`style-option${draft.layout.style === 'hospital' ? ' on' : ''}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        layout: { ...draft.layout, style: 'hospital', imageLayout: 'form7' },
                      })
                    }
                  >
                    <strong>Hospital paper form</strong>
                    <span className="tiny muted">
                      Your unit's own form: identity / visit grid, title band, three pictures on top and four down the
                      right, findings, comments and signature.
                    </span>
                  </button>
                </div>

                {draft.layout.style === 'hospital' ? (
                  <div style={{ marginTop: 12 }}>
                    <CheckRow
                      checked={!!draft.layout.extraImageSheet}
                      onChange={(v) => patchLayout('extraImageSheet', v)}
                      label="Also print a 6-picture sheet (Image Plus 1–6)"
                      hint="Adds a page after the report with six frames on a 2 × 3 grid and the same letterhead."
                    />
                  </div>
                ) : null}
              </Card>

              <Card title="Sections shown in the report">
                <div className="grid c2">
                  <CheckRow checked={draft.layout.showLogo} onChange={(v) => patchLayout('showLogo', v)} label="Clinic logo" />
                  <CheckRow checked={draft.layout.showPatientBlock} onChange={(v) => patchLayout('showPatientBlock', v)} label="Patient details table" />
                  <CheckRow
                    checked={draft.layout.showProcedureDetails}
                    onChange={(v) => patchLayout('showProcedureDetails', v)}
                    label="Procedure details table"
                  />
                  <CheckRow checked={draft.layout.showImpression} onChange={(v) => patchLayout('showImpression', v)} label="Impression / diagnosis block" />
                  <CheckRow
                    checked={draft.layout.showRecommendation}
                    onChange={(v) => patchLayout('showRecommendation', v)}
                    label="Recommendation / plan block"
                  />
                  <CheckRow checked={draft.layout.showImages} onChange={(v) => patchLayout('showImages', v)} label="Endoscopic images" />
                  <CheckRow
                    checked={draft.layout.showAudit}
                    onChange={(v) => patchLayout('showAudit', v)}
                    label="Documentation audit (internal — usually kept off the patient copy)"
                  />
                </div>

                {draft.layout.showImages ? (
                  <div className="grid c2" style={{ marginTop: 12 }}>
                    <Field
                      label="Picture plate on the report"
                      hint="The 2 × 2 and 2 × 3 plates match the paper forms most units print."
                    >
                      <Select
                        value={draft.layout.imageLayout || 'flow'}
                        onChange={(e) => patchLayout('imageLayout', e.target.value)}
                        options={IMAGE_LAYOUTS.map((l) => ({ value: l.id, label: l.label }))}
                      />
                    </Field>
                    {!draft.layout.imageLayout || draft.layout.imageLayout === 'flow' ? (
                      <Field label="Pictures per row (flowing layout)">
                        <Select
                          value={String(draft.layout.imageColumns)}
                          onChange={(e) => patchLayout('imageColumns', Number(e.target.value))}
                          options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n} per row` }))}
                        />
                      </Field>
                    ) : (
                      <Field label="Captions">
                        <div style={{ paddingTop: 6 }}>
                          <CheckRow
                            checked={draft.layout.showImageCaptions !== false}
                            onChange={(v) => patchLayout('showImageCaptions', v)}
                            label="Print the caption under each picture"
                          />
                        </div>
                      </Field>
                    )}
                  </div>
                ) : null}
                <div className="grid c2" style={{ marginTop: 12 }}>
                  <Field
                    label="Printed picture size"
                    hint="Each frame prints the whole picture on white with a single thin rule — no black mat."
                  >
                    <Select
                      value={`${Number(draft.layout.pictureW) || 63.5}x${Number(draft.layout.pictureH) || 50.8}`}
                      onChange={(e) => {
                        const [w, h] = e.target.value.split('x').map(Number)
                        setDraft((d) => ({ ...d, layout: { ...d.layout, pictureW: w, pictureH: h } }))
                      }}
                      options={[
                        { value: '63.5x50.8', label: '2.5 × 2 in — 63.5 × 50.8 mm' },
                        { value: '50.8x63.5', label: '2 × 2.5 in — 50.8 × 63.5 mm' },
                        { value: '55.88x50.8', label: '2.2 × 2 in — 55.9 × 50.8 mm' },
                        { value: '50.8x50.8', label: '2 × 2 in — 50.8 × 50.8 mm' },
                      ]}
                    />
                  </Field>
                  <Field
                    label="How the picture sits in its frame"
                    hint="“Fill” keeps the frame edge-to-edge with no mat; “whole picture” never crops."
                  >
                    <Select
                      value={draft.layout.pictureFit === 'contain' ? 'contain' : 'cover'}
                      onChange={(e) => patchLayout('pictureFit', e.target.value)}
                      options={[
                        { value: 'cover', label: 'Fill the frame — no black, no white bands' },
                        { value: 'contain', label: 'Whole picture — nothing cropped' },
                      ]}
                    />
                  </Field>
                </div>
              </Card>

              <Card title="Typography & colour">
                <div className="grid c3">
                  <Field label="Font family">
                    <Select value={draft.layout.fontFamily} onChange={(e) => patchLayout('fontFamily', e.target.value)} options={FONTS} />
                  </Field>
                  <Field label="Base font size (pt)">
                    <Input
                      value={draft.layout.fontSize}
                      onChange={(e) => patchLayout('fontSize', Number(e.target.value) || 11)}
                      inputMode="numeric"
                    />
                  </Field>
                  <Field label="Accent colour">
                    <div className="row wrap" style={{ gap: 6, paddingTop: 2 }}>
                      {ACCENTS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={`swatch ${draft.layout.accentColor === c ? 'on' : ''}`}
                          style={{ background: c }}
                          onClick={() => patchLayout('accentColor', c)}
                          title={c}
                        />
                      ))}
                      <input
                        type="color"
                        value={draft.layout.accentColor}
                        onChange={(e) => patchLayout('accentColor', e.target.value)}
                        style={{ width: 30, height: 26, border: 'none', background: 'none', cursor: 'pointer' }}
                        title="Pick any colour"
                      />
                    </div>
                  </Field>
                </div>
              </Card>

              <Card title="Header & footer text">
                <div className="grid">
                  <Field label="Header line" hint="Shown at the top-right of every page of the Word/PDF report">
                    <Textarea
                      value={draft.layout.footerText || ''}
                      onChange={(e) => patchLayout('footerText', e.target.value)}
                      style={{ minHeight: 60 }}
                    />
                  </Field>
                  <Field label="Confidentiality note (page footer)">
                    <Input value={draft.layout.confidentialNote || ''} onChange={(e) => patchLayout('confidentialNote', e.target.value)} />
                  </Field>
                  <Field label="Signature block label">
                    <Input value={draft.layout.signatureLabel || ''} onChange={(e) => patchLayout('signatureLabel', e.target.value)} />
                  </Field>
                </div>
              </Card>
            </div>
          ) : (
            <Card>
              <div className="small muted">Select a layout on the left, or create a new one.</div>
            </Card>
          )}

          <div>
            <Card title="Live sample" subtitle="How a report will look" bodyClass="tight">
              {preview ? (
                <div className="report-paper" style={{ padding: 16, fontSize: 11, maxWidth: 'none' }}>
                  <div className="lh" style={{ paddingBottom: 5, marginBottom: 8 }}>
                    <div className="cn" style={{ fontSize: 14, color: draft.layout.accentColor }}>
                      {preview.template.clinic.name}
                    </div>
                    <div className="tiny muted">{preview.template.clinic.address || 'Clinic address'}</div>
                  </div>
                  <h1 style={{ fontSize: 11.5, color: 'var(--ink)' }}>{preview.title}</h1>
                  <h2 style={{ color: draft.layout.accentColor }}>Patient</h2>
                  <table className="meta">
                    <tbody>
                      <tr>
                        <td className="k">Name</td>
                        <td>{preview.patientLine.name}</td>
                      </tr>
                      <tr>
                        <td className="k">Age / Sex</td>
                        <td>{preview.patientLine.ageSex}</td>
                      </tr>
                    </tbody>
                  </table>
                  {preview.narrative.findings.length ? (
                    <>
                      <h2 style={{ color: draft.layout.accentColor }}>Findings</h2>
                      {preview.narrative.findings.map((b) => (
                        <div key={b.heading} style={{ marginBottom: 5 }}>
                          <div style={{ fontWeight: 600, fontSize: 10.5 }}>{b.heading}</div>
                          <div className="tiny" style={{ textAlign: 'justify' }}>
                            {b.text.slice(0, 190)}
                            {b.text.length > 190 ? '…' : ''}
                          </div>
                        </div>
                      ))}
                    </>
                  ) : null}
                  <h2 style={{ color: draft.layout.accentColor }}>Impression</h2>
                  <div className="tiny" style={{ fontWeight: 700 }}>
                    {preview.narrative.diagnosis}
                  </div>
                </div>
              ) : (
                <div className="small muted">Nothing to preview yet.</div>
              )}
            </Card>

            <div style={{ marginTop: 14 }}>
              <Card title="Where to change the clinic identity">
                <div className="row small muted" style={{ gap: 8 }}>
                  <Info size={14} />
                  <div>
                    The clinic name, address, phone, logo and doctor details come from{' '}
                    <strong>Settings ▸ Clinic identity</strong> — they apply to every layout.
                  </div>
                </div>
                <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
                  <Chip tone="brand">{reportTitles('ogd').short}</Chip>
                  <Chip tone="colon">{reportTitles('colonoscopy').short}</Chip>
                  <Chip tone="both">{reportTitles('both').short}</Chip>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this layout"
        message={`Delete “${confirmDelete?.name || ''}”?`}
        detail="Reports already generated are not affected."
        confirmLabel="Delete layout"
        onConfirm={remove}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Your own Word file                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Brings the clinic's own .docx into the report. The file itself is kept, so
 * the letterhead, fonts, margins and logos are preserved when the report is
 * exported; only the {{TOKEN}} placeholders inside it are replaced. The lines
 * below are the file's real paragraphs and can be edited here before saving.
 */
function WordTemplateCard({ draft, setDraft, toast }) {
  const wt = draft.layout.wordTemplate || null
  const [importing, setImporting] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [onlyTokens, setOnlyTokens] = useState(false)

  const patchWt = (changes) =>
    setDraft((d) => ({
      ...d,
      layout: { ...d.layout, wordTemplate: { ...(d.layout.wordTemplate || {}), ...changes } },
    }))

  const importWord = async () => {
    setImporting(true)
    try {
      const res = await api.templates.importDocx()
      if (!res?.ok) {
        if (!res?.cancelled) toast.push({ tone: 'err', title: 'Could not read that Word file' })
        return
      }
      if (res.bytes > MAX_TEMPLATE_BYTES) {
        toast.push({
          tone: 'warn',
          title: 'That Word file is very large',
          body: `${kb(res.bytes)} — pictures inside the file are kept. Consider a lighter letterhead.`,
        })
      }
      patchWt({
        fileName: res.fileName,
        bytes: res.bytes,
        base64: res.base64,
        blocks: res.blocks || [],
        tokens: res.tokens || [],
        unknownTokens: res.unknownTokens || [],
        importedAt: new Date().toISOString(),
      })
      toast.push({
        tone: 'ok',
        title: 'Word template loaded',
        body: `${res.paragraphs} paragraph(s) · ${res.tables} table(s) — press Save to keep it.`,
      })
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not read that Word file', body: err.message })
    } finally {
      setImporting(false)
    }
  }

  const removeWord = () =>
    setDraft((d) => {
      const layout = { ...d.layout }
      delete layout.wordTemplate
      return { ...d, layout }
    })

  const setLine = (id, text) =>
    patchWt({ blocks: (wt.blocks || []).map((b) => (b.id === id ? { ...b, text } : b)) })

  const resetLine = (id) =>
    patchWt({ blocks: (wt.blocks || []).map((b) => (b.id === id ? { ...b, text: b.original } : b)) })

  const insertToken = (id, key) => {
    const b = (wt.blocks || []).find((x) => x.id === id)
    if (!b) return
    const glue = b.text && !/\s$/.test(b.text) ? ' ' : ''
    setLine(id, `${b.text}${glue}{{${key}}}`)
  }

  const paras = (wt?.blocks || []).filter((b) => b.kind === 'paragraph' && String(b.text || '').trim())
  const withToken = paras.filter((b) => /\{\{/.test(b.text))
  const shown = (onlyTokens ? withToken : paras).slice(0, showAll ? 400 : 30)
  const edited = paras.filter((b) => b.text !== b.original).length

  if (!wt) {
    return (
      <Card title="Use your own Word file">
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <FileText size={30} className="muted" style={{ flex: '0 0 30px', marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div className="small" style={{ lineHeight: 1.55 }}>
              Have a report already designed in Word? Import that <strong>.docx</strong> here. The hospital letterhead,
              fonts, margins and logo stay exactly as they are — we only replace the placeholders with this patient's
              details, findings, impression and pictures.
            </div>
            <div className="row wrap small muted" style={{ gap: 6, marginTop: 8 }}>
              {['{{PATIENT_NAME}}', '{{FINDINGS}}', '{{IMPRESSION}}', '{{IMAGES}}', '{{SIGNATURE}}'].map((t) => (
                <span key={t} className="token-chip">{t}</span>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <Button icon={Upload} variant="primary" onClick={importWord} disabled={importing}>
                {importing ? 'Reading the file…' : 'Import a Word template (.docx)'}
              </Button>
            </div>
            <div className="tiny muted" style={{ marginTop: 8 }}>
              Without a Word file the report is generated from the layout above — both outputs print the same content.
            </div>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card
      title="Your Word file"
      subtitle={`${wt.fileName} · ${kb(wt.bytes)} · ${paras.length} line(s), ${(wt.blocks || []).length - paras.length} table(s)`}
      actions={
        <>
          <Button size="sm" icon={Upload} onClick={importWord} disabled={importing}>
            {importing ? 'Reading…' : 'Replace'}
          </Button>
          <Button size="sm" variant="danger" onClick={removeWord}>
            Remove
          </Button>
        </>
      }
    >
      <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
        <Chip tone="ok">{paras.length} editable line(s)</Chip>
        {wt.tokens?.length ? <Chip tone="brand">{wt.tokens.length} placeholder(s) found</Chip> : <Chip tone="warn">No placeholder yet</Chip>}
        {edited ? <Chip tone="info">{edited} line(s) changed</Chip> : null}
        {wt.unknownTokens?.length ? <Chip tone="danger">{wt.unknownTokens.join(', ')} not recognised</Chip> : null}
      </div>

      <div className="small muted" style={{ marginBottom: 8, lineHeight: 1.5 }}>
        Edit the lines below to change the words printed on the report. Type or paste a placeholder
        (<code>{'{{PATIENT_NAME}}'}</code>) where a value should appear, or use the <em>＋</em> box on the right of a
        line.
      </div>

      <div className="row wrap" style={{ gap: 8, marginBottom: 8 }}>
        <Button size="sm" variant={onlyTokens ? 'primary' : 'ghost'} onClick={() => setOnlyTokens((v) => !v)}>
          {onlyTokens ? 'Showing lines with placeholders' : 'Show only lines with placeholders'}
        </Button>
        <div className="spacer" />
        <div className="row wrap" style={{ gap: 4 }}>
          {WORD_TOKENS.slice(0, 8).map((t) => (
            <span key={t} className="token-chip">{t}</span>
          ))}
        </div>
      </div>

      <div className="wt-list">
        {shown.length ? (
          shown.map((b) => (
            <div key={b.id} className={`wt-row${b.text !== b.original ? ' changed' : ''}`}>
              <span className="wt-no">{b.pNo}</span>
              <input
                className="input"
                value={b.text}
                onChange={(e) => setLine(b.id, e.target.value)}
                title={b.original}
              />
              <select
                className="select wt-token"
                value=""
                onChange={(e) => {
                  if (e.target.value) insertToken(b.id, e.target.value)
                  e.target.value = ''
                }}
                title="Insert a placeholder into this line"
              >
                <option value="">＋</option>
                {WORD_TOKENS.map((t) => (
                  <option key={t} value={t}>{`{{${t}}}`}</option>
                ))}
              </select>
              {b.text !== b.original ? (
                <button type="button" className="wt-reset" title="Restore the original line" onClick={() => resetLine(b.id)}>
                  <RotateCcw size={13} />
                </button>
              ) : (
                <span className="wt-reset gap" />
              )}
            </div>
          ))
        ) : (
          <div className="small muted">No line matches. Turn the filter off to see every paragraph.</div>
        )}
      </div>

      {paras.length > shown.length || onlyTokens ? (
        <div className="row" style={{ marginTop: 8 }}>
          <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer lines' : `Show all ${paras.length} lines`}
          </Button>
        </div>
      ) : null}

      <div className="banner info" style={{ marginTop: 10 }}>
        <ClipboardPaste size={15} style={{ flex: '0 0 15px', marginTop: 1 }} />
        <div className="small">
          <strong>{'{{IMAGES}}'}</strong> is where the 4- or 6-picture plate is placed, <strong>{'{{FINDINGS}}'}</strong>{' '}
          and <strong>{'{{IMPRESSION}}'}</strong> expand into the full text, and <strong>{'{{SIGNATURE}}'}</strong> becomes
          the signature block. Put each one on its own line and the expansion starts there.
        </div>
      </div>
    </Card>
  )
}
