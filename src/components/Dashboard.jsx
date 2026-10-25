/**
 * Dashboard.jsx — clinic landing screen: volume at a glance, recent reports
 * and the fastest route into a new procedure.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  UserPlus,
  FolderOpen,
  DatabaseBackup,
  RefreshCw,
  Camera,
  Video,
  FileText,
  Image as ImageIcon,
  ClipboardList,
  Users,
  TrendingUp,
  ArrowRight,
  BarChart3,
  CalendarDays,
} from 'lucide-react'

import { api } from '../lib/api.js'
import { Button, Card, Chip, Empty, Input, ProcedureChip, Stat, useToast } from './ui.jsx'

function Topbar({ title, crumb, children }) {
  return (
    <header className="topbar">
      <div>
        <h2>{title}</h2>
        {crumb ? <div className="crumb">{crumb}</div> : null}
      </div>
      <div className="topbar-actions">{children}</div>
    </header>
  )
}

function DayBreakdown({ row }) {
  const items = [
    { label: 'Endoscopy', value: row.endoscopy || 0, tone: 'blue' },
    { label: 'Colonoscopy', value: row.colonoscopy || 0, tone: 'teal' },
    { label: 'Both', value: row.both || 0, tone: 'violet' },
    { label: 'Polypectomy', value: row.polypectomy || 0, tone: 'amber' },
    { label: 'Biopsy', value: row.biopsy || 0, tone: 'rose' },
  ]
  return (
    <div className="day-breakdown">
      {items.map((i) => (
        <div key={i.label} className={`day-stat tone-${i.tone}`}>
          <b>{i.value}</b>
          <span>{i.label}</span>
        </div>
      ))}
      <div className="day-stat tone-total">
        <b>{row.total || 0}</b>
        <span>Total</span>
      </div>
    </div>
  )
}

function MiniChart({ daily, selected, onSelect }) {
  const points = useMemo(() => {
    const map = new Map((daily || []).map((d) => [String(d.day || d.d).slice(0, 10), d.total ?? d.c ?? 0]))
    const out = []
    const today = new Date()
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date(today.getTime() - i * 86400000)
      const key = d.toISOString().slice(0, 10)
      out.push({ key, count: map.get(key) || 0 })
    }
    return out
  }, [daily])

  const max = Math.max(1, ...points.map((p) => p.count))
  const w = 660
  const h = 110
  const step = w / points.length

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="110" preserveAspectRatio="none" role="img" aria-label="Procedures over the last 30 days">
        {points.map((p, i) => {
          const barH = (p.count / max) * (h - 18)
          const isSelected = selected === p.key
          return (
            <g key={p.key} style={{ cursor: 'pointer' }} onClick={() => onSelect?.(p.key)}>
              <title>{`${p.key}: ${p.count} procedure${p.count === 1 ? '' : 's'}`}</title>
              <rect x={i * step + 2} y={0} width={Math.max(2, step - 4)} height={h} fill="transparent" />
              <rect
                x={i * step + 2}
                y={h - barH - 2}
                width={Math.max(2, step - 4)}
                height={Math.max(p.count ? 2 : 1, barH)}
                rx="2"
                fill={isSelected ? '#0f766e' : p.count ? 'url(#g1)' : '#e2e8f0'}
              />
            </g>
          )
        })}
        <defs>
          <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
        </defs>
      </svg>
      <div className="row between tiny muted" style={{ marginTop: 4 }}>
        <span>{points[0]?.key}</span>
        <span>
          Peak day: {max} procedure{max === 1 ? '' : 's'}
        </span>
        <span>Today</span>
      </div>
    </div>
  )
}

export default function Dashboard({ stats, meta, clinic, onNavigate, onOpenProcedure, onRefresh }) {
  const toast = useToast()
  const [recent, setRecent] = useState([])
  const [rows, setRows] = useState([])
  const [consultants, setConsultants] = useState([])
  const [loading, setLoading] = useState(true)
  const todayKey = new Date().toISOString().slice(0, 10)
  const [selectedDate, setSelectedDate] = useState(todayKey)
  const [consultQuery, setConsultQuery] = useState('')
  const [consultant, setConsultant] = useState('')
  const [consultPros, setConsultPros] = useState([])
  const [consultLoading, setConsultLoading] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [dayPatients, setDayPatients] = useState([])
  const [dayLoading, setDayLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const counts = await api.data.counts(30)
      setRows(counts?.daily || [])
      setConsultants(counts?.consultants || [])
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not load recent activity', body: err.message })
    } finally {
      setLoading(false)
    }
  }, [toast])

  /** The patients booked / examined on the chosen date. */
  useEffect(() => {
    let cancelled = false
    setDayLoading(true)
    api.procedures
      .list({ from: selectedDate, to: selectedDate, limit: 300 })
      .then((list) => {
        if (!cancelled) setDayPatients(list || [])
      })
      .catch(() => {
        if (!cancelled) setDayPatients([])
      })
      .finally(() => {
        if (!cancelled) setDayLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedDate])

  /** Everything the chosen consultant has performed. */
  useEffect(() => {
    if (!consultant) {
      setConsultPros([])
      return undefined
    }
    let cancelled = false
    setConsultLoading(true)
    api.procedures
      .list({ doctor: consultant, limit: 200 })
      .then((list) => {
        if (!cancelled) setConsultPros(list || [])
      })
      .catch((err) => toast.push({ tone: 'err', title: 'Could not load the consultant', body: err.message }))
      .finally(() => {
        if (!cancelled) setConsultLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [consultant, toast])

  useEffect(() => {
    load()
  }, [load])

  const empty = !stats || (stats.patients === 0 && stats.procedures === 0)

  const prettyDate = (iso) => {
    const d = new Date(`${iso}T00:00:00`)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
  }

  const dayKeyOf = (r) => String(r.day || '').slice(0, 10)
  const dayRow =
    rows.find((r) => dayKeyOf(r) === selectedDate) || {
      total: 0, endoscopy: 0, colonoscopy: 0, both: 0, polypectomy: 0, biopsy: 0,
    }
  const lastSeven = rows.slice(-7).reverse()
  const maxTotal = Math.max(1, ...lastSeven.map((r) => r.total || 0))
  const filteredConsultants = consultants.filter((c) =>
    String(c.doctor || '').toLowerCase().includes(consultQuery.trim().toLowerCase()),
  )

  const consultantCard = (
            <Card
              title="Consultant"
              subtitle="Search a name and tick it to see all their procedures"
              actions={
                consultant ? (
                  <Button size="sm" onClick={() => setConsultant('')}>
                    Clear
                  </Button>
                ) : null
              }
            >
              <Input
                value={consultQuery}
                onChange={(e) => setConsultQuery(e.target.value)}
                placeholder="Search consultant…"
              />
              <div className="consult-list">
                {filteredConsultants.length ? (
                  filteredConsultants.map((c) => {
                    const on = consultant === c.doctor
                    return (
                      <label key={c.doctor} className={`consult-item${on ? ' on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => setConsultant(on ? '' : c.doctor)}
                        />
                        <span className="nm">{c.doctor}</span>
                        <span className="ct">{c.total}</span>
                      </label>
                    )
                  })
                ) : (
                  <div className="small muted" style={{ padding: '10px 2px' }}>
                    {consultants.length ? 'No consultant matches that search.' : 'No procedures recorded yet.'}
                  </div>
                )}
              </div>

              {consultant ? (
                <div className="consult-results">
                  <div className="consult-head">
                    {consultant}
                    <span>{consultLoading ? 'loading…' : `${consultPros.length} procedure(s)`}</span>
                  </div>
                  {consultPros.slice(0, 60).map((p) => (
                    <button key={p.id} className="consult-row" onClick={() => onOpenProcedure(p.id, p.patientId)}>
                      <span className="d">{(p.procedureDate || '').slice(0, 10) || '—'}</span>
                      <span className="n">{p.patientName}</span>
                      <ProcedureChip testName={p.testName} />
                    </button>
                  ))}
                  {!consultPros.length && !consultLoading ? (
                    <div className="small muted" style={{ padding: 8 }}>
                      Nothing recorded for this consultant yet.
                    </div>
                  ) : null}
                </div>
              ) : null}
            </Card>
  )

  return (
    <>
      <Topbar
        title="Dashboard"
        crumb={`${clinic?.name || 'Clinic'} · ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
      >
        <Button
          icon={BarChart3}
          size="sm"
          variant={showStats ? 'primary' : 'default'}
          onClick={() => setShowStats((v) => !v)}
        >
          Last 30 days
        </Button>
        <Button icon={RefreshCw} size="sm" onClick={() => { load(); onRefresh?.() }} disabled={loading}>
          Refresh
        </Button>
      </Topbar>

      <div className="content">
        <div className="hero">
          <div>
            <h1>Endoscopy &amp; colonoscopy reporting, entirely offline</h1>
            <p>
              Register the patient, document the procedure section by section, capture images and video, then print or
              export a Word report — all without an internet connection.
            </p>
          </div>
          <div className="actions">
            <Button className="solid" icon={UserPlus} onClick={() => onNavigate('patients')}>
              New patient
            </Button>
            <Button icon={ClipboardList} onClick={() => onNavigate('procedures')}>
              All reports
            </Button>
            <Button icon={DatabaseBackup} onClick={() => onNavigate('backup')}>
              Backup
            </Button>
          </div>
        </div>

        {empty ? (
          <div style={{ marginTop: 16 }}>
            <Card title="Getting started" subtitle="Four steps and you have your first report">
              <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9, fontSize: 13.5 }}>
                <li>Open <strong>Settings</strong> and enter your clinic name, address, doctor name and logo.</li>
                <li>Go to <strong>Patients</strong> and register the patient with name, age, sex and referring doctor.</li>
                <li>Start a procedure — choose <em>Upper GI Endoscopy</em>, <em>Colonoscopy</em> or <em>Both</em>.</li>
                <li>Work through the sections, capture images, review the auto-generated impression, then print or export to Word.</li>
              </ol>
            </Card>
          </div>
        ) : null}

        <div className="grid c4" style={{ marginTop: 16 }}>
          <Stat label="Patients" value={stats?.patients ?? 0} detail="Registered records" tone="" />
          <Stat label="Reports" value={stats?.procedures ?? 0} detail={`${stats?.drafts ?? 0} still in draft`} tone="teal" />
          <Stat label="Images" value={stats?.images ?? 0} detail="Captured endoscopy stills" tone="amber" />
          <Stat label="Videos" value={stats?.videos ?? 0} detail="Recorded clips" tone="violet" />
        </div>

        <div className={`dash-body${showStats ? ' with-stats' : ''}`} style={{ marginTop: 16 }}>
          {showStats ? (
          <aside className="dash-left">
            {showStats ? (
              <Card
                title="Procedures in the last 30 days"
                subtitle="Pick a date to see exactly what was done"
                actions={
                  <input
                    type="date"
                    className="dash-date"
                    value={selectedDate}
                    max={todayKey}
                    onChange={(e) => setSelectedDate(e.target.value)}
                  />
                }
              >
                <DayBreakdown row={dayRow} />
                {rows.length ? (
                  <MiniChart daily={rows} selected={selectedDate} onSelect={setSelectedDate} />
                ) : (
                  <div className="small muted">No procedures recorded in this period.</div>
                )}
                <div className="day-list">
                  <div className="day-list-head">
                    <span>Last 7 days</span>
                    <span>Total</span>
                  </div>
                  {lastSeven.map((r) => (
                    <button
                      key={r.day}
                      className={`day-row${selectedDate === r.day ? ' on' : ''}`}
                      onClick={() => setSelectedDate(r.day)}
                    >
                      <span className="d">{r.day}</span>
                      <span className="mini">
                        <i style={{ width: `${Math.max(4, (r.total / maxTotal) * 100)}%` }} />
                      </span>
                      <span className="t">{r.total}</span>
                    </button>
                  ))}
                </div>
              </Card>
            ) : null}

            {consultantCard}
          </aside>
          ) : null}

          <section className="dash-main">
            <Card
              title={`Patients — ${prettyDate(selectedDate)}`}
              subtitle={dayLoading ? 'Loading…' : `${dayPatients.length} patient(s) on this date`}
              actions={
                <input
                  type="date"
                  className="dash-date"
                  value={selectedDate}
                  max={todayKey}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              }
              bodyClass="tight"
            >
              {dayPatients.length ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Patient</th>
                      <th>Procedure</th>
                      <th>Doctor</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {dayPatients.map((p) => (
                      <tr key={p.id} onClick={() => onOpenProcedure(p.id, p.patientId)}>
                        <td>
                          <div className="name">{p.patientName}</div>
                          <div className="sub">
                            {[p.patientAge && `${p.patientAge} y`, p.patientSex, p.patientReg]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        </td>
                        <td>
                          <ProcedureChip testName={p.testName} />
                        </td>
                        <td className="small">{p.performingDoctor || '—'}</td>
                        <td>
                          <Chip tone={p.reportStatus === 'final' ? 'ok' : 'warn'}>
                            {p.reportStatus === 'final' ? 'Final' : 'Draft'}
                          </Chip>
                        </td>
                        <td className="small muted nowrap">
                          <ArrowRight size={14} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty
                  icon={CalendarDays}
                  title="No patients on this date"
                  hint="Pick another date, or register a patient to start a report."
                  action={
                    <Button variant="primary" icon={UserPlus} onClick={() => onNavigate('patients')}>
                      New patient
                    </Button>
                  }
                />
              )}
            </Card>
          </section>

          {showStats ? null : consultantCard}
        </div>

        <div className="grid c3" style={{ marginTop: 16 }}>
          <Card title="Upper GI endoscopy" icon={Camera}>
            <div className="small muted" style={{ lineHeight: 1.7 }}>
              <div>Oesophagus → GE junction → Fundus → Body → Antrum → Pylorus → D1 → D2</div>
              <div style={{ marginTop: 8 }}>
                <Chip tone="ogd"><Users size={11} /> 8 sections</Chip>{' '}
                <Chip tone="info"><Video size={11} /> Image &amp; video capture</Chip>
              </div>
            </div>
          </Card>
          <Card title="Colonoscopy" icon={Camera}>
            <div className="small muted" style={{ lineHeight: 1.7 }}>
              <div>Rectum → Sigmoid → Descending → Splenic flexure → Transverse → Hepatic flexure → Ascending → Caecum</div>
              <div style={{ marginTop: 8 }}>
                <Chip tone="colon">11 sections</Chip>{' '}
                <Chip tone="info">BBPS scoring</Chip>
              </div>
            </div>
          </Card>
          <Card title="Automatic report" icon={FileText}>
            <div className="small muted" style={{ lineHeight: 1.7 }}>
              Ticked findings generate the narrative, the impression and the follow-up plan. The audit panel flags anything
              that is missing or contradictory before you finalise.
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}

export { Topbar }
