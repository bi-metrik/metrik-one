'use client'

import Link from 'next/link'
import { FileSpreadsheet, Plus, ExternalLink } from 'lucide-react'

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

export default function BloqueCotizacion({ negocioId, modo, cotizaciones }: BloqueCotizacionProps) {
  return (
    <div className="space-y-3">
      {cotizaciones.length === 0 ? (
        <p className="text-xs text-[#6B7280]">Sin cotizaciones registradas</p>
      ) : (
        <div className="space-y-2">
          {cotizaciones.map(cot => (
            <Link
              key={cot.id}
              href={`/negocios/${negocioId}/cotizacion/${cot.id}`}
              className="flex items-center gap-2.5 rounded-lg border border-[#E5E7EB] p-2.5 hover:border-[#10B981] hover:bg-[#10B981]/5 transition-colors group"
            >
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-[#6B7280] group-hover:text-[#10B981]" />
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
                    ESTADO_COLORS[cot.estado ?? 'borrador']
                  }`}
                >
                  {ESTADO_LABELS[cot.estado ?? 'borrador']}
                </span>
                <ExternalLink className="h-3 w-3 text-[#6B7280]/40 group-hover:text-[#10B981]" />
              </div>
            </Link>
          ))}
        </div>
      )}

      {modo === 'editable' && (
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
