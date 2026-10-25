/**
 * ReportPlate.jsx — the picture plate that appears inside the report.
 *
 * Two fixed plates are offered, matching the paper forms most endoscopy units
 * already use: a 2 x 2 plate (four pictures) and a 2 x 3 plate (six pictures).
 * A free "flow" mode still lays out every captured picture in rows.
 *
 * When `editable` is on, an empty slot is a big, obvious "Add picture" button
 * and a filled slot can be swapped, re-captioned or cleared in one click.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { ImagePlus, Replace, Trash2, ArrowLeft, ArrowRight, Pencil, Check } from 'lucide-react'

import { api, mediaSrc } from '../lib/api.js'
import { Button, Modal } from './ui.jsx'

/** Cached, downscaled thumbnails so a 4K plate never loads six full frames. */
export function useThumbs(items, width = 320) {
  const [map, setMap] = useState({})
  const key = `${width}:${items.map((i) => i.id).join(',')}`

  useEffect(() => {
    let alive = true
    const missing = items.filter((i) => i && i.filePath && !map[i.id])
    if (!missing.length) return () => {}
    ;(async () => {
      const pairs = await Promise.all(
        missing.map(async (i) => {
          let dataUrl = ''
          try {
            const res = await api.media.thumbnail(i.filePath, i.id, width)
            dataUrl = res?.dataUrl || ''
          } catch {
            dataUrl = ''
          }
          if (!dataUrl) dataUrl = await mediaSrc(i.filePath)
          return [i.id, dataUrl]
        }),
      )
      if (alive) setMap((m) => ({ ...m, ...Object.fromEntries(pairs) }))
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return map
}

/* -------------------------------------------------------------------------- */

export default function ReportPlate({
  model,
  editable = false,
  onPick,
  onClear,
  onMove,
  onCaption,
  media = [],
  onAddPicture,
  variant = 'block',
  only = null,
}) {
  const plan = model.imagePlan || { mode: 'flow', columns: 3, slots: [] }
  const fixed = plan.mode === 'grid4' || plan.mode === 'grid6'
  const showCaptions = model.template.layout.showImageCaptions !== false

  const items = useMemo(
    () => plan.slots.map((s) => s.media).filter(Boolean),
    [plan],
  )
  // The screen preview uses a large cached thumbnail (never the multi-megabyte
  // original); the printed page and the Word file embed the untouched original,
  // so what is sharp on paper stays sharp on paper.
  const thumbs = useThumbs(items, 640)

  const srcFor = (m) => thumbs[m.id]

  const shown = only ? plan.slots.filter((sl) => only.includes(sl.no)) : plan.slots

  if (!fixed && !items.length) {
    return null
  }

  return (
    <div className={`report-plate ${variant} ${fixed ? `fixed ${plan.mode}` : 'flow'}`} style={{ '--plate-cols': plan.columns }}>
      {shown.map((slot) => {
        const i = slot.no - 1
        if (!fixed && !slot.media) return null
        const m = slot.media
        const src = m ? srcFor(m) : ''
        if (!m && !editable) return null

        return (
          <figure key={`${slot.no}-${slot.id || 'empty'}`} className={`plate-cell${m ? '' : ' empty'}`}>
            {m ? (
              <>
                {src ? (
                  <img src={src} alt={m.caption || ''} />
                ) : (
                  <div className="plate-loading">loading…</div>
                )}
                {editable ? (
                  <div className="plate-tools">
                    <button type="button" title="Change this picture" onClick={() => onPick?.(i)}>
                      <Replace size={12} />
                    </button>
                    {i > 0 ? (
                      <button type="button" title="Move earlier" onClick={() => onMove?.(i, i - 1)}>
                        <ArrowLeft size={12} />
                      </button>
                    ) : null}
                    {i < plan.capacity - 1 ? (
                      <button type="button" title="Move later" onClick={() => onMove?.(i, i + 1)}>
                        <ArrowRight size={12} />
                      </button>
                    ) : null}
                    <button type="button" title="Remove from the plate" onClick={() => onClear?.(i)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ) : null}
                {showCaptions ? (
                  <figcaption>
                    <SlotCaption value={m.caption || ''} index={slot.no} editable={editable} onSave={(v) => onCaption?.(m, v)} />
                  </figcaption>
                ) : null}
              </>
            ) : (
              <button type="button" className="plate-add" onClick={() => (onAddPicture ? onAddPicture(i) : onPick?.(i))}>
                <ImagePlus size={22} />
                <span>Add picture</span>
                <span className="tiny muted">slot {slot.no}</span>
              </button>
            )}
          </figure>
        )
      })}
    </div>
  )
}

function SlotCaption({ value, index, editable, onSave }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value)

  useEffect(() => setText(value), [value])

  if (!editable) {
    return (
      <span>
        {index}. {value || '(no caption)'}
      </span>
    )
  }

  if (editing) {
    return (
      <span className="cap-edit">
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onSave?.(text)
              setEditing(false)
            }
            if (e.key === 'Escape') {
              setText(value)
              setEditing(false)
            }
          }}
          onBlur={() => {
            onSave?.(text)
            setEditing(false)
          }}
        />
        <Check size={12} />
      </span>
    )
  }

  return (
    <span className="cap-view" onClick={() => setEditing(true)} title="Click to edit the caption">
      {index}. {value || '(no caption)'} <Pencil size={10} />
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Picture picker                                                             */
/* -------------------------------------------------------------------------- */

export function PicturePicker({
  open,
  onClose,
  media,
  excludeIds = [],
  onChoose,
  slotLabel,
  busy,
  onImport,
}) {
  const images = media.filter((m) => m.kind === 'image')
  const thumbs = useThumbs(images)
  const excluded = new Set(excludeIds)

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="wide"
      title={slotLabel ? `Choose a picture for ${slotLabel}` : 'Choose a picture'}
      footer={
        <>
          {onImport ? <Button icon={ImagePlus} onClick={onImport} disabled={busy}>Import from computer</Button> : null}
          <div className="spacer" />
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      {images.length ? (
        <div className="picker-grid">
          {images.map((m) => {
            const used = excluded.has(m.id)
            return (
              <button
                key={m.id}
                type="button"
                className={`picker-cell${used ? ' used' : ''}`}
                onClick={() => !used && onChoose?.(m)}
                title={used ? 'Already on the plate' : m.caption || 'Use this picture'}
              >
                {thumbs[m.id] ? <img src={thumbs[m.id]} alt="" /> : <div className="picker-skel" />}
                <span className="cap">{m.caption || '(no caption)'}</span>
                {used ? <span className="used-tag">on plate</span> : null}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="banner info">
          <div className="small">
            No pictures yet. Capture one from the live view, or import existing pictures from this computer.
          </div>
        </div>
      )}
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* Plate settings (shown above the plate inside the editor)                    */
/* -------------------------------------------------------------------------- */

export function PlateControls({ model, onLayout, onAutoFill, onClearAll }) {
  const plan = model.imagePlan
  const def = model.template.layout
  return (
    <div className="plate-bar">
      <div className="small">
        <strong>{plan.filled}</strong>
        {plan.capacity ? ` / ${plan.capacity}` : ''} picture(s) on the plate
        {plan.capacity && plan.filled < plan.capacity ? <span className="muted"> · {plan.spare} empty slot(s)</span> : null}
      </div>
      <div className="spacer" />
      <Button size="sm" onClick={() => onAutoFill?.()} disabled={!model.media.some((m) => m.kind === 'image')}>
        Auto-fill
      </Button>
      <Button size="sm" variant="ghost" onClick={() => onClearAll?.()}>
        Clear plate
      </Button>
      <select
        className="select"
        style={{ width: 'auto', fontSize: 12, padding: '4px 26px 4px 8px' }}
        value={plan.mode}
        onChange={(e) => onLayout?.(e.target.value)}
        title="Picture plate"
      >
        <option value="form7">7 pictures · 3 on top + 4 right (hospital form)</option>
        <option value="grid4">4 pictures · 2 × 2</option>
        <option value="grid6">6 pictures · 2 × 3</option>
        <option value="flow">All pictures · flowing rows</option>
      </select>
    </div>
  )
}
