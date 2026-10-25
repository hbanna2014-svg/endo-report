/**
 * UpdatesPanel.jsx — update checking and the upgrade history.
 *
 * Two promises are made explicit on this screen:
 *   1. patient records live in the data folder, never inside the application
 *      folder, so installing a new version cannot delete them;
 *   2. before the database schema is upgraded, a copy of the database is taken
 *      automatically and kept here.
 */

import React, { useCallback, useEffect, useState } from 'react'
import {
  RefreshCw,
  DownloadCloud,
  ExternalLink,
  FolderOpen,
  ShieldCheck,
  History,
  HardDrive,
  CheckCircle2,
  AlertTriangle,
  Info,
  PlayCircle,
  FileText,
} from 'lucide-react'

import { api } from '../lib/api.js'
import { Banner, Button, Card, Chip, Progress, useToast } from './ui.jsx'

function fmtBytes(n) {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = Number(n)
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

function fmtWhen(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function UpdatesPanel({ meta }) {
  const toast = useToast()
  const [info, setInfo] = useState(null)
  const [check, setCheck] = useState(null)
  const [checking, setChecking] = useState(false)
  const [asset, setAsset] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(null)
  const [staged, setStaged] = useState(null)

  const load = useCallback(async () => {
    try {
      setInfo(await api.lifecycle.info())
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not read the update information', body: err.message })
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const off = api.updates.onProgress((p) => setProgress(p))
    return off
  }, [])

  const runCheck = async () => {
    setChecking(true)
    setCheck(null)
    setStaged(null)
    setAsset(null)
    try {
      const res = await api.updates.check()
      setCheck(res)
      if (res.ok) {
        const preferred =
          res.assets?.find((a) => /setup.*\.exe$/i.test(a.name)) ||
          res.assets?.find((a) => /\.exe$/i.test(a.name)) ||
          res.assets?.find((a) => /\.zip$/i.test(a.name)) ||
          null
        setAsset(preferred)
      }
    } catch (err) {
      setCheck({ ok: false, error: err.message })
    } finally {
      setChecking(false)
    }
  }

  const startDownload = async () => {
    if (!asset) return
    setDownloading(true)
    setProgress({ percent: 0, received: 0, total: asset.size })
    try {
      const res = await api.updates.download(asset)
      setStaged(res)
      if (res.verified === false) {
        toast.push({ tone: 'err', title: 'Checksum mismatch', body: 'Do not run this file. Check the release page.', ttl: 12000 })
      } else {
        toast.push({ tone: 'ok', title: 'Download complete', body: res.verifyNote, ttl: 9000 })
      }
    } catch (err) {
      toast.push({ tone: 'err', title: 'Download failed', body: err.message })
    } finally {
      setDownloading(false)
    }
  }

  const runInstaller = async () => {
    if (!staged?.filePath) return
    try {
      const res = await api.updates.run(staged.filePath)
      if (res.launched) {
        toast.push({
          tone: 'ok',
          title: 'Installer started',
          body: 'EndoReport will close so the installer can replace the program files. Your data stays where it is.',
          ttl: 12000,
        })
      } else {
        toast.push({ tone: 'ok', title: 'Update folder opened', body: 'Close EndoReport and extract the file over the program folder.' })
      }
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not start the installer', body: err.message })
    }
  }

  const lifecycleInfo = info?.lifecycle || null
  const startup = info?.startup || null
  const backups = info?.backups || []
  const history = (lifecycleInfo?.upgradeHistory || []).slice().reverse()

  return (
    <div className="grid c2">
      <Card
        title="Application version"
        subtitle="Updates never touch your patient records"
        icon={RefreshCw}
        actions={
          <Button size="sm" variant="primary" icon={RefreshCw} onClick={runCheck} disabled={checking}>
            {checking ? 'Checking…' : 'Check for updates'}
          </Button>
        }
      >
        <div className="kv">
          <span className="k">Installed version</span>
          <span>
            <strong>v{info?.appVersion || meta?.version || '—'}</strong>
          </span>
          <span className="k">Database schema</span>
          <span>v{info?.schemaVersion ?? '—'}</span>
          <span className="k">Data folder</span>
          <span className="mono tiny">{info?.dataDir || meta?.dataDir}</span>
          <span className="k">Data folder ID</span>
          <span className="mono tiny">{info?.marker?.dataId || '—'}</span>
          <span className="k">Last started</span>
          <span>{fmtWhen(info?.stamp?.lastRunAt)}</span>
          <span className="k">Update source</span>
          <span className="mono tiny">
            github.com/{info?.repo?.owner}/{info?.repo?.repo}
          </span>
        </div>

        <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
          <Button size="sm" icon={FolderOpen} onClick={() => api.app.openDataDir()}>
            Open the data folder
          </Button>
          <Button size="sm" icon={FileText} onClick={() => api.lifecycle.openUpgradeLog()}>
            Upgrade log
          </Button>
          <Button size="sm" icon={ExternalLink} onClick={() => api.updates.releasePage()}>
            Release page
          </Button>
        </div>

        <div className="banner info" style={{ marginTop: 14 }}>
          <ShieldCheck size={16} style={{ flex: '0 0 16px', marginTop: 1 }} />
          <div className="small">
            Your records live in <strong className="mono">{info?.dataDir || 'the data folder'}</strong>, which is separate from
            the program. Installing a newer version replaces only the program files, so every patient, image and report
            stays exactly where it is. As a second safeguard, a copy of the database is taken automatically before any
            schema upgrade.
          </div>
        </div>

        {check ? (
          <div style={{ marginTop: 14 }}>
            {!check.ok ? (
              <Banner tone="warn">
                <strong>Could not check for updates</strong>
                <div className="small" style={{ marginTop: 4 }}>{check.error}</div>
                <div className="small" style={{ marginTop: 6 }}>
                  The software continues to work normally offline — this only affects the update check.
                </div>
              </Banner>
            ) : check.hasUpdate ? (
              <div className="banner info">
                <DownloadCloud size={17} style={{ flex: '0 0 17px', marginTop: 1 }} />
                <div style={{ flex: 1 }}>
                  <strong>
                    Version {check.latest} is available — you have v{check.current}.
                  </strong>
                  <div className="small" style={{ marginTop: 2 }}>
                    Published {fmtWhen(check.publishedAt)}
                  </div>

                  {check.notes ? (
                    <pre
                      className="small"
                      style={{
                        whiteSpace: 'pre-wrap',
                        marginTop: 8,
                        maxHeight: 160,
                        overflow: 'auto',
                        background: 'var(--surface-2)',
                        padding: 9,
                        borderRadius: 8,
                        border: '1px solid var(--line)',
                        fontFamily: 'inherit',
                      }}
                    >
                      {check.notes}
                    </pre>
                  ) : null}

                  {check.assets?.length ? (
                    <div style={{ marginTop: 10 }}>
                      <div className="tiny muted" style={{ marginBottom: 4 }}>Choose the file to download:</div>
                      {check.assets
                        .filter((a) => /\.(exe|zip)$/i.test(a.name))
                        .map((a) => (
                          <label
                            key={a.name}
                            className="row small"
                            style={{ gap: 7, cursor: 'pointer', padding: '3px 0' }}
                          >
                            <input
                              type="radio"
                              name="asset"
                              checked={asset?.name === a.name}
                              onChange={() => setAsset(a)}
                            />
                            <span className="mono">{a.name}</span>
                            <span className="muted">({fmtBytes(a.size)})</span>
                          </label>
                        ))}
                    </div>
                  ) : null}

                  <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={DownloadCloud}
                      onClick={startDownload}
                      disabled={!asset || downloading}
                    >
                      {downloading ? 'Downloading…' : 'Download'}
                    </Button>
                    {staged ? (
                      <Button size="sm" variant="success" icon={PlayCircle} onClick={runInstaller} disabled={staged.verified === false}>
                        {/\.exe$/i.test(staged.filePath || '') ? 'Run installer' : 'Show the file'}
                      </Button>
                    ) : null}
                  </div>

                  {progress && downloading ? (
                    <div style={{ marginTop: 10 }}>
                      <Progress value={progress.percent || 0} />
                      <div className="tiny muted" style={{ marginTop: 3 }}>
                        {fmtBytes(progress.received)} of {fmtBytes(progress.total)}
                        {progress.percent !== null ? ` · ${progress.percent}%` : ''}
                      </div>
                    </div>
                  ) : null}

                  {staged ? (
                    <div className="tiny" style={{ marginTop: 8 }}>
                      <Chip tone={staged.verified === false ? 'danger' : staged.verified ? 'ok' : 'warn'}>
                        {staged.verified === false ? 'Checksum mismatch' : staged.verified ? 'Verified' : 'Size verified'}
                      </Chip>{' '}
                      {staged.verifyNote}
                      <div className="mono" style={{ marginTop: 4, wordBreak: 'break-all' }}>
                        {staged.filePath}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <Banner tone="ok" icon={CheckCircle2}>
                <strong>You are up to date.</strong>
                <div className="small" style={{ marginTop: 2 }}>
                  Version {check.latest || check.current} — checked {fmtWhen(check.checkedAt)}.
                </div>
              </Banner>
            )}
          </div>
        ) : null}
      </Card>

      <div>
        <Card title="Last upgrade" icon={History} bodyClass="tight">
          {startup?.upgradedFrom ? (
            <div style={{ padding: '4px 2px' }}>
              <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                <Chip tone="brand">
                  v{startup.upgradedFrom} → v{startup.appVersion}
                </Chip>
                {startup.migration?.applied?.length ? (
                  <Chip tone="info">{startup.migration.applied.length} schema step(s)</Chip>
                ) : (
                  <Chip tone="ok">No schema change</Chip>
                )}
              </div>
              <div className="small muted">
                Your records were upgraded in place and remain readable by this version.
              </div>
              {startup.preUpgradeBackup?.dir ? (
                <div className="banner info" style={{ marginTop: 10 }}>
                  <ShieldCheck size={16} style={{ flex: '0 0 16px', marginTop: 1 }} />
                  <div className="small">
                    <strong>Database copied before the upgrade</strong>
                    <div className="mono tiny" style={{ marginTop: 3, wordBreak: 'break-all' }}>
                      {startup.preUpgradeBackup.dir}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <Button size="sm" icon={FolderOpen} onClick={() => api.lifecycle.openBackup(startup.preUpgradeBackup.dir)}>
                        Open the copy
                      </Button>
                    </div>
                  </div>
                </div>
              ) : startup.preUpgradeBackup?.error ? (
                <Banner tone="warn">
                  <div className="small">
                    The pre-upgrade copy could not be written: {startup.preUpgradeBackup.error}
                  </div>
                </Banner>
              ) : null}
            </div>
          ) : (
            <div className="small muted" style={{ padding: 6 }}>
              This installation is running the same version it was created with — no upgrade has been applied yet.
            </div>
          )}

          {history.length ? (
            <div style={{ marginTop: 10 }}>
              <div className="tiny muted" style={{ marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                Upgrade history
              </div>
              {history.slice(0, 6).map((h, i) => (
                <div key={i} className="row small" style={{ gap: 8, padding: '3px 0', borderTop: i ? '1px solid var(--line)' : 'none' }}>
                  <span className="mono tiny">{fmtWhen(h.at)}</span>
                  <span style={{ marginLeft: 'auto' }}>
                    {h.from ? `v${h.from} → ` : 'first run → '}
                    <strong>v{h.to}</strong>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </Card>

        <Card title="Automatic database copies" icon={HardDrive} bodyClass="tight">
          {backups.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Folder</th>
                  <th>Size</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.name} style={{ cursor: 'default' }}>
                    <td>
                      <div className="small mono" style={{ wordBreak: 'break-all' }}>{b.name}</div>
                      <div className="tiny muted">{fmtWhen(new Date(b.at).toISOString())}</div>
                    </td>
                    <td className="small">{fmtBytes(b.bytes)}</td>
                    <td>
                      <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => api.lifecycle.openBackup(b.path)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="small muted" style={{ padding: 6 }}>
              None yet. A copy is made automatically the first time you open a newer version of EndoReport.
            </div>
          )}
          <div className="tiny muted" style={{ padding: '8px 6px 2px' }}>
            <Info size={11} /> The six most recent copies are kept. Restoring instructions are inside each folder
            (<span className="mono">BACKUP-INFO.json</span>).
          </div>
        </Card>

        <Card title="If something goes wrong" icon={AlertTriangle}>
          <ul className="small" style={{ paddingLeft: 18, lineHeight: 1.7, margin: 0 }}>
            <li>
              An update cannot delete records — the data folder is outside the program folder. If records seem to be
              missing, the data folder has probably been moved or a drive is disconnected.
            </li>
            <li>
              On startup, EndoReport refuses to create a new empty database when a data folder is marked but its database
              is missing; it asks you to locate the folder instead.
            </li>
            <li>
              To roll back a schema change, close the app, rename <span className="mono">db</span> to{' '}
              <span className="mono">db.broken</span>, and rename the matching folder from{' '}
              <span className="mono">backups</span> to <span className="mono">db</span>.
            </li>
            <li>Take a manual backup (Backup &amp; restore) before a large version jump, as a matter of habit.</li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
