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
import { Camera, MonitorOff, Play, RefreshCw, Square, Video, Settings2, RotateCw, MousePointerClick } from 'lucide-react'

import { CAPTURE_KEY_OPTIONS, CAPTURE_QUALITY, fmtDuration } from '../lib/useCapture.js'
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
    attachVideo,
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
    captureFromButton,
    flash,
    deviceBusy,
    captureEngine,
    canSwitchEngine,
    switchCaptureEngine,
    captureKey,
    setCaptureKey,
    learningKey,
    beginLearnCaptureKey,
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

  /**
   * Clicking anywhere on the live picture takes a still.
   *
   * This is also how a processor behaves when its capture button emulates a
   * mouse click: the click lands on whatever is under the pointer, which
   * during a procedure is this stage.
   */
  const handleStageClick = (event) => {
    if (!live || busy) return
    if (event.target.closest('button, a, select, input, textarea')) return
    captureFromButton()
  }

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
              {canSwitchEngine ? (
                <Button
                  size="sm"
                  variant={deviceBusy ? 'warn' : 'ghost'}
                  icon={MonitorOff}
                  onClick={() => switchCaptureEngine(captureEngine === 'directshow' ? 'default' : 'directshow')}
                  title={
                    captureEngine === 'directshow'
                      ? 'Go back to the standard Windows driver (Media Foundation)'
                      : 'Older capture cards only start on the DirectShow driver. EndoReport will restart.'
                  }
                >
                  {captureEngine === 'directshow' ? 'Back to standard driver' : 'Restart with DirectShow'}
                </Button>
              ) : null}
              <span className="tiny muted">
                {deviceBusy
                  ? 'Closing the other program that holds the card is what usually fixes this. If it still fails, switch driver.'
                  : 'Tip: most “could not start video source” errors clear as soon as the other program releases the card.'}
              </span>
            </div>
            <div className="tiny muted" style={{ marginTop: 6 }}>
              Driver: {captureEngine === 'directshow' ? 'DirectShow (compatibility)' : 'Windows Media Foundation'}
            </div>
          </div>
        </div>
      ) : null}

      {/* The stage is the measuring frame; .stage-fit inside it is the picture,
          sized so that the entire frame is visible without cropping. */}
      <div
        className={`capture-stage${live ? ' clickable' : ''}${flash ? ' flash' : ''}`}
        ref={stageRef}
        onClick={handleStageClick}
        title={live ? 'Click the picture to capture an image' : undefined}
      >
        <div className="stage-fit" style={box ? { width: box.width, height: box.height } : { width: '100%', height: '100%' }}>
          <video ref={attachVideo || videoRef} playsInline muted style={videoStyle} />
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

        {live && !recording && !busy ? (
          <span className="capture-hint">
            <MousePointerClick size={12} /> Click the picture to capture
          </span>
        ) : null}

        {/* The flash is what makes a click feel like a shutter release. */}
        {flash ? <span className="capture-flash" /> : null}
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
        <Button variant="success" icon={Camera} onClick={() => captureFromButton()} disabled={!live || busy}>
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

        {/* The endoscope's own capture button reaches Windows as a keystroke.
            Learn listens for it once and remembers the key. */}
        <div className={`row small${learningKey ? ' scope-learning' : ''}`} style={{ gap: 6 }}>
          <span className="muted">Scope button</span>
          <select
            className="select"
            style={{ width: 92, padding: '3px 6px', fontSize: 11.5 }}
            value={captureKey}
            onChange={(e) => setCaptureKey(e.target.value)}
            title="The key the video processor sends when the capture button on the endoscope is pressed"
          >
            {CAPTURE_KEY_OPTIONS.map((o) => (
              <option key={o.value || 'off'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant={learningKey ? 'primary' : 'ghost'}
            onClick={beginLearnCaptureKey}
            title="Press the capture button on the endoscope; EndoReport will learn the key it sends"
          >
            {learningKey ? 'Press the scope button…' : 'Learn'}
          </Button>
        </div>

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
