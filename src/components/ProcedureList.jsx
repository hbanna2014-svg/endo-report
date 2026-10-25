/**
 * ProcedureList.jsx — the report register: filter by type/status/date, open a
 * report, batch-export Word documents, print or delete.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Search,
  RefreshCw,
  FileText,
  Printer,
  Trash2,
  Download,
  Filter,
  ClipboardList,
  CalendarDays,
} from 'lucide-react'

import { api } from '../lib/api.js'
import { buildReportModel } from '../lib/reportModel.js'
import { buildPrintHtml } from '../lib/printHtml.js'
import { PROCEDURE_TYPES } from '../lib/anatomy.js'
import { Topbar } from './Dashboard.jsx'
import {
  Button,
  Card,
  Chip,
  ConfirmDialog,
  Empty,
  Input,
  Modal,
  ProcedureChip,
  Select,
  useToast,
} from './ui.jsx'

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'final', label: 'Final' },
]

/** Loads the model needed for Word/print without opening the workspace. */
async function buildModelForProcedure(procedureId, templates, clinic) {
  const proc = await api.procedures.get(procedureId)
  if (!proc) throw new Error('Report not found')
  const patient = await api.patients.get(proc.patientId)
  const template = templates.find((t) => t.isDefault) || templates[0] || null
  const merged = template ? { ...template, clinic: { ...(template.clinic || {}), ...(clinic || {}) } } : null
  return buildReportModel(patient, proc, merged)
}

export default function ProcedureList({ onOpenProcedure, onRefreshStats }) {
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [templates, setTemplates] = useState([])
  const [clinic, setClinic] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [testName, setTestName] = useState('all')
  const [status, setStatus] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState([])
  const [batchOpen, setBatchOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, tpl, c] = await Promise.all([
        api.procedures.list({ search, testName, status, from: from || null, to: to || null, limit: 1000 }),
        api.templates.list(),
        api.settings.get('clinic', null),
      ])
      setRows(list || [])
      setTemplates(tpl || [])
      setClinic(c)
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not load reports', body: err.message })
    } finally {
      setLoading(false)
    }
  }, [search, testName, status, from, to, toast])

  useEffect(() => {
    const t = setTimeout(load, 200)
    return () => clearTimeout(t)
  }, [load])

  const summary = useMemo(() => {
    const drafts = rows.filter((r) => r.reportStatus !== 'final').length
    return { total: rows.length, drafts, final: rows.length - drafts }
  }, [rows])

  const exportDocx = async (row) => {
    setBusyId(row.id)
    try {
      const model = await buildModelForProcedure(row.id, templates, clinic)
      const res = await api.report.exportDocx(model)
      if (res.ok) toast.push({ tone: 'ok', title: 'Word report exported', body: res.filePath })
      else if (!res.cancelled) toast.push({ tone: 'err', title: 'Export failed' })
    } catch (err) {
      toast.push({ tone: 'err', title: 'Export failed', body: err.message })
    } finally {
      setBusyId(null)
    }
  }

  const printRow = async (row) => {
    setBusyId(row.id)
    try {
      const model = await buildModelForProcedure(row.id, templates, clinic)
      const media = await Promise.all(
        (model.media || []).map(async (m) => {
          if (m.kind !== 'image') return m
          try {
            const { dataUrl } = await api.app.readFileAsDataUrl(m.filePath)
            return { ...m, dataUrl }
          } catch {
            return m
          }
        }),
      )
      const html = buildPrintHtml({ ...model, media })
      const res = await api.report.print(html, `${model.reportNo} — ${model.patientLine.name}`)
      if (res?.ok === false && res.reason) toast.push({ tone: 'warn', title: 'Printing did not complete', body: res.reason })
    } catch (err) {
      toast.push({ tone: 'err', title: 'Printing failed', body: err.message })
    } finally {
      setBusyId(null)
    }
  }

  const runBatch = async () => {
    setBatchOpen(false)
    const targets = selectMode ? checked : rows.map((r) => r.id)
    if (!targets.length) {
      toast.push({ tone: 'warn', title: 'Nothing selected' })
      return
    }
    try {
      const models = []
      for (const id of targets) {
        // eslint-disable-next-line no-await-in-loop
        models.push(await buildModelForProcedure(id, templates, clinic))
      }
      const res = await api.report.exportBatch(models)
      if (res.ok) toast.push({ tone: 'ok', title: `${res.count} Word reports exported`, body: res.folder })
      else if (!res.cancelled) toast.push({ tone: 'err', title: 'Batch export failed' })
    } catch (err) {
      toast.push({ tone: 'err', title: 'Batch export failed', body: err.message })
    }
  }

  const removeRow = async () => {
    if (!confirmDelete) return
    try {
      await api.procedures.remove(confirmDelete.id)
      toast.push({ tone: 'ok', title: 'Report deleted' })
      setConfirmDelete(null)
      await load()
      onRefreshStats?.()
    } catch (err) {
      toast.push({ tone: 'err', title: 'Delete failed', body: err.message })
    }
  }

  const toggleChecked = (id) =>
    setChecked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))

  return (
    <>
      <Topbar title="Reports" crumb={`${summary.total} report(s) · ${summary.drafts} draft · ${summary.final} final`}>
        <div className="row" style={{ gap: 8 }}>
          <Button
            size="sm"
            icon={Filter}
            variant={selectMode ? 'primary' : 'default'}
            onClick={() => {
              setSelectMode((v) => !v)
              setChecked([])
            }}
          >
            {selectMode ? 'Selecting' : 'Select'}
          </Button>
          <Button size="sm" icon={Download} onClick={() => setBatchOpen(true)}>
            Export all to Word
          </Button>
          <Button size="sm" icon={RefreshCw} onClick={load} disabled={loading} />
        </div>
      </Topbar>

      <div className="content">
        <Card bodyClass="tight">
          <div className="row wrap" style={{ gap: 10 }}>
            <div style={{ position: 'relative', flex: '1 1 240px' }}>
              <Search size={15} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--ink-4)' }} />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search patient name or registration number…"
                style={{ paddingLeft: 30 }}
              />
            </div>
            <Select
              value={testName}
              onChange={(e) => setTestName(e.target.value)}
              options={[{ value: 'all', label: 'All procedures' }, ...PROCEDURE_TYPES.map((t) => ({ value: t.id, label: t.label }))]}
              style={{ width: 230 }}
            />
            <Select value={status} onChange={(e) => setStatus(e.target.value)} options={STATUS_OPTIONS} style={{ width: 150 }} />
            <div className="row" style={{ gap: 6 }}>
              <CalendarDays size={15} className="muted" />
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
              <span className="muted small">to</span>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
            </div>
            {(search || testName !== 'all' || status !== 'all' || from || to) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearch('')
                  setTestName('all')
                  setStatus('all')
                  setFrom('')
                  setTo('')
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </Card>

        <div style={{ marginTop: 16 }}>
          <Card bodyClass="tight">
            {rows.length ? (
              <table className="table">
                <thead>
                  <tr>
                    {selectMode ? <th style={{ width: 40 }} /> : null}
                    <th>Patient</th>
                    <th>Procedure</th>
                    <th>Date</th>
                    <th>Endoscopist</th>
                    <th>Status</th>
                    <th style={{ width: 210 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={checked.includes(r.id) ? 'sel' : ''}>
                      {selectMode ? (
                        <td onClick={() => toggleChecked(r.id)}>
                          <span className={`checkbox ${checked.includes(r.id) ? 'on' : ''}`} />
                        </td>
                      ) : null}
                      <td onClick={() => onOpenProcedure(r.id, r.patientId)}>
                        <div className="name">{r.patientName}</div>
                        <div className="sub">
                          {[r.patientAge && `${r.patientAge} y`, r.patientSex, r.patientReg].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td onClick={() => onOpenProcedure(r.id, r.patientId)}>
                        <ProcedureChip testName={r.testName} />
                      </td>
                      <td className="small" onClick={() => onOpenProcedure(r.id, r.patientId)}>
                        {r.procedureDate || '—'}
                      </td>
                      <td className="small" onClick={() => onOpenProcedure(r.id, r.patientId)}>
                        {r.performingDoctor || '—'}
                      </td>
                      <td onClick={() => onOpenProcedure(r.id, r.patientId)}>
                        <Chip tone={r.reportStatus === 'final' ? 'ok' : 'warn'}>{r.reportStatus === 'final' ? 'Final' : 'Draft'}</Chip>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 5 }}>
                          <Button size="sm" icon={FileText} onClick={() => onOpenProcedure(r.id, r.patientId)}>
                            Open
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={Download}
                            title="Export to Microsoft Word"
                            disabled={busyId === r.id}
                            onClick={() => exportDocx(r)}
                          />
                          <Button size="sm" variant="ghost" icon={Printer} title="Print" disabled={busyId === r.id} onClick={() => printRow(r)} />
                          <Button size="sm" variant="ghost" icon={Trash2} title="Delete" onClick={() => setConfirmDelete(r)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty
                icon={ClipboardList}
                title={loading ? 'Loading reports…' : 'No reports match these filters'}
                hint={loading ? '' : 'Adjust the filters, or register a patient and start a new procedure.'}
              />
            )}
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete report"
        message={`Delete the report for ${confirmDelete?.patientName || ''} (${confirmDelete?.procedureDate || ''})?`}
        detail="Captured images and videos belonging to this report will also be deleted."
        confirmLabel="Delete report"
        onConfirm={removeRow}
        onCancel={() => setConfirmDelete(null)}
      />

      <Modal
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        title="Export reports to Microsoft Word"
        footer={
          <>
            <Button onClick={() => setBatchOpen(false)}>Cancel</Button>
            <Button variant="primary" icon={Download} onClick={runBatch}>
              Choose folder &amp; export
            </Button>
          </>
        }
      >
        <p style={{ marginTop: 0 }}>
          {selectMode && checked.length
            ? `${checked.length} selected report(s) will be exported.`
            : `All ${rows.length} report(s) currently listed will be exported.`}
        </p>
        <p className="small muted">
          You will be asked to choose a folder. A new sub-folder is created inside it and each report is written as a
          separate <span className="mono">.docx</span> file. Captured images are embedded into the Word document.
        </p>
      </Modal>
    </>
  )
}
