/**
 * MediaRail.jsx — the vertical strip of captured frames beside the live image.
 *
 * This is the "film strip" the operator works from during the procedure: every
 * frame that was captured appears here immediately, newest last. One click puts
 * a frame on the report plate, so building the 2 x 2 / 2 x 3 picture block never
 * requires leaving the live view.
 */

import React, { useMemo } from 'react'
import { Camera, Plus, Upload, Video, Circle, Square, Image as ImageIcon } from 'lucide-react'

import { fmtDuration } from '../lib/useCapture.js'
import { useThumbs } from './ReportPlate.jsx'

export default function MediaRail({
  media = [],
  plateIds = [],
  onOpen,
  onAdd,
  onImport,
  onCapture,
  onRecord,
  onStopRecord,
  live,
  recording,
  recSeconds,
  busy,
}) {
  const images = useMemo(() => media.filter((m) => m.kind === 'image'), [media])
  const thumbs = useThumbs(images)
  const onPlate = new Set(plateIds.filter(Boolean))

  return (
    <aside className="media-rail">
      <div className="rail-head">
        <span className="tiny muted">Captured</span>
        <span className="rail-count">{media.length}</span>
      </div>

      <div className="rail-list">
        {media.length ? (
          media.map((m, i) => {
            const placed = onPlate.has(m.id)
            return (
              <div
                key={m.id}
                className={`rail-item${placed ? ' on' : ''}`}
                role="button"
                tabIndex={0}
                title={m.caption || (m.kind === 'video' ? 'Video' : 'Image')}
                onClick={() => onOpen?.(m)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onOpen?.(m)
                }}
              >
                <span className="rail-no">{i + 1}</span>

                {m.kind === 'video' ? (
                  <span className="rail-vid">
                    <Video size={16} />
                    {m.durationSec ? <em>{fmtDuration(m.durationSec)}</em> : null}
                  </span>
                ) : thumbs[m.id] ? (
                  <img src={thumbs[m.id]} alt={m.caption || ''} draggable={false} />
                ) : (
                  <span className="rail-skel" />
                )}

                {m.kind === 'image' ? (
                  <button
                    type="button"
                    className="rail-add"
                    title={placed ? 'Already on the report plate' : 'Put this picture on the report plate'}
                    onClick={(e) => {
                      e.stopPropagation()
                      onAdd?.(m)
                    }}
                  >
                    <Plus size={12} />
                  </button>
                ) : null}

                {placed ? <span className="rail-placed" title="On the report plate" /> : null}
              </div>
            )
          })
        ) : (
          <div className="rail-empty">
            <ImageIcon size={18} />
            <span>No frames yet</span>
          </div>
        )}
      </div>

      <div className="rail-foot">
        <button
          type="button"
          className="rail-btn"
          onClick={onCapture}
          disabled={!live || busy || recording}
          title="Capture image"
        >
          <Camera size={16} />
        </button>
        {recording ? (
          <button type="button" className="rail-btn rec" onClick={onStopRecord} title="Stop recording">
            <Square size={14} />
            <em>{fmtDuration(recSeconds)}</em>
          </button>
        ) : (
          <button type="button" className="rail-btn" onClick={onRecord} disabled={!live || busy} title="Record video">
            <Circle size={14} />
          </button>
        )}
        <button type="button" className="rail-btn" onClick={onImport} title="Import pictures from this computer">
          <Upload size={16} />
        </button>
      </div>
    </aside>
  )
}
