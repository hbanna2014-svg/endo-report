/**
 * BackupView.jsx — complete backup / restore of the clinic dataset, plus a
 * portable single-file JSON export.
 */

import React, { useCallback, useEffect, useState } from 'react'
import {
  DatabaseBackup,
  UploadCloud,
  DownloadCloud,
  FileJson,
  FolderOpen,
  AlertTriangle,
  ShieldCheck,
  Clock,
  HardDrive,
} from 'lucide-react'

import { api } from '../lib/api.js'
import { Topbar } from './Dashboard.jsx'
import { Banner, Button, Card, Chip, Stat, useToast } from './ui.jsx'

function fmtBytes(n) {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = Number(n)
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

export default function BackupView({ onChanged, meta }) {
  const toast = useToast()
  const [stats, setStats] = useState(null)
  const [daily, setDaily] = useState([])
  const [busy, setBusy] = useState('')
  const [lastBackup, setLastBackup] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([api.data.stats(), api.data.maintenance(30)])
      setStats(s)
      setDaily(m?.daily || [])
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not read the statistics', body: err.message })
    }
  }, [toast])

  useEffect(() => {
    refresh()
  }, [refresh])

  const runBackup = async () => {
    setBusy('backup')
    try {
      const res = await api.data.backup()
      if (res.ok) {
        setLastBackup({ folder: res.folder, at: new Date() })
        toast.push({
          tone: 'ok',
          title: 'Backup completed',
          body: `${res.patients} patient(s), ${res.procedures} report(s) copied to ${res.folder}`,
          ttl: 12000,
        })
      } else if (!res.cancelled) {
        toast.push({ tone: 'err', title: 'Backup failed', body: res.error || 'Unknown error' })
      }
    } catch (err) {
      toast.push({ tone: 'err', title: 'Backup failed', body: err.message })
    } finally {
      setBusy('')
    }
  }

  const runRestore = async () => {
    setBusy('restore')
    try {
      const res = await api.data.restore()
      if (res.ok) {
        toast.push({
          tone: 'ok',
          title: 'Restore completed',
          body: `${res.patients} patient(s) and ${res.procedures} report(s) restored.`,
          ttl: 12000,
        })
        await refresh()
        await onChanged?.()
      } else if (!res.cancelled) {
        toast.push({ tone: 'err', title: 'Restore failed', body: res.error || 'Unknown error' })
      }
    } catch (err) {
      toast.push({ tone: 'err', title: 'Restore failed', body: err.message })
    } finally {
      setBusy('')
    }
  }

  const exportJson = async () => {
    setBusy('export')
    try {
      const res = await api.data.exportJson()
      if (res.ok) toast.push({ tone: 'ok', title: 'Data exported', body: res.filePath })
      else if (!res.cancelled) toast.push({ tone: 'err', title: 'Export failed' })
    } catch (err) {
      toast.push({ tone: 'err', title: 'Export failed', body: err.message })
    } finally {
      setBusy('')
    }
  }

  const importJson = async () => {
    setBusy('import')
    try {
      const res = await api.data.importJson()
      if (res.ok) {
        toast.push({ tone: 'ok', title: 'Data merged', body: `${res.patients} patient(s) and ${res.procedures} report(s) imported.` })
        await refresh()
        await onChanged?.()
      } else if (!res.cancelled) {
        toast.push({ tone: 'err', title: 'Import failed', body: res.error || 'Unknown error' })
      }
    } catch (err) {
      toast.push({ tone: 'err', title: 'Import failed', body: err.message })
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <Topbar title="Backup & restore" crumb="Keep a restorable copy of everything">
        <Button size="sm" icon={FolderOpen} onClick={() => api.app.openDataDir()}>
          Open data folder
        </Button>
      </Topbar>

      <div className="content">
        <div className="grid c4">
          <Stat label="Patients" value={stats?.patients ?? 0} />
          <Stat label="Reports" value={stats?.procedures ?? 0} detail={`${stats?.drafts ?? 0} draft`} tone="teal" />
          <Stat label="Images" value={stats?.images ?? 0} tone="amber" />
          <Stat label="Videos" value={stats?.videos ?? 0} tone="violet" />
        </div>

        <div className="grid c2" style={{ marginTop: 16 }}>
          <Card title="Create a backup" subtitle="Copy everything to a folder you choose" icon={DatabaseBackup}>
            <p className="small" style={{ marginTop: 0 }}>
              A backup folder is created containing <span className="mono">data.json</span> (all patients, reports, doctors
              and settings) and a complete copy of the <span className="mono">media</span> folder with every image and video.
            </p>
            <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
              <Button variant="primary" icon={DownloadCloud} onClick={runBackup} disabled={busy === 'backup'}>
                {busy === 'backup' ? 'Backing up…' : 'Backup now'}
              </Button>
              <Button icon={FileJson} onClick={exportJson} disabled={busy === 'export'}>
                {busy === 'export' ? 'Exporting…' : 'Export data as a single JSON file'}
              </Button>
            </div>

            {lastBackup ? (
              <div className="banner info" style={{ marginTop: 14 }}>
                <Clock size={16} style={{ flex: '0 0 16px', marginTop: 1 }} />
                <div className="small">
                  <strong>Last backup:</strong> {lastBackup.at.toLocaleString()} — <span className="mono tiny">{lastBackup.folder}</span>
                </div>
              </div>
            ) : null}

            <div className="banner warn" style={{ marginTop: 14 }}>
              <div className="small">
                Recommended routine: back up at the end of every working day to an external drive or a network folder, and
                keep at least one copy somewhere away from the machine.
              </div>
            </div>
          </Card>

          <Card title="Restore or merge" icon={UploadCloud}>
            <div className="banner err">
              <AlertTriangle size={17} style={{ flex: '0 0 17px', marginTop: 1 }} />
              <div className="small">
                <strong>Restore replaces everything.</strong> All current patients, reports, images and videos on this
                computer are erased and replaced by the contents of the backup. You will be asked to confirm.
              </div>
            </div>
            <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
              <Button variant="danger" icon={UploadCloud} onClick={runRestore} disabled={busy === 'restore'}>
                {busy === 'restore' ? 'Restoring…' : 'Restore from a backup folder'}
              </Button>
              <Button icon={FileJson} onClick={importJson} disabled={busy === 'import'}>
                {busy === 'import' ? 'Importing…' : 'Merge from a JSON file'}
              </Button>
            </div>
            <p className="small muted" style={{ marginTop: 12 }}>
              Use <strong>Merge</strong> when you want to import records from another computer without deleting what is
              already here. Records with the same identifier are overwritten, everything else is added.
            </p>
          </Card>
        </div>

        <div className="grid c2" style={{ marginTop: 16 }}>
          <Card title="Storage" icon={HardDrive}>
            <div className="kv">
              <span className="k">Data folder</span>
              <span className="mono tiny">{meta?.dataDir}</span>
              <span className="k">Application version</span>
              <span>{meta?.version}</span>
              <span className="k">Draft reports</span>
              <span>{stats?.drafts ?? 0}</span>
            </div>
            <p className="small muted" style={{ marginTop: 12 }}>
              Everything is inside one folder. To move the clinic to a new computer, install EndoReport there and restore
              this backup.
            </p>
          </Card>

          <Card title="Data hygiene" icon={ShieldCheck}>
            <ul className="small" style={{ paddingLeft: 18, lineHeight: 1.75, margin: 0 }}>
              <li>Keep only one master installation per clinic — two databases cannot be reconciled automatically.</li>
              <li>Finalise reports once they are signed; drafts show up on the dashboard so nothing is forgotten.</li>
              <li>Test a restore once, on a spare computer, before you need it in an emergency.</li>
              <li>Encrypt the backup drive if it leaves the premises.</li>
            </ul>
            <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
              <Chip tone="ok">
                <ShieldCheck size={11} /> Fully offline
              </Chip>
              <Chip tone="brand">No cloud account</Chip>
              <Chip>Portable folder</Chip>
            </div>
            <p className="tiny muted" style={{ marginTop: 12 }}>
              {daily.length
                ? `${daily.reduce((a, d) => a + d.c, 0)} procedures recorded in the last 30 days.`
                : 'No procedures recorded in the last 30 days.'}
            </p>
          </Card>
        </div>
      </div>
    </>
  )
}
