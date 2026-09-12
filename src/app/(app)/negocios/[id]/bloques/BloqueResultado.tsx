'use client'

import { BarChart3, FileCheck, AlertTriangle } from 'lucide-react'
import { calcularResultado } from '@/lib/negocios/resultado-negocio'
import PresupuestoVsEjecutado, { type PresupuestoData } from './financiero/PresupuestoVsEjecutado'
import { fmt } from './financiero/formato'

interface BloqueResultadoProps {
  data: {
    totalCobrado: number
    costosEjecutados: number
    precioAprobado?: number
  }
  /** Lo que hace falta para las barras de presupuesto. Sale del mismo cálculo del servidor. */
  presupuesto: PresupuestoData
  /** ¿Hay gasto u horas registradas? Solo cambia el texto del vacío. */
  hayEjecucion: boolean
}

/**
 * El RESULTADO del negocio: cuánto deja, contra el presupuesto y contra el precio.
 *
 * Es la otra mitad del par que reemplazó a Cobros + Ejecución + Resumen financiero.
 * Aquí no se lista un solo movimiento: los movimientos viven en su bloque. La
 * separación es movimiento contra resultado, no ingreso contra egreso.
 */
export default function BloqueResultado({ data, presupuesto, hayEjecucion }: BloqueResultadoProps) {
  const r = calcularResultado({
    precioAprobado: data.precioAprobado,
    totalCobrado: data.totalCobrado,
    costosEjecutados: data.costosEjecutados,
  })
  const positiva = r.utilidad >= 0

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-2.5">
          <div className="mb-0.5 flex items-center gap-1">
            <FileCheck className="h-3 w-3 text-indigo-500" />
            <p className="text-[10px] font-medium text-indigo-600">
              {r.base === 'precio_aprobado' ? 'Cotizado' : 'Cobrado'}
            </p>
          </div>
          <p className="text-sm font-bold tabular-nums text-indigo-700">{fmt(r.valorBase)}</p>
        </div>
        <div className="rounded-lg border border-red-100 bg-red-50 p-2.5">
          <p className="text-[10px] font-medium text-red-600">Costo ejecutado</p>
          <p className="text-sm font-bold tabular-nums text-red-700">{fmt(r.costo)}</p>
        </div>
        <div
          className={`rounded-lg border p-2.5 ${positiva ? 'border-acento/30 bg-acento/10' : 'border-red-100 bg-red-50'}`}
        >
          <p className={`text-[10px] font-medium ${positiva ? 'text-acento' : 'text-red-600'}`}>Utilidad</p>
          <p className={`text-sm font-bold tabular-nums ${positiva ? 'text-acento' : 'text-red-700'}`}>
            {fmt(r.utilidad)}
          </p>
        </div>
      </div>

      {/* Lo cobrado es CAJA, no resultado. Va aparte y rotulado como tal: mezclarlo con
          la utilidad fue exactamente lo que hacía que un negocio con anticipo se leyera
          como un negocio en pérdida. */}
      <div className="flex items-center justify-between rounded-lg border border-[#E5E7EB] bg-papel px-2.5 py-1.5">
        <span className="text-[10px] font-medium text-tinta-suave">Caja</span>
        <span className="text-[10px] tabular-nums text-tinta-suave">
          Cobrado <span className="font-semibold text-green-700">{fmt(r.cobrado)}</span>
          {r.base === 'precio_aprobado' && (
            <> · Por cobrar <span className="font-semibold text-amber-700">{fmt(r.porCobrar)}</span></>
          )}
        </span>
      </div>

      {r.margenPct !== null && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] text-tinta-suave">
              Margen sobre {r.base === 'precio_aprobado' ? 'lo cotizado' : 'lo cobrado'}
            </span>
            <span className={`text-[10px] font-semibold ${positiva ? 'text-acento' : 'text-red-600'}`}>
              {r.margenPct}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E5E7EB]">
            <div
              className={`h-full rounded-full transition-all ${positiva ? 'bg-acento' : 'bg-red-500'}`}
              style={{ width: `${Math.min(Math.abs(r.margenPct), 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Sin cotización aprobada el margen cuelga de lo cobrado, que sube a medida que
          el cliente paga. Decirlo evita leer como resultado lo que es solo recaudo. */}
      {r.base === 'cobrado' && (
        <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-amber-600" />
          <p className="text-[10px] leading-snug text-amber-800">
            Este negocio no tiene cotización aprobada, así que el margen se mide contra lo
            cobrado y se mueve cada vez que entra un pago. Aprueba la cotización para medirlo
            contra el precio.
          </p>
        </div>
      )}

      <PresupuestoVsEjecutado data={presupuesto} costoTotal={r.costo} hayDatos={hayEjecucion} />

      <div className="flex items-center gap-1.5">
        <BarChart3 className="h-3 w-3 text-tinta-suave" />
        <span className="text-[10px] text-tinta-suave">Solo visualización · Actualiza en tiempo real</span>
      </div>
    </div>
  )
}
