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
import { buildConstraintStages, describeMediaError } from './captureConstraints.js'
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
const warm = { stream: null, deviceId: '' }

function streamIsLive(stream) {
  return !!stream && stream.getVideoTracks().some((t) => t.readyState === 'live')
}

export function closeWarmStream() {
  if (warm.stream) {
    warm.stream.getTracks().forEach((t) => t.stop())
    warm.stream = null
    warm.deviceId = ''
  }
}

export function fmtDuration(sec) {
  if (!sec && sec !== 0) return ''
  const s = Math.round(Number(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
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
    api.settings.set('capture', { rotation, quality, trimBlack, autoCaption, deviceId }).catch(() => {})
  }, [prefsLoaded, rotation, quality, trimBlack, autoCaption, deviceId])

  const refreshDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        setError('This environment does not expose any capture devices to the application.')
        return
      }
      const list = await navigator.mediaDevices.enumerateDevices()
      const cams = list.filter((d) => d.kind === 'videoinput')
      setDevices(cams)
      setDeviceId((cur) => cur || cams[0]?.deviceId || '')
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices)
  }, [refreshDevices])

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
    for (let i = 0; i < stages.length; i += 1) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const stream = await navigator.mediaDevices.getUserMedia({ video: stages[i], audio: false })
          return { stream, stage: i }
        } catch (err) {
          lastErr = err
          // A permission refusal will not improve by trying other constraints.
          if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') throw err
          // The card may still be releasing itself — give it one short pause.
          if (err?.name === 'NotReadableError' && attempt === 0) {
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 650))
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
      setError(describeMediaError(err))
    }
  }, [deviceId, openStream, quality, refreshDevices, stopStream, toast])

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
    devices,
    deviceId,
    setDeviceId,
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
