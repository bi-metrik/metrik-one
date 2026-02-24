'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowDownCircle, ArrowUpCircle, FileText, Filter } from 'lucide-react'
import { formatCOP } from '@/lib/contacts/constants'
import type { Movimiento } from './actions'

interface Props {
  movimientos: Movimiento[]
  totales: { ingresos: number; egresos: number }
  filtroTipo: string
  filtroMes: string
}

const MESES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
]

function formatFechaCort(fecha: string) {
  const [, m, d] = fecha.split('-')
  return `${Number(d)} ${MESES[Number(m) - 1]}`
}

function mesLabel(mes: string) {
  const [y, m] = mes.split('-')
  return `${MESES[Number(m) - 1]} ${y}`
}

export default function MovimientosClient({ movimientos, totales, filtroTipo, filtroMes }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const neto = totales.ingresos - totales.egresos

  function navigate(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set(key, value)
    router.push(`/movimientos?${params.toString()}`)
  }

  // Month navigation
  function cambiarMes(delta: number) {
    const [y, m] = filtroMes.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    navigate('mes', d.toISOString().slice(0, 7))
  }

  // Group movimientos by date
  const porFecha = movimientos.reduce<Record<string, Movimiento[]>>((acc, mov) => {
    if (!acc[mov.fecha]) acc[mov.fecha] = []
    acc[mov.fecha].push(mov)
    return acc
  }, {})

  const fechasOrdenadas = Object.keys(porFecha).sort((a, b) => b.localeCompare(a))

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Mis Movimientos</h1>
      </div>

      {/* Month selector */}
      <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
        <button onClick={() => cambiarMes(-1)} className="px-2 py-1 text-sm text-muted-foreground hover:text-foreground">
          &larr;
        </button>
        <span className="text-sm font-medium">{mesLabel(filtroMes)}</span>
        <button onClick={() => cambiarMes(1)} className="px-2 py-1 text-sm text-muted-foreground hover:text-foreground">
          &rarr;
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Ingresos</p>
          <p className="text-sm font-semibold text-green-600 dark:text-green-400">
            {formatCOP(totales.ingresos)}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Egresos</p>
          <p className="text-sm font-semibold text-red-600 dark:text-red-400">
            {formatCOP(totales.egresos)}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-3 text-center">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Neto</p>
          <p className={`text-sm font-semibold ${neto >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {neto >= 0 ? '+' : ''}{formatCOP(neto)}
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg border bg-card p-1">
        {(['todos', 'ingresos', 'egresos'] as const).map(t => (
          <button
            key={t}
            onClick={() => navigate('tipo', t)}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filtroTipo === t
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'todos' ? 'Todos' : t === 'ingresos' ? 'Ingresos' : 'Egresos'}
          </button>
        ))}
      </div>

      {/* Movimientos list */}
      {movimientos.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Filter className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p>No hay movimientos en {mesLabel(filtroMes)}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {fechasOrdenadas.map(fecha => (
            <div key={fecha}>
              {/* Date header */}
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                {formatFechaCort(fecha)}
              </p>
              <div className="space-y-1">
                {porFecha[fecha].map(mov => (
                  <div
                    key={mov.id}
                    className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5"
                  >
                    {/* Icon */}
                    {mov.tipo === 'ingreso' ? (
                      <ArrowDownCircle className="h-5 w-5 shrink-0 text-green-500" />
                    ) : (
                      <ArrowUpCircle className="h-5 w-5 shrink-0 text-red-500" />
                    )}

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{mov.descripcion}</p>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {mov.proyecto && <span className="truncate">{mov.proyecto}</span>}
                        {mov.categoria && (
                          <>
                            {mov.proyecto && <span>·</span>}
                            <span className="capitalize">{mov.categoria}</span>
                          </>
                        )}
                        {mov.deducible && (
                          <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                            Deducible
                          </span>
                        )}
                        {mov.soporte_url && (
                          <FileText className="h-3 w-3 text-blue-500" />
                        )}
                      </div>
                    </div>

                    {/* Amount */}
                    <span className={`shrink-0 text-sm font-semibold tabular-nums ${
                      mov.tipo === 'ingreso'
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}>
                      {mov.tipo === 'ingreso' ? '+' : '-'}{formatCOP(mov.monto)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
