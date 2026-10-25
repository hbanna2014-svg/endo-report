/**
 * PatientForm.jsx — patient registration, laid out like the unit's own
 * "New Patient" dialog: identity, age/sex, MRN, bed, procedure, referrer,
 * doctor, indication, visit date and address, all on one screen.
 *
 * "Save & open capture" writes the patient, creates the procedure with the
 * chosen test and lands straight in the live console, so a study can start
 * without a second trip through the reports list.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { Camera, Save, UserPlus } from 'lucide-react'
import { api } from '../lib/api.js'
import { PROCEDURE_TYPES } from '../lib/anatomy.js'
import { Banner, Button, Field, Input, Modal, Select, Textarea, useToast } from './ui.jsx'

const SEXES = ['Male', 'Female', 'Other']
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

export default function PatientForm({ open, patient, doctors = [], onClose, onSaved, onStartReport }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY_PATIENT)
  const [saving, setSaving] = useState(false)
  const [suggestedReg, setSuggestedReg] = useState('')
  const [testName, setTestName] = useState('ogd')
  const [visitDate, setVisitDate] = useState(today())
  const [bed, setBed] = useState('OPD')

  useEffect(() => {
    if (!open) return
    if (patient) {
      setForm({ ...EMPTY_PATIENT, ...patient })
      setSuggestedReg(patient.regNo || '')
    } else {
      setForm({ ...EMPTY_PATIENT })
      setTestName('ogd')
      setVisitDate(today())
      setBed('OPD')
      api.patients
        .nextRegNo()
        .then((r) => setSuggestedReg(r))
        .catch(() => setSuggestedReg(''))
    }
  }, [open, patient])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const doctorOptions = useMemo(() => doctors.map((d) => d.name), [doctors])

  const persist = async () => {
    if (!form.name.trim()) {
      toast.push({ tone: 'warn', title: 'Patient name is required' })
      return null
    }
    const saved = await api.patients.save({
      ...form,
      regNo: form.regNo || suggestedReg,
      performingDoctor: form.performingDoctor,
    })
    return saved
  }

  const save = async (andNew = false) => {
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

  /** Save, open the procedure and go straight to the capture screen. */
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
  const isNew = !patient

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="wide"
      title={patient ? `Edit patient — ${patient.name}` : 'Register a new patient'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {isNew ? (
            <Button icon={UserPlus} onClick={() => save(true)} disabled={busy}>
              Save &amp; add another
            </Button>
          ) : null}
          <Button icon={Save} onClick={() => save(false)} disabled={busy}>
            {busy ? 'Saving…' : 'Save patient'}
          </Button>
          {isNew || onStartReport ? (
            <Button variant="success" icon={Camera} onClick={saveAndCapture} disabled={busy}>
              Save &amp; open capture
            </Button>
          ) : null}
        </>
      }
    >
      <div className="grid c3">
        <Field label="Patient name" required className="c2">
          <Input value={form.name} onChange={set('name')} placeholder="Full name" autoFocus />
        </Field>
        <Field label="Registration no (MRN)" hint={!form.regNo ? `Suggested: ${suggestedReg || '…'}` : ''}>
          <Input value={form.regNo} onChange={set('regNo')} placeholder={suggestedReg} />
        </Field>

        <Field label="Hospital identity no." hint="Printed on the report header">
          <Input value={form.identityNo} onChange={set('identityNo')} placeholder="e.g. 00053211" />
        </Field>
        <Field label="Visit / file no." hint="Second number in the header">
          <Input value={form.visitId} onChange={set('visitId')} placeholder="e.g. C1853940" />
        </Field>
        <Field label="Visit date">
          <Input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
        </Field>

        <Field label="Age">
          <div className="row">
            <Input value={form.age} onChange={set('age')} placeholder="e.g. 45" inputMode="numeric" />
            <Select value={form.ageUnit} onChange={set('ageUnit')} options={AGE_UNITS} />
          </div>
        </Field>
        <Field label="Sex">
          <div className="sex-pick">
            {SEXES.map((s) => (
              <button
                key={s}
                type="button"
                className={`sex-opt ${form.sex === s ? 'on' : ''}`}
                onClick={() => setForm((f) => ({ ...f, sex: s }))}
              >
                <span className="dot" />
                {s}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Bed / unit">
          <Select value={bed} onChange={(e) => setBed(e.target.value)} options={BEDS} />
        </Field>

        <Field label="Procedure" className="c2">
          <Select
            value={testName}
            onChange={(e) => setTestName(e.target.value)}
            options={PROCEDURE_TYPES.map((t) => ({ value: t.id, label: t.label }))}
          />
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
        <Field label="Mobile / contact">
          <Input value={form.phone} onChange={set('phone')} placeholder="Phone number" />
        </Field>

        <datalist id="doctor-list">
          {doctorOptions.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>

        <Field label="Address" className="c2">
          <Input value={form.address} onChange={set('address')} placeholder="House / road, village, area" />
        </Field>
        <Field label="Town / upazila">
          <Input value={form.town} onChange={set('town')} placeholder="Town" />
        </Field>

        <Field label="District / state">
          <Input value={form.state} onChange={set('state')} placeholder="District" />
        </Field>
        <Field label="Post code">
          <Input value={form.postCode} onChange={set('postCode')} placeholder="Post code" />
        </Field>
        <Field label="Other notes">
          <Input value={form.notes} onChange={set('notes')} placeholder="Anything else" />
        </Field>

        <Field label="Indication for the procedure" className="c3">
          <Textarea
            value={form.indication}
            onChange={set('indication')}
            placeholder="e.g. Epigastric pain for 3 months, not responding to PPI. For evaluation of dyspepsia."
            style={{ minHeight: 58 }}
          />
        </Field>

        <Field label="Relevant history" className="c3" hint="Past illness, previous endoscopy, comorbidities, current drugs">
          <Textarea
            value={form.history}
            onChange={set('history')}
            placeholder="e.g. Diabetic, hypertensive. Previous endoscopy 2022 showed antral gastritis."
            style={{ minHeight: 58 }}
          />
        </Field>

        <Field label="Allergy">
          <Input value={form.allergy} onChange={set('allergy')} placeholder="e.g. Nil known" />
        </Field>
        <Field label="Current medication">
          <Input value={form.medication} onChange={set('medication')} placeholder="e.g. Omeprazole 20 mg BD" />
        </Field>
        <div />

        <div className="c3">
          <Banner tone="info">
            <strong>Save &amp; open capture</strong> registers the patient, creates the procedure and goes
            straight to the live console with the camera and the report side by side.
          </Banner>
        </div>
      </div>
    </Modal>
  )
}
