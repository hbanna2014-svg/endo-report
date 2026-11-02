/**
 * CaptureStage.jsx — the live endoscopic picture plus its capture controls.
 *
 * One component, used both in the full Images tab and beside the report in the
 * live console, so the capture behaviour can never drift between the two.
 *
 * The picture is fitted, never cropped: the stage measures the space it has and
 * draws the largest box that keeps the card's own aspect ratio, including after
 * a quarter turn. That is what makes the whole camera view visible instead of a
 * letterboxed or cut-off slice of it.
 */

import React, { useEffect, useRef, useState } from 'react'
import { Camera, MonitorOff, Play, RefreshCw, Square, Video, Settings2, RotateCw } from 'lucide-react'

import { CAPTURE_QUALITY, fmtDuration } from '../lib/useCapture.js'
import { ROTATION_OPTIONS, fitWithin, rotatedSize, rotationBadge } from '../lib/frameRotation.js'
import { Button, Chip, Field, Select } from './ui.jsx'

/** Tracks the pixel size of an element so the picture can be fitted to it. */
function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  return size
}

export default function CaptureStage({ cap, activeSection, onSelectSection, compact = false, showDevicePicker = true }) {
  const {
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
    frameSize,
    sections,
    sectionLabel,
    refreshDevices,
    startStream,
    stopStream,
    captureStill,
    startRecording,
    stopRecording,
  } = cap

  const stageRef = useRef(null)
  const stageSize = useElementSize(stageRef)

  const hasFrame = !!(frameSize?.width && frameSize?.height)
  const turned = rotatedSize(frameSize?.width, frameSize?.height, activeRotation)
  // Largest box that shows the entire frame inside the space available.
  const box = hasFrame && stageSize.width > 0 ? fitWithin(stageSize, turned.width, turned.height) : null

  const swap = activeRotation % 180 !== 0
  const videoStyle = {
    display: live ? 'block' : 'none',
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: box ? (swap ? box.height : box.width) : '100%',
    height: box ? (swap ? box.width : box.height) : '100%',
    transform: `translate(-50%, -50%) rotate(${activeRotation}deg)`,
    objectFit: 'contain',
    objectPosition: 'center',
  }

  const megapixels = frameSize ? ((frameSize.width * frameSize.height) / 1e6).toFixed(1) : null

  /* A one-click quarter turn: the fastest way out of a sideways picture, and
     the choice is remembered for the next patient. */
  const nudgeRotation = () => {
    const order = [0, 90, 180, 270]
    const current = order.includes(Number(rotation)) ? Number(rotation) : activeRotation
    setRotation(String(order[(order.indexOf(current) + 1) % order.length]))
  }

  return (
    <div className={`stage-wrap${compact ? ' compact' : ''}`}>
      {showDevicePicker ? (
        <div className="stage-head">
          <Field label="Capture device">
            {/* The rescan button sits inside the field so the three pickers stay
                on one row on a 1366 px laptop. */}
            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <Select
                value={deviceId}
                onChange={(e) => {
                  setDeviceId(e.target.value)
                  if (live) {
                    stopStream()
                    setTimeout(startStream, 250)
                  }
                }}
                options={devices.map((d, i) => ({ value: d.deviceId, label: d.label || `Video input ${i + 1}` }))}
                placeholder={devices.length ? 'Select a device…' : 'No device found'}
                style={{ flex: 1, minWidth: 0 }}
              />
              <Button size="sm" icon={RefreshCw} onClick={refreshDevices} title="Rescan for capture devices" />
            </div>
          </Field>
          <Field label="Section for the next capture">
            <Select
              value={activeSection || ''}
              onChange={(e) => onSelectSection?.(e.target.value)}
              options={sections.map((s) => ({ value: s.id, label: s.label }))}
              placeholder="Select section…"
            />
          </Field>
          <Field label="Capture resolution">
            <Select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              options={CAPTURE_QUALITY.map((q) => ({ value: q.id, label: q.label }))}
            />
          </Field>
        </div>
      ) : null}

      {error ? (
        <div className="banner err" style={{ marginBottom: 10 }}>
          <MonitorOff size={17} style={{ flex: '0 0 17px', marginTop: 1 }} />
          <div className="small" style={{ flex: 1 }}>
            {error}
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              <Button size="sm" variant="primary" icon={RefreshCw} onClick={startStream}>
                Try again
              </Button>
              <Button size="sm" icon={RefreshCw} onClick={refreshDevices}>
                Rescan devices
              </Button>
              <span className="tiny muted">
                Tip: most “could not start video source” errors clear as soon as the other program releases the card.
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* The stage is the measuring frame; .stage-fit inside it is the picture,
          sized so that the entire frame is visible without cropping. */}
      <div className="capture-stage" ref={stageRef}>
        <div className="stage-fit" style={box ? { width: box.width, height: box.height } : { width: '100%', height: '100%' }}>
          <video ref={videoRef} playsInline muted style={videoStyle} />
        </div>

        {!live ? (
          <div className="placeholder">
            <Camera size={compact ? 24 : 30} style={{ opacity: 0.4, marginBottom: 8 }} />
            <div>Start the live view to see the endoscopic image here.</div>
            {!compact ? (
              <div className="tiny" style={{ marginTop: 6 }}>
                Connect the video processor / capture card, then choose it above.
              </div>
            ) : null}
          </div>
        ) : null}

        {live ? (
          <span className="capture-badge">
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} />
            LIVE · {sectionLabel || 'no section selected'}
            {frameSize ? ` · ${frameSize.width}×${frameSize.height}${rotationBadge(activeRotation)}` : ''}
          </span>
        ) : null}

        {recording ? (
          <span className="capture-badge" style={{ left: 'auto', right: 9, background: 'rgba(185,28,28,.9)' }}>
            <span className="rec-dot" />
            REC {fmtDuration(recSeconds)}
          </span>
        ) : null}
      </div>

      <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
        {!live ? (
          <Button variant="primary" icon={Play} onClick={startStream} disabled={!devices.length}>
            Start live view
          </Button>
        ) : (
          <Button icon={MonitorOff} onClick={stopStream}>
            Stop
          </Button>
        )}
        <Button variant="success" icon={Camera} onClick={() => captureStill()} disabled={!live || busy}>
          Capture image
        </Button>
        {recording ? (
          <Button variant="recording" icon={Square} onClick={stopRecording}>
            Stop {fmtDuration(recSeconds)}
          </Button>
        ) : (
          <Button variant="danger" icon={Video} onClick={startRecording} disabled={!live || busy}>
            Record
          </Button>
        )}
        <div className="spacer" />
        {frameSize ? (
          <Chip tone={frameSize.width >= 1000 ? 'ok' : 'warn'} title="Frames are stored at the sensor's own size, losslessly">
            {frameSize.width} × {frameSize.height}
            {megapixels ? ` · ${megapixels} MP` : ''}
          </Chip>
        ) : null}
      </div>

      <div className="row wrap" style={{ gap: 10, marginTop: 8 }}>
        <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={autoCaption} onChange={(e) => setAutoCaption(e.target.checked)} />
          Auto-caption with the section name
        </label>
        <label className="row small" style={{ gap: 6, cursor: 'pointer' }} title="Removes the black frame some capture cards add around the picture">
          <input type="checkbox" checked={trimBlack} onChange={(e) => setTrimBlack(e.target.checked)} />
          Trim black border
        </label>
        {/* Orientation lives with the other capture preferences rather than in
            the header: the console's centre column is narrow, and a fourth
            picker there wrapped onto its own row and cost picture height. */}
        <label className="row small" style={{ gap: 6 }} title="Turn the live picture when the capture card sends it sideways">
          <span className="muted">Orientation</span>
          <select
            className="select"
            style={{ width: 132, padding: '3px 6px', fontSize: 11.5 }}
            value={String(rotation)}
            onChange={(e) => setRotation(e.target.value)}
          >
            {ROTATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn ghost sm"
            style={{ padding: '2px 6px' }}
            onClick={nudgeRotation}
            title="Turn the picture a quarter turn"
          >
            <RotateCw size={12} />
          </button>
        </label>
        <span className="spacer" />
        {!showDevicePicker ? (
          <Button
            size="sm"
            variant="ghost"
            icon={Settings2}
            onClick={() => setQuality(CAPTURE_QUALITY[(CAPTURE_QUALITY.findIndex((q) => q.id === quality) + 1) % CAPTURE_QUALITY.length].id)}
            title="Cycle the capture resolution"
          >
            {quality === 'max' ? 'Max resolution' : `${quality}p`}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
