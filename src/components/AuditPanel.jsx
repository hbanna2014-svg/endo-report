/**
 * AuditPanel.jsx — "auto problem detection".
 *
 * Shows the completeness score, the blocking errors, the warnings and the
 * optional documentation hints produced by the reporting engine, and lets the
 * endoscopist jump straight to the relevant section.
 */

import React, { useMemo, useState } from 'react'
import { ShieldCheck, CircleAlert, AlertTriangle, Info, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react'
import { Button, Card, Progress, ScoreRing } from './ui.jsx'

export default function AuditPanel({ audit, onJump, compact = false }) {
  const [showAll, setShowAll] = useState(false)
  const groups = useMemo(() => {
    const items = audit?.items || []
    return {
      error: items.filter((i) => i.level === 'error'),
      warning: items.filter((i) => i.level === 'warning'),
      info: items.filter((i) => i.level === 'info'),
    }
  }, [audit])

  if (!audit) return null

  const visible = showAll ? audit.items : [...groups.error, ...groups.warning].slice(0, 6)

  const tone = audit.errors ? 'err' : audit.warnings ? 'warn' : 'ok'

  return (
    <Card
      title="Documentation audit"
      subtitle="Automatic checks before you finalise"
      icon={ShieldCheck}
      actions={
        audit.items.length > visible.length ? (
          <Button size="sm" variant="ghost" icon={showAll ? ChevronUp : ChevronDown} onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show less' : `+${audit.items.length - visible.length} more`}
          </Button>
        ) : null
      }
    >
      <div className="row" style={{ gap: 16, alignItems: 'center' }}>
        <ScoreRing value={audit.score} label={audit.scoreLabel} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 650, fontSize: 14 }}>{audit.scoreLabel}</div>
          <div className="small muted" style={{ marginBottom: 8 }}>
            {audit.errors} blocking issue(s) · {audit.warnings} warning(s) · {audit.infos} suggestion(s)
          </div>
          <Progress value={audit.score} />
          {audit.errors ? (
            <div className="small" style={{ color: 'var(--danger)', marginTop: 8 }}>
              Blocking issues must be resolved before the report can be marked final.
            </div>
          ) : (
            <div className="small" style={{ color: 'var(--ok)', marginTop: 8 }}>
              No blocking problem detected — the report can be finalised.
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        {visible.length ? (
          visible.map((it, i) => {
            const Icon = it.level === 'error' ? CircleAlert : it.level === 'warning' ? AlertTriangle : Info
            return (
              <div key={`${it.code}-${i}`} className={`audit-item ${it.level}`}>
                <span className="ico">
                  <Icon size={15} />
                </span>
                <div style={{ flex: 1 }}>
                  <div>{it.message}</div>
                  {it.sectionId && onJump ? (
                    <div className="fix">
                      <Button size="sm" variant="ghost" icon={ArrowRight} onClick={() => onJump(it.sectionId)}>
                        Go to the section
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })
        ) : (
          <div className="banner info">
            <ShieldCheck size={17} style={{ flex: '0 0 17px', marginTop: 1 }} />
            <div className="small">No documentation problem detected. Everything a complete report normally needs is present.</div>
          </div>
        )}
      </div>

      {!compact && audit.items.length ? (
        <div className="row tiny muted" style={{ marginTop: 8, gap: 6 }}>
          <Info size={12} />
          <span>
            These checks are decision support only — they never change the medical content of your report.
          </span>
        </div>
      ) : null}
      <div className={tone} style={{ display: 'none' }} />
    </Card>
  )
}
