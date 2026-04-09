'use client'

import { Activity, Clock, Receipt, TrendingUp } from 'lucide-react'

const CATEGORIA_LABELS: Record<string, string> = {
  materiales: 'Materiales',
  transporte: 'Transporte',
  servicios_profesionales: 'Servicios profesionales',
  viaticos: 'Viáticos',
  software: 'Software',
  impuestos_seguros: 'Impuestos/Seguros',
  mano_de_obra: 'Mano de obra',
  alimentacion: 'Alimentación',
  otros: 'Otros',
}

interface EjecucionData {
  totalGastos: number
  totalHoras: number
  costoHoras: number
  gastosPorCategoria: Array<{ categoria: string; total: number }>
}

interface BloqueEjecucionProps {
  negocioId: string
  data: EjecucionData
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

export default function BloqueEjecucion({ data }: BloqueEjecucionProps) {
  const costoTotal = data.totalGastos + data.costoHoras
  const hayDatos = data.totalGastos > 0 || data.totalHoras > 0

  if (!hayDatos) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <Activity className="h-8 w-8 text-[#6B7280]/20" />
        <p className="text-xs text-[#6B7280]">Sin registros de ejecución aún</p>
        <p className="text-[11px] text-[#6B7280]/60">
          Registra gastos y horas desde el FAB o por WhatsApp
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-red-50 border border-red-100 p-2.5">
          <div className="flex items-center gap-1 mb-0.5">
            <Receipt className="h-3 w-3 text-red-500" />
            <p className="text-[10px] font-medium text-red-600">Gastos</p>
          </div>
          <p className="text-sm font-bold text-red-700 tabular-nums">{fmt(data.totalGastos)}</p>
        </div>
        <div className="rounded-lg bg-blue-50 border border-blue-100 p-2.5">
          <div className="flex items-center gap-1 mb-0.5">
            <Clock className="h-3 w-3 text-blue-500" />
            <p className="text-[10px] font-medium text-blue-600">Horas</p>
          </div>
          <p className="text-sm font-bold text-blue-700 tabular-nums">{data.totalHoras}h</p>
          {data.costoHoras > 0 && (
            <p className="text-[10px] text-blue-500 tabular-nums">{fmt(data.costoHoras)}</p>
          )}
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
          <div className="flex items-center gap-1 mb-0.5">
            <TrendingUp className="h-3 w-3 text-slate-500" />
            <p className="text-[10px] font-medium text-slate-600">Costo total</p>
          </div>
          <p className="text-sm font-bold text-slate-700 tabular-nums">{fmt(costoTotal)}</p>
        </div>
      </div>

      {/* Gastos por categoría */}
      {data.gastosPorCategoria.length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-[#6B7280] mb-1.5">Gastos por categoría</p>
          <div className="space-y-1">
            {data.gastosPorCategoria.map(g => {
              const pct = data.totalGastos > 0 ? Math.round((g.total / data.totalGastos) * 100) : 0
              return (
                <div key={g.categoria} className="flex items-center gap-2">
                  <span className="text-[10px] text-[#6B7280] w-28 truncate">
                    {CATEGORIA_LABELS[g.categoria] ?? g.categoria}
                  </span>
                  <div className="flex-1 h-1.5 rounded-full bg-[#E5E7EB] overflow-hidden">
                    <div className="h-full rounded-full bg-red-400" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] font-medium text-[#6B7280] tabular-nums w-20 text-right">
                    {fmt(g.total)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <Activity className="h-3 w-3 text-[#6B7280]" />
        <span className="text-[10px] text-[#6B7280]">Solo visualización · Actualiza en tiempo real</span>
      </div>
    </div>
  )
}
