/**
 * PrintPreview.jsx — "what will come out of the printer", before it prints.
 *
 * Electron's own print dialog cannot render a preview pane, so Windows shows
 * "This app doesn't support print preview" where the page should be. The fix is
 * to preview in the app instead: the very same HTML that is handed to the
 * printer is rendered here first, then printed straight to the chosen device
 * without a second dialog.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Printer, RefreshCw, FileText, CircleAlert, CheckCircle2 } from 'lucide-react'

import { api } from '../lib/api.js'
import { Banner, Button, Field, Select, useToast } from './ui.jsx'

export default function PrintPreview({ open, html, title, onClose, onSavePdf, onPrinted }) {
  const toast = useToast()
  const [printers, setPrinters] = useState([])
  const [deviceName, setDeviceName] = useState('')
  const [copies, setCopies] = useState(1)
  const [loading, setLoading] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const doc = useMemo(() => html || '', [html])

  const loadPrinters = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const list = await api.report.printers()
      setPrinters(list || [])
      setDeviceName((cur) => cur || list?.find((p) => p.isDefault)?.name || list?.[0]?.name || '')
      if (!list?.length) {
        setError('Windows did not report any printer. Add the printer in Windows settings, then press Rescan.')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setDone(false)
    setError('')
    setCopies(1)
    loadPrinters()
  }, [open, loadPrinters])

  const print = async () => {
    setPrinting(true)
    setError('')
    try {
      const res = await api.report.printSilent(doc, title || 'EndoReport report', {
        deviceName: deviceName || undefined,
        copies: Number(copies) || 1,
      })
      if (res?.ok) {
        setDone(true)
        toast.push({ tone: 'ok', title: 'Sent to the printer', body: deviceName ? `${deviceName} · ${copies} copy` : undefined })
        onPrinted?.()
        setTimeout(() => onClose?.(), 900)
      } else {
        setError(res?.reason || 'The printer did not accept the job.')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setPrinting(false)
    }
  }

  const systemDialog = async () => {
    setPrinting(true)
    try {
      const res = await api.report.print(doc, title || 'EndoReport report')
      if (res?.ok === false && res.reason) setError(res.reason)
      else onClose?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setPrinting(false)
    }
  }

  if (!open) return null

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !printing && onClose?.()}>
      <div className="modal wide print-preview" onMouseDown={(e) => e.stopPropagation()} style={{ width: 'min(1180px, 100%)' }}>
        <header className="modal-head">
          <Printer size={17} className="muted" />
          <div>
            <h3 style={{ fontSize: 15 }}>Print preview</h3>
            <div className="tiny muted">A4 · this is exactly what the printer will produce</div>
          </div>
          <div className="spacer" />
          <Button size="sm" icon={RefreshCw} variant="ghost" onClick={loadPrinters} disabled={loading}>
            Rescan printers
          </Button>
        </header>

        <div className="modal-body" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="print-preview-bar">
            <Field label="Printer">
              <Select
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                options={printers.map((p) => ({ value: p.name, label: `${p.displayName}${p.isDefault ? ' (default)' : ''}` }))}
                placeholder={printers.length ? 'Choose a printer…' : 'No printer found'}
              />
            </Field>
            <Field label="Copies">
              <input
                className="input"
                style={{ width: 80 }}
                type="number"
                min={1}
                max={50}
                value={copies}
                onChange={(e) => setCopies(e.target.value)}
              />
            </Field>
            <div className="spacer" />
            <div className="tiny muted" style={{ maxWidth: 360 }}>
              The report is printed at A4 with the clinic header, pictures and signature block exactly as shown below.
            </div>
          </div>

          {error ? (
            <div style={{ padding: '10px 16px 0' }}>
              <Banner tone="err" icon={CircleAlert}>
                <div className="small">{error}</div>
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <Button size="sm" onClick={systemDialog} disabled={printing}>
                    Use the Windows print dialog
                  </Button>
                  <Button size="sm" variant="ghost" onClick={loadPrinters}>
                    Rescan
                  </Button>
                </div>
              </Banner>
            </div>
          ) : null}

          {done ? (
            <div style={{ padding: '10px 16px 0' }}>
              <Banner tone="info" icon={CheckCircle2}>
                <div className="small">The job has been sent to the printer.</div>
              </Banner>
            </div>
          ) : null}

          <div className="print-preview-canvas">
            {doc ? (
              <iframe title="Print preview" srcDoc={doc} className="print-preview-frame" />
            ) : (
              <div className="small muted">Nothing to preview.</div>
            )}
          </div>
        </div>

        <footer className="modal-foot">
          {onSavePdf ? (
            <Button icon={FileText} onClick={onSavePdf} disabled={printing}>
              Save PDF instead
            </Button>
          ) : null}
          <div className="spacer" />
          <Button onClick={onClose} disabled={printing}>
            Cancel
          </Button>
          <Button variant="primary" icon={Printer} onClick={print} disabled={printing || !doc || !deviceName}>
            {printing ? 'Printing…' : `Print ${Number(copies) > 1 ? `${copies} copies` : ''}`}
          </Button>
        </footer>
      </div>
    </div>
  )
}
