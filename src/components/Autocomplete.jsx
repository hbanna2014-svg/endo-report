/**
 * Autocomplete.jsx — a text field that remembers what has been typed before.
 *
 * The operator can always type freely. As soon as there is something to match,
 * a short list of previously saved values appears underneath; picking one fills
 * the field. Everything it offers comes from the clinic's own data, so the list
 * grows by itself the first time a new referrer or procedure is saved.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'

/**
 * @param {string}   value       current text
 * @param {function} onChange    called with the new text
 * @param {Array}    options     strings, or { value, label, hint }
 * @param {boolean}  allowCustom keep text that matches nothing
 */
export default function Autocomplete({
  value,
  onChange,
  options = [],
  placeholder,
  allowCustom = true,
  disabled = false,
  maxResults = 8,
  emptyHint = 'New entry — it will be saved for next time.',
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value || '')
  const [active, setActive] = useState(-1)
  const boxRef = useRef(null)
  const inputRef = useRef(null)

  // Keep the box in step when the value is changed from outside (a different
  // patient being opened, or the "Both" button taking over the field).
  useEffect(() => {
    setQuery(value || '')
  }, [value])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const normalised = useMemo(
    () =>
      options
        .map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
        .filter((o) => o && o.label),
    [options],
  )

  const matches = useMemo(() => {
    const q = String(query || '').trim().toLowerCase()
    if (!q) return normalised.slice(0, maxResults)
    const starts = []
    const contains = []
    for (const o of normalised) {
      const label = String(o.label).toLowerCase()
      if (label === q) continue // already typed in full
      // The hint is searchable too, so "upp" finds ENDOSCOPY (upper GI) and
      // "lower" finds COLONOSCOPY, which is how people actually type.
      const haystack = `${label} ${String(o.hint || '').toLowerCase()}`
      if (haystack.startsWith(q) || label.startsWith(q)) starts.push(o)
      else if (haystack.includes(q)) contains.push(o)
    }
    return [...starts, ...contains].slice(0, maxResults)
  }, [normalised, query, maxResults])

  const exact = normalised.some((o) => String(o.label).toLowerCase() === String(query || '').trim().toLowerCase())
  const showCustom = allowCustom && query.trim() && !exact

  const choose = (option) => {
    setQuery(option.label)
    onChange?.(option.label, option)
    setOpen(false)
    setActive(-1)
    inputRef.current?.focus()
  }

  const onKeyDown = (e) => {
    if (disabled) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(matches.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(-1, i - 1))
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && matches[active]) {
        e.preventDefault()
        choose(matches[active])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const rows = [...matches]
  const customRowIndex = showCustom ? rows.length : -1

  return (
    <div className={`ac ${className}`} ref={boxRef}>
      <div className="ac-field">
        <input
          ref={inputRef}
          className="input"
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value)
            onChange?.(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="ac-toggle"
          tabIndex={-1}
          title="Show saved values"
          disabled={disabled}
          onClick={() => {
            setOpen((o) => !o)
            inputRef.current?.focus()
          }}
        >
          <ChevronDown size={13} />
        </button>
      </div>

      {open && !disabled && (rows.length || showCustom) ? (
        <div className="ac-menu" role="listbox">
          {rows.map((o, i) => (
            <button
              key={`${o.value}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              className={i === active ? 'on' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
            >
              <span className="ac-label">{o.label}</span>
              {o.hint ? <span className="ac-hint">{o.hint}</span> : null}
              {i === active ? <Check size={12} /> : null}
            </button>
          ))}

          {showCustom ? (
            <button
              type="button"
              className={`ac-custom ${active === customRowIndex ? 'on' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange?.(query.trim())
                setOpen(false)
              }}
            >
              <span className="ac-label">Use “{query.trim()}”</span>
              <span className="ac-hint">{emptyHint}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
