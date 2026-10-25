/**
 * ImagePlus.jsx — the "Image Plus" page.
 *
 * A big, quiet grid: pick four or six pictures, click any empty frame to put a
 * picture in it, and see the whole set at a glance. This is the screen the
 * clinic asked for — the frames are large, the choice is one click, and nothing
 * else competes for attention.
 */

import React, { useMemo } from 'react'
import { Camera, ImagePlus as ImagePlusIcon, Sparkles, Trash2, X, Video } from 'lucide-react'

import { Button, Modal } from './ui.jsx'
import { useThumbs } from './ReportPlate.jsx'

export default function ImagePlus({
  open,
  onClose,
  model,
  media = [],
  onLayout,
  onPick,
  onClear,
  onAutoFill,
  onClearAll,
  onCapture,
  live = false,
  busy = false,
}) {
  const plan = model?.imagePlan || { mode: 'grid4', slots: [], filled: 0, capacity: 4 }
  const slots = plan.slots.length
    ? plan.slots
    : Array.from({ length: 4 }, (_, i) => ({ no: i + 1, id: null, media: null }))

  const items = useMemo(() => slots.map((s) => s.media).filter(Boolean), [slots])
  const thumbs = useThumbs(items, 480)
  const spare = slots.filter((s) => !s.media).length

  return (
    <Modal open={open} onClose={onClose} width={980} title="Image Plus — pictures on this report">
      <div className="ip-bar">
        <div className="ip-modes">
          {[
            ['grid4', 'Image Plus 4'],
            ['grid6', 'Image Plus 6'],
          ].map(([id, label]) => (
            <label key={id} className={`ip-radio${plan.mode === id ? ' on' : ''}`}>
              <input
                type="radio"
                name="image-plus"
                checked={plan.mode === id}
                onChange={() => onLayout?.(id)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <span className="small muted">
          {plan.filled} of {slots.length} placed
        </span>
        <Button size="sm" icon={Sparkles} onClick={onAutoFill} disabled={!media.length}>
          Fill automatically
        </Button>
        <Button size="sm" variant="ghost" onClick={onClearAll}>
          Clear all
        </Button>
        {onCapture ? (
          <Button size="sm" variant="success" icon={Camera} onClick={onCapture} disabled={!live || busy}>
            Capture now
          </Button>
        ) : null}
        <Button size="sm" variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>

      <div className={`ip-grid ${slots.length === 6 ? 'six' : 'four'}`}>
        {slots.map((slot) => {
          const m = slot.media
          const src = m ? thumbs[m.id] : ''
          return (
            <div key={slot.no} className={`ip-cell${m ? ' has' : ''}`}>
              <button type="button" className="ip-frame" onClick={() => onPick?.(slot.no - 1)}>
                {m ? (
                  src ? (
                    <img src={src} alt={m.caption || ''} />
                  ) : (
                    <span className="ip-empty">Loading…</span>
                  )
                ) : (
                  <>
                    <ImagePlusIcon size={34} />
                    <span className="ip-none">No Preview Available</span>
                    <span className="ip-add">Click to add a picture</span>
                  </>
                )}
              </button>

              {m ? (
                <>
                  <div className="ip-tools">
                    <button type="button" title="Remove from the report" onClick={() => onClear?.(slot.no - 1)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="ip-cap">
                    <span className="ip-no">Image Plus {slot.no}</span>
                    <span className="ip-title">{m.caption || '(Image Title)'}</span>
                  </div>
                </>
              ) : (
                <div className="ip-cap">
                  <span className="ip-no">Image Plus {slot.no}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="ip-foot small muted">
        {spare ? (
          <>
            <Camera size={12} /> {spare} empty frame(s) — the next {spare} capture(s) will land in them,
            or click a frame to choose from the pictures already taken.
          </>
        ) : (
          <>
            <Video size={12} /> All frames are full. Click any picture to replace it.
          </>
        )}
      </div>
    </Modal>
  )
}
