'use client'

import { Activity, Clock, Receipt, TrendingUp, Target, AlertTriangle, HelpCircle } from 'lucide-react'
import { TIPOS_RUBRO } from '@/lib/catalogos/constants'
import {
  TIPO_RUBRO_SIN_DETALLE,
  CONCEPTO_HORAS_STAFF,
  type LineaBase,
} from '@/lib/negocios/presupuesto-ejecucion'

const CATEGORIA_LABELS: Record<string, string> = {
  materiales: 'Materiales',
  transporte: 'Transporte',
  servicios_profesionales: 'Servicios profesionales',
  viaticos: 'Viáticos',
  software: 'Software',
  impuestos_seguros: 'Impuestos/Seguros',
  mano_de_obra: 'Mano de obra',
  alimentacion: 'Alimentación',
  comision: 'Comisiones',
  arriendo: 'Arriendo',
  marketing: 'Marketing',
  capacitacion: 'Capacitación',
  otros: 'Otros',
}

// Etiqueta de cada rubro. Sale del catálogo (`TIPOS_RUBRO`), no de una copia a mano:
// una lista paralela se desincroniza y el síntoma es un rubro rotulado con su slug.
const RUBRO_LABELS: Record<string, string> = {
  ...Object.fromEntries(TIPOS_RUBRO.map(t => [t.value, t.label])),
  [TIPO_RUBRO_SIN_DETALLE]: 'Sin desglosar',
}

interface EjecucionData {
  totalGastos: number
  totalHoras: number
  costoHoras: number
  gastosPorCategoria: Array<{ categoria: string; total: number }>
  /** Rubros de la cotización aceptada, cada uno con lo ya ejecutado que le cuenta. */
  presupuestoPorRubro?: Array<{ tipo: string; nombre: string; total: number; ejecutado: number }>
  /** Presupuesto de COSTO (suma de los rubros). Distinto del precio de venta. */
  presupuestoCosto?: number
  /** Precio aprobado al cliente. Mide MARGEN, no sobrecosto. */
  precioAprobado?: number
  /** Lo ejecutado que no cuenta contra ningún rubro. Suma al costo, no a las barras. */
  sinPresupuesto?: { total: number; conceptos: Array<{ concepto: string; total: number }> }
  /** Horas que entraron valiendo cero: el ejecutado está subestimado. */
  horasSinTarifa?: { filas: number; horas: number; sinStaff: number; sinSalario: number }
  /** Qué cotización fija el presupuesto, o por qué no hay contra qué comparar. */
  lineaBase: LineaBase
}

interface BloqueEjecucionProps {
  negocioId: string
  data: EjecucionData
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

const plural = (n: number, singular: string, plural: string) =>
  n === 1 ? `1 ${singular}` : `${n} ${plural}`

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

/**
 * Por qué este negocio no tiene presupuesto contra el cual compararse.
 *
 * El vacío se explica en vez de dejar la sección ausente: antes, un negocio con gasto
 * y sin cotización aprobada simplemente no mostraba nada, y eso se lee igual que "no
 * hay nada que comparar" o que "la pantalla está rota".
 *
 * NUNCA se usa una cotización en borrador o enviada como si fuera presupuesto: se
 * nombra para poder ir a buscarla, y su valor no se muestra — un número al lado de un
 * presupuesto ausente se lee como presupuesto.
 */
function motivoSinLineaBase(lineaBase: LineaBase): { titulo: string; detalle: string } {
  // Cotización aprobada que no deja presupuesto: sus ítems no tienen rubros y su precio
  // es cero. Pasa con las cotizaciones cargadas sin desglose de costo, y sin este caso
  // la sección volvería a quedar en blanco sin explicación.
  if (lineaBase.estado === 'aprobada') {
    return {
      titulo: 'La cotización aprobada no tiene presupuesto de costo',
      detalle: `${
        lineaBase.cotizacion.consecutivo ? `La cotización ${lineaBase.cotizacion.consecutivo}` : 'La cotización aprobada'
      } está aprobada pero sus ítems no tienen rubros de costo, así que no hay contra qué comparar lo ejecutado.`,
    }
  }

  if (lineaBase.estado === 'sin_cotizacion') {
    return {
      titulo: 'Sin línea base para comparar',
      detalle:
        'Este negocio no tiene cotización, así que no hay presupuesto de costo contra el cual medir lo ejecutado. Los gastos y las horas de arriba sí están completos.',
    }
  }

  const { borradores, enviadas, rechazadas, pendiente } = lineaBase
  const nombre = pendiente ? `La cotización ${pendiente}` : 'La cotización'

  if (enviadas > 0) {
    return {
      titulo: 'Sin línea base para comparar',
      detalle: `${nombre} está enviada y todavía sin aprobar. El presupuesto aparece cuando se apruebe.`,
    }
  }

  if (borradores > 0) {
    return {
      titulo: 'Sin línea base para comparar',
      detalle: `${nombre} está en borrador. El presupuesto aparece cuando se apruebe. Si la aprobación se soltó para corregirla, queda registrado en el historial de actividad de este negocio.`,
    }
  }

  return {
    titulo: 'Sin línea base para comparar',
    detalle: `${
      rechazadas === 1 ? 'La única cotización de este negocio fue rechazada' : `Las ${rechazadas} cotizaciones de este negocio fueron rechazadas`
    }. Mientras no se apruebe una, no hay presupuesto contra el cual medir lo ejecutado.`,
  }
}

/** Cuántas horas entraron sin costo y qué hay que arreglar para que valgan. */
function avisoHorasSinTarifa(sinTarifa: NonNullable<EjecucionData['horasSinTarifa']>): string {
  const horas = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(sinTarifa.horas)
  const causas: string[] = []
  if (sinTarifa.sinStaff > 0) causas.push(`${plural(sinTarifa.sinStaff, 'registro', 'registros')} sin responsable`)
  if (sinTarifa.sinSalario > 0) {
    causas.push(`${plural(sinTarifa.sinSalario, 'registro', 'registros')} con el salario del responsable sin configurar`)
  }
  return `${horas} h entraron al costo valiendo $0 (${causas.join(' y ')}). El costo ejecutado está por debajo del real.`
}

export default function BloqueEjecucion({ data }: BloqueEjecucionProps) {
  const costoTotal = data.totalGastos + data.costoHoras
  const hayDatos = data.totalGastos > 0 || data.totalHoras > 0
  const hayRubros = !!data.presupuestoPorRubro && data.presupuestoPorRubro.length > 0
  const presupuestoCosto = data.presupuestoCosto ?? 0
  const precioAprobado = data.precioAprobado ?? 0
  // La sección aparece con cualquiera de las dos líneas base. Un caso sin desglose de
  // costo pero con precio aprobado sigue teniendo algo que decir: cuánto margen queda.
  const hayPresupuesto = hayRubros || presupuestoCosto > 0 || precioAprobado > 0
  const pctCosto = presupuestoCosto > 0 ? Math.round((costoTotal / presupuestoCosto) * 100) : 0
  const pctMargen = precioAprobado > 0 ? Math.round((costoTotal / precioAprobado) * 100) : 0
  const sinPresupuesto = data.sinPresupuesto
  const motivo = motivoSinLineaBase(data.lineaBase)
  const variasAprobadas =
    data.lineaBase.estado === 'aprobada' && data.lineaBase.otrasAprobadas > 0
      ? data.lineaBase
      : null

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

      {/* Presupuesto vs Ejecutado — solo si hay cotización aprobada */}
      {hayPresupuesto && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Target className="h-3 w-3 text-[#6B7280]" />
            <p className="text-[10px] font-medium text-[#6B7280]">Presupuesto vs Ejecutado</p>
          </div>

          {/* Dos cotizaciones aprobadas a la vez: manda la más reciente, y se dice cuál.
              Callarlo dejaría el presupuesto colgando de un dato que nadie sabe que
              está duplicado. */}
          {variasAprobadas && (
            <p className="mb-1.5 text-[10px] leading-snug text-amber-700">
              Este negocio tiene {variasAprobadas.otrasAprobadas + 1} cotizaciones aprobadas a la
              vez. El presupuesto usa la más reciente
              {variasAprobadas.cotizacion.consecutivo ? ` (${variasAprobadas.cotizacion.consecutivo})` : ''}.
            </p>
          )}

          <div className="space-y-1.5">
            {(data.presupuestoPorRubro ?? []).map(rubro => {
              // El ejecutado lo reparte el servidor: cada gasto cuenta contra un rubro o
              // contra ninguno, y las horas de staff caen en mano de obra propia.
              const pct = rubro.total > 0 ? Math.round((rubro.ejecutado / rubro.total) * 100) : 0
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
                      {fmt(rubro.ejecutado)} / {fmt(rubro.total)}
                    </span>
                  </div>
                </div>
              )
            })}

            {/* Gasto ejecutado que NO estaba presupuestado. Deliberadamente SIN barra y
                sin "X / Y": una barra necesita un denominador, y aquí no hay ninguno —
                pintarla haría leer esta plata como si estuviera presupuestada, que es
                justo lo contrario de lo que dice. Suma al costo total de abajo, así que
                la sección reconcilia: rubros + esto = total ejecutado. */}
            {sinPresupuesto && sinPresupuesto.total > 0 && (
              <div className="rounded-md border border-dashed border-amber-300 bg-amber-50/50 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-amber-800">Sin presupuesto</p>
                    <p className="mt-0.5 text-[10px] leading-snug text-amber-700">
                      Gasto ejecutado que no corresponde a ningún rubro de la cotización
                      aprobada. Cuenta en el costo total, no en las barras de arriba.
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] font-bold text-amber-800 tabular-nums">
                    {fmt(sinPresupuesto.total)}
                  </span>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {sinPresupuesto.conceptos.map(c => (
                    <li key={c.concepto} className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-amber-700 truncate">
                        {c.concepto === CONCEPTO_HORAS_STAFF
                          ? 'Horas del equipo'
                          : CATEGORIA_LABELS[c.concepto] ?? c.concepto}
                      </span>
                      <span className="text-[10px] text-amber-700 tabular-nums whitespace-nowrap">
                        {fmt(c.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Sobrecosto: lo ejecutado contra el presupuesto de COSTO. Es la barra que
                responde "¿me pasé de lo que dije que iba a gastar?". */}
            {presupuestoCosto > 0 && (
              <div className="pt-1.5 mt-1.5 border-t border-[#E5E7EB]">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] font-medium text-[#1A1A1A]">
                    Total ejecutado <span className="font-normal text-[#6B7280]">vs presupuesto</span>
                  </span>
                  <span className={`text-[10px] font-semibold tabular-nums ${barTextColor(pctCosto)}`}>
                    {pctCosto}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-[#E5E7EB] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${barColor(pctCosto)}`}
                      style={{ width: `${Math.min(pctCosto, 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-medium text-[#6B7280] tabular-nums whitespace-nowrap">
                    {fmt(costoTotal)} / {fmt(presupuestoCosto)}
                  </span>
                </div>
                {pctCosto > 100 && (
                  <p className="mt-0.5 text-[10px] font-medium text-red-600">
                    Sobrecosto de {fmt(costoTotal - presupuestoCosto)} frente a lo presupuestado
                  </p>
                )}
              </div>
            )}

            {/* Margen: el mismo costo contra el PRECIO. Mide cuánto de la utilidad queda,
                no si hubo sobrecosto — un caso puede gastar el doble de su presupuesto y
                seguir por debajo del precio, y esa diferencia es la que hay que ver. */}
            {precioAprobado > 0 && (
              <div className="pt-1.5 mt-1.5 border-t border-[#E5E7EB]">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] font-medium text-[#1A1A1A]">
                    Margen consumido{' '}
                    <span className="font-normal text-[#6B7280]">vs precio aprobado</span>
                  </span>
                  <span className={`text-[10px] font-semibold tabular-nums ${barTextColor(pctMargen)}`}>
                    {pctMargen}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-[#E5E7EB] overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${barColor(pctMargen)}`}
                      style={{ width: `${Math.min(pctMargen, 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-[#6B7280] tabular-nums whitespace-nowrap">
                    {fmt(costoTotal)} / {fmt(precioAprobado)}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] text-[#6B7280]">
                  {pctMargen > 100
                    ? `El costo supera el precio en ${fmt(costoTotal - precioAprobado)}`
                    : `Quedan ${fmt(precioAprobado - costoTotal)} de margen`}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sin línea base: el vacío se explica. Antes esta sección simplemente no
          aparecía, y un negocio con gasto acumulado quedaba sin decir por qué no tenía
          contra qué compararse. */}
      {!hayPresupuesto && (
        <div className="rounded-lg border border-[#E5E7EB] bg-[#F5F4F2] p-2.5">
          <div className="flex items-start gap-1.5">
            <HelpCircle className="mt-px h-3 w-3 shrink-0 text-[#6B7280]" />
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-[#1A1A1A]">{motivo.titulo}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-[#6B7280]">{motivo.detalle}</p>
              {hayDatos && (
                <p className="mt-1 text-[10px] text-[#6B7280]">
                  Ejecutado hasta ahora:{' '}
                  <span className="font-semibold text-[#1A1A1A] tabular-nums">{fmt(costoTotal)}</span>
                </p>
              )}
            </div>
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
