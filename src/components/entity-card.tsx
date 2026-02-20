'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────

export interface SummaryLine {
  icon?: React.ReactNode
  label?: string
  text: string
}

export interface ExpandableSection {
  title: string
  content: React.ReactNode
  defaultOpen?: boolean
}

export interface CardAction {
  label: string
  onClick: () => void
  variant?: 'default' | 'destructive'
  icon?: React.ReactNode
}

export interface EntityCardProps {
  /** Card title (main text) */
  title: string
  /** Subtitle below title */
  subtitle?: string
  /** Status chip label + Tailwind classes */
  statusLabel?: string
  statusColor?: string
  /** Value displayed prominently (e.g. $8.000.000) */
  value?: string
  /** Summary lines shown in collapsed state */
  summaryLines?: SummaryLine[]
  /** Completeness indicator: true=green check, false=red dot, undefined=none */
  isComplete?: boolean
  /** Show green check instead of hiding indicator when complete (for empresas) */
  showGreenCheck?: boolean
  /** Expandable accordion sections */
  expandableSections?: ExpandableSection[]
  /** Actions in dropdown menu */
  actions?: CardAction[]
  /** Quick action icon button shown inline (e.g. + to create oportunidad) */
  quickAction?: { tooltip: string; onClick: () => void; icon: React.ReactNode }
  /** Primary CTA button */
  primaryAction?: { label: string; onClick: () => void; icon?: React.ReactNode }
  /** Navigate on card click */
  href?: string
  /** Additional click handler */
  onClick?: () => void
  /** Small badges shown below summary lines */
  badges?: { label: string; className?: string }[]
  /** Relative time text (e.g. "hace 3 dias") */
  timeAgo?: string
  /** Extra className */
  className?: string
}

// ── Component ─────────────────────────────────────────────────

export default function EntityCard({
  title,
  subtitle,
  statusLabel,
  statusColor = 'bg-gray-100 text-gray-600',
  value,
  summaryLines = [],
  isComplete,
  showGreenCheck = false,
  expandableSections = [],
  actions = [],
  badges = [],
  quickAction,
  primaryAction,
  href,
  onClick,
  timeAgo,
  className = '',
}: EntityCardProps) {
  const [expandedSections, setExpandedSections] = useState<Set<number>>(
    new Set(expandableSections.filter(s => s.defaultOpen).map((_, i) => i))
  )
  const [menuOpen, setMenuOpen] = useState(false)

  const toggleSection = (index: number) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const cardContent = (
    <div
      className={`relative w-full rounded-lg border border-border bg-card p-4 md:p-5 shadow-sm transition-shadow hover:shadow-md ${className}`}
      onClick={onClick}
    >
      {/* ── Completeness indicator ── */}
      {isComplete === false && (
        <span
          className="absolute top-3 right-3 h-2 w-2 rounded-full bg-red-500"
          title="Datos incompletos"
        />
      )}
      {isComplete === true && showGreenCheck && (
        <span
          className="absolute top-3 right-3 h-2 w-2 rounded-full bg-green-500"
          title="Perfil completo"
        />
      )}

      {/* ── Header row ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Title + subtitle */}
          <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Value */}
          {value && (
            <span className="text-sm font-semibold text-foreground">{value}</span>
          )}

          {/* Status chip */}
          {statusLabel && (
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusColor}`}>
              {statusLabel}
            </span>
          )}

          {/* Quick action icon */}
          {quickAction && (
            <button
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); quickAction.onClick() }}
              title={quickAction.tooltip}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
            >
              {quickAction.icon}
            </button>
          )}

          {/* Actions menu */}
          {actions.length > 0 && (
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); setMenuOpen(!menuOpen) }}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 z-50 mt-1 min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-lg">
                    {actions.map((action, i) => (
                      <button
                        key={i}
                        onClick={(e) => {
                          e.stopPropagation()
                          e.preventDefault()
                          setMenuOpen(false)
                          action.onClick()
                        }}
                        className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors ${
                          action.variant === 'destructive'
                            ? 'text-red-600 hover:bg-red-50'
                            : 'text-foreground hover:bg-accent'
                        }`}
                      >
                        {action.icon}
                        {action.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Summary lines ── */}
      {summaryLines.length > 0 && (
        <div className="mt-2 space-y-1">
          {summaryLines.map((line, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {line.icon && <span className="shrink-0">{line.icon}</span>}
              {line.label && <span className="font-medium text-foreground">{line.label}:</span>}
              <span className="truncate">{line.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Badges ── */}
      {badges.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {badges.map((badge, i) => (
            <span key={i} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className ?? 'bg-muted text-muted-foreground'}`}>
              {badge.label}
            </span>
          ))}
        </div>
      )}

      {/* ── Time ago ── */}
      {timeAgo && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">{timeAgo}</p>
      )}

      {/* ── Primary action ── */}
      {primaryAction && (
        <button
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); primaryAction.onClick() }}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {primaryAction.icon}
          {primaryAction.label}
        </button>
      )}

      {/* ── Expandable sections ── */}
      {expandableSections.length > 0 && (
        <div className="mt-3 border-t border-border pt-2 space-y-0.5">
          {expandableSections.map((section, i) => (
            <div key={i}>
              <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleSection(i) }}
                className="flex w-full items-center gap-1.5 rounded-sm px-1 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {expandedSections.has(i) ? (
                  <ChevronDown className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 shrink-0" />
                )}
                {section.title}
              </button>
              {expandedSections.has(i) && (
                <div className="ml-4 mt-1 mb-2 text-xs">
                  {section.content}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="block">
        {cardContent}
      </Link>
    )
  }

  return cardContent
}
