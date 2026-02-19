'use client'

import { TrendingUp, TrendingDown, DollarSign, Receipt, ArrowRight } from 'lucide-react'
import Link from 'next/link'

interface PulsoMesProps {
  ventasMes: number
  metaVentas: number
  cobradoMes: number
  metaCobros: number
  gastoTotalMes: number
  gastosFijosMes: number
  hasMetas: boolean
}

const fmtShort = (v: number) => {
  if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`
  if (v >= 1000) return `$${Math.round(v / 1000)}K`
  return `$${v.toLocaleString('es-CO')}`
}

function getColor(pct: number, inverted = false): { bg: string; text: string; emoji: string } {
  if (inverted) {
    // For expenses: lower is better
    if (pct < 90) return { bg: 'bg-green-100 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-400', emoji: '🟢' }
    if (pct <= 100) return { bg: 'bg-yellow-100 dark:bg-yellow-900/20', text: 'text-yellow-700 dark:text-yellow-400', emoji: '🟡' }
    return { bg: 'bg-red-100 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-400', emoji: '🔴' }
  }
  // For sales/collections: higher is better
  if (pct >= 90) return { bg: 'bg-green-100 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-400', emoji: '🟢' }
  if (pct >= 70) return { bg: 'bg-yellow-100 dark:bg-yellow-900/20', text: 'text-yellow-700 dark:text-yellow-400', emoji: '🟡' }
  return { bg: 'bg-red-100 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-400', emoji: '🔴' }
}

export default function PulsoMes({ ventasMes, metaVentas, cobradoMes, metaCobros, gastoTotalMes, gastosFijosMes, hasMetas }: PulsoMesProps) {
  if (!hasMetas) {
    return (
      <div className="rounded-xl border border-dashed p-5 text-center">
        <p className="text-sm text-muted-foreground">
          Configura tus <strong>metas mensuales</strong> para ver el Pulso del Mes
        </p>
        <Link href="/config" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          Ir a configuración <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    )
  }

  const pctVentas = metaVentas > 0 ? (ventasMes / metaVentas) * 100 : 0
  const pctCobros = metaCobros > 0 ? (cobradoMes / metaCobros) * 100 : 0
  const pctGastos = gastosFijosMes > 0 ? (gastoTotalMes / gastosFijosMes) * 100 : 0

  const colorsVentas = getColor(pctVentas)
  const colorsCobros = getColor(pctCobros)
  const colorsGastos = getColor(pctGastos, true)

  const metrics = [
    {
      label: 'Ventas',
      icon: TrendingUp,
      actual: ventasMes,
      meta: metaVentas,
      pct: pctVentas,
      colors: colorsVentas,
    },
    {
      label: 'Cobros',
      icon: DollarSign,
      actual: cobradoMes,
      meta: metaCobros,
      pct: pctCobros,
      colors: colorsCobros,
    },
    {
      label: 'Gastos',
      icon: Receipt,
      actual: gastoTotalMes,
      meta: gastosFijosMes,
      pct: pctGastos,
      colors: colorsGastos,
    },
  ]

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Pulso del Mes</h3>
        <span className="text-xs text-muted-foreground">
          {new Date().toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {metrics.map(m => {
          const Icon = m.icon
          return (
            <div key={m.label} className={`rounded-xl border p-3 ${m.colors.bg}`}>
              <div className="flex items-center justify-between">
                <Icon className={`h-4 w-4 ${m.colors.text}`} />
                <span className="text-lg">{m.colors.emoji}</span>
              </div>
              <p className={`mt-2 text-lg font-bold ${m.colors.text}`}>
                {fmtShort(m.actual)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Meta: {fmtShort(m.meta)}
              </p>
              {/* Progress bar */}
              <div className="mt-2 h-1.5 rounded-full bg-muted">
                <div
                  className={`h-1.5 rounded-full ${
                    m.colors.emoji === '🟢' ? 'bg-green-500' :
                    m.colors.emoji === '🟡' ? 'bg-yellow-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.min(100, m.pct)}%` }}
                />
              </div>
              <p className={`mt-1 text-[10px] font-medium ${m.colors.text}`}>
                {m.pct.toFixed(0)}%
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
