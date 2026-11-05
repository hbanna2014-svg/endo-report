/**
 * AnnotationEditor.jsx — put markers on a captured frame.
 *
 * Two ways in:
 *   • "Mark findings" drops a numbered marker for every finding already recorded
 *     in this section (polyp, ulcer, erythema …) — a documentation aid, not a
 *     diagnosis read off the pixels.
 *   • Click anywhere on the picture to drop one by hand, then drag it.
 *
 * The result is stored twice: the marker list in the database (so it stays
 * editable) and a composited PNG beside the original (so Word and the printer,
 * which cannot overlay live markup, still show them).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MousePointerClick, Sparkles, Trash2, Save, RotateCcw } from 'lucide-react'

import { api } from '../lib/api.js'
import { MARKER_TYPES, composeMarkedImage, markerColor, markerLabel, autoPosition } from '../lib/markerTypes.js'
import { Button, useToast } from './ui.jsx'

let seq = 0
const nextId = () => `mk-${Date.now().toString(36)}-${(seq += 1)}`

export default function AnnotationEditor({ item, src, findings = [], onSaved, onCancel }) {
  const toast = useToast()
  const imgRef = useRef(null)
  const dragRef = useRef(null)
  const movedRef = useRef(false)
  const [markers, setMarkers] = useState(() => (Array.isArray(item.annotations) ? item.annotations : []))
  const [type, setType] = useState('polyp')
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setMarkers(Array.isArray(item.annotations) ? item.annotations : [])
    setSelected(null)
  }, [item.id])

  const addAt = useCallback(
    (x, y, markerType = type) => {
      const marker = { id: nextId(), type: markerType, label: markerLabel(markerType), x, y }
      setMarkers((list) => [...list, marker])
      setSelected(marker.id)
    },
    [type],
  )

  const autoMark = useCallback(() => {
    if (!findings.length) {
      toast.push({ tone: 'warn', title: 'Nothing to mark', body: 'Record the findings for this section first.' })
      return
    }
    // Keep the hand-placed markers; the automatic ones are rebuilt so pressing
    // the button twice does not stack duplicates.
    setMarkers((list) => {
      const manual = list.filter((m) => !m.auto)
      const auto = findings.map((f, index) => ({
        id: nextId(),
        type: f.type,
        label: f.label,
        auto: true,
        ...autoPosition(f.id || f.label, index),
      }))
      return [...manual, ...auto]
    })
  }, [findings, toast])

  const pointFromEvent = (e) => {
    const rect = imgRef.current?.getBoundingClientRect()
    if (!rect) return null
    return {
      x: Math.min(0.98, Math.max(0.02, (e.clientX - rect.left) / rect.width)),
      y: Math.min(0.98, Math.max(0.02, (e.clientY - rect.top) / rect.height)),
    }
  }

  const onWrapperDown = (e) => {
    if (e.button !== 0) return
    const p = pointFromEvent(e)
    if (p) addAt(p.x, p.y)
  }

  const onDotDown = (e, id) => {
    e.stopPropagation()
    e.preventDefault()
    dragRef.current = id
    movedRef.current = false
    setSelected(id)
  }

  const onMove = (e) => {
    if (!dragRef.current) return
    const p = pointFromEvent(e)
    if (!p) return
    movedRef.current = true
    setMarkers((list) => list.map((m) => (m.id === dragRef.current ? { ...m, x: p.x, y: p.y } : m)))
  }

  const onUp = () => {
    dragRef.current = null
  }

  const remove = (id) => {
    setMarkers((list) => list.filter((m) => m.id !== id))
    setSelected((s) => (s === id ? null : s))
  }

  useEffect(() => {
    const onKey = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault()
        remove(selected)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const save = async () => {
    if (!imgRef.current) return
    setSaving(true)
    try {
      const png = markers.length ? composeMarkedImage(imgRef.current, markers) : null
      const updated = await api.media.annotate(item.id, { annotations: markers, pngDataUrl: png })
      toast.push({
        tone: 'ok',
        title: markers.length ? `${markers.length} marker(s) saved` : 'Markers cleared',
        body: 'The printed and Word copies use these markers.',
      })
      onSaved?.(updated)
    } catch (err) {
      toast.push({ tone: 'err', title: 'Could not save the markers', body: err.message })
    } finally {
      setSaving(false)
    }
  }

  const legend = useMemo(() => markers.map((m, i) => ({ ...m, n: i + 1 })), [markers])

  return (
    <div className="annot">
      <div className="annot-tools">
        <div className="annot-types">
          {MARKER_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`annot-type${type === t.id ? ' on' : ''}`}
              onClick={() => setType(t.id)}
              title={`Place a ${t.label} marker`}
            >
              <span className="dot" style={{ background: t.color }} />
              {t.short}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <Button size="sm" variant="ghost" icon={Sparkles} onClick={autoMark} disabled={!findings.length}>
          Mark findings ({findings.length})
        </Button>
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setMarkers([])} disabled={!markers.length}>
          Clear
        </Button>
      </div>

      <div
        className="annot-stage"
        onPointerDown={onWrapperDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      >
        <div className="annot-canvas">
          <img ref={imgRef} src={src} alt={item.caption || ''} draggable={false} />
          {markers.map((m, index) => (
            <button
              key={m.id}
              type="button"
              className={`annot-dot${selected === m.id ? ' on' : ''}`}
              style={{
                left: `${m.x * 100}%`,
                top: `${m.y * 100}%`,
                background: markerColor(m.type),
              }}
              onPointerDown={(e) => onDotDown(e, m.id)}
              title={`${index + 1}. ${m.label || markerLabel(m.type)} — drag to move`}
            >
              {index + 1}
            </button>
          ))}
        </div>
      </div>

      <div className="annot-foot">
        <div className="annot-hint">
          <MousePointerClick size={13} /> Click the picture to add a marker, drag a marker to move it.
        </div>
        <div className="annot-legend">
          {legend.map((m) => (
            <span key={m.id} className="annot-chip" style={{ borderColor: markerColor(m.type) }}>
              <b style={{ color: markerColor(m.type) }}>{m.n}</b>
              {m.label || markerLabel(m.type)}
              <button type="button" onClick={() => remove(m.id)} title="Remove">
                <Trash2 size={11} />
              </button>
            </span>
          ))}
        </div>
        <div className="spacer" />
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" icon={Save} onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save markers'}
        </Button>
      </div>
    </div>
  )
}
