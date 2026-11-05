/**
 * SessionPicker.jsx — choose which procedure the second pane should show.
 *
 * A patient is found by name / serial / MRN, and then either an existing report
 * is opened or a fresh one is started (OGD, colonoscopy, or both).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Stethoscope, FileText, Loader2, ArrowRight, Columns2 } from 'lucide-react'

import { api } from '../lib/api.js'
import { emptyProcedure } from '../lib/autoReport.js'
import { PROCEDURE_TYPES, procedureTypeFromLabel } from '../lib/anatomy.js'
import { Button, Chip, Empty, Input, Modal, ProcedureChip, useToast } from './ui.jsx'

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function SessionPicker({ open, onClose, onPick, onPickPair, openProcedureIds = [] }) {
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [patients, setPatients] = useState([])
  const [selected, setSelected] = useState(null)
  const [procedures, setProcedures] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setSearch('')
    setSelected(null)
    setProcedures([])
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const list = await api.patients.list(search, 40)
        if (!cancelled) setPatients(list || [])
      } catch {
        if (!cancelled) setPatients([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [open, search])

  const choosePatient = useCallback(async (pat) => {
    setSelected(pat)
    setProcedures([])
    try {
      const list = await api.procedures.list({ patientId: pat.id, limit: 100 })
      setProcedures(list || [])
    } catch {
      setProcedures([])
    }
  }, [])

  const startNew = useCallback(
    async (testName) => {
      if (!selected) return
      setBusy(true)
      try {
        const drafts = await api.procedures.list({ patientId: selected.id, testName, status: 'draft', limit: 100 })
        const sameDay = (drafts || []).find((p) => (p.procedureDate || '') === today())
        if (sameDay) {
          onPick(sameDay)
          onClose()
          return
        }
        const payload = {
          ...emptyProcedure(testName),
          procedureDate: today(),
          performingDoctor: selected.performingDoctor || '',
          assistant: selected.assistant || '',
          indication: selected.indication || '',
          medication: selected.medication || '',
          status: 'draft',
        }
        const saved = await api.procedures.save(selected.id, payload)
        onPick(saved)
        onClose()
      } catch (err) {
        toast.push({ tone: 'err', title: 'Could not start the procedure', body: err.message })
      } finally {
        setBusy(false)
      }
    },
    [selected, onPick, onClose, toast],
  )

  /** Endoscopy and colonoscopy for the same patient, one report each, side by side. */
  const startPair = useCallback(async () => {
    if (!selected) return
    setBusy(true)
    try {
      const made = []
      for (const testName of ['ogd', 'colonoscopy']) {
        // eslint-disable-next-line no-await-in-loop
        const drafts = await api.procedures.list({ patientId: selected.id, testName, status: 'draft', limit: 100 })
        const sameDay = (drafts || []).find((p) => (p.procedureDate || '') === today())
        if (sameDay) {
          made.push(sameDay)
          continue
        }
        // eslint-disable-next-line no-await-in-loop
        const saved = await api.procedures.save(selected.id, {
          ...emptyProcedure(testName),
          procedureDate: today(),
          performingDoctor: selected.performingDoctor || '',
          assistant: selected.assistant || '',
          indication: selected.indication || '',
          medication: selected.medication || '',
          status: 'draft',
        })
        made.push(saved)
      }
      onPickPair?.(made)
      onClose()
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not start the two reports', body: err.message })
    } finally {
      setBusy(false)
    }
  }, [selected, onPickPair, onClose, toast])

  return (
    <Modal open={open} title="Open a second session" onClose={onClose} width={760}>
      <div className="picker">
        <div className="picker-left">
          <div className="picker-search">
            <Search size={14} className="muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, serial no, MRN or phone…"
              autoFocus
            />
          </div>

          <div className="picker-list">
            {loading ? (
              <div className="center muted" style={{ padding: 28 }}>
                <Loader2 className="spin" size={18} />
              </div>
            ) : patients.length ? (
              patients.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  className={`picker-row${selected?.id === p.id ? ' on' : ''}`}
                  onClick={() => choosePatient(p)}
                >
                  <span className="serial-no">{p.serial || '—'}</span>
                  <span className="grow">
                    <span className="name">{p.name}</span>
                    <span className="sub">
                      {[p.age && `${p.age} ${p.ageUnit}`, p.sex, p.regNo && `MRN ${p.regNo}`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <ArrowRight size={14} className="muted" />
                </button>
              ))
            ) : (
              <Empty title="No patient found" hint="Check the spelling, or register the patient first." />
            )}
          </div>
        </div>

        <div className="picker-right">
          {!selected ? (
            <div className="picker-hint">
              <Stethoscope size={22} className="muted" />
              <p>Pick a patient to see their reports, or start a new one.</p>
            </div>
          ) : (
            <>
              <div className="picker-head">
                <div className="name">{selected.name}</div>
                <div className="sub">
                  {[selected.serial && `Serial ${selected.serial}`, selected.regNo && `MRN ${selected.regNo}`]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>

              <div className="picker-sub">Open an existing report</div>
              <div className="picker-reports">
                {procedures.length ? (
                  procedures.map((p) => {
                    const already = openProcedureIds.includes(p.id)
                    return (
                      <button
                        type="button"
                        key={p.id}
                        className="picker-report"
                        disabled={already || busy}
                        onClick={() => {
                          onPick(p)
                          onClose()
                        }}
                      >
                        <ProcedureChip testName={p.testName} />
                        <span className="small muted">{p.procedureDate || '—'}</span>
                        <Chip tone={p.reportStatus === 'final' ? 'ok' : 'warn'}>
                          {p.reportStatus === 'final' ? 'Final' : 'Draft'}
                        </Chip>
                        {already ? <span className="small muted">already open</span> : null}
                      </button>
                    )
                  })
                ) : (
                  <div className="small muted" style={{ padding: '6px 2px' }}>
                    No report yet for this patient.
                  </div>
                )}
              </div>

              <div className="picker-sub">Start a new report</div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {PROCEDURE_TYPES.filter((t) => t.id !== 'both').map((t) => (
                  <Button key={t.id} size="sm" icon={FileText} disabled={busy} onClick={() => startNew(t.id)}>
                    {t.label}
                  </Button>
                ))}
                <Button size="sm" variant="primary" icon={FileText} disabled={busy} onClick={() => startNew('both')}>
                  Both
                </Button>
                <Button size="sm" variant="success" icon={Columns2} disabled={busy} onClick={startPair}>
                  Endoscopy + colonoscopy, side by side
                </Button>
              </div>
              <p className="small muted" style={{ marginTop: 10 }}>
                A draft started today for the same test is reopened instead of duplicated.
              </p>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
