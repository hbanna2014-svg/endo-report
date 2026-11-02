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
import { Camera, Check, ChevronDown, Plus, Save, X } from 'lucide-react'
import { api } from '../lib/api.js'
import { procedureTypeFromLabel } from '../lib/anatomy.js'
import Autocomplete from './Autocomplete.jsx'
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
  /* One patient, two studies. When this is on, saving creates two separate
     procedure records — ENDOSCOPY and COLONOSCOPY — each with its own id and
     its own picture folder, instead of one combined report. */
  const [dual, setDual] = useState(false)
  /* The procedure name is free text: it is remembered once saved and offered
     again next time. The clinical template is derived from it. */
  const [procedureLabel, setProcedureLabel] = useState('ENDOSCOPY')
  const [savedProcedureLabels, setSavedProcedureLabels] = useState([])
  const [referrerOptions, setReferrerOptions] = useState([])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  useEffect(() => {
    if (!open) return
    if (patient) {
      setForm({ ...EMPTY_PATIENT, ...patient })
      setSuggestedReg(patient.regNo || '')
      setMore(false)
      setDual(false)
    } else {
      const preferred =
        doctors.find((d) => d.isDefault && d.active !== false) || doctors.find((d) => d.active !== false)
      setForm({ ...EMPTY_PATIENT, performingDoctor: preferred?.name || '' })
      setTestName('ogd')
      setProcedureLabel('ENDOSCOPY')
      setVisitDate(today())
      setBed('OPD')
      setMore(false)
      setDual(false)
      api.patients
        .nextRegNo()
        .then((r) => setSuggestedReg(r))
        .catch(() => setSuggestedReg(''))
    }
  }, [open, patient, doctors])

  const names = useMemo(() => doctors.filter((d) => d.active !== false).map((d) => d.name), [doctors])

  /* Everything the two boxes suggest comes from the clinic's own saved data, so
     the lists fill themselves as records are entered. */
  useEffect(() => {
    if (!open) return undefined
    let alive = true
    Promise.all([api.patients.referrers().catch(() => []), api.procedures.labels().catch(() => [])]).then(
      ([refs, labels]) => {
        if (!alive) return
        setReferrerOptions(refs || [])
        setSavedProcedureLabels(labels || [])
      },
    )
    return () => {
      alive = false
    }
  }, [open])

  const persist = async () => {
    if (!form.name.trim()) {
      toast.push({ tone: 'warn', title: 'Patient name is required' })
      return null
    }
    return api.patients.save({ ...form, regNo: form.regNo || suggestedReg })
  }

  /** Which report ids this save should create, and what each one prints. */
  const procedureTypes = dual ? ['ogd', 'colonoscopy'] : [testName]
  const procedureLabels = dual ? ['ENDOSCOPY', 'COLONOSCOPY'] : [(procedureLabel || '').trim() || 'ENDOSCOPY']

  const save = async () => {
    setSaving(true)
    try {
      const saved = await persist()
      if (!saved) return
      toast.push({
        tone: saved.matchedExisting ? 'warn' : 'ok',
        title: saved.matchedExisting
          ? 'Existing patient reused — no duplicate created'
          : patient
            ? 'Patient updated'
            : 'Patient registered',
        body: saved.matchedExisting
          ? `${saved.name} · ${saved.regNo} was already on file; that record was opened instead.`
          : `${saved.name} · ${saved.regNo}`,
      })
      onSaved?.(saved)
      // With "both" selected the two report ids are created immediately, even
      // when the operator stays on this screen.
      if (dual)
        onStartReport?.(saved, {
          testNames: procedureTypes,
          procedureLabels,
          procedureDate: visitDate,
          bed,
          open: false,
        })
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
      onStartReport?.(saved, {
        testNames: procedureTypes,
        procedureLabels,
        testName,
        procedureDate: visitDate,
        bed,
        open: true,
      })
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
            {dual ? 'Save & open both' : 'Save & open capture'}
          </Button>
          <Button variant="success" icon={Save} onClick={save} disabled={busy}>
            {busy ? 'Saving…' : dual ? 'Add both reports' : 'Add'}
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
          <div style={{ flex: 1, display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
            <Autocomplete
              value={dual ? 'ENDOSCOPY + COLONOSCOPY (two reports)' : procedureLabel}
              onChange={(text, option) => {
                if (dual) return
                setProcedureLabel(text)
                const known = option && !String(option.value).startsWith('custom:') ? option.value : null
                setTestName(known || procedureTypeFromLabel(text))
              }}
              options={[
                { value: 'ogd', label: 'ENDOSCOPY', hint: 'upper GI' },
                { value: 'colonoscopy', label: 'COLONOSCOPY', hint: 'lower GI' },
                { value: 'both', label: 'ENDOSCOPY + COLONOSCOPY', hint: 'one report' },
                ...savedProcedureLabels.map((l) => ({ value: `custom:${l}`, label: l })),
              ]}
              placeholder="Type or pick a procedure…"
              disabled={dual}
              emptyHint="New name — saved for the next patient."
            />
            <button
              type="button"
              className={`btn sm${dual ? ' primary' : ''}`}
              style={{ whiteSpace: 'nowrap' }}
              onClick={() => {
                setDual((d) => !d)
                if (!testName) setTestName('ogd')
              }}
              title="Create two separate reports for the same patient: ENDOSCOPY and COLONOSCOPY"
            >
              {dual ? <Check size={13} /> : <Plus size={13} />}
              Both
            </button>
            <button
              type="button"
              className="np-x"
              title="Clear"
              onClick={() => {
                setDual(false)
                setTestName('')
              }}
            >
              <X size={13} />
            </button>
          </div>
        </Row>

        {dual ? (
          <div style={{ margin: '-2px 0 8px 0' }}>
            <Banner tone="info">
              Two report ids will be created for this patient — <strong>ENDOSCOPY</strong> and{' '}
              <strong>COLONOSCOPY</strong>. Each keeps its own pictures and prints its own report; open
              whichever study is being performed.
            </Banner>
          </div>
        ) : null}

        <Row label="Referrer">
          <Autocomplete
            value={form.referredBy}
            onChange={(v) => setForm((f) => ({ ...f, referredBy: v }))}
            options={[...new Set([...referrerOptions, ...names])]}
            placeholder="Referring physician"
            emptyHint="New referrer — saved for next time."
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
          procedure and opens the camera and report side by side. A patient who is already on file is
          opened, never duplicated.
        </Banner>
      </div>
    </Modal>
  )
}
