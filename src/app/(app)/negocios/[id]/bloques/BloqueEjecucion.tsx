'use client'

import { Activity, Clock, Receipt, TrendingUp, Target } from 'lucide-react'

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

// Mapeo de tipos de cotización (rubros) a categorías de gastos
const TIPO_A_CATEGORIA: Record<string, string> = {
  materiales: 'materiales',
  mano_obra: 'mano_de_obra',
  servicio: 'servicios_profesionales',
  transporte: 'transporte',
  otro: 'otros',
}

const RUBRO_LABELS: Record<string, string> = {
  materiales: 'Materiales',
  mano_obra: 'Mano de obra',
  servicio: 'Servicios profesionales',
  transporte: 'Transporte',
  otro: 'Otros',
  total: 'Total cotizado',
}

interface EjecucionData {
  totalGastos: number
  totalHoras: number
  costoHoras: number
  gastosPorCategoria: Array<{ categoria: string; total: number }>
  presupuestoPorRubro?: Array<{ tipo: string; nombre: string; total: number }>
  precioAprobado?: number
}

interface BloqueEjecucionProps {
  negocioId: string
  data: EjecucionData
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

function barColor(pct: number): string {
  if (pct >= 100) return 'bg-red-500'
  if (pct >= 90) return 'bg-amber-500'
  return 'bg-[#10B981]'
}

function barTextColor(pct: number): string {
  if (pct >= 100) return 'text-red-600'
  if (pct >= 90) return 'text-amber-600'
  return 'text-[#10B981]'
}

export default function BloqueEjecucion({ data }: BloqueEjecucionProps) {
  const costoTotal = data.totalGastos + data.costoHoras
  const hayDatos = data.totalGastos > 0 || data.totalHoras > 0
  const hayPresupuesto = data.presupuestoPorRubro && data.presupuestoPorRubro.length > 0

  if (!hayDatos && !hayPresupuesto) {
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

  // Construir mapa de gastos por categoría para lookup rápido
  const gastosMap: Record<string, number> = {}
  for (const g of data.gastosPorCategoria) {
    gastosMap[g.categoria] = g.total
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

      {/* Presupuesto vs Ejecutado — solo si hay cotización aprobada */}
      {hayPresupuesto && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Target className="h-3 w-3 text-[#6B7280]" />
            <p className="text-[10px] font-medium text-[#6B7280]">Presupuesto vs Ejecutado</p>
          </div>
          <div className="space-y-1.5">
            {data.presupuestoPorRubro!.map(rubro => {
              const categoriaGasto = TIPO_A_CATEGORIA[rubro.tipo] ?? rubro.tipo
              const ejecutado = gastosMap[categoriaGasto] ?? 0
              const pct = rubro.total > 0 ? Math.round((ejecutado / rubro.total) * 100) : 0
              const label = RUBRO_LABELS[rubro.tipo] ?? rubro.nombre ?? rubro.tipo

              return (
                <div key={rubro.tipo}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[10px] text-[#6B7280] truncate">{label}</span>
                    <span className={`text-[10px] font-semibold tabular-nums ${barTextColor(pct)}`}>
                      {pct}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-[#E5E7EB] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${barColor(pct)}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-[#6B7280] tabular-nums whitespace-nowrap">
                      {fmt(ejecutado)} / {fmt(rubro.total)}
                    </span>
                  </div>
                </div>
              )
            })}

            {/* Total: gastos+horas vs precio aprobado */}
            {data.precioAprobado && data.precioAprobado > 0 && (
              <div className="pt-1.5 mt-1.5 border-t border-[#E5E7EB]">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] font-medium text-[#1A1A1A]">Total</span>
                  <span className={`text-[10px] font-semibold tabular-nums ${barTextColor(
                    Math.round((costoTotal / data.precioAprobado) * 100)
                  )}`}>
                    {Math.round((costoTotal / data.precioAprobado) * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-[#E5E7EB] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${barColor(
                        Math.round((costoTotal / data.precioAprobado) * 100)
                      )}`}
                      style={{ width: `${Math.min(Math.round((costoTotal / data.precioAprobado) * 100), 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-medium text-[#6B7280] tabular-nums whitespace-nowrap">
                    {fmt(costoTotal)} / {fmt(data.precioAprobado)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Gastos por categoría — siempre visible */}
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
