'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { FileSpreadsheet, Plus, ExternalLink, CheckCircle2, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { aceptarCotizacionNegocio } from '../cotizacion/actions'

interface CotizacionResumen {
  id: string
  consecutivo: string | null
  modo: string | null
  estado: string | null
  valor_total: number | null
  descripcion: string | null
  created_at: string | null
}

interface BloqueCotizacionProps {
  negocioId: string
  modo: 'editable' | 'visible'
  cotizaciones: CotizacionResumen[]
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

const ESTADO_COLORS: Record<string, string> = {
  borrador: 'bg-slate-100 text-slate-600',
  enviada: 'bg-blue-100 text-blue-700',
  aceptada: 'bg-green-100 text-green-700',
  rechazada: 'bg-red-100 text-red-700',
  vencida: 'bg-orange-100 text-orange-700',
}

const ESTADO_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
  vencida: 'Vencida',
}

const ESTADO_ORDER: Record<string, number> = {
  aceptada: 0,
  enviada: 1,
  borrador: 2,
  rechazada: 3,
  vencida: 4,
}

export default function BloqueCotizacion({ negocioId, modo, cotizaciones }: BloqueCotizacionProps) {
  const [isPending, startTransition] = useTransition()
  const [optimisticAceptadaId, setOptimisticAceptadaId] = useState<string | null>(null)

  const aceptada = cotizaciones.find(c => c.estado === 'aceptada') ??
    (optimisticAceptadaId ? cotizaciones.find(c => c.id === optimisticAceptadaId) : null)

  const sorted = [...cotizaciones].sort((a, b) => {
    // Si hay optimistic aceptada, tratarla como aceptada en el sort
    const aEstado = a.id === optimisticAceptadaId ? 'aceptada' : (a.estado ?? 'borrador')
    const bEstado = b.id === optimisticAceptadaId ? 'aceptada' : (b.estado ?? 'borrador')
    return (ESTADO_ORDER[aEstado] ?? 99) - (ESTADO_ORDER[bEstado] ?? 99)
  })

  const handleAprobar = (cotizacionId: string) => {
    setOptimisticAceptadaId(cotizacionId)
    startTransition(async () => {
      const res = await aceptarCotizacionNegocio(cotizacionId, negocioId)
      if (!res.success) {
        setOptimisticAceptadaId(null)
        toast.error(res.error)
      } else {
        toast.success('Cotización aprobada — bloque en solo lectura')
      }
    })
  }

  const hayAceptada = !!aceptada || !!optimisticAceptadaId

  return (
    <div className="space-y-3">
      {/* Banner solo lectura */}
      {hayAceptada && (
        <div className="flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-900/30 dark:bg-green-950/20 dark:text-green-400">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          Cotización aprobada — bloque en solo lectura
        </div>
      )}

      {cotizaciones.length === 0 ? (
        <p className="text-xs text-[#6B7280]">Sin cotizaciones registradas</p>
      ) : (
        <div className="space-y-2">
          {sorted.map(cot => {
            const esAceptadaOptimista = cot.id === optimisticAceptadaId
            const estadoEfectivo = esAceptadaOptimista ? 'aceptada' : (cot.estado ?? 'borrador')
            const esAceptada = estadoEfectivo === 'aceptada'

            return (
              <div key={cot.id} className="flex items-center gap-2">
                <Link
                  href={`/negocios/${negocioId}/cotizacion/${cot.id}`}
                  className={`flex flex-1 items-center gap-2.5 rounded-lg border p-2.5 transition-colors group ${
                    esAceptada
                      ? 'border-green-200 bg-green-50/50 hover:border-green-300 dark:border-green-900/30 dark:bg-green-950/10'
                      : 'border-[#E5E7EB] hover:border-[#10B981] hover:bg-[#10B981]/5'
                  }`}
                >
                  <FileSpreadsheet
                    className={`h-4 w-4 shrink-0 ${
                      esAceptada ? 'text-green-500' : 'text-[#6B7280] group-hover:text-[#10B981]'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[#1A1A1A] truncate">
                      {cot.consecutivo ?? 'COT'} &middot;{' '}
                      {cot.descripcion ?? (cot.modo === 'flash' ? 'Cotización rápida' : 'Cotización detallada')}
                    </p>
                    {cot.valor_total !== null && (
                      <p className="text-[10px] text-[#6B7280] tabular-nums">{fmt(cot.valor_total)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        ESTADO_COLORS[estadoEfectivo]
                      }`}
                    >
                      {ESTADO_LABELS[estadoEfectivo]}
                    </span>
                    {esAceptada ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <ExternalLink className="h-3 w-3 text-[#6B7280]/40 group-hover:text-[#10B981]" />
                    )}
                  </div>
                </Link>

                {/* Botón Aprobar — solo enviadas, solo si no hay aceptada, solo modo editable */}
                {modo === 'editable' && !hayAceptada && cot.estado === 'enviada' && (
                  <button
                    onClick={() => handleAprobar(cot.id)}
                    disabled={isPending}
                    className="shrink-0 rounded-lg border border-green-200 bg-green-50 px-2.5 py-2 text-[10px] font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50 transition-colors"
                  >
                    Aprobar
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Nueva cotización — oculto si hay aceptada */}
      {modo === 'editable' && !hayAceptada && (
        <Link
          href={`/negocios/${negocioId}/cotizacion/nueva`}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[#10B981]/40 bg-[#10B981]/5 py-2.5 text-xs font-medium text-[#10B981] hover:border-[#10B981] hover:bg-[#10B981]/10 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Nueva cotización
        </Link>
      )}
    </div>
  )
}
