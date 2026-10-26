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
import { sectionsForProcedure } from './anatomy.js'
import { useToast } from '../components/ui.jsx'

/** Capture card / video processor resolutions we offer. "max" asks for the most the device has. */
export const CAPTURE_QUALITY = [
  { id: 'max', label: 'Highest the device supports', size: { width: 3840, height: 2160 } },
  { id: '1080', label: 'Full HD — 1920 × 1080', size: { width: 1920, height: 1080 } },
  { id: '720', label: 'HD — 1280 × 720', size: { width: 1280, height: 720 } },
  { id: 'pal', label: 'PAL — 720 × 576 (older processors)', size: { width: 720, height: 576 } },
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
  const [lastCaptured, setLastCaptured] = useState(null)
  const [frameSize, setFrameSize] = useState(null)

  const sections = useMemo(() => (procedure ? sectionsForProcedure(procedure.testName) : []), [procedure])
  const sectionLabel = useMemo(() => {
    const s = sections.find((x) => x.id === activeSection)
    return s ? s.label : ''
  }, [sections, activeSection])

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
    setLive(false)
  }, [])

  useEffect(() => () => stopStream(), [stopStream])

  const startStream = useCallback(async () => {
    setError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This computer did not give the app access to a camera or capture card.')
        return
      }
      const want = (CAPTURE_QUALITY.find((q) => q.id === quality) || CAPTURE_QUALITY[0]).size
      const constraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: want.width }, height: { ideal: want.height } }
          : { width: { ideal: want.width }, height: { ideal: want.height } },
        audio: false,
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
        const track = stream.getVideoTracks()[0]
        const settings = track?.getSettings ? track.getSettings() : null
        if (settings?.width) setFrameSize({ width: settings.width, height: settings.height })
      }
      setLive(true)
      refreshDevices()
    } catch (err) {
      stopStream()
      setError(
        `Could not open the capture device: ${err.message}. Check that the video processor / capture card is connected and that no other program (OBS, the endoscopy unit software) is using it.`,
      )
    }
  }, [deviceId, quality, refreshDevices, stopStream])

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

      // Drop the black frame the capture card adds, so the printed picture is
      // the endoscopic image itself and not a letterboxed copy of it.
      const trimmed = trimBlack ? trimDarkBorder(canvas) : { canvas, cropped: false }
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
        setLastCaptured({ ...rec, width: fw, height: fh })
        setFrameSize({ width: fw, height: fh })
        toast.push({
          tone: 'ok',
          title: `Image captured · ${fw} × ${fh}`,
          body: trimmed.cropped
            ? `Black border trimmed (was ${w} × ${h}).`
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
    [activeSection, autoCaption, live, onCaptured, patientId, procedureId, sectionLabel, setMedia, toast, trimBlack],
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
