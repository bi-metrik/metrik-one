'use client'

import { DollarSign, TrendingUp, Percent, Target, Clock, ArrowRight } from 'lucide-react'
import Link from 'next/link'

interface CincoPreguntasProps {
  caja: number
  utilidad: number
  margen: number
  puntoEquilibrio: number
  runway: number
  hasBankData: boolean
}

const fmtShort = (v: number) => {
  if (Math.abs(v) >= 1000000) return `$${(v / 1000000).toFixed(1)}M`
  if (Math.abs(v) >= 1000) return `$${Math.round(v / 1000)}K`
  return `$${v.toLocaleString('es-CO')}`
}

const PREGUNTAS = [
  {
    pregunta: '¿Cuánta plata tengo?',
    key: 'caja' as const,
    icon: DollarSign,
    format: (v: number) => fmtShort(v),
    color: (v: number) => v > 0 ? 'text-green-600' : 'text-red-600',
    tooltip: 'Saldo actual en todas tus cuentas bancarias',
  },
  {
    pregunta: '¿Estoy ganando plata?',
    key: 'utilidad' as const,
    icon: TrendingUp,
    format: (v: number) => fmtShort(v),
    color: (v: number) => v > 0 ? 'text-green-600' : 'text-red-600',
    tooltip: 'Utilidad del mes = cobrado - gastos - impuestos estimados',
  },
  {
    pregunta: '¿Cuánto me queda de cada peso?',
    key: 'margen' as const,
    icon: Percent,
    format: (v: number) => `${v.toFixed(1)}%`,
    color: (v: number) => v >= 15 ? 'text-green-600' : v >= 0 ? 'text-yellow-600' : 'text-red-600',
    tooltip: 'Margen neto: utilidad / ingresos × 100',
  },
  {
    pregunta: '¿Cuánto necesito para no perder?',
    key: 'puntoEquilibrio' as const,
    icon: Target,
    format: (v: number) => fmtShort(v),
    color: () => 'text-foreground',
    tooltip: 'Punto de equilibrio: gastos fijos mensuales',
  },
  {
    pregunta: '¿Para cuántos meses me alcanza?',
    key: 'runway' as const,
    icon: Clock,
    format: (v: number) => v >= 12 ? '12+ meses' : `${v.toFixed(1)} meses`,
    color: (v: number) => v >= 6 ? 'text-green-600' : v >= 3 ? 'text-yellow-600' : 'text-red-600',
    tooltip: 'Runway: caja / gasto mensual',
  },
]

export default function CincoPreguntas({ caja, utilidad, margen, puntoEquilibrio, runway, hasBankData }: CincoPreguntasProps) {
  if (!hasBankData) {
    return (
      <div className="rounded-xl border border-dashed p-5 text-center">
        <p className="text-sm text-muted-foreground">
          Registra tus <strong>cuentas bancarias</strong> y saldos para ver las 5 preguntas clave
        </p>
        <Link href="/config" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          Ir a configuración <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    )
  }

  const values = { caja, utilidad, margen, puntoEquilibrio, runway }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Las 5 preguntas de tu negocio</h3>
      <div className="space-y-2">
        {PREGUNTAS.map(p => {
          const Icon = p.icon
          const value = values[p.key]
          return (
            <div key={p.key} className="flex items-center gap-3 rounded-xl border bg-card p-3 group" title={p.tooltip}>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">{p.pregunta}</p>
                <p className={`text-lg font-bold ${p.color(value)}`}>
                  {p.format(value)}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
