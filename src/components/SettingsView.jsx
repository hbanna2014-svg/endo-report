/**
 * SettingsView.jsx — clinic identity, doctor directory, optional AI assist and
 * data/privacy information.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Building2,
  Stethoscope,
  Sparkles,
  HardDrive,
  Upload,
  Plus,
  Trash2,
  Save,
  Pencil,
  FolderOpen,
  ShieldCheck,
  Info,
  RefreshCw,
} from 'lucide-react'

import { api } from '../lib/api.js'
import { DEFAULT_TEMPLATE } from '../lib/reportModel.js'
import UpdatesPanel from './UpdatesPanel.jsx'
import { Topbar } from './Dashboard.jsx'
import {
  Banner,
  Button,
  Card,
  CheckRow,
  Chip,
  ConfirmDialog,
  Empty,
  Field,
  Input,
  Modal,
  Select,
  Tabs,
  Textarea,
  useToast,
} from './ui.jsx'

const EMPTY_DOCTOR = { id: null, name: '', designation: '', role: 'endoscopist', regNo: '', phone: '', active: true }

function DoctorDialog({ open, doctor, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_DOCTOR)

  useEffect(() => {
    setForm({ ...EMPTY_DOCTOR, ...(doctor || {}) })
  }, [doctor, open])

  const save = async () => {
    if (!form.name.trim()) {
      toast.push({ tone: 'warn', title: 'Doctor name is required' })
      return
    }
    try {
      await api.doctors.save(form)
      toast.push({ tone: 'ok', title: 'Doctor saved' })
      await onSaved?.()
      onClose?.()
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not save', body: err.message })
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={doctor?.id ? 'Edit doctor' : 'Add doctor'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Save} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid c2">
        <Field label="Name" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Dr. Full Name" autoFocus />
        </Field>
        <Field label="Designation">
          <Input
            value={form.designation}
            onChange={(e) => setForm({ ...form, designation: e.target.value })}
            placeholder="Consultant Gastroenterologist"
          />
        </Field>
        <Field label="Role">
          <Select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            options={[
              { value: 'endoscopist', label: 'Performing endoscopist' },
              { value: 'referrer', label: 'Referring physician' },
              { value: 'assistant', label: 'Assistant / nurse' },
            ]}
          />
        </Field>
        <Field label="BMDC / registration number">
          <Input value={form.regNo} onChange={(e) => setForm({ ...form, regNo: e.target.value })} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Status">
          <div style={{ paddingTop: 6 }}>
            <CheckRow checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Active" />
          </div>
        </Field>
      </div>
    </Modal>
  )
}

export default function SettingsView({ meta, clinic, doctors, onChanged }) {
  const toast = useToast()
  const [tab, setTab] = useState('clinic')
  const [identity, setIdentity] = useState({ ...DEFAULT_TEMPLATE.clinic, ...(clinic || {}) })
  const [savingIdentity, setSavingIdentity] = useState(false)
  const [doctorOpen, setDoctorOpen] = useState(false)
  const [editingDoctor, setEditingDoctor] = useState(null)
  const [confirmDoctor, setConfirmDoctor] = useState(null)
  const [ai, setAi] = useState({ enabled: false, baseUrl: '', model: '', apiKey: '' })
  const [aiStatus, setAiStatus] = useState(null)
  const [savingAi, setSavingAi] = useState(false)
  const [stats, setStats] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => {
    setIdentity({ ...DEFAULT_TEMPLATE.clinic, ...(clinic || {}) })
  }, [clinic])

  const loadAi = useCallback(async () => {
    try {
      const [cfg, status] = await Promise.all([api.settings.get('ai', null), api.ai.status()])
      setAi({
        enabled: !!cfg?.enabled,
        baseUrl: cfg?.baseUrl || '',
        model: cfg?.model || '',
        apiKey: '',
      })
      setAiStatus(status)
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not read the AI settings', body: err.message })
    }
  }, [toast])

  useEffect(() => {
    loadAi()
    api.data.stats().then(setStats).catch(() => {})
  }, [loadAi])

  const saveIdentity = async () => {
    setSavingIdentity(true)
    try {
      await api.settings.set('clinic', identity)
      toast.push({ tone: 'ok', title: 'Clinic identity saved' })
      await onChanged?.()
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not save', body: err.message })
    } finally {
      setSavingIdentity(false)
    }
  }

  const pickLogo = () => fileRef.current?.click()

  const onLogo = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      toast.push({ tone: 'warn', title: 'Choose a PNG or JPEG image' })
      return
    }
    if (file.size > 600 * 1024) {
      toast.push({ tone: 'warn', title: 'Logo is quite large', body: 'A logo under 600 KB keeps reports small. It will still be used.' })
    }
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsDataURL(file)
    })
    setIdentity((s) => ({ ...s, logoDataUrl: dataUrl }))
    e.target.value = ''
  }

  const saveAi = async () => {
    setSavingAi(true)
    try {
      const payload = { enabled: ai.enabled, baseUrl: ai.baseUrl, model: ai.model }
      if (ai.apiKey) payload.apiKey = ai.apiKey
      await api.settings.set('ai', payload)
      setAi((s) => ({ ...s, apiKey: '' }))
      await loadAi()
      toast.push({ tone: 'ok', title: 'AI settings saved' })
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not save', body: err.message })
    } finally {
      setSavingAi(false)
    }
  }

  const removeDoctor = async () => {
    if (!confirmDoctor) return
    try {
      await api.doctors.remove(confirmDoctor.id)
      toast.push({ tone: 'ok', title: 'Doctor removed' })
      setConfirmDoctor(null)
      await onChanged?.()
    } catch (err) {
      toast.push({ tone: 'err', title: 'Delete failed', body: err.message })
    }
  }

  return (
    <>
      <Topbar title="Settings" crumb="Clinic identity, doctors, AI assist and data">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'clinic', label: 'Clinic identity' },
            { value: 'doctors', label: 'Doctors' },
            { value: 'ai', label: 'AI assist' },
            { value: 'data', label: 'Data & privacy' },
            { value: 'updates', label: 'Updates' },
          ]}
        />
      </Topbar>

      <div className="content">
        {tab === 'clinic' ? (
          <div className="grid c2">
            <Card
              title="Clinic identity"
              subtitle="Printed on every report"
              icon={Building2}
              actions={
                <Button size="sm" variant="primary" icon={Save} onClick={saveIdentity} disabled={savingIdentity}>
                  {savingIdentity ? 'Saving…' : 'Save'}
                </Button>
              }
            >
              <div className="grid c2">
                <Field label="Clinic / hospital name" className="c2">
                  <Input value={identity.name} onChange={(e) => setIdentity({ ...identity, name: e.target.value })} />
                </Field>
                <Field label="Address / department" className="c2">
                  <Textarea
                    value={identity.address}
                    onChange={(e) => setIdentity({ ...identity, address: e.target.value })}
                    style={{ minHeight: 58 }}
                  />
                </Field>
                <Field label="Phone">
                  <Input value={identity.phone} onChange={(e) => setIdentity({ ...identity, phone: e.target.value })} />
                </Field>
                <Field label="Email">
                  <Input value={identity.email} onChange={(e) => setIdentity({ ...identity, email: e.target.value })} />
                </Field>
              </div>

              <div style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 14 }}>
                <strong style={{ fontSize: 13 }}>Default endoscopist signature</strong>
                <div className="grid c2" style={{ marginTop: 10 }}>
                  <Field label="Doctor name">
                    <Input value={identity.doctorName} onChange={(e) => setIdentity({ ...identity, doctorName: e.target.value })} />
                  </Field>
                  <Field label="Degrees">
                    <Input value={identity.doctorDegrees} onChange={(e) => setIdentity({ ...identity, doctorDegrees: e.target.value })} placeholder="MBBS, FCPS, MD" />
                  </Field>
                  <Field label="Designation">
                    <Input
                      value={identity.doctorDesignation}
                      onChange={(e) => setIdentity({ ...identity, doctorDesignation: e.target.value })}
                    />
                  </Field>
                  <Field label="Registration number">
                    <Input value={identity.doctorRegNo} onChange={(e) => setIdentity({ ...identity, doctorRegNo: e.target.value })} />
                  </Field>
                </div>
              </div>
            </Card>

            <div>
              <Card title="Clinic logo" subtitle="PNG or JPEG, transparent background works best">
                <div className="row" style={{ gap: 14, alignItems: 'center' }}>
                  <div
                    style={{
                      width: 150,
                      height: 96,
                      border: '1px dashed var(--line-2)',
                      borderRadius: 10,
                      display: 'grid',
                      placeItems: 'center',
                      background: 'var(--surface-2)',
                      overflow: 'hidden',
                    }}
                  >
                    {identity.logoDataUrl ? (
                      <img src={identity.logoDataUrl} alt="Clinic logo" style={{ maxWidth: '100%', maxHeight: '100%' }} />
                    ) : (
                      <span className="tiny muted">No logo</span>
                    )}
                  </div>
                  <div>
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onLogo} />
                    <Button icon={Upload} onClick={pickLogo}>
                      Choose image
                    </Button>
                    {identity.logoDataUrl ? (
                      <Button variant="danger" size="sm" style={{ marginTop: 8 }} onClick={() => setIdentity({ ...identity, logoDataUrl: '' })}>
                        Remove logo
                      </Button>
                    ) : null}
                    <div className="tiny muted" style={{ marginTop: 8, maxWidth: 260 }}>
                      Remember to press <strong>Save</strong> after choosing the logo.
                    </div>
                  </div>
                </div>
              </Card>

              <Card title="Installation">
                <div className="kv">
                  <span className="k">Application version</span>
                  <span>{meta?.version}</span>
                  <span className="k">Data folder</span>
                  <span className="mono tiny">{meta?.dataDir}</span>
                  <span className="k">Platform</span>
                  <span>{meta?.platform}</span>
                </div>
                <div style={{ marginTop: 12 }}>
                  <Button size="sm" icon={FolderOpen} onClick={() => api.app.openDataDir()}>
                    Open the data folder
                  </Button>
                </div>
              </Card>
            </div>
          </div>
        ) : null}

        {tab === 'doctors' ? (
          <Card
            title="Doctors"
            subtitle="Used for the performing endoscopist and referring physician lists"
            icon={Stethoscope}
            actions={
              <Button
                size="sm"
                variant="primary"
                icon={Plus}
                onClick={() => {
                  setEditingDoctor(null)
                  setDoctorOpen(true)
                }}
              >
                Add doctor
              </Button>
            }
            bodyClass="tight"
          >
            {doctors.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Designation</th>
                    <th>Role</th>
                    <th>Reg. no</th>
                    <th>Phone</th>
                    <th>Status</th>
                    <th style={{ width: 110 }} />
                  </tr>
                </thead>
                <tbody>
                  {doctors.map((d) => (
                    <tr key={d.id} style={{ cursor: 'default' }}>
                      <td className="name">{d.name}</td>
                      <td className="small">{d.designation || '—'}</td>
                      <td className="small">{d.role}</td>
                      <td className="small mono">{d.regNo || '—'}</td>
                      <td className="small">{d.phone || '—'}</td>
                      <td>
                        <Chip tone={d.active ? 'ok' : ''}>{d.active ? 'Active' : 'Inactive'}</Chip>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 5 }}>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={Pencil}
                            onClick={() => {
                              setEditingDoctor(d)
                              setDoctorOpen(true)
                            }}
                          />
                          <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setConfirmDoctor(d)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty icon={Stethoscope} title="No doctors added yet" hint="Add the endoscopists and referring physicians of your clinic." />
            )}
          </Card>
        ) : null}

        {tab === 'ai' ? (
          <div className="grid c2">
            <Card
              title="AI assist (optional)"
              subtitle="Additional, assistive image review"
              icon={Sparkles}
              actions={
                <Button size="sm" variant="primary" icon={Save} onClick={saveAi} disabled={savingAi}>
                  {savingAi ? 'Saving…' : 'Save'}
                </Button>
              }
            >
              <Banner tone="warn">
                <div className="small">
                  <strong>This is the only feature that needs the internet.</strong> When switched on, a captured frame is
                  sent to the endpoint you configure for analysis. Everything else in EndoReport — including the
                  rule-based auto impression, the audit and all reporting — works entirely offline. Turn it off if your
                  clinic policy does not allow images to leave the computer.
                </div>
              </Banner>

              <div style={{ marginTop: 14 }}>
                <CheckRow
                  checked={ai.enabled}
                  onChange={(v) => setAi({ ...ai, enabled: v })}
                  label="Enable AI image review"
                  hint="Adds an “AI review” button in the findings and image screens"
                />
              </div>

              <div className="grid" style={{ marginTop: 14 }}>
                <Field label="API base URL" hint="An OpenAI-compatible chat-completions endpoint">
                  <Input
                    value={ai.baseUrl}
                    onChange={(e) => setAi({ ...ai, baseUrl: e.target.value })}
                    placeholder="https://api.example.com/v1"
                  />
                </Field>
                <Field label="Model name">
                  <Input value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} placeholder="e.g. gpt-4o-mini" />
                </Field>
                <Field label="API key" hint="Stored encrypted on this computer when the operating system supports it. Leave blank to keep the existing key.">
                  <Input type="password" value={ai.apiKey} onChange={(e) => setAi({ ...ai, apiKey: e.target.value })} placeholder="••••••••" />
                </Field>
              </div>

              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                <Chip tone={aiStatus?.configured ? 'ok' : 'warn'}>{aiStatus?.configured ? 'Configured' : 'Not configured'}</Chip>
                <Chip tone={meta?.ai?.encryptionAvailable ? 'ok' : 'warn'}>
                  {meta?.ai?.encryptionAvailable ? 'Key encryption available' : 'Key encryption unavailable on this OS'}
                </Chip>
                <Button size="sm" icon={RefreshCw} onClick={loadAi}>
                  Re-check
                </Button>
              </div>
            </Card>

            <Card title="What the AI is allowed to do">
              <ul className="small" style={{ paddingLeft: 18, lineHeight: 1.75, margin: 0 }}>
                <li>It lists <em>observations</em> mapped to the finding catalogue of the procedure.</li>
                <li>Every suggestion appears in a review dialog — nothing is written into the report automatically.</li>
                <li>It is explicitly instructed not to give a diagnosis.</li>
                <li>Suggestions are added to the report as an editable note, so the audit still checks the required values.</li>
                <li>If the request fails or the key is wrong, the report workflow is not blocked in any way.</li>
              </ul>
              <div className="banner info" style={{ marginTop: 14 }}>
                <Info size={16} style={{ flex: '0 0 16px', marginTop: 1 }} />
                <div className="small">
                  AI output must always be confirmed by the endoscopist. It is a second pair of eyes, never a substitute for
                  the operator's judgement.
                </div>
              </div>
            </Card>
          </div>
        ) : null}

        {tab === 'data' ? (
          <div className="grid c2">
            <Card title="Where your data lives" icon={HardDrive}>
              <div className="kv">
                <span className="k">Data folder</span>
                <span className="mono tiny">{meta?.dataDir}</span>
                <span className="k">Patients</span>
                <span>{stats?.patients ?? '—'}</span>
                <span className="k">Reports</span>
                <span>{stats?.procedures ?? '—'} ({stats?.drafts ?? 0} draft)</span>
                <span className="k">Images</span>
                <span>{stats?.images ?? '—'}</span>
                <span className="k">Videos</span>
                <span>{stats?.videos ?? '—'}</span>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 14 }}>
                <Button size="sm" icon={FolderOpen} onClick={() => api.app.openDataDir()}>
                  Open folder
                </Button>
              </div>
              <div className="small muted" style={{ marginTop: 12 }}>
                Inside the data folder you will find <span className="mono">db/</span> (the database),{' '}
                <span className="mono">media/</span> (images and videos, one folder per patient) and{' '}
                <span className="mono">exports/</span>. Copying this folder to a USB drive is a complete backup.
              </div>
            </Card>

            <Card title="Privacy & compliance notes" icon={ShieldCheck}>
              <ul className="small" style={{ paddingLeft: 18, lineHeight: 1.75, margin: 0 }}>
                <li>No patient data leaves this computer unless you export it or turn on AI assist.</li>
                <li>There is no telemetry and no cloud account.</li>
                <li>Reports are generated locally; Word files are saved wherever you choose.</li>
                <li>Deleting a patient removes their reports, images and videos permanently — keep a backup.</li>
                <li>Only one installation should hold the master record for a clinic. To use a second computer, point it at this
                  one over the network rather than keeping two databases.</li>
              </ul>
              <div className="banner info" style={{ marginTop: 14 }}>
                <Info size={16} style={{ flex: '0 0 16px', marginTop: 1 }} />
                <div className="small">
                  Take a backup at the end of every working day. The <strong>Backup &amp; restore</strong> screen writes a
                  complete, restorable copy.
                </div>
              </div>
            </Card>
          </div>
        ) : null}

        {tab === 'updates' ? <UpdatesPanel meta={meta} /> : null}
      </div>

      <DoctorDialog
        open={doctorOpen}
        doctor={editingDoctor}
        onClose={() => setDoctorOpen(false)}
        onSaved={onChanged}
      />

      <ConfirmDialog
        open={!!confirmDoctor}
        title="Remove doctor"
        message={`Remove ${confirmDoctor?.name || ''} from the list?`}
        detail="Reports that already mention this doctor are not changed."
        confirmLabel="Remove"
        onConfirm={removeDoctor}
        onCancel={() => setConfirmDoctor(null)}
      />
    </>
  )
}
