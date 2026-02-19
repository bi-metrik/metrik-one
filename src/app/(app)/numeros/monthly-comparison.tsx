'use client'

import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'

/**
 * Sprint 12 — D83: Comparativos mensuales
 * - 2+ meses datos requerido
 * - Min 2, max 6 meses
 * - Flecha verde/rojo/gris por indicador
 * - Insight rule-based
 */

interface MonthlyData {
  month: string        // "2026-01", "2026-02", etc.
  monthLabel: string   // "Ene", "Feb", etc.
  ingresos: number
  gastos: number
  margen: number       // percentage
  proyectos: number    // active projects
  oportunidades: number // won this month
  hoursLogged: number
}

interface MonthlyComparisonProps {
  months: MonthlyData[]  // sorted oldest → newest, max 6
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

function TrendArrow({ current, previous }: { current: number; previous: number }) {
  if (current === previous || previous === 0) {
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />
  }
  const pctChange = ((current - previous) / Math.abs(previous)) * 100
  if (current > previous) {
    return (
      <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400">
        <TrendingUp className="h-3.5 w-3.5" />
        <span className="text-[10px] font-medium">+{pctChange.toFixed(0)}%</span>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400">
      <TrendingDown className="h-3.5 w-3.5" />
      <span className="text-[10px] font-medium">{pctChange.toFixed(0)}%</span>
    </span>
  )
}

function generateInsight(months: MonthlyData[]): string | null {
  if (months.length < 2) return null
  const latest = months[months.length - 1]
  const prev = months[months.length - 2]

  // Revenue trend
  if (latest.ingresos > prev.ingresos * 1.2) {
    return `Tus ingresos crecieron más del 20% en ${latest.monthLabel}. ¡Gran mes!`
  }
  if (latest.ingresos < prev.ingresos * 0.8) {
    return `Tus ingresos bajaron más del 20% en ${latest.monthLabel}. Revisa tu pipeline.`
  }

  // Margin trend
  if (latest.margen > prev.margen + 5) {
    return `Tu margen mejoró ${(latest.margen - prev.margen).toFixed(1)} puntos. Estás optimizando costos.`
  }
  if (latest.margen < prev.margen - 5) {
    return `Tu margen bajó ${(prev.margen - latest.margen).toFixed(1)} puntos. Revisa tus gastos.`
  }

  // Expense growth
  if (latest.gastos > prev.gastos * 1.3 && latest.ingresos <= prev.ingresos) {
    return `Tus gastos crecieron pero tus ingresos no. Vigila el balance.`
  }

  return `Mes estable. Sigue registrando para ver tendencias más claras.`
}

export default function MonthlyComparison({ months }: MonthlyComparisonProps) {
  const [expanded, setExpanded] = useState(false)

  if (months.length < 2) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Necesitas al menos 2 meses de datos para ver comparativos.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Sigue registrando actividad y tus comparativos aparecerán automáticamente.
        </p>
      </div>
    )
  }

  const displayMonths = months.slice(-6) // Max 6 months (D83)
  const insight = generateInsight(displayMonths)

  const indicators = [
    { key: 'ingresos', label: 'Ingresos', format: fmt },
    { key: 'gastos', label: 'Gastos', format: fmt },
    { key: 'margen', label: 'Margen', format: (v: number) => `${v.toFixed(1)}%` },
    { key: 'proyectos', label: 'Proyectos activos', format: (v: number) => String(v) },
    { key: 'oportunidades', label: 'Oportunidades ganadas', format: (v: number) => String(v) },
    { key: 'hoursLogged', label: 'Horas registradas', format: (v: number) => `${v}h` },
  ]

  return (
    <div className="space-y-4">
      {/* D83: Insight rule-based */}
      {insight && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
          {insight}
        </div>
      )}

      {/* Comparison table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="pb-2 text-left text-xs font-medium text-muted-foreground">Indicador</th>
              {displayMonths.map((m, i) => (
                <th key={m.month} className="pb-2 text-right text-xs font-medium text-muted-foreground">
                  {m.monthLabel}
                  {i === displayMonths.length - 1 && (
                    <span className="ml-1 rounded bg-primary/10 px-1 py-0.5 text-[9px] text-primary">
                      actual
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(expanded ? indicators : indicators.slice(0, 3)).map(({ key, label, format }) => (
              <tr key={key} className="border-b last:border-0">
                <td className="py-2.5 text-muted-foreground">{label}</td>
                {displayMonths.map((m, i) => {
                  const val = m[key as keyof MonthlyData] as number
                  const prevVal = i > 0 ? displayMonths[i - 1][key as keyof MonthlyData] as number : val
                  return (
                    <td key={m.month} className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="font-medium">{format(val)}</span>
                        {i > 0 && <TrendArrow current={val} previous={prevVal} />}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {indicators.length > 3 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed py-2 text-xs text-muted-foreground hover:bg-accent/50"
        >
          {expanded ? (
            <>Mostrar menos <ChevronUp className="h-3 w-3" /></>
          ) : (
            <>Ver {indicators.length - 3} indicadores más <ChevronDown className="h-3 w-3" /></>
          )}
        </button>
      )}
    </div>
  )
}
