/**
 * Workspace.jsx — the live reporting console.
 *
 * This is the heart of the application and it is deliberately ONE screen: the
 * captured frames on the left, the live endoscopic image in the middle and the
 * finished report — including its 2 x 2 / 2 x 3 picture plate — on the right.
 * The doctor captures, writes and prints without ever changing view, exactly
 * like the console software most endoscopy units already use.
 *
 * The detailed findings / procedure-details editors are still one click away;
 * the camera keeps streaming (parked off-screen) while they are open, so a frame
 * can be captured at any moment from the top bar.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Save,
  Printer,
  FileText,
  ImagePlus as ImagePlusIcon,
  CheckCircle2,
  ArrowLeft,
  Camera,
  Video,
  Square,
  Loader2,
  Sparkles,
  Images,
  ClipboardList,
  Stethoscope,
  MonitorPlay,
} from 'lucide-react'

import { api, mediaSrc, newUid } from '../lib/api.js'
import { analyse, emptyProcedure, findingsForSection, findFindingDef } from '../lib/autoReport.js'
import { sectionsForProcedure, PROCEDURE_TYPES } from '../lib/anatomy.js'
import { buildReportModel, renderPlainText, imageLayoutDef } from '../lib/reportModel.js'
import { buildPrintHtml } from '../lib/printHtml.js'
import useCapture, { fmtDuration } from '../lib/useCapture.js'

import FindingsPanel from './FindingsPanel.jsx'
import DetailsPanel from './DetailsPanel.jsx'
import AuditPanel from './AuditPanel.jsx'
import MediaRail from './MediaRail.jsx'
import CaptureStage from './CaptureStage.jsx'
import ReportView, { AutoSummary } from './ReportView.jsx'
import { PicturePicker, PlateControls } from './ReportPlate.jsx'
import ImagePlus from './ImagePlus.jsx'
import { MediaThumb } from './CapturePanel.jsx'
import {
  Banner,
  Button,
  Card,
  Chip,
  ConfirmDialog,
  Empty,
  Modal,
  ProcedureChip,
  useToast,
} from './ui.jsx'

/* -------------------------------------------------------------------------- */

function Topbar({ children }) {
  return <header className="topbar">{children}</header>
}

const VIEWS = [
  { value: 'console', label: 'Live console', icon: MonitorPlay },
  { value: 'findings', label: 'Findings', icon: ClipboardList },
  { value: 'details', label: 'Procedure details', icon: Stethoscope },
]

export default function Workspace({
  procedureId,
  patientId,
  clinic,
  templates,
  doctors,
  onClose,
  onRegisterMenu,
  onSaved,
  onOpenPatient,
}) {
  const toast = useToast()
  const [procedure, setProcedure] = useState(null)
  const [patient, setPatient] = useState(null)
  const [media, setMedia] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('console')
  const [activeSection, setActiveSection] = useState(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [imagePlus, setImagePlus] = useState(false)
  const [confirmFinal, setConfirmFinal] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiResult, setAiResult] = useState(null)
  const [aiSourceMedia, setAiSourceMedia] = useState(null)
  const [aiStatus, setAiStatus] = useState(null)
  const [picker, setPicker] = useState(null)
  const [preview, setPreview] = useState(null)
  const [libraryOpen, setLibraryOpen] = useState(false)

  const menuActionsRef = useRef({})
  const saveTimer = useRef(null)
  const captureHandler = useRef(() => {})

  /* ------------------------------------------------------------------ load --- */

  const load = useCallback(async () => {
    if (!procedureId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const proc = await api.procedures.get(procedureId)
      if (!proc) {
        toast.push({ tone: 'err', title: 'Report not found' })
        onClose?.()
        return
      }
      const merged = { ...emptyProcedure(proc.testName), ...proc }
      merged.biopsy = { ...emptyProcedure().biopsy, ...(proc.biopsy || {}) }
      merged.hpylori = { ...emptyProcedure().hpylori, ...(proc.hpylori || {}) }
      merged.sectionNotes = proc.sectionNotes || {}
      merged.entries = Array.isArray(proc.entries) ? proc.entries : []
      setProcedure(merged)
      setMedia(proc.media || [])
      const sections = sectionsForProcedure(merged.testName)
      setActiveSection(sections[0]?.id || null)

      const pat = await api.patients.get(proc.patientId)
      setPatient(pat)
      setDirty(false)
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not open the report', body: err.message })
    } finally {
      setLoading(false)
    }
  }, [procedureId, onClose, toast])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procedureId])

  useEffect(() => {
    api.ai.status().then(setAiStatus).catch(() => setAiStatus(null))
  }, [])

  /* ---------------------------------------------------------------- mutate --- */

  const patch = useCallback((changes) => {
    setProcedure((p) => ({ ...p, ...changes }))
    setDirty(true)
  }, [])

  const toggleFinding = useCallback((sectionId, findingId) => {
    setProcedure((p) => {
      const entries = [...(p.entries || [])]
      const idx = entries.findIndex((e) => e.sectionId === sectionId && e.findingId === findingId)
      if (idx >= 0) entries.splice(idx, 1)
      else entries.push({ uid: newUid(), sectionId, findingId, values: {}, notes: '' })
      return { ...p, entries }
    })
    setDirty(true)
  }, [])

  const setValue = useCallback((sectionId, findingId, key, value) => {
    setProcedure((p) => ({
      ...p,
      entries: (p.entries || []).map((e) =>
        e.sectionId === sectionId && e.findingId === findingId ? { ...e, values: { ...e.values, [key]: value } } : e,
      ),
    }))
    setDirty(true)
  }, [])

  const setNote = useCallback((sectionId, findingId, note) => {
    setProcedure((p) => ({
      ...p,
      entries: (p.entries || []).map((e) =>
        e.sectionId === sectionId && e.findingId === findingId ? { ...e, notes: note } : e,
      ),
    }))
    setDirty(true)
  }, [])

  const setSectionNote = useCallback((sectionId, note) => {
    setProcedure((p) => ({ ...p, sectionNotes: { ...(p.sectionNotes || {}), [sectionId]: note } }))
    setDirty(true)
  }, [])

  /* ------------------------------------------------------------------ save --- */

  const stripMedia = (p) => {
    const { media: _drop, ...rest } = p
    return rest
  }

  const save = useCallback(
    async (opts = {}) => {
      if (!procedure || !patientId) return null
      setSaving(true)
      try {
        const payload = stripMedia({ ...procedure, ...(opts.changes || {}) })
        const saved = await api.procedures.save(patientId, payload)
        setProcedure((p) => ({ ...p, ...opts.changes, ...saved, media: p.media }))
        setDirty(false)
        setSavedAt(new Date())
        if (!opts.silent) toast.push({ tone: 'ok', title: 'Report saved' })
        onSaved?.()
        return saved
      } catch (err) {
        toast.push({ tone: 'err', title: 'Save failed', body: err.message })
        return null
      } finally {
        setSaving(false)
      }
    },
    [procedure, patientId, toast, onSaved],
  )

  // Debounced autosave keeps the record safe without interrupting documentation.
  useEffect(() => {
    if (!dirty || !procedure) return undefined
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      save({ silent: true, changes: {} })
    }, 3000)
    return () => clearTimeout(saveTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, procedure])

  /* ----------------------------------------------------------------- model --- */

  const template = useMemo(
    () => templates.find((t) => t.isDefault) || templates[0] || null,
    [templates],
  )

  const mergedTemplate = useMemo(
    () => (template ? { ...template, clinic: { ...(template.clinic || {}), ...(clinic || {}) } } : null),
    [template, clinic],
  )

  const analysis = useMemo(
    () => (procedure ? analyse(procedure, { mediaCount: media.length }) : null),
    [procedure, media.length],
  )

  const model = useMemo(() => {
    if (!procedure || !patient || !analysis) return null
    // `media` lives in its own state (it changes on every capture) so it is
    // injected here — this is what keeps the report plate and the rail in sync.
    return buildReportModel(patient, { ...procedure, media }, mergedTemplate)
  }, [procedure, patient, media, mergedTemplate, analysis])

  const slotIds = useMemo(
    () => (model?.imagePlan?.slots || []).map((s) => s.id),
    [model],
  )

  /* ----------------------------------------------------------- capture hook --- */

  const cap = useCapture({
    patientId,
    procedureId,
    media,
    setMedia,
    activeSection,
    procedure,
    onCaptured: (rec) => captureHandler.current(rec),
  })

  /* ------------------------------------------------------ picture plate edits --- */

  /** Writes an explicit ordered list of media ids for the fixed plate. */
  const writePlate = useCallback(
    (ids, layoutId) => {
      const changes = { reportImages: ids }
      if (layoutId && layoutId !== model?.imagePlan?.mode) changes.imageLayout = layoutId
      patch(changes)
    },
    [model, patch],
  )

  /** The ids currently on the plate, padded to the plate's capacity. */
  const paddedIds = useCallback(
    (layoutId) => {
      const cap4 = imageLayoutDef(layoutId).capacity
      const base = (model?.imagePlan?.slots || []).map((s) => s.id).slice(0, cap4)
      const out = [...base]
      while (out.length < cap4) out.push(null)
      return out
    },
    [model],
  )

  const choosePicture = useCallback(
    (m) => {
      const target = picker?.index
      const layoutId = model?.imagePlan?.capacity ? model.imagePlan.mode : 'grid4'
      const next = paddedIds(layoutId)

      if (target === null || target === undefined) {
        const free = next.indexOf(null)
        if (free >= 0) next[free] = m.id
        else {
          next.shift()
          next.push(m.id)
        }
      } else {
        const already = next.indexOf(m.id)
        if (already >= 0 && already !== target) next[already] = next[target]
        next[target] = m.id
      }

      writePlate(next, layoutId)
      setPicker(null)
      const slot = target === null || target === undefined ? next.indexOf(m.id) : target
      toast.push({ tone: 'ok', title: `Picture ${slot + 1} set on the report plate` })
    },
    [model, picker, paddedIds, toast, writePlate],
  )

  const clearPicture = useCallback(
    (i) => {
      const layoutId = model?.imagePlan?.capacity ? model.imagePlan.mode : 'grid4'
      const next = paddedIds(layoutId)
      next[i] = null
      writePlate(next, layoutId)
    },
    [model, paddedIds, writePlate],
  )

  const movePicture = useCallback(
    (i, j) => {
      const layoutId = model?.imagePlan?.capacity ? model.imagePlan.mode : 'grid4'
      const next = paddedIds(layoutId)
      const tmp = next[j]
      next[j] = next[i]
      next[i] = tmp
      writePlate(next, layoutId)
    },
    [model, paddedIds, writePlate],
  )

  const autoFillPlate = useCallback(() => {
    const layoutId = model?.imagePlan?.capacity ? model.imagePlan.mode : 'grid4'
    const cap4 = imageLayoutDef(layoutId).capacity
    const ids = media.filter((m) => m.kind === 'image').slice(0, cap4).map((m) => m.id)
    const next = [...ids]
    while (next.length < cap4) next.push(null)
    writePlate(next, layoutId)
    toast.push({ tone: 'ok', title: 'Plate filled', body: `${ids.length} picture(s)` })
  }, [model, media, toast, writePlate])

  const clearPlate = useCallback(() => {
    patch({ reportImages: [] })
  }, [patch])

  /**
   * One click from the rail puts a frame on the plate. In the flowing layout
   * there are no slots, so the first click promotes the report to the 4-picture
   * plate — otherwise the button would appear to do nothing.
   */
  /** Open the clinic's Word report and edit it on the page. */
  const openWordReport = useCallback(async () => {
    setBusy(true)
    try {
      const res = await api.docx.pickHtml()
      if (!res?.ok) {
        if (res && !res.cancelled) toast.push({ tone: 'err', title: 'Could not open that file' })
        return
      }
      patch({ docHtml: res.html, docName: res.fileName })
      toast.push({
        tone: 'ok',
        title: 'Word report opened',
        body: `${res.fileName} — click anywhere in the text to change it.`,
      })
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not open that file', body: err?.message || String(err) })
    } finally {
      setBusy(false)
    }
  }, [patch, toast])

  const placeOnPlate = useCallback(
    (m) => {
      if (!model) return
      const flow = !model.imagePlan.capacity
      const layoutId = flow ? 'grid4' : model.imagePlan.mode
      const cap4 = imageLayoutDef(layoutId).capacity
      const next = flow ? [] : paddedIds(layoutId)
      while (next.length < cap4) next.push(null)

      const already = next.indexOf(m.id)
      if (already >= 0) {
        toast.push({ tone: 'info', title: `Already printed as picture ${already + 1}` })
        return
      }

      const free = next.indexOf(null)
      if (free >= 0) next[free] = m.id
      else {
        next.shift()
        next.push(m.id)
      }

      patch({ reportImages: next, ...(flow ? { imageLayout: layoutId } : {}) })
      toast.push({
        tone: 'ok',
        title: `Picture ${next.indexOf(m.id) + 1} on the report plate`,
        body: flow ? 'The report now uses the 4-picture plate — switch to 6 pictures in the plate bar.' : undefined,
      })
    },
    [model, paddedIds, patch, toast],
  )

  const setPlateCaption = useCallback(
    async (item, caption) => {
      try {
        const updated = await api.media.update(item.id, { caption })
        setMedia((list) => list.map((m) => (m.id === item.id ? { ...m, caption: updated?.caption ?? caption } : m)))
      } catch (err) {
        toast.push({ tone: 'err', title: 'Could not save the caption', body: err.message })
      }
    },
    [toast],
  )

  /**
   * A freshly captured frame drops straight into the next free slot of a fixed
   * plate. That is what makes "capture six pictures and print" one gesture
   * instead of six drag-and-drops.
   */
  useEffect(() => {
    captureHandler.current = (rec) => {
      if (!rec || !model) return
      const layoutId = model.imagePlan.capacity ? model.imagePlan.mode : (procedure?.imageLayout || template?.layout?.imageLayout || 'flow')
      const def = imageLayoutDef(layoutId)
      if (!def.capacity) return // flowing layout: every picture is printed anyway
      const next = paddedIds(layoutId)
      const free = next.indexOf(null)
      if (free < 0) return
      next[free] = rec.id
      patch({ reportImages: next })
    }
  }, [model, paddedIds, patch, procedure, template])

  /* ----------------------------------------------------- print / export / copy --- */

  const withImages = useCallback(async () => {
    const imgs = await Promise.all(
      media
        .filter((m) => m.kind === 'image')
        .map(async (m) => {
          try {
            const { dataUrl } = await api.app.readFileAsDataUrl(m.filePath)
            return { ...m, dataUrl }
          } catch {
            return m
          }
        }),
    )
    const videos = media.filter((m) => m.kind === 'video')
    return [
      ...model.media.map((m) => (m.kind === 'image' ? imgs.find((i) => i.id === m.id) || m : m)),
      ...videos.filter((v) => !model.media.some((m) => m.id === v.id)),
    ]
  }, [media, model])

  const doPrint = useCallback(async () => {
    if (!model) return
    setBusy(true)
    try {
      await save({ silent: true, changes: {} })
      const enriched = await withImages()
      const html = buildPrintHtml({ ...model, media: enriched })
      const res = await api.report.print(html, `${model.reportNo} — ${model.patientLine.name}`)
      if (res?.ok === false && res.reason) toast.push({ tone: 'warn', title: 'Printing cancelled', body: res.reason })
    } catch (err) {
      toast.push({ tone: 'err', title: 'Printing failed', body: err.message })
    } finally {
      setBusy(false)
    }
  }, [model, save, toast, withImages])

  const doDocx = useCallback(async () => {
    if (!model) return
    setBusy(true)
    try {
      await save({ silent: true, changes: {} })
      const res = await api.report.exportDocx({ ...model, media })
      if (res.ok) {
        toast.push({
          tone: 'ok',
          title: res.fromWordTemplate ? 'Word report written into your template' : 'Word report exported',
          body: res.warning || res.filePath,
        })
      } else if (!res.cancelled) toast.push({ tone: 'err', title: 'Export failed' })
    } catch (err) {
      toast.push({ tone: 'err', title: 'Export failed', body: err.message })
    } finally {
      setBusy(false)
    }
  }, [model, media, save, toast])

  const doPdf = useCallback(async () => {
    if (!model) return
    setBusy(true)
    try {
      const enriched = await withImages()
      const html = buildPrintHtml({ ...model, media: enriched })
      const res = await api.report.savePdf(html, `${model.patientLine.name}-${model.reportNo}`)
      if (res.ok) toast.push({ tone: 'ok', title: 'PDF saved', body: res.filePath })
      else if (!res.cancelled) toast.push({ tone: 'err', title: 'PDF export failed' })
    } catch (err) {
      toast.push({ tone: 'err', title: 'PDF export failed', body: err.message })
    } finally {
      setBusy(false)
    }
  }, [model, toast, withImages])

  const doCopy = useCallback(async () => {
    if (!model) return
    await api.app.copyText(renderPlainText(model))
    toast.push({ tone: 'ok', title: 'Report text copied to the clipboard' })
  }, [model, toast])

  const finalise = useCallback(async () => {
    setConfirmFinal(false)
    const res = await save({ changes: { status: 'final' }, silent: true })
    if (res) toast.push({ tone: 'ok', title: 'Report marked final', body: 'It is now locked as a signed report.' })
  }, [save, toast])

  const importFiles = useCallback(async () => {
    try {
      const res = await api.media.import({ patientId, procedureId, section: activeSection || null })
      if (res?.ok && res.added?.length) {
        setMedia((list) => [...list, ...res.added])
        toast.push({ tone: 'ok', title: `${res.added.length} file(s) imported` })
      }
    } catch (err) {
      toast.push({ tone: 'err', title: 'Import failed', body: err.message })
    }
  }, [activeSection, patientId, procedureId, toast])

  const removeMedia = useCallback(
    async (item) => {
      try {
        await api.media.remove(item.id)
        setMedia((list) => list.filter((m) => m.id !== item.id))
        setPreview(null)
        toast.push({ tone: 'ok', title: 'Deleted' })
      } catch (err) {
        toast.push({ tone: 'err', title: 'Delete failed', body: err.message })
      }
    },
    [toast],
  )

  /* --------------------------------------------------------------- AI review --- */

  const runAiReview = useCallback(
    async (mediaItem) => {
      if (!procedure) return
      const sections = sectionsForProcedure(procedure.testName)
      const candidateIds = sections.flatMap((s) => findingsForSection(s.id).map((f) => f.id))
      let target = mediaItem
      if (!target) {
        const firstImage = media.filter((m) => m.kind === 'image').slice(-1)[0]
        if (!firstImage) {
          toast.push({ tone: 'warn', title: 'No image to review', body: 'Capture or import an image first.' })
          return
        }
        target = firstImage
      }
      setAiBusy(true)
      setAiSourceMedia(target)
      setAiResult(null)
      setAiOpen(true)
      try {
        const { dataUrl } = await api.app.readFileAsDataUrl(target.filePath)
        const res = await api.ai.analyseImage({
          imageDataUrl: dataUrl,
          candidateIds,
          context: PROCEDURE_TYPES.find((t) => t.id === procedure.testName)?.label || 'endoscopy',
        })
        if (!res.ok) {
          setAiResult({ error: res.error })
        } else {
          setAiResult(res.result)
        }
      } catch (err) {
        setAiResult({ error: err.message })
      } finally {
        setAiBusy(false)
      }
    },
    [media, procedure, toast],
  )

  const acceptAiSuggestion = useCallback(
    (obs) => {
      const sections = sectionsForProcedure(procedure.testName)
      const section = sections.find((s) => findingsForSection(s.id).some((f) => f.id === obs.findingId))
      if (!section) {
        toast.push({ tone: 'warn', title: 'Unknown finding', body: `${obs.findingId} is not part of this procedure type.` })
        return
      }
      setProcedure((p) => {
        const entries = [...(p.entries || [])]
        if (entries.some((e) => e.sectionId === section.id && e.findingId === obs.findingId)) return p
        entries.push({
          uid: newUid(),
          sectionId: section.id,
          findingId: obs.findingId,
          values: {},
          notes: `Suggested by AI image review${obs.confidence ? ` (confidence ${Math.round(obs.confidence * 100)}%)` : ''}${obs.region ? ` — ${obs.region}` : ''}. ${obs.note || ''}`.trim(),
        })
        return { ...p, entries }
      })
      setDirty(true)
      setActiveSection(section.id)
      toast.push({ tone: 'ok', title: 'Finding added', body: 'Complete the required values, then review the impression.' })
    },
    [procedure, toast],
  )

  /* --------------------------------------------------- keyboard / menu wiring --- */

  useEffect(() => {
    menuActionsRef.current = {
      captureImage: () => cap.captureStill(),
      toggleVideo: cap.toggleVideo,
      start: cap.startStream,
    }
  }, [cap.captureStill, cap.toggleVideo, cap.startStream])

  useEffect(() => {
    onRegisterMenu?.((action) => {
      if (action === 'report:save') save({})
      else if (action === 'report:print') doPrint()
      else if (action === 'report:docx') doDocx()
      else if (action === 'report:pdf') doPdf()
      else if (action === 'capture:image') menuActionsRef.current.captureImage?.()
      else if (action === 'capture:video') menuActionsRef.current.toggleVideo?.()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save, doPrint, doDocx, doPdf])

  /* ----------------------------------------------------------------- render --- */

  if (!procedureId) {
    return (
      <>
        <Topbar>
          <h2>Current procedure</h2>
        </Topbar>
        <div className="content">
          <Empty
            icon={Camera}
            title="No procedure open"
            hint="Choose a patient from the Patients screen and press “New report”."
            action={<Button variant="primary" onClick={onClose}>Go to reports</Button>}
          />
        </div>
      </>
    )
  }

  if (loading || !procedure) {
    return (
      <>
        <Topbar>
          <h2>Loading report…</h2>
        </Topbar>
        <div className="content">
          <div className="center muted" style={{ padding: 60 }}>
            <Loader2 className="spin" size={22} />
          </div>
        </div>
      </>
    )
  }

  const statusChip = procedure.status === 'final' ? <Chip tone="ok">Final</Chip> : <Chip tone="warn">Draft</Chip>
  const plateMode = model?.imagePlan?.mode || 'flow'

  return (
    <>
      <Topbar>
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onClose} />
        <div>
          <h2 style={{ fontSize: 15 }}>{patient?.name || 'Patient'}</h2>
          <div className="crumb">
            {[patient?.regNo, patient?.age && `${patient.age} ${patient.ageUnit}`, patient?.sex].filter(Boolean).join(' · ')}
          </div>
        </div>
        <ProcedureChip testName={procedure.testName} />
        {statusChip}
        {dirty ? (
          <span className="small muted">Unsaved changes…</span>
        ) : savedAt ? (
          <span className="small muted">Saved {savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
        ) : null}

        <div className="topbar-actions">
          <Button
            size="sm"
            variant="success"
            icon={Camera}
            onClick={() => cap.captureStill()}
            disabled={!cap.live || cap.busy}
            title={cap.live ? 'Capture the current frame at full resolution (F9)' : 'Start the live view first'}
          >
            Capture
          </Button>
          {cap.recording ? (
            <Button size="sm" variant="recording" icon={Square} onClick={cap.stopRecording}>
              Stop {fmtDuration(cap.recSeconds)}
            </Button>
          ) : (
            <Button size="sm" variant="danger" icon={Video} onClick={cap.startRecording} disabled={!cap.live || cap.busy}>
              Record
            </Button>
          )}
          <Button size="sm" icon={Save} onClick={() => save({})} disabled={saving}>
            Save
          </Button>
          <Button size="sm" icon={FileText} onClick={doDocx} disabled={busy}>
            Word
          </Button>
          <Button size="sm" variant="primary" icon={Printer} onClick={doPrint} disabled={busy}>
            Print
          </Button>
          <Button
            size="sm"
            variant="success"
            icon={CheckCircle2}
            disabled={!!analysis?.audit.errors}
            title={analysis?.audit.errors ? 'Resolve the blocking issues first' : 'Mark this report final'}
            onClick={() => setConfirmFinal(true)}
          >
            Finalise
          </Button>
        </div>
      </Topbar>

      <div className="content console-content">
        {analysis?.audit.errors ? (
          <div style={{ marginBottom: 10 }}>
            <Banner tone="err">
              <strong>{analysis.audit.errors} blocking issue(s) before this report can be finalised.</strong>
              <div className="small" style={{ marginTop: 3 }}>
                Open <em>Findings</em> to see them; the audit list on the right of that view jumps straight to the section.
              </div>
            </Banner>
          </div>
        ) : null}

        <div className="workspace-switch">
          <div className="segmented">
            {VIEWS.map((v) => {
              const Icon = v.icon
              return (
                <button
                  key={v.value}
                  type="button"
                  className={view === v.value ? 'on' : ''}
                  onClick={() => setView(v.value)}
                >
                  <Icon size={14} />
                  {v.label}
                  {v.value === 'findings' && analysis?.audit?.errors ? (
                    <em className="seg-badge">{analysis.audit.errors}</em>
                  ) : null}
                </button>
              )
            })}
          </div>
          <div className="spacer" />
          <Chip tone={cap.live ? 'ok' : 'warn'}>{cap.live ? 'Camera live' : 'Camera idle'}</Chip>
          {cap.frameSize ? (
            <Chip tone={cap.frameSize.width >= 1000 ? 'ok' : 'warn'} title="Frames are stored at the sensor's own size">
              {cap.frameSize.width} × {cap.frameSize.height}
            </Chip>
          ) : null}
          <Chip tone={media.length ? 'brand' : 'info'}>
            <Images size={11} /> {media.length}
          </Chip>
          <Button size="sm" variant="ghost" icon={Images} onClick={() => setLibraryOpen(true)}>
            Media library
          </Button>
        </div>

        <div className={`console-grid view-${view}`}>
          {view === 'console' ? (
            <MediaRail
              media={media}
              plateIds={slotIds}
              onOpen={setPreview}
              onAdd={placeOnPlate}
              onImport={importFiles}
              onCapture={() => cap.captureStill()}
              onRecord={cap.startRecording}
              onStopRecord={cap.stopRecording}
              live={cap.live}
              recording={cap.recording}
              recSeconds={cap.recSeconds}
              busy={cap.busy}
            />
          ) : null}

          <section className={`console-center${view === 'console' ? '' : ' wide'}`}>
            <div className={`stage-host${view === 'console' ? '' : ' parked'}`} aria-hidden={view !== 'console'}>
              <CaptureStage
                cap={cap}
                activeSection={activeSection}
                onSelectSection={setActiveSection}
                compact={view !== 'console'}
                showDevicePicker={view === 'console'}
              />
            </div>

            {view === 'console' ? (
              <div className="stage-under">
                <div className="small muted">
                  {cap.live
                    ? 'Frames are saved at the capture device’s own resolution and embedded in the print and Word output without re-compression.'
                    : 'Connect the video processor, pick it above and press “Start live view”. Everything stays on this computer.'}
                </div>
                <div className="spacer" />
                {cap.lastCaptured ? (
                  <div className="row small" style={{ gap: 6 }}>
                    <Camera size={12} className="muted" />
                    <span className="muted two-line">
                      Last · {cap.lastCaptured.width ? `${cap.lastCaptured.width} × ${cap.lastCaptured.height} · ` : ''}
                      {cap.lastCaptured.caption || 'saved'}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {view === 'findings' ? (
              <div className="console-form">
                <FindingsPanel
                  procedure={procedure}
                  activeSection={activeSection}
                  onSelectSection={(id) => setActiveSection(id)}
                  onToggleFinding={toggleFinding}
                  onSetValue={setValue}
                  onSetNote={setNote}
                  onSetSectionNote={setSectionNote}
                  aiEnabled={!!aiStatus?.enabled}
                  onAiReview={() => runAiReview(null)}
                  aiBusy={aiBusy}
                />
              </div>
            ) : null}

            {view === 'details' ? (
              <div className="console-form">
                <DetailsPanel
                  procedure={procedure}
                  patch={patch}
                  activeSection={activeSection}
                  onSelectSection={setActiveSection}
                  audit={analysis?.audit}
                />
              </div>
            ) : null}
          </section>

          <aside className="console-report">
            {view === 'findings' ? (
              <>
                {analysis ? (
                  <AutoSummary
                    analysis={analysis}
                    procedure={procedure}
                    onUseDefault={() => patch({ impressionOverride: '' })}
                  />
                ) : null}
                <div style={{ marginTop: 12 }}>
                  <AuditPanel audit={analysis?.audit} onJump={(sectionId) => setActiveSection(sectionId)} />
                </div>
              </>
            ) : null}

            {view === 'details' ? (
              <>
                <AuditPanel audit={analysis?.audit} onJump={(sectionId) => { setView('findings'); setActiveSection(sectionId) }} />
                {analysis?.recommendations?.length ? (
                  <div style={{ marginTop: 12 }}>
                    <Card title="Recommendations generated" bodyClass="tight">
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.55 }}>
                        {analysis.recommendations.slice(0, 8).map((r, i) => (
                          <li key={i} style={{ marginBottom: 5 }}>{r}</li>
                        ))}
                      </ul>
                    </Card>
                  </div>
                ) : null}
              </>
            ) : null}

            {view === 'console' && model ? (
              <>
                {/* The plate lives inside the report sheet itself (right-hand
                    column, or three-on-top), so what is on screen is exactly
                    what comes out of the printer. Only the controls sit here. */}
                <div className="report-col-head">
                  <div className="report-col-title">Report</div>
                  <Button size="sm" icon={FileText} onClick={openWordReport} disabled={busy}>
                    Open Word file
                  </Button>
                  <Button size="sm" icon={ImagePlusIcon} onClick={() => setImagePlus(true)}>
                    Image Plus
                  </Button>
                  <PlateControls
                    model={model}
                    onLayout={(id) => patch({ imageLayout: id })}
                    onAutoFill={autoFillPlate}
                    onClearAll={clearPlate}
                  />
                </div>

                <div className="report-scroll">
                  <ReportView
                    model={model}
                    compact
                    editable
                    docMode={!!model.reportDoc?.custom}
                    onDocSave={(html) => patch({ docHtml: html })}
                    onDocReset={() => patch({ docHtml: '', docName: '' })}
                    onImagePick={(i) => setPicker({ index: i })}
                    onImageClear={clearPicture}
                    onImageMove={movePicture}
                    onImageCaption={setPlateCaption}
                    onAddPicture={(i) => {
                      const idx = Number.isInteger(i) ? i : slotIds.indexOf(null)
                      setPicker({ index: idx >= 0 ? idx : null })
                    }}
                    onField={(kind, key, value) => {
                      if (kind === 'patient') {
                        setPatient((p) => {
                          const next = { ...p, [key]: value }
                          api.patients.update(next.id, next).catch(() => {})
                          return next
                        })
                      } else {
                        patch({ [key]: value })
                      }
                    }}
                    onRichSave={(html) => patch({ reportHtml: html })}
                    onRichReset={() => patch({ reportHtml: '' })}
                    onPrint={doPrint}
                    onDocx={doDocx}
                    onPdf={doPdf}
                    onCopy={doCopy}
                    astats={analysis?.audit}
                    busy={busy}
                  />
                </div>
              </>
            ) : null}
          </aside>
        </div>
      </div>

      <ImagePlus
        open={imagePlus}
        onClose={() => setImagePlus(false)}
        model={model}
        media={media}
        onLayout={(id) => patch({ imageLayout: id })}
        onPick={(i) => setPicker({ index: i })}
        onClear={clearPicture}
        onAutoFill={autoFillPlate}
        onClearAll={clearPlate}
        onCapture={() => cap.captureStill()}
        live={cap.live}
        busy={busy}
      />

      <PicturePicker
        open={!!picker}
        onClose={() => setPicker(null)}
        media={media}
        excludeIds={slotIds.filter(Boolean)}
        onChoose={choosePicture}
        onImport={importFiles}
        slotLabel={picker?.index !== null && picker?.index !== undefined ? `picture ${picker.index + 1}` : null}
      />

      {preview ? (
        <MediaModal
          item={preview}
          onClose={() => setPreview(null)}
          onDelete={removeMedia}
          onPlate={(m) => {
            placeOnPlate(m)
            setPreview(null)
          }}
          onCaption={setPlateCaption}
        />
      ) : null}

      <Modal
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        width="wide"
        title="Media library"
        footer={<Button onClick={() => setLibraryOpen(false)}>Close</Button>}
      >
        {media.length ? (
          <div className="thumb-grid">
            {media.map((m) => (
              <MediaThumb
                key={m.id}
                item={m}
                selected={slotIds.includes(m.id)}
                onOpen={setPreview}
                onDelete={removeMedia}
                onCaption={setPlateCaption}
                onAiReview={runAiReview}
                aiEnabled={!!aiStatus?.enabled}
                aiBusy={aiBusy}
              />
            ))}
          </div>
        ) : (
          <Empty
            icon={Camera}
            title="No images captured yet"
            hint="Start the live view and press “Capture”, or import pictures from this computer."
            action={<Button onClick={importFiles}>Import files</Button>}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={confirmFinal}
        title="Mark this report as final"
        message="The report will be marked final and locked as a signed study."
        detail="You can still reopen and edit it later — it is a status change, not a deletion."
        confirmLabel="Mark final"
        tone="success"
        onConfirm={finalise}
        onCancel={() => setConfirmFinal(false)}
      />

      <AiReviewDialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        busy={aiBusy}
        result={aiResult}
        status={aiStatus}
        media={aiSourceMedia}
        procedure={procedure}
        onAccept={acceptAiSuggestion}
        onOpenSettings={() => toast.push({ tone: 'warn', title: 'Enable AI in Settings', body: 'Settings ▸ AI assist — add a base URL and API key.' })}
      />
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Full-size media preview                                                     */
/* -------------------------------------------------------------------------- */

function MediaModal({ item, onClose, onDelete, onPlate, onCaption }) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    let alive = true
    mediaSrc(item.filePath).then((s) => alive && setSrc(s))
    return () => {
      alive = false
    }
  }, [item.filePath])

  return (
    <Modal
      open
      onClose={onClose}
      width="wide"
      title={item.caption || (item.kind === 'video' ? 'Video' : 'Image')}
      footer={
        <>
          {item.kind === 'image' ? (
            <Button variant="primary" onClick={() => onPlate?.(item)}>
              Put on the report plate
            </Button>
          ) : null}
          <Button onClick={() => api.app.revealPath(item.filePath)}>Show in folder</Button>
          <div className="spacer" />
          <Button variant="danger" onClick={() => onDelete?.(item)}>Delete</Button>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div style={{ background: '#05080f', borderRadius: 10, padding: 8, minHeight: 220 }}>
        {!src ? (
          <div className="center muted" style={{ padding: 60 }}>Loading…</div>
        ) : item.kind === 'video' ? (
          <video src={src} controls autoPlay style={{ width: '100%', maxHeight: '68vh' }} />
        ) : (
          <img src={src} alt={item.caption || ''} style={{ width: '100%', maxHeight: '68vh', objectFit: 'contain' }} />
        )}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <input
          className="input"
          defaultValue={item.caption || ''}
          placeholder="Caption printed under the picture"
          onBlur={(e) => onCaption?.(item, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* AI review dialog                                                            */
/* -------------------------------------------------------------------------- */

function AiReviewDialog({ open, onClose, busy, result, status, media, procedure, onAccept, onOpenSettings }) {
  const [previewSrc, setPreviewSrc] = useState('')

  useEffect(() => {
    let alive = true
    if (media?.filePath) mediaSrc(media.filePath).then((s) => alive && setPreviewSrc(s))
    return () => {
      alive = false
    }
  }, [media])

  const observations = result?.observations || []

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="wide"
      title="AI image review (assistive)"
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'start' }}>
        <div>
          {previewSrc ? (
            <img src={previewSrc} alt="Reviewed frame" style={{ width: '100%', borderRadius: 10, border: '1px solid var(--line)' }} />
          ) : (
            <div className="small muted">No image selected.</div>
          )}
          <div className="tiny muted" style={{ marginTop: 6 }}>
            {media?.caption || ''}
          </div>
        </div>

        <div>
          {busy ? (
            <div className="row" style={{ gap: 8 }}>
              <Loader2 size={16} className="spin" />
              <span className="small">Analysing the frame…</span>
            </div>
          ) : result?.error ? (
            <Banner tone="err">
              <strong>AI review unavailable</strong>
              <div className="small" style={{ marginTop: 4 }}>{result.error}</div>
              <div style={{ marginTop: 10 }}>
                <Button size="sm" onClick={onOpenSettings}>
                  Open settings
                </Button>
              </div>
            </Banner>
          ) : result ? (
            <>
              <div className="row" style={{ gap: 8, marginBottom: 10 }}>
                <Chip tone="brand">
                  <Sparkles size={11} /> {observations.length} suggestion(s)
                </Chip>
                {result.quality ? <Chip tone={result.quality === 'good' ? 'ok' : 'warn'}>Image quality: {result.quality}</Chip> : null}
              </div>
              {result.summary ? <p className="small" style={{ marginTop: 0 }}>{result.summary}</p> : null}

              {observations.length ? (
                <div>
                  {observations.map((o, i) => {
                    const def = sectionsForProcedure(procedure.testName)
                      .map((s) => findFindingDef(s.id, o.findingId))
                      .find(Boolean)
                    return (
                      <div key={i} className="audit-item info" style={{ alignItems: 'center' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600 }}>{def?.label || o.label || o.findingId}</div>
                          <div className="tiny">
                            {o.region ? `${o.region} · ` : ''}
                            {o.confidence !== undefined ? `confidence ${Math.round(Number(o.confidence) * 100)}%` : ''}
                          </div>
                          {o.note ? <div className="tiny">{o.note}</div> : null}
                        </div>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => onAccept({ ...o, findingId: def?.id || o.findingId })}
                          disabled={!def}
                          title={def ? 'Add this finding to the report' : 'This finding id is not valid for this procedure'}
                        >
                          Add
                        </Button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="banner info">
                  <div className="small">No specific abnormality was suggested for this frame.</div>
                </div>
              )}

              <div className="banner warn" style={{ marginTop: 12 }}>
                <div className="small">
                  AI output is a prompt for your own review — it is never inserted into the report automatically and it is
                  not a diagnosis. Every suggestion must be confirmed by the endoscopist.
                </div>
              </div>
            </>
          ) : (
            <div className="small muted">
              {status?.enabled ? 'Ready.' : 'AI assist is switched off. Enable it in Settings ▸ AI assist.'}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
