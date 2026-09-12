'use client'

import { Target, HelpCircle } from 'lucide-react'
import { CONCEPTO_HORAS_STAFF, type LineaBase } from '@/lib/negocios/presupuesto-ejecucion'
import { CATEGORIA_LABELS, RUBRO_LABELS, fmt, barColor, barTextColor } from './formato'

export interface PresupuestoData {
  /** Rubros de la cotización aceptada, cada uno con lo ya ejecutado que le cuenta. */
  presupuestoPorRubro?: Array<{ tipo: string; nombre: string; total: number; ejecutado: number }>
  /** Presupuesto de COSTO (suma de los rubros). Distinto del precio de venta. */
  presupuestoCosto?: number
  /** Precio aprobado al cliente. Mide MARGEN, no sobrecosto. */
  precioAprobado?: number
  /** Lo ejecutado que no cuenta contra ningún rubro. Suma al costo, no a las barras. */
  sinPresupuesto?: { total: number; conceptos: Array<{ concepto: string; total: number }> }
  /** Qué cotización fija el presupuesto, o por qué no hay contra qué comparar. */
  lineaBase: LineaBase
}

interface Props {
  data: PresupuestoData
  /** Gastos + costo de horas. Es el numerador de todas las barras. */
  costoTotal: number
  /** ¿Hay algo ejecutado? Cambia solo el texto del vacío. */
  hayDatos: boolean
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
export function motivoSinLineaBase(lineaBase: LineaBase): { titulo: string; detalle: string } {
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

/** ¿Hay algo contra lo cual comparar lo ejecutado? */
export function hayPresupuestoQueMostrar(data: PresupuestoData): boolean {
  const hayRubros = !!data.presupuestoPorRubro && data.presupuestoPorRubro.length > 0
  // La sección aparece con cualquiera de las dos líneas base. Un caso sin desglose de
  // costo pero con precio aprobado sigue teniendo algo que decir: cuánto margen queda.
  return hayRubros || (data.presupuestoCosto ?? 0) > 0 || (data.precioAprobado ?? 0) > 0
}

/**
 * Ejecutado contra presupuestado: las barras por rubro, el sobrecosto y el margen.
 *
 * Es la mitad de RESULTADO del antiguo bloque de Ejecución. Se extrajo para que el
 * bloque de Resultado la muestre sin duplicar la aritmética: dos copias de la misma
 * barra se desincronizan y el síntoma son dos pantallas discrepando por el mismo peso.
 */
export default function PresupuestoVsEjecutado({ data, costoTotal, hayDatos }: Props) {
  const presupuestoCosto = data.presupuestoCosto ?? 0
  const precioAprobado = data.precioAprobado ?? 0
  const pctCosto = presupuestoCosto > 0 ? Math.round((costoTotal / presupuestoCosto) * 100) : 0
  const pctMargen = precioAprobado > 0 ? Math.round((costoTotal / precioAprobado) * 100) : 0
  const sinPresupuesto = data.sinPresupuesto
  const variasAprobadas =
    data.lineaBase.estado === 'aprobada' && data.lineaBase.otrasAprobadas > 0
      ? data.lineaBase
      : null

  // Sin línea base: el vacío se explica. Antes esta sección simplemente no aparecía, y
  // un negocio con gasto acumulado quedaba sin decir por qué no tenía contra qué
  // compararse.
  if (!hayPresupuestoQueMostrar(data)) {
    const motivo = motivoSinLineaBase(data.lineaBase)
    return (
      <div className="rounded-lg border border-[#E5E7EB] bg-papel p-2.5">
        <div className="flex items-start gap-1.5">
          <HelpCircle className="mt-px h-3 w-3 shrink-0 text-tinta-suave" />
          <div className="min-w-0">
            <p className="text-[10px] font-medium text-tinta">{motivo.titulo}</p>
            <p className="mt-0.5 text-[10px] leading-snug text-tinta-suave">{motivo.detalle}</p>
            {hayDatos && (
              <p className="mt-1 text-[10px] text-tinta-suave">
                Ejecutado hasta ahora:{' '}
                <span className="font-semibold text-tinta tabular-nums">{fmt(costoTotal)}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Target className="h-3 w-3 text-tinta-suave" />
        <p className="text-[10px] font-medium text-tinta-suave">Presupuesto vs Ejecutado</p>
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
                <span className="text-[10px] text-tinta-suave truncate">{label}</span>
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
                <span className="text-[10px] text-tinta-suave tabular-nums whitespace-nowrap">
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
              <span className="text-[10px] font-medium text-tinta">
                Total ejecutado <span className="font-normal text-tinta-suave">vs presupuesto</span>
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
              <span className="text-[10px] font-medium text-tinta-suave tabular-nums whitespace-nowrap">
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
              <span className="text-[10px] font-medium text-tinta">
                Margen consumido{' '}
                <span className="font-normal text-tinta-suave">vs precio aprobado</span>
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
              <span className="text-[10px] text-tinta-suave tabular-nums whitespace-nowrap">
                {fmt(costoTotal)} / {fmt(precioAprobado)}
              </span>
            </div>
            <p className="mt-0.5 text-[10px] text-tinta-suave">
              {pctMargen > 100
                ? `El costo supera el precio en ${fmt(costoTotal - precioAprobado)}`
                : `Quedan ${fmt(precioAprobado - costoTotal)} de margen`}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
