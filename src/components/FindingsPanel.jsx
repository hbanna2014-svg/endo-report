/**
 * FindingsPanel.jsx — the structured documentation surface.
 *
 * Left: the anatomical sections for this procedure type.
 * Right: the finding catalogue for the selected section, plus the value fields
 *        (LA grade, polyp size, Forrest class …) for every ticked finding.
 */

import React, { useMemo, useState } from 'react'
import { Check, Search, StickyNote, Sparkles, Info } from 'lucide-react'
import { findingsForSection, SEVERITY_ORDER } from '../lib/autoReport.js'
import { sectionsForProcedure } from '../lib/anatomy.js'
import { Button, Input, SeverityChip, Textarea } from './ui.jsx'

function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}

export function SectionList({ procedure, activeSection, onSelect }) {
  const sections = useMemo(() => sectionsForProcedure(procedure.testName), [procedure.testName])
  const entries = procedure.entries || []

  return (
    <div className="sectionbar">
      {sections.map((s) => {
        const items = entries.filter((e) => e.sectionId === s.id)
        const note = (procedure.sectionNotes || {})[s.id]
        const defs = items.map((i) => findingsForSection(s.id).find((f) => f.id === i.findingId)).filter(Boolean)
        const abnormal = defs.some((d) => !d.isNormal && !d.isNegative)
        const hasNegative = defs.some((d) => d.isNegative)
        const dot = abnormal ? 'abnormal' : items.length ? 'filled' : note ? 'note' : ''
        const tone = abnormal
          ? 'critical'
          : hasNegative
            ? 'unknown'
            : defs[0]?.severity || 'normal'
        return (
          <button
            key={s.id}
            type="button"
            className={cx('sectionitem', activeSection === s.id && 'active', items.length ? 'done' : 'pending')}
            onClick={() => onSelect(s.id)}
          >
            <span className={cx('sectiondot', dot)} />
            <span style={{ flex: 1, textAlign: 'left' }}>{s.label}</span>
            {abnormal ? <SeverityChip severity={tone} /> : null}
            {!abnormal && items.length ? <Check size={13} style={{ color: 'var(--ok)' }} /> : null}
            {note ? <StickyNote size={12} style={{ color: 'var(--warn)' }} /> : null}
          </button>
        )
      })}
    </div>
  )
}

function ValueField({ field, value, onChange }) {
  const missing = field.required && (value === undefined || value === null || value === '')
  const common = {
    className: missing ? 'missing' : '',
    value: value ?? '',
    onChange: (e) => onChange(e.target.value),
  }
  if (field.type === 'select') {
    return (
      <div className="valuefield">
        <span>
          {field.label}
          {field.required ? ' *' : ''}
        </span>
        <select className="select" {...common}>
          <option value="">Select…</option>
          {(field.options || []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    )
  }
  if (field.type === 'number') {
    return (
      <div className="valuefield">
        <span>
          {field.label}
          {field.required ? ' *' : ''}
        </span>
        <input className={cx('input', missing && 'missing')} value={value ?? ''} onChange={(e) => onChange(e.target.value)} inputMode="decimal" />
      </div>
    )
  }
  return (
    <div className="valuefield">
      <span>
        {field.label}
        {field.required ? ' *' : ''}
      </span>
      <input className={cx('input', missing && 'missing')} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

export default function FindingsPanel({
  procedure,
  activeSection,
  onSelectSection,
  onToggleFinding,
  onSetValue,
  onSetNote,
  onSetSectionNote,
  aiEnabled,
  onAiReview,
  aiBusy,
}) {
  const [q, setQ] = useState('')
  const sections = useMemo(() => sectionsForProcedure(procedure.testName), [procedure.testName])
  const section = sections.find((s) => s.id === activeSection) || sections[0]
  const defs = useMemo(() => {
    const all = findingsForSection(section?.id)
    const sorted = [...all].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
    if (!q.trim()) return sorted
    const t = q.toLowerCase()
    return sorted.filter((f) => f.label.toLowerCase().includes(t) || f.id.includes(t))
  }, [section, q])

  const sectionEntries = (procedure.entries || []).filter((e) => e.sectionId === section?.id)
  const selectedIds = new Set(sectionEntries.map((e) => e.findingId))
  const sectionNote = (procedure.sectionNotes || {})[section?.id] || ''

  if (!section) return null

  return (
    <div className="split" style={{ gridTemplateColumns: '250px 1fr' }}>
      <div className="panel">
        <div className="panel-head">
          <strong style={{ fontSize: 13 }}>Sections</strong>
        </div>
        <div className="panel-body">
          <SectionList procedure={procedure} activeSection={section.id} onSelect={onSelectSection} />
        </div>
        <div className="panel-foot tiny muted">
          A green tick means the section has been documented. A red chip means an abnormality was recorded there.
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <strong style={{ fontSize: 13.5 }}>{section.label}</strong>
          {section.group ? <span className="chip">{section.group}</span> : null}
          <div className="spacer" />
          {aiEnabled ? (
            <Button size="sm" icon={Sparkles} onClick={onAiReview} disabled={aiBusy} title="Ask the AI assistant to review the latest captured image">
              {aiBusy ? 'Reviewing…' : 'AI review'}
            </Button>
          ) : null}
        </div>

        <div className="panel-body">
          {section.hint ? (
            <div className="row small muted" style={{ gap: 7, marginBottom: 10 }}>
              <Info size={14} />
              <span>{section.hint}</span>
            </div>
          ) : null}

          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search size={15} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--ink-4)' }} />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search findings in this section…" style={{ paddingLeft: 30 }} />
          </div>

          <div className="finding-grid">
            {defs.map((f) => {
              const on = selectedIds.has(f.id)
              const entry = sectionEntries.find((e) => e.findingId === f.id)
              const hasFields = (f.fields || []).length > 0
              return (
                <div key={f.id} className={cx('finding', on && 'on')} style={hasFields && on ? { gridColumn: '1 / -1' } : undefined}>
                  <div
                    className="row"
                    style={{ gap: 8, cursor: 'pointer' }}
                    onClick={() => onToggleFinding(section.id, f.id)}
                  >
                    <span className={cx('checkbox', on && 'on')}>{on ? <Check size={11} strokeWidth={3} /> : null}</span>
                    <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{f.label}</span>
                    <SeverityChip severity={f.severity} />
                  </div>

                  {f.tags?.length ? (
                    <div className="row wrap" style={{ gap: 4 }}>
                      {f.tags.map((t) => (
                        <span key={t} className="tiny muted" style={{ background: 'var(--surface-3)', padding: '1px 6px', borderRadius: 20 }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {on && hasFields ? (
                    <div className="valuerow">
                      {f.fields.map((field) => (
                        <ValueField
                          key={field.key}
                          field={field}
                          value={entry?.values?.[field.key]}
                          onChange={(v) => onSetValue(section.id, f.id, field.key, v)}
                        />
                      ))}
                      <div className="valuefield">
                        <span>Note for the report</span>
                        <input
                          className="input"
                          value={entry?.notes || ''}
                          placeholder="Optional free text appended to this finding"
                          onChange={(e) => onSetNote(section.id, f.id, e.target.value)}
                        />
                      </div>
                      <div className="tiny muted" style={{ marginTop: 2 }}>
                        <strong>Report text:</strong> {f.phrase}
                      </div>
                      {f.impression ? (
                        <div className="tiny muted">
                          <strong>Impression:</strong> {f.impression}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
            {!defs.length ? <div className="small muted">No finding matches “{q}”.</div> : null}
          </div>

          <div style={{ marginTop: 18 }}>
            <div className="row" style={{ gap: 7, marginBottom: 6 }}>
              <StickyNote size={14} style={{ color: 'var(--warn)' }} />
              <strong style={{ fontSize: 13 }}>Extra free-text note for {section.label}</strong>
            </div>
            <Textarea
              value={sectionNote}
              onChange={(e) => onSetSectionNote(section.id, e.target.value)}
              placeholder="Anything the structured options do not cover — measured distances, additional description, comparison with a previous study…"
              style={{ minHeight: 70 }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
