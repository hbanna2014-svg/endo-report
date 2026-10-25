/**
 * ReportView.jsx — the on-screen preview of the finished report.
 *
 * Rendered from the exact same model that feeds the printer and the Word
 * export, so what the endoscopist sees is what the clinic gets.
 */

import React from 'react'
import { Printer, Download, FileText, Copy, Sparkles, Images } from 'lucide-react'

import { Button, Card, Chip, Empty, SeverityChip } from './ui.jsx'
import ReportPlate from './ReportPlate.jsx'
import RichFindings from './RichFindings.jsx'

export default function ReportView({
  model,
  onPrint,
  onDocx,
  onPdf,
  onCopy,
  astats,
  busy,
  reference,
  editable = false,
  onImagePick,
  onImageClear,
  onImageMove,
  onImageCaption,
  onAddPicture,
  compact = false,
  hidePlate = false,
  docMode = false,
  onDocSave,
  onDocReset,
  onField,
  onRichSave,
  onRichReset,
}) {

  const recoLines = String(model.narrative.recommendation || '')
    .split('\n')
    .map((l) => l.replace(/^•\s*/, '').trim())
    .filter(Boolean)

  const impressionLines = String(model.narrative.diagnosis || '')
    .split('\n')
    .filter((l) => l.trim())

  const plan = model.imagePlan || { mode: 'flow', slots: [], filled: 0, capacity: 0 }
  const sideCount = plan.mode === 'grid6' ? 3 : plan.mode === 'grid4' ? 4 : 0

  return (
    <>
      <Card
        title={compact ? 'Report' : 'Report preview'}
        subtitle={`${model.title} · ${model.reportNo}`}
        actions={
          <>
            <Button size="sm" icon={Copy} onClick={onCopy} disabled={busy}>
              Copy text
            </Button>
            <Button size="sm" icon={FileText} onClick={onPdf} disabled={busy}>
              Save PDF
            </Button>
            <Button size="sm" icon={Download} onClick={onDocx} disabled={busy}>
              Word
            </Button>
            <Button size="sm" variant="primary" icon={Printer} onClick={onPrint} disabled={busy}>
              Print
            </Button>
          </>
        }
      >
        <div className="row wrap small" style={{ gap: 8, marginBottom: 12 }}>
          <Chip tone={astats?.errors ? 'danger' : 'ok'}>
            {astats?.errors ? `${astats.errors} blocking issue(s)` : 'Ready to finalise'}
          </Chip>
          <Chip tone="brand">{model.analysis.counts.documented}/{model.analysis.counts.expected} sections documented</Chip>
          <Chip tone="info">{model.analysis.counts.findings} abnormal finding(s)</Chip>
          <Chip>Audit score {model.audit.score}%</Chip>
          {model.media.some((m) => m.kind === 'image') ? (
            <Chip tone="info">
              <Images size={11} /> {model.media.filter((m) => m.kind === 'image').length} image(s)
            </Chip>
          ) : null}
        </div>

        <div className={`report-paper${docMode ? ' doc-mode' : ''}`} ref={reference}>
          {!docMode ? (
          <>
          <div className="lh">
            {model.template.layout.showLogo && model.template.clinic.logoDataUrl ? (
              <img src={model.template.clinic.logoDataUrl} alt="" style={{ maxHeight: 58, marginBottom: 6 }} />
            ) : null}
            <div className="cn">{model.template.clinic.name}</div>
            {model.template.clinic.address ? <div className="small muted">{model.template.clinic.address}</div> : null}
            {model.template.clinic.phone || model.template.clinic.email ? (
              <div className="tiny muted">{[model.template.clinic.phone, model.template.clinic.email].filter(Boolean).join('  |  ')}</div>
            ) : null}
          </div>

          <h1>{model.title}</h1>
          <div className="center tiny muted" style={{ marginBottom: 12 }}>
            Report No: <strong>{model.reportNo}</strong> &nbsp;|&nbsp; Generated {model.generatedLine}
          </div>

          <h2>Patient</h2>
          <table className="meta">
            <tbody>
              <MetaRow
                label="Patient name"
                value={model.patientLine.name}
                editable={editable}
                onChange={(v) => onField?.('patient', 'name', v)}
              />
              <MetaRow label="Age / Sex" editable={editable}>
                {editable ? (
                  <div className="cell-split">
                    <input
                      className="cell"
                      style={{ width: 66 }}
                      value={model.patientLine.age || ''}
                      onChange={(e) => onField?.('patient', 'age', e.target.value)}
                      placeholder="Age"
                    />
                    <span className="muted">/</span>
                    <select
                      className="cell"
                      style={{ width: 96 }}
                      value={model.patientLine.sex || ''}
                      onChange={(e) => onField?.('patient', 'sex', e.target.value)}
                    >
                      <option value="">—</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                ) : (
                  model.patientLine.ageSex
                )}
              </MetaRow>
              <MetaRow
                label="Registration no"
                value={model.patientLine.regNo}
                editable={editable}
                onChange={(v) => onField?.('patient', 'regNo', v)}
              />
              <MetaRow
                label="Referred by"
                value={model.patientLine.referredBy}
                editable={editable}
                onChange={(v) => onField?.('procedure', 'referredBy', v)}
              />
              <MetaRow
                label="Procedure done by"
                value={model.patientLine.performedBy}
                editable={editable}
                onChange={(v) => onField?.('procedure', 'performingDoctor', v)}
              />
              <MetaRow
                label="Date of procedure"
                value={model.patientLine.procedureDate}
                editable={editable}
                onChange={(v) => onField?.('procedure', 'procedureDate', v)}
              />
            </tbody>
          </table>
          </>
          ) : null}

          {plan.mode === 'grid6' && plan.filled >= 0 ? (
            <div className="sheet-top">
              <ReportPlate
                model={model}
                variant="top"
                only={[1, 2, 3]}
                editable={editable}
                onPick={onImagePick}
                onClear={onImageClear}
                onMove={onImageMove}
                onCaption={onImageCaption}
                onAddPicture={onAddPicture}
              />
            </div>
          ) : null}

          <div className={`sheet-split${sideCount ? ' has-side' : ''}`}>
            <div className="sheet-main">
              {docMode ? (
                <RichFindings
                  html={model.reportDoc.html}
                  docMode
                  minHeight={540}
                  onSave={onDocSave}
                  onReset={onDocReset}
                  placeholder="Your Word report appears here — click and type to change it."
                />
              ) : null}
              {!docMode && model.narrative.indication ? (
                <>
                  <h2>Indication</h2>
                  <p style={{ margin: 0, textAlign: 'justify' }}>{model.narrative.indication}</p>
                </>
              ) : null}

              {model.narrative.history ? (
                <>
                  <h2>Relevant history</h2>
                  <p style={{ margin: 0, textAlign: 'justify' }}>{model.narrative.history}</p>
                </>
              ) : null}

              {model.template.layout.showProcedureDetails && model.details.filter((d) => d.value).length ? (
                <>
                  <h2>Procedure details</h2>
                  <table className="meta">
                    <tbody>
                      {model.details
                        .filter((d) => d.value)
                        .map((d) => (
                          <tr key={d.label}>
                            <td className="k">{d.label}</td>
                            <td>{d.value}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </>
              ) : null}

              <h2>Findings</h2>
              {editable ? (
                <RichFindings
                  html={model.reportRich.html}
                  custom={model.reportRich.custom}
                  onSave={(html) => onRichSave?.(html)}
                  onReset={onRichReset}
                  placeholder="Tick findings on the left, then type here to adjust the wording…"
                />
              ) : model.reportRich.custom ? (
                <div className="rich-static" dangerouslySetInnerHTML={{ __html: model.reportRich.html }} />
              ) : model.narrative.findings.length ? (
                model.narrative.findings.map((b) => (
                  <div key={b.heading} style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 650, fontSize: 12.5 }}>{b.heading}</div>
                    <p style={{ margin: '2px 0 0', textAlign: 'justify' }}>{b.text}</p>
                  </div>
                ))
              ) : (
                <p className="muted">
                  <em>No findings recorded yet — tick the relevant findings in the Findings view.</em>
                </p>
              )}

              {model.template.layout.showImpression ? (
                <>
                  <h2>Impression / Diagnosis</h2>
                  <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                    {impressionLines.length ? (
                      impressionLines.map((l, i) => (
                        <li key={i} className="imp">
                          {l}
                        </li>
                      ))
                    ) : (
                      <li className="imp">Normal study</li>
                    )}
                  </ul>
                </>
              ) : null}

              {model.template.layout.showRecommendation && recoLines.length ? (
                <>
                  <h2>Recommendation / Plan</h2>
                  <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                    {recoLines.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </>
              ) : null}

              {!hidePlate && plan.mode === 'flow' && model.template.layout.showImages && (plan.filled > 0 || editable) ? (
                <>
                  <h2>Endoscopic images</h2>
                  <ReportPlate
                    model={model}
                    editable={editable}
                    onPick={onImagePick}
                    onClear={onImageClear}
                    onMove={onImageMove}
                    onCaption={onImageCaption}
                    onAddPicture={onAddPicture}
                  />
                </>
              ) : null}
            </div>

            {sideCount ? (
              <aside className="sheet-side">
                <ReportPlate
                  model={model}
                  variant="side"
                  only={plan.mode === 'grid6' ? [4, 5, 6] : [1, 2, 3, 4]}
                  editable={editable}
                  onPick={onImagePick}
                  onClear={onImageClear}
                  onMove={onImageMove}
                  onCaption={onImageCaption}
                  onAddPicture={onAddPicture}
                />
              </aside>
            ) : null}
          </div>

          <div className="sig">
            <div>
              <div style={{ height: 30 }} />
              <div className="line">
                <strong>{model.signature.name || '\u00a0'}</strong>
                <div className="tiny muted">{model.signature.designation}</div>
                {model.signature.regNo ? <div className="tiny muted">Reg. No: {model.signature.regNo}</div> : null}
              </div>
            </div>
            <div>
              <div style={{ height: 30 }} />
              <div className="line">Date: ______________________</div>
            </div>
          </div>

          {model.disclaimer ? (
            <p className="tiny muted" style={{ marginTop: 18, textAlign: 'justify' }}>
              {model.disclaimer}
            </p>
          ) : null}
        </div>
      </Card>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Live impression card (shown next to the findings editor)                    */
/* -------------------------------------------------------------------------- */

export function AutoSummary({ analysis, procedure, onUseDefault, onOpenReport }) {
  const { impression, audit, polyps } = analysis
  if (!impression) return null
  return (
    <Card
      title="Auto-generated impression"
      subtitle="Updates as you tick findings"
      actions={
        onOpenReport ? (
          <Button size="sm" variant="ghost" onClick={onOpenReport}>
            Full report
          </Button>
        ) : null
      }
    >
      {procedure.impressionOverride ? (
        <div className="banner warn" style={{ marginBottom: 10 }}>
          <Sparkles size={16} style={{ flex: '0 0 16px', marginTop: 1 }} />
          <div className="small">
            The impression has been overridden manually. The generated version below is no longer used in the report.{' '}
            <button type="button" className="btn ghost sm" style={{ padding: '1px 6px' }} onClick={onUseDefault}>
              Remove override
            </button>
          </div>
        </div>
      ) : null}

      {impression.length ? (
        <ol style={{ margin: '0 0 4px', paddingLeft: 18 }}>
          {impression.map((i, idx) => (
            <li key={idx} style={{ marginBottom: 5 }}>
              <div style={{ fontWeight: 650, fontSize: 12.5 }}>{i.text}</div>
              <SeverityChip severity={i.severity} />
            </li>
          ))}
        </ol>
      ) : (
        <Empty title="Nothing generated yet" hint="Tick findings in the sections to build the impression automatically." />
      )}

      {polyps?.hasPolyps ? (
        <div className="banner info" style={{ marginTop: 10 }}>
          <div className="small">
            <strong>Polyp summary:</strong> {polyps.totalPolyps} polyp(s), largest {polyps.largestMm || '?'} mm. The
            surveillance interval is added to the recommendations automatically.
          </div>
        </div>
      ) : null}

      <div className="row small muted" style={{ gap: 8, marginTop: 12 }}>
        <Chip tone={audit.errors ? 'danger' : 'ok'}>{audit.errors} blocking</Chip>
        <Chip tone={audit.warnings ? 'warn' : 'ok'}>{audit.warnings} warning</Chip>
        <Chip>{audit.infos} suggestion</Chip>
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* One line of the patient block — editable on the paper itself                */
/* -------------------------------------------------------------------------- */

function MetaRow({ label, value, editable = false, onChange, children }) {
  return (
    <tr>
      <td className="k">{label}</td>
      <td>
        {children ||
          (editable && onChange ? (
            <input className="cell" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
          ) : (
            value || '—'
          ))}
      </td>
    </tr>
  )
}
