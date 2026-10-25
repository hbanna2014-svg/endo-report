/**
 * PatientForm.jsx — registration / edit form for a patient record.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { Save, UserPlus } from 'lucide-react'
import { api } from '../lib/api.js'
import { Banner, Button, Field, Input, Modal, Select, Textarea, useToast } from './ui.jsx'

const SEX_OPTIONS = ['Male', 'Female', 'Other']
const AGE_UNITS = ['years', 'months', 'days']

export const EMPTY_PATIENT = {
  id: null,
  regNo: '',
  name: '',
  age: '',
  ageUnit: 'years',
  sex: '',
  phone: '',
  address: '',
  referredBy: '',
  performingDoctor: '',
  assistant: '',
  indication: '',
  history: '',
  allergy: '',
  medication: '',
  notes: '',
}

export default function PatientForm({ open, patient, doctors = [], onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_PATIENT)
  const [saving, setSaving] = useState(false)
  const [suggestedReg, setSuggestedReg] = useState('')

  useEffect(() => {
    if (!open) return
    if (patient) {
      setForm({ ...EMPTY_PATIENT, ...patient })
      setSuggestedReg(patient.regNo || '')
    } else {
      setForm({ ...EMPTY_PATIENT })
      api.patients
        .nextRegNo()
        .then((r) => setSuggestedReg(r))
        .catch(() => setSuggestedReg(''))
    }
  }, [open, patient])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const doctorOptions = useMemo(() => doctors.map((d) => d.name), [doctors])

  const save = async (andNew = false) => {
    if (!form.name.trim()) {
      toast.push({ tone: 'warn', title: 'Patient name is required' })
      return
    }
    setSaving(true)
    try {
      const saved = await api.patients.save({ ...form, regNo: form.regNo || suggestedReg })
      toast.push({ tone: 'ok', title: patient ? 'Patient updated' : 'Patient registered', body: `${saved.name} · ${saved.regNo}` })
      onSaved?.(saved)
      if (andNew) {
        const next = await api.patients.nextRegNo()
        setSuggestedReg(next)
        setForm({ ...EMPTY_PATIENT, performingDoctor: form.performingDoctor })
      } else {
        onClose?.()
      }
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not save the patient', body: err.message })
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
      title={patient ? `Edit patient — ${patient.name}` : 'Register a new patient'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {!patient ? (
            <Button icon={UserPlus} onClick={() => save(true)} disabled={busy}>
              Save &amp; add another
            </Button>
          ) : null}
          <Button variant="primary" icon={Save} onClick={() => save(false)} disabled={busy}>
            {busy ? 'Saving…' : 'Save patient'}
          </Button>
        </>
      }
    >
      <div className="grid c3">
        <Field label="Patient name" required className="c3">
          <Input value={form.name} onChange={set('name')} placeholder="Full name" autoFocus />
        </Field>
        <Field label="Registration no" hint={!form.regNo ? `Suggested: ${suggestedReg || '…'}` : ''}>
          <Input value={form.regNo} onChange={set('regNo')} placeholder={suggestedReg} />
        </Field>
        <Field label="Age">
          <div className="row">
            <Input value={form.age} onChange={set('age')} placeholder="e.g. 45" inputMode="numeric" />
            <Select value={form.ageUnit} onChange={set('ageUnit')} options={AGE_UNITS} />
          </div>
        </Field>
        <Field label="Sex">
          <Select value={form.sex} onChange={set('sex')} options={SEX_OPTIONS} placeholder="Select…" />
        </Field>

        <Field label="Mobile / contact">
          <Input value={form.phone} onChange={set('phone')} placeholder="Phone number" />
        </Field>
        <Field label="Address" className="c2">
          <Input value={form.address} onChange={set('address')} placeholder="Village / area, district" />
        </Field>

        <Field label="Referred by (doctor)">
          <Input value={form.referredBy} onChange={set('referredBy')} placeholder="Referring physician" list="doctor-list" />
        </Field>
        <Field label="Performing endoscopist">
          <Input value={form.performingDoctor} onChange={set('performingDoctor')} placeholder="Operator" list="doctor-list" />
        </Field>
        <Field label="Assistant / attending staff">
          <Input value={form.assistant} onChange={set('assistant')} placeholder="Assistant" list="doctor-list" />
        </Field>

        <datalist id="doctor-list">
          {doctorOptions.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>

        <Field label="Indication for the procedure" className="c3">
          <Textarea
            value={form.indication}
            onChange={set('indication')}
            placeholder="e.g. Epigastric pain for 3 months, not responding to PPI. For evaluation of dyspepsia."
            style={{ minHeight: 64 }}
          />
        </Field>

        <Field label="Relevant history" className="c3" hint="Past illness, previous endoscopy, comorbidities, current drugs">
          <Textarea
            value={form.history}
            onChange={set('history')}
            placeholder="e.g. Diabetic, hypertensive. Previous endoscopy 2022 showed antral gastritis."
            style={{ minHeight: 64 }}
          />
        </Field>

        <Field label="Allergy">
          <Input value={form.allergy} onChange={set('allergy')} placeholder="e.g. Nil known" />
        </Field>
        <Field label="Current medication">
          <Input value={form.medication} onChange={set('medication')} placeholder="e.g. Omeprazole 20 mg BD" />
        </Field>
        <Field label="Other notes">
          <Input value={form.notes} onChange={set('notes')} placeholder="Anything else" />
        </Field>
      </div>

      <div style={{ marginTop: 16 }}>
        <Banner tone="info">
          The history and indication entered here are carried into every report for this patient, so you only type them once.
        </Banner>
      </div>
    </Modal>
  )
}
