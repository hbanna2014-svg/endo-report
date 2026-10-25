/**
 * ui.jsx — small, dependency-free UI kit used across every screen.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { X, Check, AlertTriangle, Info, CircleAlert, CheckCircle2 } from 'lucide-react'

/* ------------------------------------------------------------------ Button --- */

export function Button({
  children,
  variant = 'default',
  size = 'md',
  icon: Icon,
  className = '',
  ...rest
}) {
  const cls = ['btn', variant !== 'default' ? variant : '', size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : '', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button type="button" className={cls} {...rest}>
      {Icon ? <Icon size={size === 'sm' ? 13 : 15} strokeWidth={2.2} /> : null}
      {children}
    </button>
  )
}

/* -------------------------------------------------------------------- Card --- */

export function Card({ title, subtitle, actions, children, className = '', bodyClass = '', icon: Icon }) {
  return (
    <section className={`card ${className}`}>
      {title ? (
        <header className="card-head">
          {Icon ? <Icon size={16} className="muted" /> : null}
          <div>
            <h3>{title}</h3>
            {subtitle ? <div className="sub">{subtitle}</div> : null}
          </div>
          <div className="spacer" />
          {actions}
        </header>
      ) : null}
      <div className={`card-body ${bodyClass}`}>{children}</div>
    </section>
  )
}

/* ------------------------------------------------------------------ Fields --- */

export function Field({ label, hint, required, children, className = '' }) {
  return (
    <div className={`field ${required ? 'req' : ''} ${className}`}>
      {label ? <label>{label}</label> : null}
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}

export function Input({ missing, className = '', ...rest }) {
  return <input className={`input ${missing ? 'missing' : ''} ${className}`} {...rest} />
}

export function Textarea({ missing, className = '', ...rest }) {
  return <textarea className={`textarea ${missing ? 'missing' : ''} ${className}`} {...rest} />
}

export function Select({ missing, options = [], placeholder, className = '', ...rest }) {
  return (
    <select className={`select ${missing ? 'missing' : ''} ${className}`} {...rest}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((o) =>
        typeof o === 'string' ? (
          <option key={o} value={o}>
            {o}
          </option>
        ) : (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ),
      )}
    </select>
  )
}

export function CheckRow({ checked, onChange, label, hint }) {
  return (
    <label className="row" style={{ gap: 9, cursor: 'pointer', alignItems: 'flex-start' }}>
      <span className={`checkbox ${checked ? 'on' : ''}`} onClick={(e) => { e.preventDefault(); onChange(!checked) }}>
        {checked ? <Check size={11} strokeWidth={3} /> : null}
      </span>
      <span>
        <span style={{ fontSize: 13 }}>{label}</span>
        {hint ? <div className="tiny muted">{hint}</div> : null}
      </span>
    </label>
  )
}

/* ------------------------------------------------------------------- Chips --- */

export function Chip({ children, tone, className = '' }) {
  return <span className={`chip ${tone || ''} ${className}`}>{children}</span>
}

export function SeverityChip({ severity }) {
  const s = severity || 'unknown'
  return <span className={`sev ${s}`}>{s}</span>
}

export function ProcedureChip({ testName }) {
  const map = {
    ogd: { tone: 'ogd', label: 'OGD' },
    colonoscopy: { tone: 'colon', label: 'Colonoscopy' },
    both: { tone: 'both', label: 'Both' },
  }
  const m = map[testName] || map.ogd
  return <Chip tone={m.tone}>{m.label}</Chip>
}

/* ------------------------------------------------------------------- Modal --- */

export function Modal({ open, onClose, title, children, footer, width = '' }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className={`modal ${width}`} onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3>{title}</h3>
          <div className="spacer" />
          <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Close" />
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- ConfirmDialog --- */

export function ConfirmDialog({ open, title, message, detail, confirmLabel = 'Confirm', tone = 'danger', onConfirm, onCancel }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width="narrow"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={tone} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>{message}</p>
      {detail ? <p className="small muted">{detail}</p> : null}
    </Modal>
  )
}

/* ------------------------------------------------------------------ Toasts --- */

const ToastCtx = createContext({ push: () => {} })

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const seq = useRef(0)

  const remove = useCallback((id) => setItems((list) => list.filter((t) => t.id !== id)), [])

  const push = useCallback(
    (toast) => {
      const id = ++seq.current
      const entry = typeof toast === 'string' ? { title: toast } : toast
      setItems((list) => [...list, { id, tone: entry.tone || 'ok', ...entry }])
      const ttl = entry.ttl ?? (entry.tone === 'err' ? 9000 : 4200)
      if (ttl > 0) setTimeout(() => remove(id), ttl)
      return id
    },
    [remove],
  )

  const value = useMemo(() => ({ push, remove }), [push, remove])

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} role="status">
            <strong>{t.title}</strong>
            {t.body ? <div className="small" style={{ color: 'var(--ink-2)' }}>{t.body}</div> : null}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  return useContext(ToastCtx)
}

/* ------------------------------------------------------------------- Misc --- */

export function Tabs({ value, onChange, items }) {
  return (
    <div className="tabs">
      {items.map((it) => (
        <button key={it.value} type="button" className={value === it.value ? 'on' : ''} onClick={() => onChange(it.value)}>
          {it.label}
        </button>
      ))}
    </div>
  )
}

export function Empty({ icon: Icon, title, hint, action }) {
  return (
    <div className="empty">
      {Icon ? <div className="big"><Icon size={34} /></div> : null}
      <div style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{title}</div>
      {hint ? <div className="small" style={{ marginTop: 4 }}>{hint}</div> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  )
}

export function Banner({ tone = 'info', children, icon }) {
  const Icon = icon || (tone === 'err' ? CircleAlert : tone === 'warn' ? AlertTriangle : Info)
  return (
    <div className={`banner ${tone}`}>
      <Icon size={17} style={{ flex: '0 0 17px', marginTop: 1 }} />
      <div>{children}</div>
    </div>
  )
}

export function Progress({ value, tone = '' }) {
  const cls = tone || (value >= 85 ? 'ok' : value >= 60 ? 'warn' : 'bad')
  return (
    <div className={`progress ${cls}`}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

export function ScoreRing({ value = 0, label }) {
  const r = 38
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  const tone = pct >= 85 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626'
  return (
    <div className="score-ring" title={label}>
      <svg width="92" height="92" viewBox="0 0 92 92">
        <circle cx="46" cy="46" r={r} fill="none" stroke="#e2e8f0" strokeWidth="9" />
        <circle
          cx="46"
          cy="46"
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
        />
      </svg>
      <div className="val" style={{ color: tone }}>
        {Math.round(pct)}%
      </div>
    </div>
  )
}

export function Stat({ label, value, detail, tone = '' }) {
  return (
    <div className={`stat ${tone}`}>
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      {detail ? <span className="d">{detail}</span> : null}
    </div>
  )
}

export function AuditList({ items }) {
  if (!items?.length) return <div className="small muted">No documentation issues detected.</div>
  const icon = { error: CircleAlert, warning: AlertTriangle, info: Info }
  return (
    <div>
      {items.map((it, i) => {
        const Icon = icon[it.level] || Info
        return (
          <div key={`${it.code}-${i}`} className={`audit-item ${it.level}`}>
            <span className="ico"><Icon size={15} /></span>
            <div>
              <div>{it.message}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export { CheckCircle2 }
