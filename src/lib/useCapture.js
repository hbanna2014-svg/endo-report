/**
 * useCapture.js — the whole live-capture engine as one hook.
 *
 * Shared by the full "Images" tab and by the live reporting console, so a frame
 * captured next to the report goes through exactly the same path as one
 * captured in the media library: native sensor resolution -> lossless PNG ->
 * patient folder on this computer. Nothing is re-encoded, resized or uploaded.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from './api.js'
import { buildConstraintStages, describeMediaError, isDeviceBusy } from './captureConstraints.js'
import { effectiveRotation, rotateCanvas } from './frameRotation.js'
import { sectionsForProcedure } from './anatomy.js'
import { useToast } from '../components/ui.jsx'

/** Capture card / video processor resolutions we offer. "max" asks for the most the device has. */
// Labels stay short so the whole value is readable inside the capture toolbar,
// which has three selects side by side on a 1366 px laptop.
export const CAPTURE_QUALITY = [
  { id: 'max', label: 'Highest available', size: { width: 3840, height: 2160 } },
  { id: '1080', label: 'Full HD 1920×1080', size: { width: 1920, height: 1080 } },
  { id: '720', label: 'HD 1280×720', size: { width: 1280, height: 720 } },
  { id: 'pal', label: 'PAL 720×576', size: { width: 720, height: 576 } },
]

function pickMime() {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
  if (typeof MediaRecorder === 'undefined') return ''
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) || ''
}

/**
 * Strips a uniform black frame that many capture cards leave around the
 * endoscopic picture. A line is only removed when it is almost entirely
 * near-black, and never more than a quarter of the picture from any edge, so a
 * genuinely dark lumen is never eaten into.
 */
function trimDarkBorder(source) {
  const w = source.width
  const h = source.height
  if (w < 48 || h < 48) return { canvas: source, cropped: false }

  const ctx = source.getContext('2d', { willReadFrequently: true })
  const { data } = ctx.getImageData(0, 0, w, h)
  const DARK = 20
  const STEP = 3
  const isDark = (i) => data[i] < DARK && data[i + 1] < DARK && data[i + 2] < DARK

  const rowDark = (y) => {
    let dark = 0
    let n = 0
    const base = y * w * 4
    for (let x = 0; x < w; x += STEP) {
      if (isDark(base + x * 4)) dark += 1
      n += 1
    }
    return n ? dark / n : 1
  }
  const colDark = (x) => {
    let dark = 0
    let n = 0
    for (let y = 0; y < h; y += STEP) {
      if (isDark((y * w + x) * 4)) dark += 1
      n += 1
    }
    return n ? dark / n : 1
  }

  const limitRow = Math.floor(h * 0.25)
  const limitCol = Math.floor(w * 0.25)
  let top = 0
  let bottom = 0
  let left = 0
  let right = 0
  while (top < limitRow && rowDark(top) > 0.995) top += 1
  while (bottom < limitRow && rowDark(h - 1 - bottom) > 0.995) bottom += 1
  while (left < limitCol && colDark(left) > 0.995) left += 1
  while (right < limitCol && colDark(w - 1 - right) > 0.995) right += 1

  const cw = w - left - right
  const ch = h - top - bottom
  if (left + right + top + bottom < 4) return { canvas: source, cropped: false }
  if (cw < w * 0.4 || ch < h * 0.4) return { canvas: source, cropped: false }

  const out = document.createElement('canvas')
  out.width = cw
  out.height = ch
  out.getContext('2d', { alpha: false }).drawImage(source, left, top, cw, ch, 0, 0, cw, ch)
  return { canvas: out, cropped: true, box: { left, top, right, bottom } }
}

/**
 * The capture card stays open across tab switches.
 *
 * Opening a video processor is the slow part — the card renegotiates its HDMI
 * mode and can take a second or two before the first frame arrives. The stream
 * used to be closed whenever the console was left, so every return paid that
 * cost again. It is now held here, outside React, and re-attached instantly;
 * only leaving the patient, pressing Stop or changing device closes it.
 */
const warm = { stream: null, deviceId: '', holders: 0 }

function streamIsLive(stream) {
  return !!stream && stream.getVideoTracks().some((t) => t.readyState === 'live')
}

function stopWarmStream() {
  if (warm.stream) {
    warm.stream.getTracks().forEach((t) => t.stop())
    warm.stream = null
    warm.deviceId = ''
  }
}

/**
 * Pins the shared stream while a console pane is on screen.
 *
 * Two sessions can be open side by side, and closing one of them must not yank
 * the camera out from under the other. The stream is only released when the last
 * holder unmounts.
 */
export function retainWarmStream() {
  warm.holders += 1
  let released = false
  return () => {
    if (released) return
    released = true
    warm.holders = Math.max(0, warm.holders - 1)
    if (warm.holders === 0) stopWarmStream()
  }
}

/** Explicit stop — the operator pressed Stop or left the patient entirely. */
export function closeWarmStream() {
  warm.holders = 0
  stopWarmStream()
}

export function fmtDuration(sec) {
  if (!sec && sec !== 0) return ''
  const s = Math.round(Number(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/* -------------------------------------------------------------------------- */
/* Scope capture button                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Keys offered for the endoscope's own capture button.
 *
 * Most video processors with a keyboard port (Olympus, Pentax, Fujifilm, and
 * the generic Chinese processors built around them) send an ordinary key press
 * to the PC when the button on the scope is pressed — usually F1/F2 or a
 * multimedia key. Windows cannot see that press any other way, so the clinic
 * teaches the app which key its processor sends.
 */
export const CAPTURE_KEY_OPTIONS = [
  { value: '', label: 'Off' },
  { value: 'any', label: 'Any key' },
  { value: 'F1', label: 'F1' },
  { value: 'F2', label: 'F2' },
  { value: 'F3', label: 'F3' },
  { value: 'F4', label: 'F4' },
  { value: 'F5', label: 'F5' },
  { value: 'F6', label: 'F6' },
  { value: 'F7', label: 'F7' },
  { value: 'F8', label: 'F8' },
  { value: 'F9', label: 'F9' },
  { value: 'F10', label: 'F10' },
  { value: 'F11', label: 'F11' },
  { value: 'F12', label: 'F12' },
  { value: 'PrintScreen', label: 'Print Screen' },
  { value: 'Insert', label: 'Insert' },
  { value: 'Enter', label: 'Enter' },
  { value: 'Space', label: 'Space' },
]

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'Dead', 'Unidentified'])

/** True when the keystroke belongs to a text field, so "Any key" must not fire. */
function isTypingTarget(target) {
  if (!target || !target.tagName) return false
  const tag = target.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  return target.isContentEditable === true
}

export default function useCapture({
  patientId,
  procedureId,
  media,
  setMedia,
  activeSection,
  procedure,
  onCaptured,
  autoStart = false,
}) {
  const toast = useToast()
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const recStartRef = useRef(0)
  const mediaRef = useRef(media)

  useEffect(() => {
    mediaRef.current = media
  }, [media])

  const [devices, setDevices] = useState([])
  const [deviceId, setDeviceId] = useState('')
  const [live, setLive] = useState(false)
  const [error, setError] = useState('')
  const [recording, setRecording] = useState(false)
  const [recSeconds, setRecSeconds] = useState(0)
  const [busy, setBusy] = useState(false)
  const [autoCaption, setAutoCaption] = useState(true)
  const [trimBlack, setTrimBlack] = useState(true)
  const [quality, setQuality] = useState('max')
  // 'auto' | 0 | 90 | 180 | 270 — a capture card that hands over a portrait
  // buffer makes the picture look sideways; this turns it back.
  const [rotation, setRotation] = useState('auto')
  // '' = off, 'any' = any key, otherwise an event.key such as "F2".
  const [captureKey, setCaptureKey] = useState('')
  const [learningKey, setLearningKey] = useState(false)
  // Remembered by label as well as id: the deviceId changes when the portable
  // folder is copied to another computer, the label ("LB725 Video Device") does not.
  const [deviceLabel, setDeviceLabel] = useState('')
  // True when the card exists but Windows refused to start it — the only case
  // where switching to the DirectShow driver can help.
  const [deviceBusy, setDeviceBusy] = useState(false)
  const [captureEngine, setCaptureEngine] = useState('default')
  const [canSwitchEngine, setCanSwitchEngine] = useState(false)
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [lastCaptured, setLastCaptured] = useState(null)
  const [frameSize, setFrameSize] = useState(null)

  const sections = useMemo(() => (procedure ? sectionsForProcedure(procedure.testName) : []), [procedure])
  const sectionLabel = useMemo(() => {
    const s = sections.find((x) => x.id === activeSection)
    return s ? s.label : ''
  }, [sections, activeSection])

  /** The angle actually used right now, after "auto" has been resolved. */
  const activeRotation = useMemo(() => effectiveRotation(frameSize, rotation), [frameSize, rotation])

  /* Capture preferences survive a restart: an operator should not have to set
     the orientation and the black-border trim again every morning. */
  useEffect(() => {
    let alive = true
    api.settings
      .get('capture', null)
      .then((saved) => {
        if (!alive) return
        if (saved) {
          if (saved.rotation !== undefined) setRotation(saved.rotation)
          if (saved.quality) setQuality(saved.quality)
          if (typeof saved.trimBlack === 'boolean') setTrimBlack(saved.trimBlack)
          if (typeof saved.autoCaption === 'boolean') setAutoCaption(saved.autoCaption)
          if (typeof saved.captureKey === 'string') setCaptureKey(saved.captureKey)
          if (saved.deviceLabel) setDeviceLabel(saved.deviceLabel)
          if (saved.deviceId) setDeviceId((cur) => cur || saved.deviceId)
        }
        setPrefsLoaded(true)
      })
      .catch(() => setPrefsLoaded(true))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!prefsLoaded) return
    api.settings.set('capture', { rotation, quality, trimBlack, autoCaption, captureKey, deviceId, deviceLabel }).catch(() => {})
  }, [prefsLoaded, rotation, quality, trimBlack, autoCaption, captureKey, deviceId, deviceLabel])

  const refreshDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setError('This environment does not expose any capture devices to the application.')
        return
      }
      const list = await navigator.mediaDevices.enumerateDevices()
      const cams = list.filter((d) => d.kind === 'videoinput')
      setDevices(cams)
      setDeviceId((cur) => {
        if (cur && cams.some((c) => c.deviceId === cur)) return cur
        // The saved id can be stale: device ids are per profile, so a portable
        // folder copied to another computer has to find its card by name.
        const wanted = (deviceLabel || '').trim().toLowerCase()
        if (wanted) {
          const exact = cams.find((c) => (c.label || '').trim().toLowerCase() === wanted)
          const loose = cams.find((c) => (c.label || '').toLowerCase().includes(wanted))
          if (exact || loose) return (exact || loose).deviceId
        }
        // Prefer a capture card over the laptop's own webcam on a fresh machine.
        const grabber = cams.find((c) =>
          /capture|grabber|video device|hdmi|usb video|endoscop|\blb\d|ezcap|avermedia|elgato|magewell|dazzle/i.test(c.label || ''),
        )
        return grabber?.deviceId || cams[0]?.deviceId || ''
      })
    } catch (err) {
      setError(err.message)
    }
  }, [deviceLabel])

  useEffect(() => {
    refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices)
  }, [refreshDevices])

  /**
   * A callback ref for the <video> element.
   *
   * The console re-creates that element when its layout changes, and a plain
   * ref leaves the new node empty while the hook still reports "live": the
   * picture goes black and every capture fails with "no video frame". Attaching
   * the stream whenever the node appears keeps the picture on screen across
   * re-mounts, and re-attaches the warm stream instantly after a tab switch.
   */
  const attachVideo = useCallback((node) => {
    videoRef.current = node
    if (!node) return
    const stream = streamRef.current || (streamIsLive(warm.stream) ? warm.stream : null)
    if (!stream) return
    if (node.srcObject !== stream) {
      node.srcObject = stream
      void node.play().catch(() => {})
    }
    setLive(true)
    const settings = stream.getVideoTracks()[0]?.getSettings?.()
    if (settings?.width) setFrameSize({ width: settings.width, height: settings.height })
  }, [])

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    closeWarmStream()
    setLive(false)
  }, [])

  /** Leaving the screen must not close the card — only detach the picture. */
  useEffect(
    () => () => {
      if (videoRef.current) videoRef.current.srcObject = null
    },
    [],
  )

  /* Re-attach a stream that is still open, so the picture is on screen in the
     same frame the console appears. */
  useEffect(() => {
    const stream = warm.stream
    const wanted = warm.deviceId
    if (!streamIsLive(stream)) return
    if (deviceId && wanted && wanted !== deviceId) return
    streamRef.current = stream
    const el = videoRef.current
    if (!el) return
    el.srcObject = stream
    setLive(true)
    el.play().catch(() => {})
    const settings = stream.getVideoTracks()[0]?.getSettings?.()
    if (settings?.width) setFrameSize({ width: settings.width, height: settings.height })
  }, [deviceId])

  /**
   * Opens the card, relaxing the request until something works.
   *
   * A video processor / capture card only supports a fixed set of modes — a PAL
   * unit answers 720×576 and refuses anything else with NotReadableError, which
   * is exactly the "Could not start video source" failure seen on real hardware.
   * Trying the exact device without a size, then the device id without "exact",
   * then any camera, gets a picture on screen instead of an error box.
   */
  const openStream = useCallback(async (stages) => {
    let lastErr = null
    // A card that another program has just let go of needs a moment before the
    // driver will hand it over; three spaced retries cover that without making
    // a genuinely absent device take long to report.
    const retryDelays = [500, 1200, 2000]

    for (let i = 0; i < stages.length; i += 1) {
      for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const stream = await navigator.mediaDevices.getUserMedia({ video: stages[i], audio: false })
          return { stream, stage: i }
        } catch (err) {
          lastErr = err
          // A permission refusal will not improve by trying other constraints.
          if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') throw err
          // Overconstrained means this mode is wrong for the card: move on at once.
          if (err?.name === 'OverconstrainedError' || err?.name === 'ConstraintNotSatisfiedError') break
          // Anything else that means "would not start" gets one more pause.
          if (attempt < retryDelays.length) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, retryDelays[attempt]))
            continue
          }
          break
        }
      }
    }
    throw lastErr
  }, [])

  const startStream = useCallback(async () => {
    setError('')
    setDeviceBusy(false)
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This computer did not give the app access to a camera or capture card.')
        return
      }
      const want = (CAPTURE_QUALITY.find((q) => q.id === quality) || CAPTURE_QUALITY[0]).size
      const stages = buildConstraintStages(deviceId, want)
      const { stream, stage } = await openStream(stages)
      streamRef.current = stream
      warm.stream = stream
      warm.deviceId = deviceId || ''
      const track = stream.getVideoTracks()[0]
      const settings = track?.getSettings ? track.getSettings() : null
      if (settings?.width) setFrameSize({ width: settings.width, height: settings.height })

      const el = videoRef.current
      if (el) {
        el.srcObject = stream
        // Show the element as soon as the stream is attached: waiting for
        // play() to resolve made the console sit on a black rectangle for the
        // second or two the card needs to settle.
        setLive(true)
        void el.play().catch(() => {})
        if (!settings?.width) {
          el.addEventListener(
            'loadedmetadata',
            () => {
              if (el.videoWidth) setFrameSize({ width: el.videoWidth, height: el.videoHeight })
            },
            { once: true },
          )
        }
      } else {
        setLive(true)
      }
      refreshDevices()
      if (stage > 0) {
        const s = stream.getVideoTracks()[0]?.getSettings?.()
        toast.push({
          tone: 'info',
          title: 'Card opened at its own mode',
          body: `${s?.width ? `${s.width} × ${s.height}. ` : ''}This capture card does not offer the requested resolution, so the hardware default was used.`,
        })
      }
    } catch (err) {
      stopStream()
      setDeviceBusy(isDeviceBusy(err))
      setError(describeMediaError(err))
    }
  }, [deviceId, openStream, quality, refreshDevices, stopStream, toast])

  /* Which Windows driver stack this run is using. Shown next to the error so a
     failed open can be traced to Media Foundation instead of to the card. */
  useEffect(() => {
    let alive = true
    api.app
      .captureEngine()
      .then((res) => {
        if (!alive) return
        setCaptureEngine(res?.engine === 'directshow' ? 'directshow' : 'default')
        setCanSwitchEngine(!!res?.canSwitch)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  /** Saves the driver choice and restarts, so a stubborn card can be retried. */
  const switchCaptureEngine = useCallback(
    async (engine) => {
      try {
        const res = await api.app.setCaptureEngine(engine)
        setCaptureEngine(res?.engine === 'directshow' ? 'directshow' : 'default')
        if (res?.restartRequired) await api.app.relaunch()
        return res
      } catch (err) {
        toast.push({ tone: 'err', title: 'Could not change the capture driver', body: err.message })
        return null
      }
    },
    [toast],
  )

  /* Keep the remembered device name in step with the picked device, so the card
     can still be found after the folder is copied to another computer. */
  useEffect(() => {
    if (!devices.length) return
    const picked = devices.find((d) => d.deviceId === deviceId)
    if (picked?.label && picked.label !== deviceLabel) setDeviceLabel(picked.label)
  }, [deviceId, devices, deviceLabel])

  useEffect(() => {
    if (!autoStart) return
    if (live || !devices.length) return
    startStream()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices.length])

  useEffect(() => {
    if (!recording) return undefined
    const t = setInterval(() => setRecSeconds(Math.round((Date.now() - recStartRef.current) / 1000)), 500)
    return () => clearInterval(t)
  }, [recording])

  /* -------------------------------------------------------------- stills --- */

  const captureStill = useCallback(
    async (opts = {}) => {
      const video = videoRef.current
      if (!video || !live) {
        toast.push({ tone: 'warn', title: 'Start the live view first', body: 'Click “Start live view” so the capture device is open.' })
        return null
      }
      // Always the sensor's own frame — never the CSS size of the <video> box.
      const w = video.videoWidth
      const h = video.videoHeight
      if (!w || !h) {
        toast.push({ tone: 'warn', title: 'No video frame available yet' })
        return null
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { alpha: false })
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(video, 0, 0, w, h)

      // Turn the picture upright *before* trimming, so the saved PNG is already
      // in the orientation the endoscopist saw on screen.
      const angle = effectiveRotation({ width: w, height: h }, rotation)
      const upright = angle ? rotateCanvas(canvas, angle) : canvas

      // Drop the black frame the capture card adds, so the printed picture is
      // the endoscopic image itself and not a letterboxed copy of it.
      const trimmed = trimBlack ? trimDarkBorder(upright) : { canvas: upright, cropped: false }
      const frame = trimmed.canvas
      const fw = frame.width
      const fh = frame.height

      const blob = await new Promise((resolve) => frame.toBlob(resolve, 'image/png'))
      if (!blob) {
        toast.push({ tone: 'err', title: 'Could not encode the frame' })
        return null
      }
      const buffer = await blob.arrayBuffer()
      const stamp = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      const caption = autoCaption ? [sectionLabel, stamp].filter(Boolean).join(' — ') : ''
      setBusy(true)
      try {
        const rec = await api.media.addImage({
          patientId,
          procedureId,
          section: opts.section || activeSection || null,
          caption,
          data: buffer,
          mime: 'image/png',
        })
        setMedia([...mediaRef.current, rec])
        // Deliberately not overwriting frameSize here: it describes the live
        // card mode, and the preview must not change shape after a capture.
        setLastCaptured({ ...rec, width: fw, height: fh })
        const notes = []
        if (angle) notes.push(`Rotated ${angle}°`)
        if (trimmed.cropped) notes.push(`black border trimmed (was ${w} × ${h})`)
        toast.push({
          tone: 'ok',
          title: `Image captured · ${fw} × ${fh}`,
          body: notes.length
            ? `${notes.join(', ')}.`
            : autoCaption
              ? caption
              : 'Caption it from the picture rail.',
        })
        onCaptured?.(rec)
        return rec
      } catch (err) {
        toast.push({ tone: 'err', title: 'Could not save the image', body: err.message })
        return null
      } finally {
        setBusy(false)
      }
    },
    [activeSection, autoCaption, live, onCaptured, patientId, procedureId, rotation, sectionLabel, setMedia, toast, trimBlack],
  )

  /* ------------------------------------------- scope capture button ------- */

  const lastTrigger = useRef(0)
  const learnTimer = useRef(0)
  const flashTimer = useRef(0)
  const [flash, setFlash] = useState(false)

  /** A single short white flash on the stage, so a click that captured is felt. */
  const flashStage = useCallback(() => {
    setFlash(true)
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlash(false), 220)
  }, [])

  /**
   * One entry point for every trigger — the toolbar button, a click on the
   * picture and the key the endoscope sends. The 500 ms guard swallows the
   * key-repeat some processors emit when the button is held.
   */
  const captureFromButton = useCallback(async () => {
    const now = Date.now()
    if (now - lastTrigger.current < 500) return null
    lastTrigger.current = now
    flashStage()
    return captureStill()
  }, [captureStill, flashStage])

  const beginLearnCaptureKey = useCallback(() => {
    setLearningKey(true)
    window.clearTimeout(learnTimer.current)
    learnTimer.current = window.setTimeout(() => setLearningKey(false), 15000)
    toast.push({
      tone: 'info',
      title: 'Press the capture button on the endoscope',
      body: 'Listening for the key the processor sends…',
    })
  }, [toast])

  /**
   * The endoscope's own capture button.
   *
   * Windows sees that button only as a keystroke: the processor's keyboard port
   * forwards it as a normal key (F1/F2 on most units). Nothing in the browser
   * API can read the button directly, so the clinic teaches the key once and it
   * is remembered with the other capture preferences.
   */
  useEffect(() => {
    if (!live) return undefined

    const onKeyDown = (event) => {
      if (event.repeat) return

      if (learningKey) {
        if (MODIFIER_KEYS.has(event.key)) return
        event.preventDefault()
        event.stopPropagation()
        window.clearTimeout(learnTimer.current)
        setCaptureKey(event.key)
        setLearningKey(false)
        toast.push({
          tone: 'ok',
          title: `Scope button set to “${event.key}”`,
          body: 'Saved. Press the scope button again to test it.',
        })
        return
      }

      if (!captureKey) return

      if (captureKey === 'any') {
        if (MODIFIER_KEYS.has(event.key)) return
        if (event.ctrlKey || event.altKey || event.metaKey) return
        // Typing a patient's name must never fire the camera.
        if (isTypingTarget(event.target)) return
        void captureFromButton()
        return
      }

      if (event.key !== captureKey) return
      void captureFromButton()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [live, captureKey, learningKey, captureFromButton, toast])

  useEffect(() => () => window.clearTimeout(learnTimer.current), [])

  /* ------------------------------------------------------------- recording --- */

  const startRecording = useCallback(() => {
    const stream = streamRef.current
    if (!stream || !live) {
      toast.push({ tone: 'warn', title: 'Start the live view first' })
      return
    }
    const mime = pickMime()
    if (!mime) {
      toast.push({ tone: 'err', title: 'Video recording is not supported', body: 'This build of the runtime has no MediaRecorder video encoder.' })
      return
    }
    try {
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 })
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data)
      }
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mime.split(';')[0] })
        const seconds = Math.round((Date.now() - recStartRef.current) / 1000)
        chunksRef.current = []
        setRecording(false)
        if (!blob.size) {
          toast.push({ tone: 'warn', title: 'Nothing was recorded' })
          return
        }
        setBusy(true)
        try {
          const buffer = await blob.arrayBuffer()
          const rec2 = await api.media.addVideo({
            patientId,
            procedureId,
            section: activeSection || null,
            caption: [sectionLabel, 'video'].filter(Boolean).join(' — '),
            data: buffer,
            mime: mime.split(';')[0],
            durationSec: seconds,
          })
          setMedia((list) => [...list, rec2])
          toast.push({ tone: 'ok', title: 'Video saved', body: `${fmtDuration(seconds)} · ${(blob.size / 1048576).toFixed(1)} MB` })
        } catch (err) {
          toast.push({ tone: 'err', title: 'Could not save the video', body: err.message })
        } finally {
          setBusy(false)
        }
      }
      rec.start(1000)
      recorderRef.current = rec
      recStartRef.current = Date.now()
      setRecSeconds(0)
      setRecording(true)
    } catch (err) {
      toast.push({ tone: 'err', title: 'Recording failed to start', body: err.message })
    }
  }, [activeSection, live, patientId, procedureId, sectionLabel, setMedia, toast])

  const stopRecording = useCallback(() => {
    try {
      recorderRef.current?.stop()
    } catch {
      setRecording(false)
    }
  }, [])

  const toggleVideo = useCallback(() => (recording ? stopRecording() : startRecording()), [recording, startRecording, stopRecording])

  return {
    videoRef,
    attachVideo,
    devices,
    deviceId,
    setDeviceId,
    deviceLabel,
    deviceBusy,
    captureEngine,
    canSwitchEngine,
    switchCaptureEngine,
    captureKey,
    setCaptureKey,
    learningKey,
    beginLearnCaptureKey,
    flash,
    captureFromButton,
    live,
    error,
    recording,
    recSeconds,
    busy,
    autoCaption,
    setAutoCaption,
    trimBlack,
    setTrimBlack,
    quality,
    setQuality,
    rotation,
    setRotation,
    activeRotation,
    lastCaptured,
    frameSize,
    sections,
    sectionLabel,
    refreshDevices,
    startStream,
    stopStream,
    captureStill,
    startRecording,
    stopRecording,
    toggleVideo,
  }
}
