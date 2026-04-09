'use client'

import { BarChart3, FileCheck } from 'lucide-react'

interface ResumenFinancieroData {
  totalCobrado: number
  porCobrar: number
  costosEjecutados: number
  precioAprobado?: number
}

interface BloqueResumenFinancieroProps {
  data: ResumenFinancieroData
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

export default function BloqueResumenFinanciero({ data }: BloqueResumenFinancieroProps) {
  const ganancia = data.totalCobrado - data.costosEjecutados
  const margen = data.totalCobrado > 0 ? Math.round((ganancia / data.totalCobrado) * 100) : 0

  return (
    <div className="space-y-3">
      <div className={`grid gap-2 ${data.precioAprobado ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {/* Precio aprobado (cotización) — si existe */}
        {data.precioAprobado != null && data.precioAprobado > 0 && (
          <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-2.5">
            <div className="flex items-center gap-1 mb-0.5">
              <FileCheck className="h-3 w-3 text-indigo-500" />
              <p className="text-[10px] font-medium text-indigo-600">Cotizado</p>
            </div>
            <p className="text-sm font-bold text-indigo-700 tabular-nums">{fmt(data.precioAprobado)}</p>
          </div>
        )}
        <div className="rounded-lg bg-green-50 border border-green-100 p-2.5">
          <p className="text-[10px] font-medium text-green-600">Total cobrado</p>
          <p className="text-sm font-bold text-green-700 tabular-nums">{fmt(data.totalCobrado)}</p>
        </div>
        <div className="rounded-lg bg-amber-50 border border-amber-100 p-2.5">
          <p className="text-[10px] font-medium text-amber-600">Por cobrar</p>
          <p className="text-sm font-bold text-amber-700 tabular-nums">{fmt(data.porCobrar)}</p>
        </div>
        <div className="rounded-lg bg-red-50 border border-red-100 p-2.5">
          <p className="text-[10px] font-medium text-red-600">Costos ejecutados</p>
          <p className="text-sm font-bold text-red-700 tabular-nums">{fmt(data.costosEjecutados)}</p>
        </div>
        <div className={`rounded-lg border p-2.5 ${ganancia >= 0 ? 'bg-[#10B981]/10 border-[#10B981]/30' : 'bg-red-50 border-red-100'}`}>
          <p className={`text-[10px] font-medium ${ganancia >= 0 ? 'text-[#10B981]' : 'text-red-600'}`}>Ganancia</p>
          <p className={`text-sm font-bold tabular-nums ${ganancia >= 0 ? 'text-[#10B981]' : 'text-red-700'}`}>{fmt(ganancia)}</p>
        </div>
      </div>

      {data.totalCobrado > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] text-[#6B7280]">Margen</span>
            <span className={`text-[10px] font-semibold ${margen >= 0 ? 'text-[#10B981]' : 'text-red-600'}`}>{margen}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E5E7EB]">
            <div
              className={`h-full rounded-full transition-all ${margen >= 0 ? 'bg-[#10B981]' : 'bg-red-500'}`}
              style={{ width: `${Math.min(Math.abs(margen), 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <BarChart3 className="h-3 w-3 text-[#6B7280]" />
        <span className="text-[10px] text-[#6B7280]">Solo visualización · Actualiza en tiempo real</span>
      </div>
    </div>
  )
}
