/**
 * DetailsPanel.jsx — the procedure-level documentation: sedation, scope,
 * extent reached, bowel preparation scoring, quality metrics, biopsy and
 * complication details.
 */

import React from 'react'
import { Syringe, Timer, Scissors, ShieldCheck, AlertTriangle } from 'lucide-react'

import { BBPS_SCALE, BBPS_SEGMENTS, COLON_EXTENT, PROCEDURE_TYPES } from '../lib/anatomy.js'
import { Button, Card, CheckRow, Field, Input, Select, Textarea, Tabs } from './ui.jsx'

const SEDATION_OPTIONS = [
  'Conscious sedation — midazolam + pethidine',
  'Conscious sedation — midazolam only',
  'Conscious sedation — propofol (anaesthetist present)',
  'Topical pharyngeal anaesthesia only (no sedation)',
  'General anaesthesia',
  'None',
]

const PREP_OPTIONS = ['Excellent', 'Good', 'Fair', 'Poor', 'Inadequate']

export default function DetailsPanel({ procedure, patch, activeSection, onSelectSection, audit }) {
  const isColon = procedure.testName === 'colonoscopy' || procedure.testName === 'both'
  const isOgd = procedure.testName === 'ogd' || procedure.testName === 'both'
  const bbps = procedure.bbps || {}
  const bbpsTotal = BBPS_SEGMENTS.reduce((a, s) => a + Number(bbps[s.id] || 0), 0)
  const bbpsComplete = BBPS_SEGMENTS.every((s) => bbps[s.id] !== undefined && bbps[s.id] !== '')

  const setBbps = (id, value) => patch({ bbps: { ...bbps, [id]: value } })

  return (
    <div className="grid c2">
      <Card title="Procedure information" icon={Syringe}>
        <div className="grid c2">
          <Field label="Type of procedure">
            <Select
              value={procedure.testName}
              onChange={(e) => patch({ testName: e.target.value })}
              options={PROCEDURE_TYPES.map((t) => ({ value: t.id, label: t.label }))}
            />
          </Field>
          <Field label="Date of procedure">
            <Input type="date" value={procedure.procedureDate || ''} onChange={(e) => patch({ procedureDate: e.target.value })} />
          </Field>
          <Field label="Performing endoscopist">
            <Input value={procedure.performingDoctor || ''} onChange={(e) => patch({ performingDoctor: e.target.value })} />
          </Field>
          <Field label="Assistant / attending staff">
            <Input value={procedure.assistant || ''} onChange={(e) => patch({ assistant: e.target.value })} />
          </Field>
          <Field label="Scope / equipment used">
            <Input value={procedure.scopeModel || ''} onChange={(e) => patch({ scopeModel: e.target.value })} placeholder="e.g. Olympus GIF-HQ190" />
          </Field>
          <Field label="Total procedure time (minutes)">
            <Input
              value={procedure.totalProcedureTime || ''}
              onChange={(e) => patch({ totalProcedureTime: e.target.value })}
              inputMode="numeric"
              placeholder="e.g. 18"
            />
          </Field>
          <Field label="Sedation / anaesthesia" className="c2">
            <Select
              value={procedure.sedation || ''}
              onChange={(e) => patch({ sedation: e.target.value })}
              options={SEDATION_OPTIONS}
              placeholder="Select…"
            />
          </Field>
        </div>
      </Card>

      <Card title="Quality & safety" icon={ShieldCheck}>
        <div className="grid">
          <Field label="Complications" hint='Record "none" explicitly — an empty field is not the same as "no complication".'>
            <Textarea
              value={procedure.complications || ''}
              onChange={(e) => patch({ complications: e.target.value })}
              placeholder="e.g. None. No bleeding, no perforation, patient tolerated the procedure well."
              style={{ minHeight: 62 }}
              missing={!String(procedure.complications || '').trim()}
            />
          </Field>

          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <Scissors size={15} className="muted" />
              <strong style={{ fontSize: 13 }}>Biopsy / histology</strong>
            </div>
            <CheckRow
              checked={!!procedure.biopsy?.taken}
              onChange={(v) => patch({ biopsy: { ...(procedure.biopsy || {}), taken: v } })}
              label="Specimen(s) sent for histopathology"
            />
            {procedure.biopsy?.taken ? (
              <div className="grid c2" style={{ marginTop: 10 }}>
                <Field label="Number of specimens / pots">
                  <Input
                    value={procedure.biopsy?.count || ''}
                    onChange={(e) => patch({ biopsy: { ...(procedure.biopsy || {}), count: e.target.value } })}
                    inputMode="numeric"
                  />
                </Field>
                <Field label="Site(s) of biopsy" required>
                  <Input
                    value={procedure.biopsy?.sites || ''}
                    onChange={(e) => patch({ biopsy: { ...(procedure.biopsy || {}), sites: e.target.value } })}
                    placeholder="e.g. Antrum 2, body 2, D2 1"
                    missing={!String(procedure.biopsy?.sites || '').trim()}
                  />
                </Field>
              </div>
            ) : null}
          </div>

          {isOgd ? (
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <CheckRow
                checked={!!procedure.hpylori?.tested}
                onChange={(v) => patch({ hpylori: { ...(procedure.hpylori || {}), tested: v } })}
                label="H. pylori status assessed"
                hint="Rapid urease test, histology, stool antigen or urea breath test"
              />
              {procedure.hpylori?.tested ? (
                <div className="grid c2" style={{ marginTop: 10 }}>
                  <Field label="Method">
                    <Select
                      value={procedure.hpylori?.method || ''}
                      onChange={(e) => patch({ hpylori: { ...(procedure.hpylori || {}), method: e.target.value } })}
                      options={['Rapid urease test (RUT)', 'Histology', 'Stool antigen', 'Urea breath test', 'Not performed']}
                      placeholder="Select…"
                    />
                  </Field>
                  <Field label="Result">
                    <Select
                      value={procedure.hpylori?.result || ''}
                      onChange={(e) => patch({ hpylori: { ...(procedure.hpylori || {}), result: e.target.value } })}
                      options={['Positive', 'Negative', 'Equivocal']}
                      placeholder="Select…"
                    />
                  </Field>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      {isColon ? (
        <Card title="Colonoscopy metrics" icon={Timer} className="c2">
          <div className="grid c3">
            <Field label="Extent of examination" required hint="Where did the scope reach?">
              <Select
                value={procedure.extentReached || ''}
                onChange={(e) => patch({ extentReached: e.target.value })}
                options={COLON_EXTENT}
                placeholder="Select…"
                missing={!procedure.extentReached}
              />
            </Field>
            <Field label="Caecal intubation time (min)">
              <Input
                value={procedure.caecalIntubationTime || ''}
                onChange={(e) => patch({ caecalIntubationTime: e.target.value })}
                inputMode="numeric"
              />
            </Field>
            <Field label="Withdrawal time (min)" hint="Target ≥ 6 minutes">
              <Input
                value={procedure.withdrawalTime || ''}
                onChange={(e) => patch({ withdrawalTime: e.target.value })}
                inputMode="numeric"
                missing={Number(procedure.withdrawalTime) > 0 && Number(procedure.withdrawalTime) < 6}
              />
            </Field>
            <Field label="Overall bowel preparation quality" required>
              <Select
                value={procedure.prepQuality || ''}
                onChange={(e) => patch({ prepQuality: e.target.value })}
                options={PREP_OPTIONS}
                placeholder="Select…"
                missing={!procedure.prepQuality}
              />
            </Field>
            <Field label="Retroflexion performed in rectum">
              <Select
                value={procedure.retroflexionPerformed || ''}
                onChange={(e) => patch({ retroflexionPerformed: e.target.value })}
                options={['Yes', 'No', 'Attempted, not completed']}
                placeholder="Select…"
              />
            </Field>
            <Field label="Bowel preparation score (BBPS)" hint="Boston Bowel Preparation Scale, 0–3 per segment">
              <div className="row" style={{ gap: 6 }}>
                <span className={`chip ${bbpsComplete ? 'ok' : 'warn'}`}>Total {bbpsTotal}/9</span>
                {!bbpsComplete ? <span className="chip warn">Incomplete</span> : null}
              </div>
            </Field>
          </div>

          <div className="grid c3" style={{ marginTop: 10 }}>
            {BBPS_SEGMENTS.map((s) => (
              <Field key={s.id} label={s.label}>
                <Select
                  value={bbps[s.id] ?? ''}
                  onChange={(e) => setBbps(s.id, e.target.value)}
                  options={BBPS_SCALE.map((b) => ({ value: String(b.value), label: b.label }))}
                  placeholder="Not scored"
                />
              </Field>
            ))}
          </div>
        </Card>
      ) : null}

      <Card title="Narrative additions & overrides" className={isColon ? 'c2' : ''}>
        <div className="grid">
          <Field label="Additional findings / free text" hint="Appears after the structured findings in the report">
            <Textarea
              value={procedure.additionalFindings || ''}
              onChange={(e) => patch({ additionalFindings: e.target.value })}
              placeholder="e.g. A 5 mm sessile polyp in the sigmoid was also noted and removed with a cold snare."
              style={{ minHeight: 70 }}
            />
          </Field>

          <div className="banner info">
            <AlertTriangle size={16} style={{ flex: '0 0 16px', marginTop: 1 }} />
            <div className="small">
              Leave the two boxes below empty and the report will use the automatically generated impression and
              recommendations. Type in them only when you want to override the generated wording.
            </div>
          </div>

          <Field label="Impression / diagnosis (manual override)">
            <Textarea
              value={procedure.impressionOverride || ''}
              onChange={(e) => patch({ impressionOverride: e.target.value })}
              placeholder="Leave empty to use the auto-generated impression"
              style={{ minHeight: 62 }}
            />
          </Field>
          <Field label="Recommendation / plan (manual override)">
            <Textarea
              value={procedure.recommendationOverride || ''}
              onChange={(e) => patch({ recommendationOverride: e.target.value })}
              placeholder="Leave empty to use the auto-generated recommendations"
              style={{ minHeight: 62 }}
            />
          </Field>
        </div>
      </Card>
    </div>
  )
}

export { Tabs }
