'use client'

import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface StatHeroProps {
  label: string
  value: string
  delta?: number        // % change — positive = good
  deltaLabel?: string   // e.g. "vs mes anterior"
  suffix?: string       // e.g. "dias", "meses"
  invertDelta?: boolean // true = negative delta is good (e.g. expenses down)
  /** Tres cifras en fila en un celular: el valor baja de tamano. */
  compact?: boolean
  /** Linea gris bajo el valor (p.ej. "3 propuestas"). */
  note?: string
}

export function StatHero({ label, value, delta, deltaLabel, suffix, invertDelta, compact, note }: StatHeroProps) {
  const isPositive = invertDelta ? (delta ?? 0) < 0 : (delta ?? 0) > 0
  const isNeutral = delta === undefined || delta === 0

  return (
    <div>
      <p className={compact ? 'text-[11px] sm:text-sm font-medium text-gray-500 leading-tight' : 'text-sm font-medium text-gray-500'}>{label}</p>
      <div className="flex items-baseline gap-2 mt-1">
        <span className={compact ? 'text-lg sm:text-3xl font-bold text-gray-900' : 'text-4xl font-bold text-gray-900'}>{value}</span>
        {suffix && <span className="text-lg font-medium text-gray-500">{suffix}</span>}
      </div>
      {note && <p className="text-[11px] sm:text-xs text-gray-400 mt-0.5">{note}</p>}
      {delta !== undefined && (
        <div className={`flex items-center gap-1 mt-1 text-sm font-semibold ${
          isNeutral ? 'text-gray-400' : isPositive ? 'text-acento' : 'text-red-500'
        }`}>
          {isNeutral ? (
            <Minus className="h-3.5 w-3.5" />
          ) : isPositive ? (
            <TrendingUp className="h-3.5 w-3.5" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5" />
          )}
          <span>{delta > 0 ? '+' : ''}{delta.toFixed(0)}%</span>
          {deltaLabel && <span className="font-normal text-gray-400">{deltaLabel}</span>}
        </div>
      )}
    </div>
  )
}
