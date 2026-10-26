/**
 * RichFindings.jsx — the word processor that lives on the report page.
 *
 * Everything the old DOS-era reporting program offered is here: bold, italic,
 * underline, strike-through, bulleted and numbered lists, the four alignments,
 * font family, font size, text colour, indent, undo/redo and "clear
 * formatting". It edits either the generated findings block or a Word file the
 * doctor opened, and hands the HTML straight back to the report model.
 */

import React, { useEffect, useRef, useState } from 'react'
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  IndentIncrease,
  IndentDecrease,
  Undo2,
  Redo2,
  Eraser,
  RotateCcw,
  ImagePlus,
} from 'lucide-react'

import { downscaleForPrint } from '../lib/printImages.js'

const FONTS = [
  ['', 'Font'],
  ['Arial', 'Arial'],
  ['Times New Roman', 'Times New Roman'],
  ['Calibri', 'Calibri'],
  ['Cambria', 'Cambria'],
  ['Georgia', 'Georgia'],
  ['Verdana', 'Verdana'],
  ['Tahoma', 'Tahoma'],
  ['Courier New', 'Courier New'],
]

const SIZES = [
  ['', 'Size'],
  ['1', '8'],
  ['2', '10'],
  ['3', '12'],
  ['4', '14'],
  ['5', '18'],
  ['6', '24'],
  ['7', '36'],
]

const SYMBOLS = [
  '°', '±', '≥', '≤', 'µ', '≈', '≠', '→', '←', '↑', '↓',
  '×', '÷', '½', '¼', '¾', '•', '§', '¶', 'Δ', 'α', 'β', 'Ω', '∞',
]

const BUTTONS = [
  [
    { cmd: 'bold', icon: Bold, title: 'Bold (Ctrl+B)' },
    { cmd: 'italic', icon: Italic, title: 'Italic (Ctrl+I)' },
    { cmd: 'underline', icon: Underline, title: 'Underline (Ctrl+U)' },
    { cmd: 'strikeThrough', icon: Strikethrough, title: 'Strike-through' },
  ],
  [
    { cmd: 'insertUnorderedList', icon: List, title: 'Bulleted list' },
    { cmd: 'insertOrderedList', icon: ListOrdered, title: 'Numbered list' },
  ],
  [
    { cmd: 'justifyLeft', icon: AlignLeft, title: 'Align left' },
    { cmd: 'justifyCenter', icon: AlignCenter, title: 'Align centre' },
    { cmd: 'justifyRight', icon: AlignRight, title: 'Align right' },
    { cmd: 'justifyFull', icon: AlignJustify, title: 'Justify both sides' },
  ],
  [
    { cmd: 'outdent', icon: IndentDecrease, title: 'Less indent' },
    { cmd: 'indent', icon: IndentIncrease, title: 'More indent' },
  ],
]

export default function RichFindings({ html, onSave, onReset, custom = false, placeholder, minHeight = 160, docMode = false }) {
  const ref = useRef(null)
  const focused = useRef(false)
  const fileRef = useRef(null)
  const saveTimer = useRef(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!ref.current || focused.current) return
    if (ref.current.innerHTML !== html) ref.current.innerHTML = html
  }, [html])

  useEffect(() => {
    try {
      document.execCommand('styleWithCSS', false, true)
    } catch {
      /* older engines ignore this */
    }
  }, [])

  const focusEditor = () => {
    const el = ref.current
    if (!el) return null
    el.focus()
    return el
  }

  const exec = (cmd, value = null) => {
    if (!focusEditor()) return
    try {
      document.execCommand(cmd, false, value)
    } catch {
      /* the engine refused the command */
    }
    setDirty(true)
  }

  const save = () => {
    if (!ref.current) return
    focused.current = false
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (dirty) {
      onSave?.(ref.current.innerHTML)
      setDirty(false)
    }
  }

  /* Keep the report in step while typing: clicking Print without leaving the
     editor must still print the new text. */
  const queueSave = () => {
    setDirty(true)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      if (ref.current) onSave?.(ref.current.innerHTML)
      setDirty(false)
    }, 600)
  }

  const insertSymbol = (sym) => {
    if (!sym || !focusEditor()) return
    document.execCommand('insertText', false, sym)
    queueSave()
  }

  const insertPicture = async (file) => {
    if (!file) return
    const dataUrl = await new Promise((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result || ''))
      fr.readAsDataURL(file)
    })
    // Keep the page light: a 900 px JPEG prints at 300 dpi in this space.
    const small = await downscaleForPrint(dataUrl, 900)
    if (!focusEditor()) return
    document.execCommand('insertImage', false, small)
    queueSave()
  }

  return (
    <div className="rich-findings">
      <div className="format-bar" onMouseDown={(e) => e.preventDefault()}>
        <select
          className="fmt-select fmt-font"
          value=""
          title="Font"
          onChange={(e) => {
            if (e.target.value) exec('fontName', e.target.value)
            e.target.value = ''
          }}
        >
          {FONTS.map(([v, l]) => (
            <option key={v || 'none'} value={v}>
              {l}
            </option>
          ))}
        </select>

        <select
          className="fmt-select fmt-size"
          value=""
          title="Font size"
          onChange={(e) => {
            if (e.target.value) exec('fontSize', e.target.value)
            e.target.value = ''
          }}
        >
          {SIZES.map(([v, l]) => (
            <option key={v || 'none'} value={v}>
              {l}
            </option>
          ))}
        </select>

        {BUTTONS.map((group, gi) => (
          <React.Fragment key={gi}>
            <span className="fmt-sep" />
            {group.map((b) => (
              <button key={b.cmd} type="button" title={b.title} onClick={() => exec(b.cmd)}>
                <b.icon size={13} />
              </button>
            ))}
          </React.Fragment>
        ))}

        <span className="fmt-sep" />
        <select
          className="fmt-select fmt-sym"
          value=""
          title="Insert a symbol"
          onChange={(e) => {
            insertSymbol(e.target.value)
            e.target.value = ''
          }}
        >
          <option value="">Ω</option>
          {SYMBOLS.map((sym) => (
            <option key={sym} value={sym}>
              {sym}
            </option>
          ))}
        </select>
        <button type="button" title="Insert a picture" onClick={() => fileRef.current?.click()}>
          <ImagePlus size={13} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            insertPicture(file)
            e.target.value = ''
          }}
        />

        <span className="fmt-sep" />
        <label className="fmt-color" title="Text colour">
          <input type="color" defaultValue="#111827" onChange={(e) => exec('foreColor', e.target.value)} />
        </label>
        <button type="button" title="Undo" onClick={() => exec('undo')}>
          <Undo2 size={13} />
        </button>
        <button type="button" title="Redo" onClick={() => exec('redo')}>
          <Redo2 size={13} />
        </button>
        <button type="button" title="Clear formatting" onClick={() => exec('removeFormat')}>
          <Eraser size={13} />
        </button>

        <span className="spacer" />
        {custom || docMode ? (
          <button type="button" className="fmt-reset" title="Rebuild this text from the ticked findings" onClick={onReset}>
            <RotateCcw size={12} /> Regenerate
          </button>
        ) : (
          <span className="fmt-hint">Click and type to edit</span>
        )}
      </div>

      <div
        ref={ref}
        className={`rich-edit${docMode ? ' doc' : ''}`}
        style={{ minHeight }}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        data-placeholder={placeholder || 'Findings…'}
        onFocus={() => {
          focused.current = true
        }}
        onInput={queueSave}
        onBlur={save}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault()
            save()
          }
        }}
      />
    </div>
  )
}
