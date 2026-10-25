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
} from 'lucide-react'

import { api } from '../lib/api.js'
import { Button, Card, Chip, Empty, ProcedureChip, Stat, useToast } from './ui.jsx'

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

function MiniChart({ daily }) {
  const points = useMemo(() => {
    const map = new Map((daily || []).map((d) => [String(d.d).slice(0, 10), d.c]))
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
          return (
            <rect
              key={p.key}
              x={i * step + 2}
              y={h - barH - 2}
              width={Math.max(2, step - 4)}
              height={Math.max(p.count ? 2 : 1, barH)}
              rx="2"
              fill={p.count ? 'url(#g1)' : '#e2e8f0'}
            />
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
  const [daily, setDaily] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, maint] = await Promise.all([
        api.procedures.list({ limit: 8 }),
        api.data.maintenance(30),
      ])
      setRecent(list || [])
      setDaily(maint?.daily || [])
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not load recent activity', body: err.message })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const empty = !stats || (stats.patients === 0 && stats.procedures === 0)

  return (
    <>
      <Topbar
        title="Dashboard"
        crumb={`${clinic?.name || 'Clinic'} · ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
      >
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

        <div className="grid c2" style={{ marginTop: 16 }}>
          <Card title="Procedures in the last 30 days" subtitle="Daily case volume">
            {daily.length ? <MiniChart daily={daily} /> : <div className="small muted">No procedures recorded in this period.</div>}
          </Card>

          <Card title="Quick actions">
            <div className="grid c2">
              <Button icon={UserPlus} onClick={() => onNavigate('patients')} className="lg">
                Register patient
              </Button>
              <Button icon={FolderOpen} onClick={() => onNavigate('procedures')} className="lg">
                Browse reports
              </Button>
              <Button icon={Camera} onClick={() => onNavigate('workspace')} className="lg">
                Capture images
              </Button>
              <Button icon={FileText} onClick={() => onNavigate('templates')} className="lg">
                Edit template
              </Button>
            </div>
            <div className="banner info" style={{ marginTop: 14 }}>
              <TrendingUp size={17} style={{ flex: '0 0 17px', marginTop: 1 }} />
              <div className="small">
                Everything is stored on this computer in <strong className="mono">{meta?.dataDir || 'your documents folder'}</strong>. Take a
                backup regularly — the <strong>Backup &amp; restore</strong> screen writes a complete copy you can keep on a USB drive.
              </div>
            </div>
          </Card>
        </div>

        <div style={{ marginTop: 16 }}>
          <Card
            title="Recent reports"
            subtitle={loading ? 'Loading…' : `${recent.length} shown`}
            actions={
              <Button size="sm" variant="ghost" icon={ArrowRight} onClick={() => onNavigate('procedures')}>
                View all
              </Button>
            }
            bodyClass="tight"
          >
            {recent.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Procedure</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recent.map((p) => (
                    <tr key={p.id} onClick={() => onOpenProcedure(p.id, p.patientId)}>
                      <td>
                        <div className="name">{p.patientName}</div>
                        <div className="sub">
                          {[p.patientAge && `${p.patientAge} y`, p.patientSex, p.patientReg].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td>
                        <ProcedureChip testName={p.testName} />
                      </td>
                      <td className="small">{p.procedureDate || '—'}</td>
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
                icon={ImageIcon}
                title="No reports yet"
                hint="Register a patient to create your first endoscopy report."
                action={
                  <Button variant="primary" icon={UserPlus} onClick={() => onNavigate('patients')}>
                    New patient
                  </Button>
                }
              />
            )}
          </Card>
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
