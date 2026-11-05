/**
 * Workspace.jsx — the session shell.
 *
 * Normally this is one pane (exactly the console the clinic already knows). It
 * can hold a second, completely independent pane: capture patient A while the
 * report for patient B is being written, or capture the colonoscopy on the right
 * while the OGD report is typed on the left.
 *
 * Each pane owns its own procedure, media, findings and camera state. The only
 * shared resource — the capture device — is arbitrated in lib/captureLock.js.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Columns2, ArrowLeftRight, X, Users } from 'lucide-react'

import SessionPane from './SessionPane.jsx'
import SessionPicker from './SessionPicker.jsx'
import { Button } from './ui.jsx'

const MAX_PANES = 2

export default function Workspace({
  procedureId,
  patientId,
  clinic,
  templates,
  doctors,
  onClose,
  onRegisterMenu,
  onSaved,
  onOpenPatient,
}) {
  const [panes, setPanes] = useState(() => (procedureId ? [{ key: 'A', procedureId, patientId }] : []))
  const [focused, setFocused] = useState('A')
  const [pickerOpen, setPickerOpen] = useState(false)

  /* Opening a different report from the archive starts a fresh, single session. */
  useEffect(() => {
    setPanes(procedureId ? [{ key: 'A', procedureId, patientId }] : [])
    setFocused('A')
    setPickerOpen(false)
  }, [procedureId, patientId])

  const split = panes.length > 1

  const addSession = useCallback((proc) => {
    setPanes((current) => {
      if (current.length >= MAX_PANES) return current
      // Reuse the first free key so the capture lock keeps a stable identity.
      const used = new Set(current.map((p) => p.key))
      const key = ['A', 'B'].find((k) => !used.has(k)) || 'B'
      return [...current, { key, procedureId: proc.id, patientId: proc.patientId }]
    })
    setFocused('B')
  }, [])

  /** Opens two procedures at once — one per pane. */
  const openPair = useCallback((procs) => {
    const next = (procs || [])
      .filter(Boolean)
      .slice(0, MAX_PANES)
      .map((proc, index) => ({
        key: index === 0 ? 'A' : 'B',
        procedureId: proc.id,
        patientId: proc.patientId,
      }))
    if (next.length) {
      setPanes(next)
      setFocused(next.length > 1 ? 'B' : 'A')
    }
  }, [])

  const closePane = useCallback(
    (key) => {
      setPanes((current) => {
        const next = current.filter((p) => p.key !== key)
        if (!next.length) onClose?.()
        return next
      })
    },
    [onClose],
  )

  const swap = useCallback(() => {
    setPanes((current) => [...current].reverse())
  }, [])

  const collapse = useCallback(() => {
    setPanes((current) => (current.length > 1 ? [current[0]] : current))
  }, [])

  const openIds = useMemo(() => panes.map((p) => p.procedureId).filter(Boolean), [panes])

  if (!panes.length) {
    return (
      <div className="ws-shell">
        <div className="ws-empty">
          <Users size={28} className="muted" />
          <p>No report is open. Choose a patient to begin.</p>
          <Button variant="primary" size="sm" onClick={() => setPickerOpen(true)}>
            Choose a patient
          </Button>
        </div>
        <SessionPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={addSession}
        onPickPair={openPair}
        openProcedureIds={openIds}
      />
      </div>
    )
  }

  return (
    <div className="ws-shell">
      <div className="ws-bar">
        <span className="ws-bar-title">
          {split ? 'Two sessions — capture one patient while reporting another' : 'Single session'}
        </span>
        <div className="spacer" />
        {split ? (
          <>
            <Button size="sm" variant="ghost" icon={ArrowLeftRight} onClick={swap} title="Swap the two panes">
              Swap
            </Button>
            <Button size="sm" variant="ghost" icon={X} onClick={collapse} title="Close the second pane">
              Single session
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            icon={Columns2}
            onClick={() => setPickerOpen(true)}
            title="Open a second patient beside this one"
          >
            Second session
          </Button>
        )}
      </div>

      <div className={`ws-panes${split ? ' split' : ''}`}>
        {panes.map((pane, index) => (
          <div
            key={pane.key}
            className={`ws-pane${split ? ' compact' : ''}${split && focused === pane.key ? ' focused' : ''}`}
            onMouseDown={() => setFocused(pane.key)}
          >
            <SessionPane
              paneKey={pane.key}
              compact={split}
              badge={
                split ? (
                  <span className={`pane-badge${pane.key === 'A' ? ' a' : ' b'}`} title="Session">
                    {pane.key}
                  </span>
                ) : null
              }
              deferCapture={split && index > 0}
              procedureId={pane.procedureId}
              patientId={pane.patientId}
              clinic={clinic}
              templates={templates}
              doctors={doctors}
              onClose={() => (split ? closePane(pane.key) : onClose?.())}
              onRegisterMenu={focused === pane.key ? onRegisterMenu : () => () => {}}
              onSaved={onSaved}
              onOpenPatient={onOpenPatient}
            />
          </div>
        ))}
      </div>

      <SessionPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={addSession}
        onPickPair={openPair}
        openProcedureIds={openIds}
      />
    </div>
  )
}
