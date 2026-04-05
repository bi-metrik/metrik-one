'use client'

import { FileSpreadsheet, ExternalLink, Plus } from 'lucide-react'
import Link from 'next/link'
import type { NegocioBloque } from '../../negocio-v2-actions'

interface Cotizacion {
  id: string
  consecutivo: string
  estado: string
  valor_total: number | null
  created_at: string
  oportunidad_id: string | null
}

interface BloqueCotizacionProps {
  negocioId: string
  negocioBloqueId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  cotizacion: Cotizacion | null
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

const ESTADO_LABELS: Record<string, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
}

const ESTADO_COLORS: Record<string, string> = {
  borrador: 'bg-slate-100 text-slate-600',
  enviada: 'bg-blue-100 text-blue-700',
  aceptada: 'bg-green-100 text-green-700',
  rechazada: 'bg-red-100 text-red-700',
}

export default function BloqueCotizacion({
  negocioId,
  instancia,
  modo,
  cotizacion,
}: BloqueCotizacionProps) {
  const data = (instancia?.data ?? {}) as Record<string, string>
  const cotizacionId = cotizacion?.id ?? data.cotizacion_id

  if (!cotizacion && !cotizacionId) {
    if (modo === 'visible') {
      return <p className="text-xs text-[#6B7280]">Sin cotización vinculada</p>
    }
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <FileSpreadsheet className="h-8 w-8 text-[#6B7280]/30" />
        <p className="text-xs text-[#6B7280]">Sin cotización creada para este negocio</p>
        <Link
          href={`/negocios/${negocioId}/cotizacion/nueva`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#10B981] px-3 py-2 text-xs font-medium text-white hover:bg-[#059669] transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Crear cotización
        </Link>
      </div>
    )
  }

  const cot = cotizacion
  const estadoClass = ESTADO_COLORS[cot?.estado ?? ''] ?? 'bg-slate-100 text-slate-600'
  const isComplete = cot?.estado === 'aceptada' || cot?.estado === 'enviada'

  const resumenUrl = cot?.oportunidad_id
    ? `/pipeline/${cot.oportunidad_id}`
    : null

  return (
    <div className="rounded-lg border border-[#E5E7EB] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-[#10B981] shrink-0" />
          <div>
            <p className="text-xs font-semibold text-[#1A1A1A]">{cot?.consecutivo ?? '—'}</p>
            {cot?.valor_total && (
              <p className="text-xs text-[#6B7280] tabular-nums">{fmt(cot.valor_total)}</p>
            )}
          </div>
        </div>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${estadoClass}`}>
          {ESTADO_LABELS[cot?.estado ?? ''] ?? cot?.estado ?? '—'}
        </span>
      </div>

      {isComplete && (
        <div className="mt-1.5 flex items-center gap-1">
          <div className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
          <span className="text-[10px] text-[#10B981] font-medium">Gate cumplido</span>
        </div>
      )}

      {resumenUrl && (
        <Link
          href={resumenUrl}
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#10B981] hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Ver cotización completa
        </Link>
      )}
    </div>
  )
}
