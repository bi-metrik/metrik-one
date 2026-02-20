'use client'

import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react'
import { formatCOP } from '@/lib/contacts/constants'

// ── Types ─────────────────────────────────────────────

interface ProgressBarData {
  current: number
  target: number
  label: string
  sublabel: string
}

interface DualBarData {
  bar1: { value: number; label: string }
  bar2: { value: number; label: string }
}

interface GaugeBarData {
  value: number
  zones: { start: number; end: number; color: string }[]
}

interface DualMarkerBarData {
  current: number
  target: number
  marker: number
  markerLabel: string
}

type BarData = ProgressBarData | DualBarData | GaugeBarData | DualMarkerBarData

interface QuestionCardProps {
  questionNumber: 1 | 2 | 3 | 4 | 5
  title: string
  value: number
  valueFormat: 'currency' | 'months' | 'percent'
  trend: 'up' | 'down' | 'stable'
  trendIsPositive: boolean
  barType: 'progress' | 'dual' | 'gauge' | 'dual_marker'
  barData: BarData
  barColor?: string
  onClick?: () => void
  isEmpty?: boolean
  monthType?: 'current' | 'past' | 'future'
  hasWarningBadge?: boolean
}

// ── Component ─────────────────────────────────────────

export default function QuestionCard({
  title,
  value,
  valueFormat,
  trend,
  trendIsPositive,
  barType,
  barData,
  barColor,
  onClick,
  isEmpty,
  monthType = 'current',
  hasWarningBadge,
}: QuestionCardProps) {
  const formattedValue = valueFormat === 'currency'
    ? formatCOP(value)
    : valueFormat === 'months'
      ? `${value.toFixed(1)} meses`
      : `${Math.round(value)}%`

  const trendColor = trend === 'stable'
    ? 'text-muted-foreground'
    : trendIsPositive
      ? 'text-green-600 dark:text-green-400'
      : 'text-red-600 dark:text-red-400'

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus

  return (
    <button
      onClick={onClick}
      className={`relative w-full rounded-xl border bg-card p-4 text-left transition-all hover:shadow-md active:scale-[0.98] ${
        monthType === 'future' ? 'opacity-60 border-dashed' : ''
      }`}
    >
      {/* Warning badge */}
      {hasWarningBadge && (
        <div className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-yellow-400">
          <span className="text-[10px]" title="Datos parciales"><AlertTriangle className="h-3 w-3 text-yellow-900" /></span>
        </div>
      )}

      {/* Title + Trend */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground leading-tight">{title}</h3>
        <div className={`flex items-center gap-0.5 ${trendColor}`}>
          <TrendIcon className="h-3.5 w-3.5" />
        </div>
      </div>

      {/* Value */}
      <div className={`mt-1 text-lg font-bold ${
        valueFormat === 'currency' && value < 0 ? 'text-red-600 dark:text-red-400' : ''
      }`}>
        {isEmpty ? '—' : formattedValue}
      </div>

      {/* Bar */}
      <div className="mt-3">
        {barType === 'progress' && <ProgressBar data={barData as ProgressBarData} color={barColor} empty={isEmpty || monthType === 'future'} />}
        {barType === 'dual' && <DualBar data={barData as DualBarData} empty={isEmpty || monthType === 'future'} />}
        {barType === 'gauge' && <GaugeBar data={barData as GaugeBarData} empty={isEmpty || monthType === 'future'} />}
        {barType === 'dual_marker' && <DualMarkerBar data={barData as DualMarkerBarData} color={barColor} empty={isEmpty || monthType === 'future'} />}
      </div>
    </button>
  )
}

// ── Progress Bar ──────────────────────────────────────

function ProgressBar({ data, color, empty }: { data: ProgressBarData; color?: string; empty?: boolean }) {
  const pct = data.target > 0 ? Math.min((data.current / data.target) * 100, 100) : 0

  return (
    <div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        {!empty && (
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              backgroundColor: color || 'var(--color-primary)',
            }}
          />
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{data.label}</span>
        <span>{data.sublabel}</span>
      </div>
    </div>
  )
}

// ── Dual Bar (P2: Ingresos vs Gastos) ────────────────

function DualBar({ data, empty }: { data: DualBarData; empty?: boolean }) {
  const maxVal = Math.max(data.bar1.value, data.bar2.value, 1)
  const pct1 = (data.bar1.value / maxVal) * 100
  const pct2 = (data.bar2.value / maxVal) * 100
  const ratio = data.bar1.value > 0 ? data.bar2.value / data.bar1.value : 0
  const gastosColor = ratio > 0.9 ? '#EF4444' : ratio > 0.7 ? '#F59E0B' : '#10B981'

  return (
    <div className="space-y-1.5">
      <div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
          <span>{data.bar1.label}</span>
          <span>{formatCOP(data.bar1.value)}</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          {!empty && (
            <div
              className="h-full rounded-full bg-green-500 transition-all duration-500"
              style={{ width: `${pct1}%` }}
            />
          )}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
          <span>{data.bar2.label}</span>
          <span>{formatCOP(data.bar2.value)}</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          {!empty && (
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct2}%`, backgroundColor: gastosColor }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Gauge Bar (P5: Runway) ────────────────────────────

function GaugeBar({ data, empty }: { data: GaugeBarData; empty?: boolean }) {
  const maxRange = data.zones[data.zones.length - 1]?.end ?? 12
  const position = Math.min(data.value / maxRange, 1) * 100

  return (
    <div>
      <div className="relative h-3 w-full rounded-full overflow-hidden flex">
        {data.zones.map((zone, i) => {
          const width = ((zone.end - zone.start) / maxRange) * 100
          return (
            <div
              key={i}
              className="h-full opacity-30"
              style={{ width: `${width}%`, backgroundColor: zone.color }}
            />
          )
        })}
        {/* Marker */}
        {!empty && (
          <div
            className="absolute top-0 h-full w-0.5 bg-foreground transition-all duration-500"
            style={{ left: `${position}%` }}
          >
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] font-bold whitespace-nowrap">
              {data.value > 12 ? '12+' : data.value.toFixed(1)}
            </div>
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
        <span>0</span>
        <span>3</span>
        <span>6</span>
        <span>12+</span>
      </div>
    </div>
  )
}

// ── Dual Marker Bar (P4: Ventas con PE marker) ───────

function DualMarkerBar({ data, color, empty }: { data: DualMarkerBarData; color?: string; empty?: boolean }) {
  const maxVal = Math.max(data.target, data.current, 1)
  const pct = (data.current / maxVal) * 100
  const markerPct = (data.marker / maxVal) * 100

  return (
    <div>
      <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden">
        {!empty && (
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(pct, 100)}%`,
              backgroundColor: color || 'var(--color-primary)',
            }}
          />
        )}
        {/* PE Marker */}
        {data.marker > 0 && (
          <div
            className="absolute top-0 h-full w-0.5 bg-foreground/50"
            style={{ left: `${Math.min(markerPct, 100)}%` }}
          />
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{formatCOP(data.current)} / {formatCOP(data.target)}</span>
        {data.marker > 0 && (
          <span className="text-[9px]">▲ {data.markerLabel}</span>
        )}
      </div>
    </div>
  )
}
