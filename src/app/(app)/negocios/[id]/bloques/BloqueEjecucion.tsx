'use client'

import { Activity, Clock, Receipt, TrendingUp, AlertTriangle } from 'lucide-react'
import GastosPorCategoria, { type CategoriaGasto, type MovimientoGasto } from './financiero/GastosPorCategoria'
import PresupuestoVsEjecutado, {
  hayPresupuestoQueMostrar,
  type PresupuestoData,
} from './financiero/PresupuestoVsEjecutado'
import { fmt, plural } from './financiero/formato'

export type { MovimientoGasto }

export interface EjecucionData extends PresupuestoData {
  totalGastos: number
  totalHoras: number
  costoHoras: number
  gastosPorCategoria: CategoriaGasto[]
  /** Horas que entraron valiendo cero: el ejecutado está subestimado. */
  horasSinTarifa?: { filas: number; horas: number; sinStaff: number; sinSalario: number }
}

interface BloqueEjecucionProps {
  negocioId: string
  data: EjecucionData
}

/** Cuántas horas entraron sin costo y qué hay que arreglar para que valgan. */
export function avisoHorasSinTarifa(sinTarifa: NonNullable<EjecucionData['horasSinTarifa']>): string {
  const horas = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(sinTarifa.horas)
  const causas: string[] = []
  if (sinTarifa.sinStaff > 0) causas.push(`${plural(sinTarifa.sinStaff, 'registro', 'registros')} sin responsable`)
  if (sinTarifa.sinSalario > 0) {
    causas.push(`${plural(sinTarifa.sinSalario, 'registro', 'registros')} con el salario del responsable sin configurar`)
  }
  return `${horas} h entraron al costo valiendo $0 (${causas.join(' y ')}). El costo ejecutado está por debajo del real.`
}

/**
 * El bloque de Ejecución clásico: movimientos de salida y resultado en una sola tarjeta.
 *
 * Los workspaces que separaron la plata en dos bloques (Movimientos y Resultado) no lo
 * usan; los que no, lo siguen viendo igual. Por eso las dos mitades viven en
 * `financiero/` y este archivo solo las compone: partir la vista no puede significar
 * partir la aritmética.
 */
export default function BloqueEjecucion({ data }: BloqueEjecucionProps) {
  const costoTotal = data.totalGastos + data.costoHoras
  const hayDatos = data.totalGastos > 0 || data.totalHoras > 0

  if (!hayDatos && !hayPresupuestoQueMostrar(data)) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <Activity className="h-8 w-8 text-tinta-suave/20" />
        <p className="text-xs text-tinta-suave">Sin registros de ejecución aún</p>
        <p className="text-[11px] text-tinta-suave/60">
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

      {/* Horas que entraron valiendo cero. Va debajo del KPI porque lo que queda
          subestimado es el "Costo total", que es el número del que cuelgan las barras.
          NO se inventa una tarifa por defecto: se declara el hueco. */}
      {data.horasSinTarifa && (
        <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-amber-600" />
          <p className="text-[10px] leading-snug text-amber-800">
            {avisoHorasSinTarifa(data.horasSinTarifa)}
          </p>
        </div>
      )}

      <PresupuestoVsEjecutado data={data} costoTotal={costoTotal} hayDatos={hayDatos} />

      <GastosPorCategoria categorias={data.gastosPorCategoria} totalGastos={data.totalGastos} />

      <div className="flex items-center gap-1.5">
        <Activity className="h-3 w-3 text-tinta-suave" />
        <span className="text-[10px] text-tinta-suave">Solo visualización · Actualiza en tiempo real</span>
      </div>
    </div>
  )
}
