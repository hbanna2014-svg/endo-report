/**
 * HospitalForm.jsx — the unit's printed form, drawn at true A4 geometry.
 *
 * The sheet is laid out at exactly 210 mm × 297 mm (793.7 × 1122.5 px at 96 dpi)
 * and scaled with a CSS transform to whatever width is available, so the console
 * preview, the full report view and the printed page share one geometry:
 *
 *   • a 1.2 px border around the whole sheet;
 *   • pictures at 2.2 in × 2 in (55.88 mm × 50.8 mm);
 *   • three pictures across the top, four down the right column, the column
 *     reaching the bottom border;
 *   • the doctor's signature stamp above the name.
 */

import React, { useLayoutEffect, useRef, useState } from 'react'
import { ImagePlus, Replace, Trash2, ArrowLeft, ArrowRight } from 'lucide-react'

import { useThumbs } from './ReportPlate.jsx'

const MM = 96 / 25.4
const SHEET_W = 210 * MM
const SHEET_H = 297 * MM

/* -------------------------------------------------------------------------- */

function InlineField({ value, editable, onChange, placeholder, className = '' }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value || '')

  if (!editable) return <span className={className}>{value || ''}</span>

  if (!editing) {
    return (
      <span
        className={`hf-editable ${className}`}
        title="Click to edit"
        onClick={() => {
          setText(value || '')
          setEditing(true)
        }}
      >
        {value || <span className="hf-ph">{placeholder || '—'}</span>}
      </span>
    )
  }

  return (
    <input
      className={`hf-input ${className}`}
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        onChange?.(text)
        setEditing(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onChange?.(text)
          setEditing(false)
        }
        if (e.key === 'Escape') setEditing(false)
      }}
    />
  )
}

function Figure({ media, src, editable, onPick, onClear, onMove, index, capacity, variant }) {
  if (!media) {
    return (
      <figure className={`hf-fig hf-empty ${variant}`}>
        {editable ? (
          <button type="button" className="hf-add" onClick={() => onPick?.(index)}>
            <ImagePlus size={16} />
            <span>Add picture</span>
          </button>
        ) : (
          <div className="hf-noimg">No Preview Available</div>
        )}
        <figcaption>&nbsp;</figcaption>
      </figure>
    )
  }

  return (
    <figure className={`hf-fig ${variant}`}>
      <div className="hf-imgwrap" onClick={() => editable && onPick?.(index)}>
        {src ? <img src={src} alt={media.caption || ''} /> : <div className="hf-loading">loading…</div>}
        {editable ? (
          <div className="hf-tools">
            <button type="button" title="Replace this picture" onClick={(e) => { e.stopPropagation(); onPick?.(index) }}>
              <Replace size={12} />
            </button>
            {index > 0 ? (
              <button type="button" title="Move earlier" onClick={(e) => { e.stopPropagation(); onMove?.(index, index - 1) }}>
                <ArrowLeft size={12} />
              </button>
            ) : null}
            {index < capacity - 1 ? (
              <button type="button" title="Move later" onClick={(e) => { e.stopPropagation(); onMove?.(index, index + 1) }}>
                <ArrowRight size={12} />
              </button>
            ) : null}
            <button type="button" title="Remove" onClick={(e) => { e.stopPropagation(); onClear?.(index) }}>
              <Trash2 size={12} />
            </button>
          </div>
        ) : null}
      </div>
      <figcaption>{media.caption && media.caption !== '(no caption)' ? media.caption : '(Image Title)'}</figcaption>
    </figure>
  )
}

/* -------------------------------------------------------------------------- */

export default function HospitalForm({
  model,
  editable = false,
  onImagePick,
  onImageClear,
  onImageMove,
  onAddPicture,
  onField,
  reference,
}) {
  const f = model.hospital
  const pictures = f ? [...f.top, ...f.side] : []
  const thumbs = useThumbs(pictures, 520)

  const viewport = useRef(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const el = viewport.current
    if (!el) return undefined
    const fit = () => setScale(Math.min(1, el.clientWidth / SHEET_W))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!f) return null

  const capacity = 7
  const field = (kind, key) => (v) => onField?.(kind, key, v)

  return (
    <div className="hf-viewport" ref={viewport} style={{ height: SHEET_H * scale }}>
      <div
        className="hf-sheet"
        ref={reference}
        style={{ width: SHEET_W, height: SHEET_H, transform: `scale(${scale})` }}
      >
        <div className="hf-frame">
          {/* letterhead ---------------------------------------------------- */}
          <div className="hf-lh">
            {f.header.logo ? <img className="hf-logo" src={f.header.logo} alt="" /> : null}
            <div className="hf-lh-txt">
              <div className="hf-name">{f.header.name}</div>
              {f.header.address ? <div className="hf-addr">{f.header.address}</div> : null}
              {f.header.phones ? <div className="hf-phone">{f.header.phones}</div> : null}
            </div>
          </div>

          {/* patient grid -------------------------------------------------- */}
          <table className="hf-grid">
            <tbody>
              <tr>
                <td className="hf-k">Identity No.</td>
                <td className="hf-v">
                  <InlineField value={f.rows[0][0].value} editable={editable} onChange={field('patient', 'identityNo')} placeholder="Hospital ID" />
                </td>
                <td className="hf-k2">Visit Date</td>
                <td className="hf-v2">{f.rows[0][1].value || '\u00a0'}</td>
              </tr>
              <tr>
                <td className="hf-k">Patient Name</td>
                <td className="hf-v">
                  <InlineField value={f.rows[1][0].value} editable={editable} onChange={field('patient', 'name')} placeholder="Patient name" />
                </td>
                <td className="hf-k2">Age / Sex</td>
                <td className="hf-v2">{f.rows[1][1].value || '\u00a0'}</td>
              </tr>
              <tr>
                <td className="hf-k">History</td>
                <td className="hf-v">
                  <InlineField value={f.rows[2][0].value} editable={editable} onChange={field('patient', 'history')} placeholder="N/A" />
                </td>
                <td className="hf-k2">Instrument</td>
                <td className="hf-v2">
                  <InlineField value={f.rows[2][1].value} editable={editable} onChange={field('procedure', 'scopeModel')} placeholder="N/A" />
                </td>
              </tr>
              <tr>
                <td className="hf-k">Referrer</td>
                <td className="hf-v">
                  <InlineField value={f.rows[3][0].value} editable={editable} onChange={field('procedure', 'referredBy')} placeholder="Referring doctor" />
                </td>
                <td className="hf-k2">Bed</td>
                <td className="hf-v2">
                  <InlineField value={f.rows[3][1].value} editable={editable} onChange={field('procedure', 'bed')} placeholder="OPD" />
                </td>
              </tr>
            </tbody>
          </table>

          {/* title band ---------------------------------------------------- */}
          <div className="hf-band">{f.title}</div>

          {/* three across the top ------------------------------------------ */}
          <div className="hf-top3">
            {[0, 1, 2].map((i) => (
              <Figure
                key={`t${i}`}
                variant="hf-top"
                index={i}
                capacity={capacity}
                media={f.top[i]}
                src={f.top[i] ? thumbs[f.top[i].id] : ''}
                editable={editable}
                onPick={onImagePick || onAddPicture}
                onClear={onImageClear}
                onMove={onImageMove}
              />
            ))}
          </div>

          {/* text on the left, pictures down the right to the bottom -------- */}
          <div className="hf-cols">
            <div className="hf-left">
              <p className="hf-line">
                <span className="hf-lbl">Procedure :</span> <span className="hf-val">{f.procedure}</span>
              </p>
              <p className="hf-line">
                <span className="hf-lbl">Indication :</span>{' '}
                <InlineField className="hf-val" value={f.indication} editable={editable} onChange={field('procedure', 'indication')} placeholder="N/A" />
              </p>
              <p className="hf-line">
                <span className="hf-lbl">Medication :</span>{' '}
                <InlineField className="hf-val" value={f.medication} editable={editable} onChange={field('procedure', 'medication')} placeholder="N/A" />
              </p>

              <div className="hf-fh">FINDINGS :</div>
              {f.findings.map((b, i) => (
                <p key={`${b.heading}-${i}`} className="hf-fb">
                  <b>
                    <i>{b.heading}:-</i>
                  </b>{' '}
                  {b.text}
                </p>
              ))}

              <div className="hf-comments">
                <span className="hf-lbl">COMMENTS :</span>{' '}
                {editable ? (
                  <InlineField
                    className="hf-comment-val"
                    value={f.comments.join('; ')}
                    editable
                    onChange={field('procedure', 'comments')}
                    placeholder="Diagnosis"
                  />
                ) : (
                  f.comments.map((line, i) => (
                    <div key={i} className="hf-comment-line">
                      {line}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="hf-side4">
              {[0, 1, 2, 3].map((i) => {
                const slot = 3 + i
                const m = f.side[i]
                return (
                  <Figure
                    key={`s${i}`}
                    variant="hf-side"
                    index={slot}
                    capacity={capacity}
                    media={m}
                    src={m ? thumbs[m.id] : ''}
                    editable={editable}
                    onPick={onImagePick || onAddPicture}
                    onClear={onImageClear}
                    onMove={onImageMove}
                  />
                )
              })}
            </div>
          </div>

          {/* signature ----------------------------------------------------- */}
          <div className="hf-sign">
            {f.signature.sealDataUrl ? <img className="hf-seal" src={f.signature.sealDataUrl} alt="" /> : null}
            <div className="hf-sign-name">{f.signature.name || '\u00a0'}</div>
            {f.signature.degrees ? <div className="hf-sign-deg">{f.signature.degrees}</div> : null}
            {f.signature.designation ? <div className="hf-sign-deg">{f.signature.designation}</div> : null}
            {f.signature.affiliation ? <div className="hf-sign-aff">{f.signature.affiliation}</div> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
