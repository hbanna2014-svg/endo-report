/**
 * CapturePanel.jsx — the full media library for one procedure.
 *
 * The live engine lives in `useCapture` and the picture stage in
 * `CaptureStage`, so the live reporting console and this tab behave identically.
 * Everything stays on this computer: frames are written straight into the
 * patient's folder and never leave the machine.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { Upload, Trash2, FolderOpen, Pencil, Sparkles, Image as ImageIcon, Video, Camera } from 'lucide-react'

import { api, mediaSrc } from '../lib/api.js'
import { fmtDuration } from '../lib/useCapture.js'
import CaptureStage from './CaptureStage.jsx'
import { Button, Card, Empty, Input, useToast } from './ui.jsx'

export function MediaThumb({ item, onOpen, onDelete, onCaption, onAiReview, aiEnabled, aiBusy, selected }) {
  const [src, setSrc] = useState('')
  const [editing, setEditing] = useState(false)
  const [caption, setCaption] = useState(item.caption || '')

  useEffect(() => {
    let alive = true
    ;(async () => {
      let url = ''
      try {
        const res = await api.media.thumbnail(item.filePath, item.id, 260)
        url = res?.dataUrl || ''
      } catch {
        url = ''
      }
      if (!url) url = await mediaSrc(item.filePath)
      if (alive) setSrc(url)
    })()
    return () => {
      alive = false
    }
  }, [item.filePath, item.id])

  return (
    <div className={`thumb${selected ? ' selected' : ''}`}>
      <span className="kind">{item.kind}</span>
      {item.kind === 'image' ? (
        src ? <img src={src} alt={item.caption || ''} onClick={() => onOpen?.(item)} /> : <div style={{ height: 88, background: '#0b1220' }} />
      ) : src ? (
        <video src={src} onClick={() => onOpen?.(item)} />
      ) : (
        <div style={{ height: 88, background: '#0b1220', display: 'grid', placeItems: 'center', color: '#64748b' }}>
          <Video size={18} />
        </div>
      )}
      <div className="tools">
        {aiEnabled && item.kind === 'image' ? (
          <button type="button" title="AI review this image" onClick={() => onAiReview?.(item)} disabled={aiBusy}>
            <Sparkles size={12} />
          </button>
        ) : null}
        <button type="button" title="Edit caption" onClick={() => setEditing((v) => !v)}>
          <Pencil size={12} />
        </button>
        <button type="button" title="Delete" onClick={() => onDelete?.(item)}>
          <Trash2 size={12} />
        </button>
      </div>
      {editing ? (
        <div style={{ padding: 5, background: '#fff' }}>
          <Input
            value={caption}
            autoFocus
            onChange={(e) => setCaption(e.target.value)}
            onBlur={() => {
              onCaption?.(item, caption)
              setEditing(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onCaption?.(item, caption)
                setEditing(false)
              }
            }}
            style={{ fontSize: 11, padding: '3px 6px' }}
          />
        </div>
      ) : (
        <div className="cap" title={item.caption}>
          {item.caption || '(no caption)'}
          {item.kind === 'video' && item.durationSec ? ` · ${fmtDuration(item.durationSec)}` : ''}
        </div>
      )}
    </div>
  )
}

export default function CapturePanel({
  procedureId,
  patientId,
  media,
  setMedia,
  activeSection,
  onSelectSection,
  procedure,
  onAiReview,
  aiEnabled,
  aiBusy,
  registerMenuActions,
  cap,
}) {
  const toast = useToast()
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    registerMenuActions?.({
      captureImage: () => cap.captureStill(),
      toggleVideo: cap.toggleVideo,
      start: cap.startStream,
    })
  }, [cap.captureStill, cap.toggleVideo, cap.startStream, registerMenuActions])

  const updateCaption = useCallback(
    async (item, caption) => {
      try {
        const updated = await api.media.update(item.id, { caption })
        setMedia(media.map((m) => (m.id === item.id ? { ...m, caption: updated?.caption ?? caption } : m)))
      } catch (err) {
        toast.push({ tone: 'err', title: 'Could not save the caption', body: err.message })
      }
    },
    [media, setMedia, toast],
  )

  const removeItem = useCallback(
    async (item) => {
      try {
        await api.media.remove(item.id)
        setMedia(media.filter((m) => m.id !== item.id))
        toast.push({ tone: 'ok', title: 'Deleted' })
      } catch (err) {
        toast.push({ tone: 'err', title: 'Delete failed', body: err.message })
      }
    },
    [media, setMedia, toast],
  )

  const importFiles = useCallback(async () => {
    setBusy(true)
    try {
      const res = await api.media.import({ patientId, procedureId, section: activeSection || null })
      if (res?.ok && res.added?.length) {
        setMedia([...media, ...res.added])
        toast.push({ tone: 'ok', title: `${res.added.length} file(s) imported` })
      }
    } catch (err) {
      toast.push({ tone: 'err', title: 'Import failed', body: err.message })
    } finally {
      setBusy(false)
    }
  }, [activeSection, media, patientId, procedureId, setMedia, toast])

  const images = media.filter((m) => m.kind === 'image')
  const videos = media.filter((m) => m.kind === 'video')

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', alignItems: 'start' }}>
      <Card title="Live capture" subtitle={cap.live ? 'Capture device is streaming' : 'No live view'}>
        <CaptureStage cap={cap} activeSection={activeSection} onSelectSection={onSelectSection} />
        {cap.lastCaptured ? (
          <div className="row small" style={{ gap: 8, marginTop: 10 }}>
            <Camera size={13} className="muted" />
            <span className="muted two-line">
              Last saved {cap.lastCaptured.width ? `${cap.lastCaptured.width} × ${cap.lastCaptured.height} · ` : ''}
              {cap.lastCaptured.caption || cap.lastCaptured.filePath}
            </span>
          </div>
        ) : null}
      </Card>

      <Card
        title="Media library"
        subtitle={`${images.length} image(s) · ${videos.length} video(s)`}
        actions={
          <>
            <Button size="sm" icon={Upload} onClick={importFiles} disabled={busy}>
              Import files
            </Button>
            {procedureId ? (
              <Button
                size="sm"
                variant="ghost"
                icon={FolderOpen}
                title="Open the folder that holds this patient's media"
                onClick={() => api.app.revealPath(media[0]?.filePath || '')}
              />
            ) : null}
          </>
        }
      >
        {media.length ? (
          <>
            <div className="thumb-grid">
              {media.map((m) => (
                <MediaThumb
                  key={m.id}
                  item={m}
                  onOpen={(it) => setPreview(it)}
                  onDelete={removeItem}
                  onCaption={updateCaption}
                  onAiReview={onAiReview}
                  aiEnabled={aiEnabled}
                  aiBusy={aiBusy}
                />
              ))}
            </div>
            <div className="small muted" style={{ marginTop: 12 }}>
              Images are kept at the capture card's full resolution in this patient's folder and are embedded into the
              printed and Word reports without re-compression. Videos stay with the record and open from here.
            </div>
          </>
        ) : (
          <Empty
            icon={ImageIcon}
            title="No images captured yet"
            hint="Start the live view and press “Capture image”, or import existing pictures from this computer."
            action={
              <Button icon={Upload} onClick={importFiles}>
                Import files
              </Button>
            }
          />
        )}
      </Card>

      {preview ? (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setPreview(null)}>
          <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h3>{preview.caption || 'Media'}</h3>
              <div className="spacer" />
              <Button size="sm" icon={FolderOpen} onClick={() => api.app.revealPath(preview.filePath)}>
                Show in folder
              </Button>
              <Button size="sm" onClick={() => setPreview(null)}>
                Close
              </Button>
            </header>
            <div className="modal-body" style={{ background: '#05080f' }}>
              <PreviewMedia item={preview} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function PreviewMedia({ item }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let alive = true
    mediaSrc(item.filePath).then((s) => alive && setSrc(s))
    return () => {
      alive = false
    }
  }, [item.filePath])
  if (!src) return <div className="center muted">Loading…</div>
  return item.kind === 'video' ? (
    <video src={src} controls autoPlay style={{ width: '100%', maxHeight: '74vh' }} />
  ) : (
    <img src={src} alt={item.caption} style={{ width: '100%', maxHeight: '74vh', objectFit: 'contain' }} />
  )
}
