/**
 * App.jsx — application shell: navigation, global state and view routing.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  FileText,
  Settings as SettingsIcon,
  DatabaseBackup,
  Activity,
  MonitorSmartphone,
  RefreshCw,
} from 'lucide-react'

import { api, isDesktop } from './lib/api.js'
import { DEFAULT_TEMPLATE } from './lib/reportModel.js'
import { Banner, Button, useToast } from './components/ui.jsx'

import Dashboard from './components/Dashboard.jsx'
import PatientList from './components/PatientList.jsx'
import ProcedureList from './components/ProcedureList.jsx'
import Workspace from './components/Workspace.jsx'
import TemplateEditor from './components/TemplateEditor.jsx'
import SettingsView from './components/SettingsView.jsx'
import BackupView from './components/BackupView.jsx'

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'Clinic' },
  { id: 'patients', label: 'Patient Archive', icon: Users, section: 'Clinic' },
  { id: 'procedures', label: 'Reports', icon: ClipboardList, section: 'Clinic' },
  { id: 'workspace', label: 'Current procedure', icon: Activity, section: 'Clinic' },
  { id: 'templates', label: 'Report template', icon: FileText, section: 'Configuration' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, section: 'Configuration' },
  { id: 'backup', label: 'Backup & restore', icon: DatabaseBackup, section: 'Configuration' },
]

export default function App() {
  const toast = useToast()
  const [view, setView] = useState('dashboard')
  const [meta, setMeta] = useState(null)
  const [templates, setTemplates] = useState([])
  const [doctors, setDoctors] = useState([])
  const [clinic, setClinic] = useState(DEFAULT_TEMPLATE.clinic)
  const [stats, setStats] = useState(null)
  const [booting, setBooting] = useState(true)
  const [bootError, setBootError] = useState(null)
  const [activeProcedureId, setActiveProcedureId] = useState(null)
  const [activePatientId, setActivePatientId] = useState(null)
  const menuHandlerRef = useRef(null)

  /* ------------------------------------------------------------ bootstrap --- */

  const refreshLookups = useCallback(async () => {
    try {
      const [tpl, docs, clinicSetting, s] = await Promise.all([
        api.templates.list(),
        api.doctors.list(false),
        api.settings.get('clinic', null),
        api.data.stats(),
      ])
      setTemplates(tpl || [])
      setDoctors(docs || [])
      if (clinicSetting) setClinic({ ...DEFAULT_TEMPLATE.clinic, ...clinicSetting })
      setStats(s)
      return tpl
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not load settings', body: err.message })
      return []
    }
  }, [toast])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const info = await api.app.info()
        if (cancelled) return
        setMeta(info)
        let list = await refreshLookups()
        if (cancelled) return
        // Seed the hospital paper form once. It mirrors the printed form the
        // unit already uses, so the very first report comes out looking right.
        try {
          const seeded = await api.settings.get('template.hospitalSeeded', false)
          if (!seeded && !list.some((t) => (t.layout?.style || 'standard') === 'hospital')) {
            await api.templates.save({
              ...DEFAULT_TEMPLATE,
              id: null,
              name: 'Hospital paper form',
              isDefault: true,
              layout: {
                ...DEFAULT_TEMPLATE.layout,
                style: 'hospital',
                imageLayout: 'form7',
                extraImageSheet: false,
              },
            })
            await api.settings.set('template.hospitalSeeded', true)
          }
          // Re-read so the standard-template fallback below never overwrites the
          // default that was just created.
          list = await refreshLookups()
        } catch (err) {
          toast.push({
            tone: 'warn',
            title: 'The hospital form could not be prepared',
            body: err.message,
          })
        }

        if (!list.length) {
          // First run: create the standard template so the app is usable
          // immediately. A failure here must not block the whole application —
          // the report engine falls back to the built-in defaults.
          try {
            await api.templates.save({ ...DEFAULT_TEMPLATE, isDefault: true })
            await refreshLookups()
          } catch (err) {
            toast.push({
              tone: 'warn',
              title: 'Using the built-in report template',
              body: `The template could not be stored (${err.message}). Reports will still be generated with the default layout.`,
            })
          }
        }
      } catch (err) {
        if (!cancelled) setBootError(err.message)
      } finally {
        if (!cancelled) setBooting(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshLookups])

  /* ------------------------------------------------------------ menu wiring --- */

  useEffect(() => {
    const off = api.app.onMenu((payload) => {
      if (typeof payload === 'string') {
        if (payload.startsWith('nav:')) setView(payload.slice(4))
        else if (payload === 'patient:new') setView('patients')
        else if (payload.startsWith('report:') || payload.startsWith('capture:')) {
          setView('workspace')
          setTimeout(() => menuHandlerRef.current?.(payload), 60)
        }
      } else if (payload?.toast) {
        const t = payload.toast
        if (t.ok === false && t.cancelled) return
        if (t.error) toast.push({ tone: 'err', title: 'Backup / restore failed', body: t.error })
        else if (t.ok) toast.push({ tone: 'ok', title: 'Done', body: t.folder ? `Saved to ${t.folder}` : 'Completed successfully' })
      }
    })
    return off
  }, [toast])

  const registerMenuHandler = useCallback((fn) => {
    menuHandlerRef.current = fn
  }, [])

  /* -------------------------------------------------------------- callbacks --- */

  const openProcedure = useCallback(
    async (procedureId, patientId = null) => {
      try {
        const proc = await api.procedures.get(procedureId)
        if (!proc) {
          toast.push({ tone: 'err', title: 'Report not found' })
          return
        }
        setActiveProcedureId(procedureId)
        setActivePatientId(patientId || proc.patientId)
        setView('workspace')
      } catch (err) {
        toast.push({ tone: 'err', title: 'Could not open report', body: err.message })
      }
    },
    [toast],
  )

  const onSaved = useCallback(async () => {
    await refreshLookups()
  }, [refreshLookups])

  const go = useCallback(
    (next, opts = {}) => {
      if (next === 'workspace' && !activeProcedureId && !opts.force) {
        toast.push({ tone: 'warn', title: 'No procedure open', body: 'Open a patient and start a new report first.' })
        setView('patients')
        return
      }
      setView(next)
      if (opts.patientId !== undefined) setActivePatientId(opts.patientId)
    },
    [activeProcedureId, toast],
  )

  const navCounts = useMemo(
    () => ({
      patients: stats?.patients ?? '',
      procedures: stats?.procedures ?? '',
    }),
    [stats],
  )

  /* ------------------------------------------------------------------ render --- */

  if (booting) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <div className="center">
          <div className="nav-logo" style={{ margin: '0 auto 12px' }}>ER</div>
          <div className="muted">Starting EndoReport…</div>
        </div>
      </div>
    )
  }

  const sections = [...new Set(NAV.map((n) => n.section))]

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-brand">
          <div className="nav-logo">ER</div>
          <div className="nav-brand-text">
            <strong>EndoReport</strong>
            <span>Offline reporting</span>
          </div>
        </div>

        {sections.map((section) => (
          <React.Fragment key={section}>
            <div className="nav-section">{section}</div>
            {NAV.filter((n) => n.section === section).map((n) => {
              const Icon = n.icon
              const disabled = n.id === 'workspace' && !activeProcedureId
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`nav-item ${view === n.id ? 'active' : ''}`}
                  onClick={() => go(n.id)}
                  style={disabled ? { opacity: 0.55 } : undefined}
                >
                  <Icon size={16} />
                  <span>{n.label}</span>
                  {navCounts[n.id] !== undefined && navCounts[n.id] !== '' ? (
                    <span className="count">{navCounts[n.id]}</span>
                  ) : null}
                </button>
              )
            })}
          </React.Fragment>
        ))}

        <div className="nav-spacer" />
        <div className="nav-foot">
          <div className="row" style={{ gap: 6, marginBottom: 6 }}>
            <MonitorSmartphone size={13} />
            {isDesktop ? 'Desktop build' : 'Browser preview'}
          </div>
          v{meta?.version || '0.1.0'}
        </div>
      </nav>

      <main className="main">
        {bootError ? (
          <div style={{ padding: 20 }}>
            <Banner tone="err">
              <strong>The local database could not be opened.</strong>
              <div className="small" style={{ marginTop: 4 }}>{bootError}</div>
            </Banner>
          </div>
        ) : null}

        {view === 'dashboard' ? (
          <Dashboard
            stats={stats}
            meta={meta}
            clinic={clinic}
            onNavigate={go}
            onOpenProcedure={openProcedure}
            onRefresh={refreshLookups}
          />
        ) : null}

        {view === 'patients' ? (
          <PatientList
            doctors={doctors}
            onOpenProcedure={openProcedure}
            onGoToWorkspace={(patientId, procedureId) => {
              setActivePatientId(patientId)
              setActiveProcedureId(procedureId)
              setView('workspace')
            }}
            onRefreshStats={refreshLookups}
          />
        ) : null}

        {view === 'procedures' ? (
          <ProcedureList onOpenProcedure={openProcedure} onRefreshStats={refreshLookups} />
        ) : null}

        {view === 'workspace' ? (
          <Workspace
            procedureId={activeProcedureId}
            patientId={activePatientId}
            clinic={clinic}
            templates={templates}
            doctors={doctors}
            onClose={() => setView('procedures')}
            onRegisterMenu={registerMenuHandler}
            onSaved={onSaved}
            onOpenPatient={(pid) => {
              setActivePatientId(pid)
              setView('patients')
            }}
          />
        ) : null}

        {view === 'templates' ? (
          <TemplateEditor templates={templates} onChanged={refreshLookups} />
        ) : null}

        {view === 'settings' ? (
          <SettingsView
            meta={meta}
            clinic={clinic}
            doctors={doctors}
            onChanged={async () => {
              await refreshLookups()
            }}
          />
        ) : null}

        {view === 'backup' ? <BackupView onChanged={refreshLookups} meta={meta} /> : null}
      </main>
    </div>
  )
}
