/**
 * PatientList.jsx — searchable patient register with a detail panel and the
 * entry point for starting a new procedure.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Search,
  UserPlus,
  Pencil,
  Trash2,
  PlayCircle,
  Phone,
  MapPin,
  Stethoscope,
  ClipboardList,
  RefreshCw,
  FileText,
} from 'lucide-react'

import { api } from '../lib/api.js'
import { emptyProcedure } from '../lib/autoReport.js'
import { PROCEDURE_TYPES } from '../lib/anatomy.js'
import { Topbar } from './Dashboard.jsx'
import PatientForm from './PatientForm.jsx'
import {
  Button,
  Card,
  Chip,
  ConfirmDialog,
  Empty,
  Field,
  Input,
  Modal,
  ProcedureChip,
  Select,
  useToast,
} from './ui.jsx'

function today() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}

function StartProcedureDialog({ open, patient, doctors, onClose, onStarted }) {
  const toast = useToast()
  const [testName, setTestName] = useState('ogd')
  const [date, setDate] = useState(today())
  const [doctor, setDoctor] = useState('')
  const [assistant, setAssistant] = useState('')
  const [scope, setScope] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTestName('ogd')
    setDate(today())
    setDoctor(patient?.performingDoctor || '')
    setAssistant(patient?.assistant || '')
    setScope('')
  }, [open, patient])

  const start = async () => {
    if (!patient) return
    setBusy(true)
    try {
      const payload = {
        ...emptyProcedure(testName),
        procedureDate: date,
        performingDoctor: doctor,
        assistant,
        scopeModel: scope,
        indication: patient.indication || '',
        status: 'draft',
      }
      const saved = await api.procedures.save(patient.id, payload)
      toast.push({ tone: 'ok', title: 'Report started', body: `${PROCEDURE_TYPES.find((t) => t.id === testName)?.label}` })
      onStarted?.(saved)
      onClose?.()
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not start the procedure', body: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Start a procedure — ${patient?.name || ''}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={PlayCircle} onClick={start} disabled={busy}>
            {busy ? 'Creating…' : 'Start report'}
          </Button>
        </>
      }
    >
      <div className="grid c2">
        <Field label="Type of procedure" required>
          <Select value={testName} onChange={(e) => setTestName(e.target.value)} options={PROCEDURE_TYPES.map((t) => ({ value: t.id, label: t.label }))} />
        </Field>
        <Field label="Date of procedure" required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Performing endoscopist">
          <Input value={doctor} onChange={(e) => setDoctor(e.target.value)} list="doctor-list-2" placeholder="Operator" />
        </Field>
        <Field label="Assistant">
          <Input value={assistant} onChange={(e) => setAssistant(e.target.value)} list="doctor-list-2" placeholder="Assistant" />
        </Field>
        <Field label="Scope / equipment used" className="c2">
          <Input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="e.g. Olympus GIF-HQ190, Pentax EC-3890Fi" />
        </Field>
        <datalist id="doctor-list-2">
          {doctors.map((d) => (
            <option key={d.id} value={d.name} />
          ))}
        </datalist>
      </div>
      <div className="banner info" style={{ marginTop: 14 }}>
        <ClipboardList size={17} style={{ flex: '0 0 17px', marginTop: 1 }} />
        <div className="small">
          Choosing <strong>Both</strong> creates a single report covering upper GI endoscopy and colonoscopy together — useful
          for a combined panendoscopy case.
        </div>
      </div>
    </Modal>
  )
}

export default function PatientList({ doctors, onOpenProcedure, onGoToWorkspace, onRefreshStats }) {
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [procedures, setProcedures] = useState([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [startOpen, setStartOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) || null, [rows, selectedId])

  const load = useCallback(
    async (term = search) => {
      setLoading(true)
      try {
        const list = await api.patients.list(term, 500)
        setRows(list || [])
        if (!selectedId && list?.length) setSelectedId(list[0].id)
        if (selectedId && !list.some((r) => r.id === selectedId)) setSelectedId(list?.[0]?.id || null)
      } catch (err) {
        toast.push({ tone: 'err', title: 'Could not load patients', body: err.message })
      } finally {
        setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast],
  )

  useEffect(() => {
    load('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const t = setTimeout(() => load(search), 220)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const loadProcedures = useCallback(
    async (patientId) => {
      if (!patientId) {
        setProcedures([])
        return
      }
      try {
        const list = await api.procedures.list({ patientId, limit: 200 })
        setProcedures(list || [])
      } catch (err) {
        toast.push({ tone: 'err', title: 'Could not load this patient\u2019s reports', body: err.message })
      }
    },
    [toast],
  )

  useEffect(() => {
    loadProcedures(selectedId)
  }, [selectedId, loadProcedures])

  const removePatient = async () => {
    if (!confirmDelete) return
    try {
      await api.patients.remove(confirmDelete.id)
      toast.push({ tone: 'ok', title: 'Patient deleted', body: `${confirmDelete.name} and all related reports were removed.` })
      setConfirmDelete(null)
      setSelectedId(null)
      await load(search)
      onRefreshStats?.()
    } catch (err) {
      toast.push({ tone: 'err', title: 'Delete failed', body: err.message })
    }
  }

  return (
    <>
      <Topbar title="Patients" crumb={`${rows.length} record${rows.length === 1 ? '' : 's'}`}>
        <div className="row" style={{ gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--ink-4)' }} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, reg. no, phone…"
              style={{ paddingLeft: 30, width: 260 }}
            />
          </div>
          <Button icon={RefreshCw} size="sm" onClick={() => load(search)} disabled={loading} />
          <Button
            variant="primary"
            icon={UserPlus}
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            New patient
          </Button>
        </div>
      </Topbar>

      <div className="content">
        <div className="split" style={{ gridTemplateColumns: '1.35fr 1fr' }}>
          <div className="panel" style={{ gridColumn: 'span 2', display: 'block', overflow: 'hidden' }}>
            <div className="panel-head">
              <strong style={{ fontSize: 13.5 }}>Patient register</strong>
              <div className="spacer" />
              <span className="small muted">{loading ? 'Loading…' : `${rows.length} shown`}</span>
            </div>
            {rows.length ? (
              <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 210px)' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 56 }} />
                      <th>Patient</th>
                      <th>Registration</th>
                      <th>Age / Sex</th>
                      <th>Contact</th>
                      <th>Referred by</th>
                      <th>Reports</th>
                      <th style={{ width: 130 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className={selectedId === r.id ? 'sel' : ''} onClick={() => setSelectedId(r.id)}>
                        <td>
                          <div className={`avatar ${r.sex === 'Female' ? 'f' : ''}`}>{initials(r.name)}</div>
                        </td>
                        <td>
                          <div className="name">{r.name}</div>
                          <div className="sub">{r.indication ? <span className="two-line">{r.indication}</span> : '—'}</div>
                        </td>
                        <td className="small mono">{r.regNo || '—'}</td>
                        <td className="small">{[r.age && `${r.age} ${r.ageUnit || 'y'}`, r.sex].filter(Boolean).join(' / ') || '—'}</td>
                        <td className="small">{r.phone || '—'}</td>
                        <td className="small">{r.referredBy || '—'}</td>
                        <td>
                          <Chip tone={r.procedureCount ? 'brand' : ''}>{r.procedureCount || 0}</Chip>
                        </td>
                        <td>
                          <div className="row" style={{ gap: 5 }}>
                            <Button
                              size="sm"
                              variant="primary"
                              icon={PlayCircle}
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedId(r.id)
                                setStartOpen(true)
                              }}
                            >
                              New report
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={Pencil}
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditing(r)
                                setFormOpen(true)
                              }}
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={Trash2}
                              onClick={(e) => {
                                e.stopPropagation()
                                setConfirmDelete(r)
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                icon={UserPlus}
                title={search ? 'No patient matches that search' : 'No patients registered yet'}
                hint={search ? 'Try a different name, registration number or phone number.' : 'Register your first patient to begin.'}
                action={
                  <Button
                    variant="primary"
                    icon={UserPlus}
                    onClick={() => {
                      setEditing(null)
                      setFormOpen(true)
                    }}
                  >
                    Register patient
                  </Button>
                }
              />
            )}
          </div>
        </div>

        {selected ? (
          <div className="grid c2" style={{ marginTop: 16 }}>
            <Card
              title={selected.name}
              subtitle={`${selected.regNo || ''} · ${[selected.age && `${selected.age} ${selected.ageUnit}`, selected.sex].filter(Boolean).join(' / ')}`}
              actions={
                <Button
                  size="sm"
                  variant="primary"
                  icon={PlayCircle}
                  onClick={() => setStartOpen(true)}
                >
                  New report
                </Button>
              }
            >
              <div className="kv">
                <span className="k">Contact</span>
                <span><Phone size={13} className="muted" /> {selected.phone || '—'}</span>
                <span className="k">Address</span>
                <span><MapPin size={13} className="muted" /> {selected.address || '—'}</span>
                <span className="k">Referred by</span>
                <span>{selected.referredBy || '—'}</span>
                <span className="k">Performing doctor</span>
                <span><Stethoscope size={13} className="muted" /> {selected.performingDoctor || '—'}</span>
                <span className="k">Allergy</span>
                <span>{selected.allergy || '—'}</span>
                <span className="k">Medication</span>
                <span>{selected.medication || '—'}</span>
                <span className="k">Indication</span>
                <span>{selected.indication || '—'}</span>
                <span className="k">History</span>
                <span>{selected.history || '—'}</span>
                <span className="k">Notes</span>
                <span>{selected.notes || '—'}</span>
              </div>
            </Card>

            <Card title="Reports for this patient" subtitle={`${procedures.length} report(s)`} bodyClass="tight">
              {procedures.length ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Procedure</th>
                      <th>Date</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {procedures.map((p) => (
                      <tr key={p.id} onClick={() => onOpenProcedure(p.id, selected.id)}>
                        <td>
                          <ProcedureChip testName={p.testName} />
                          <div className="sub">{p.performingDoctor || ''}</div>
                        </td>
                        <td className="small">{p.procedureDate || '—'}</td>
                        <td>
                          <Chip tone={p.reportStatus === 'final' ? 'ok' : 'warn'}>{p.reportStatus === 'final' ? 'Final' : 'Draft'}</Chip>
                        </td>
                        <td className="small muted nowrap">
                          <FileText size={14} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty icon={ClipboardList} title="No reports yet" hint="Use “New report” to start the first procedure." />
              )}
            </Card>
          </div>
        ) : null}
      </div>

      <PatientForm
        open={formOpen}
        patient={editing}
        doctors={doctors}
        onClose={() => setFormOpen(false)}
        onSaved={async (saved) => {
          await load(search)
          setSelectedId(saved.id)
          onRefreshStats?.()
        }}
      />

      <StartProcedureDialog
        open={startOpen}
        patient={selected}
        doctors={doctors}
        onClose={() => setStartOpen(false)}
        onStarted={(saved) => {
          onGoToWorkspace?.(saved.patientId, saved.id)
          onRefreshStats?.()
        }}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete patient record"
        message={`Delete ${confirmDelete?.name || ''} permanently?`}
        detail="Every report, image and video belonging to this patient will also be deleted. This cannot be undone."
        confirmLabel="Delete permanently"
        onConfirm={removePatient}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  )
}
