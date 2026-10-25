/**
 * CaptureStage.jsx — the live endoscopic picture plus its capture controls.
 *
 * One component, used both in the full Images tab and beside the report in the
 * live console, so the capture behaviour can never drift between the two.
 */

import React from 'react'
import { Camera, MonitorOff, Play, RefreshCw, Square, Video, Settings2 } from 'lucide-react'

import { CAPTURE_QUALITY, fmtDuration } from '../lib/useCapture.js'
import { Button, Chip, Field, Select } from './ui.jsx'

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
    quality,
    setQuality,
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

  const megapixels = frameSize ? ((frameSize.width * frameSize.height) / 1e6).toFixed(1) : null

  return (
    <div className={`stage-wrap${compact ? ' compact' : ''}`}>
      {showDevicePicker ? (
        <div className="stage-head">
          <Field label="Capture device">
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
              placeholder={devices.length ? 'Select a device…' : 'No capture device found'}
            />
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
          <Button size="sm" icon={RefreshCw} onClick={refreshDevices} title="Rescan for capture devices" />
        </div>
      ) : null}

      {error ? (
        <div className="banner err" style={{ marginBottom: 10 }}>
          <MonitorOff size={17} style={{ flex: '0 0 17px', marginTop: 1 }} />
          <div className="small">{error}</div>
        </div>
      ) : null}

      <div className="capture-stage">
        <video ref={videoRef} playsInline muted style={{ display: live ? 'block' : 'none' }} />
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
            {frameSize ? ` · ${frameSize.width}×${frameSize.height}` : ''}
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
