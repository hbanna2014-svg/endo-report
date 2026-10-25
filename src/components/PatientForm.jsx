/**
 * PatientForm.jsx — patient registration in the unit's own "New Patient"
 * layout: a right-aligned label column and a field column, in the same order
 * as the old dialog —
 *
 *   Patient Name · Age / Sex · MRN | Bed · Procedure · Referrer · Doctor ·
 *   Indication · Visit Date · Address · Town | State · Post Code | Phone
 *
 * The fields the printed report needs but the old dialog did not have
 * (hospital identity, visit/file number, history, allergy …) sit in a
 * collapsed "Report header & clinical details" strip so the first screen stays
 * exactly as familiar as the original.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { Camera, ChevronDown, Plus, Save, X } from 'lucide-react'
import { api } from '../lib/api.js'
import { PROCEDURE_TYPES } from '../lib/anatomy.js'
import { Banner, Button, Input, Modal, Select, Textarea, useToast } from './ui.jsx'

const AGE_UNITS = ['years', 'months', 'days']
const BEDS = ['OPD', 'Indoor', 'ICU', 'Cabin', 'Emergency']

export const EMPTY_PATIENT = {
  id: null,
  regNo: '',
  identityNo: '',
  visitId: '',
  name: '',
  age: '',
  ageUnit: 'years',
  sex: '',
  phone: '',
  address: '',
  town: '',
  state: '',
  postCode: '',
  referredBy: '',
  performingDoctor: '',
  assistant: '',
  indication: '',
  history: '',
  allergy: '',
  medication: '',
  notes: '',
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

/* --------------------------------------------------------------- sub-parts --- */

function Row({ label, children, top = false }) {
  return (
    <div className={`np-row${top ? ' top' : ''}`}>
      <div className="np-label">{label}</div>
      <div className="np-body">{children}</div>
    </div>
  )
}

/** Text field with the "+" picker from the old dialog. */
function PickerInput({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="np-pick">
      <Input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <button
        type="button"
        className="np-plus"
        title="Pick from the doctor list"
        onClick={() => setOpen((o) => !o)}
      >
        <Plus size={13} />
      </button>
      {open && options.length ? (
        <div className="np-menu">
          {options.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                onChange(name)
                setOpen(false)
              }}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ form ---- */

export default function PatientForm({ open, patient, doctors = [], onClose, onSaved, onStartReport }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_PATIENT)
  const [saving, setSaving] = useState(false)
  const [suggestedReg, setSuggestedReg] = useState('')
  const [testName, setTestName] = useState('ogd')
  const [visitDate, setVisitDate] = useState(today())
  const [bed, setBed] = useState('OPD')
  const [more, setMore] = useState(false)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  useEffect(() => {
    if (!open) return
    if (patient) {
      setForm({ ...EMPTY_PATIENT, ...patient })
      setSuggestedReg(patient.regNo || '')
      setMore(false)
    } else {
      const preferred =
        doctors.find((d) => d.isDefault && d.active !== false) || doctors.find((d) => d.active !== false)
      setForm({ ...EMPTY_PATIENT, performingDoctor: preferred?.name || '' })
      setTestName('ogd')
      setVisitDate(today())
      setBed('OPD')
      setMore(false)
      api.patients
        .nextRegNo()
        .then((r) => setSuggestedReg(r))
        .catch(() => setSuggestedReg(''))
    }
  }, [open, patient, doctors])

  const names = useMemo(() => doctors.filter((d) => d.active !== false).map((d) => d.name), [doctors])

  const persist = async () => {
    if (!form.name.trim()) {
      toast.push({ tone: 'warn', title: 'Patient name is required' })
      return null
    }
    return api.patients.save({ ...form, regNo: form.regNo || suggestedReg })
  }

  const save = async () => {
    setSaving(true)
    try {
      const saved = await persist()
      if (!saved) return
      toast.push({
        tone: 'ok',
        title: patient ? 'Patient updated' : 'Patient registered',
        body: `${saved.name} · ${saved.regNo}`,
      })
      onSaved?.(saved)
      onClose?.()
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not save the patient', body: err.message })
    } finally {
      setSaving(false)
    }
  }

  /** Save, create the procedure and go straight to the camera + report screen. */
  const saveAndCapture = async () => {
    setSaving(true)
    try {
      const saved = await persist()
      if (!saved) return
      onSaved?.(saved)
      onClose?.()
      onStartReport?.(saved, { testName, procedureDate: visitDate, bed })
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not start the procedure', body: err.message })
    } finally {
      setSaving(false)
    }
  }

  const busy = saving

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="wide"
      title={patient ? `Edit patient — ${patient.name}` : 'New Patient'}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <span style={{ flex: 1 }} />
          <Button icon={Camera} onClick={saveAndCapture} disabled={busy}>
            Save &amp; open capture
          </Button>
          <Button variant="success" icon={Save} onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="np-wrap">
        <Row label="Patient Name">
          <Input value={form.name} onChange={set('name')} placeholder="Full name" autoFocus />
        </Row>

        <Row label="Age / Sex">
          <Input
            className="np-age"
            value={form.age}
            onChange={set('age')}
            placeholder="Age"
            inputMode="numeric"
          />
          <select className="np-unit" value={form.ageUnit} onChange={set('ageUnit')}>
            {AGE_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <div className="np-radio">
            {['Male', 'Female'].map((s) => (
              <label key={s}>
                <input
                  type="radio"
                  name="np-sex"
                  checked={form.sex === s}
                  onChange={() => setForm((f) => ({ ...f, sex: s }))}
                />
                {s}
              </label>
            ))}
          </div>
        </Row>

        <div className="np-row np-pair">
          <div className="np-label">MRN</div>
          <Input value={form.regNo} onChange={set('regNo')} placeholder={suggestedReg} />
          <div className="np-label">Bed</div>
          <Select value={bed} onChange={(e) => setBed(e.target.value)} options={BEDS} />
        </div>

        <Row label="Procedure">
          <Select
            value={testName}
            onChange={(e) => setTestName(e.target.value)}
            options={PROCEDURE_TYPES.map((t) => ({ value: t.id, label: t.label }))}
          />
          <button
            type="button"
            className="np-x"
            title="Clear"
            onClick={() => setTestName('')}
          >
            <X size={13} />
          </button>
        </Row>

        <Row label="Referrer">
          <PickerInput
            value={form.referredBy}
            onChange={(v) => setForm((f) => ({ ...f, referredBy: v }))}
            options={names}
            placeholder="Referring physician"
          />
        </Row>

        <Row label="Doctor">
          <PickerInput
            value={form.performingDoctor}
            onChange={(v) => setForm((f) => ({ ...f, performingDoctor: v }))}
            options={names}
            placeholder="Endoscopist"
          />
        </Row>

        <Row label="Indication" top>
          <Textarea
            value={form.indication}
            onChange={set('indication')}
            placeholder="e.g. Epigastric pain for 3 months, not responding to PPI"
            style={{ minHeight: 64 }}
          />
        </Row>

        <div className="np-div" />

        <Row label="Visit Date">
          <Input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
        </Row>

        <Row label="Address">
          <Input value={form.address} onChange={set('address')} placeholder="House / road, village, area" />
        </Row>

        <div className="np-row np-pair">
          <div className="np-label">Town</div>
          <Input value={form.town} onChange={set('town')} placeholder="Town / upazila" />
          <div className="np-label">State</div>
          <Input value={form.state} onChange={set('state')} placeholder="District" />
        </div>

        <div className="np-row np-pair">
          <div className="np-label">Post Code</div>
          <Input value={form.postCode} onChange={set('postCode')} placeholder="Post code" />
          <div className="np-label">Phone</div>
          <Input value={form.phone} onChange={set('phone')} placeholder="Phone number" />
        </div>

        <button type="button" className="np-more" onClick={() => setMore((m) => !m)}>
          <ChevronDown size={14} style={{ transform: more ? 'rotate(180deg)' : 'none' }} />
          Report header &amp; clinical details
          <span className="tiny muted">(optional)</span>
        </button>

        {more ? (
          <div className="np-more-body">
            <Row label="Identity No.">
              <Input
                value={form.identityNo}
                onChange={set('identityNo')}
                placeholder="Hospital identity number printed on the report"
              />
            </Row>
            <Row label="Visit / File">
              <Input value={form.visitId} onChange={set('visitId')} placeholder="Second number in the header" />
            </Row>
            <Row label="Assistant">
              <PickerInput
                value={form.assistant}
                onChange={(v) => setForm((f) => ({ ...f, assistant: v }))}
                options={names}
                placeholder="Attending staff"
              />
            </Row>
            <Row label="History" top>
              <Textarea
                value={form.history}
                onChange={set('history')}
                placeholder="Past illness, previous endoscopy, comorbidities"
                style={{ minHeight: 54 }}
              />
            </Row>
            <Row label="Allergy">
              <Input value={form.allergy} onChange={set('allergy')} placeholder="e.g. Nil known" />
            </Row>
            <Row label="Medication">
              <Input value={form.medication} onChange={set('medication')} placeholder="e.g. Omeprazole 20 mg BD" />
            </Row>
            <Row label="Notes">
              <Input value={form.notes} onChange={set('notes')} placeholder="Anything else" />
            </Row>
          </div>
        ) : null}

        <Banner tone="info">
          <strong>Add</strong> saves the patient. <strong>Save &amp; open capture</strong> also creates the
          procedure and opens the camera and report side by side.
        </Banner>
      </div>
    </Modal>
  )
}
