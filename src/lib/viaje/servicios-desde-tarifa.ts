/**
 * De la tarifa aceptada a las filas de servicio del viaje (F0, plan post-cotización).
 *
 * Cada ítem que la tarifa aceptada cobra se vuelve UNA fila de `negocio_servicios`: es lo que
 * la empresa le compra a un proveedor para cumplir la venta. Módulo puro: quien llama lee la
 * cotización (`contextoDeCotizacion`) y escribe; aquí solo se decide qué filas salen.
 *
 * Qué entra (criterio F0-1 de Vera):
 *  · los ítems del itinerario de la tarifa aceptada (`itemsDelItinerario`), o los que aportan
 *    al total si la cotización no tiene tarifas: los mismos que suma el precio;
 *  · NO entran los de fuera del precio (sugerencias que el cliente no compró) ni el ítem de
 *    ajuste (cuadre de precio, no un servicio);
 *  · un ítem sin ranura ni grupo NO se descarta: sale con tipo «otro».
 *
 * El costo de cada fila es el costo directo de su línea con la MISMA aritmética de la cascada
 * (`calcularCascada` sobre esa sola línea), y la diferencia de redondeo contra el costo
 * directo de la tarifa se le suma a la fila más cara. Así Σ costo_cotizado = costo directo de
 * la tarifa al peso (F0-2), que es el número contra el que se mide el margen.
 */

import { calcularCascada, type ParametrosCascada } from '@/lib/cotizaciones/totales'
import { itemsDelItinerario, itemsQueAportanAlTotal, normalizarGrupo } from '@/lib/cotizaciones/itinerarios'
import { etiquetaDeRanura, ranuraDeGrupo } from '@/lib/cotizaciones/ranuras-pantallazo'
import { esTipoRanura, tipoDeDefinicion } from '@/lib/cotizaciones/ranuras-cotizacion'
import { lecturaDeOpcion } from '@/lib/cotizaciones/habitaciones'
import { leerTarifaPax } from '@/lib/cotizaciones/tarifa-pasajero'
import type { ItemDeCotizacion } from '@/lib/cotizaciones/itinerarios-datos'

export const TIPOS_SERVICIO = ['vuelo', 'hotel', 'traslado', 'actividad', 'asistencia', 'otro'] as const
export type TipoServicio = (typeof TIPOS_SERVICIO)[number]

/** Lo que se inserta en `negocio_servicios` (sin las llaves del negocio). */
export interface FilaServicioNueva {
  item_id: string
  tipo: TipoServicio
  nombre: string
  proveedor_nombre: string | null
  fecha_servicio: string | null
  costo_cotizado: number
  orden: number
}

/** Lo mínimo del ítem que hace falta aquí (lo trae `contextoDeCotizacion`). */
export type ItemParaServicio = Pick<
  ItemDeCotizacion,
  | 'id' | 'nombre' | 'grupo' | 'opcion_de' | 'es_ajuste' | 'orden' | 'dia_relativo' | 'entra_al_precio'
  | 'cantidad' | 'subtotal' | 'numeroDeRubros' | 'costoDeRubros' | 'descuento_porcentaje'
  | 'margen_porcentaje' | 'precio_venta' | 'precio_manual' | 'adicionales' | 'pasajeros' | 'tarifa_pax'
>

const MAX_NOMBRE = 200

/**
 * El tipo del servicio. Manda la ranura del ítem (`items.ranura_id` → `cotizacion_ranuras.tipo`);
 * si no la tiene, el tipo de su grupo; si tampoco, «asistencia» cuando el texto lo dice y si no
 * «otro». Nunca se descarta un ítem por no saber qué es.
 */
export function tipoDeServicio(item: Pick<ItemParaServicio, 'grupo' | 'nombre'>, tipoRanura?: string | null): TipoServicio {
  if (esTipoRanura(tipoRanura)) return tipoRanura
  const porGrupo = tipoDeDefinicion(ranuraDeGrupo(item.grupo))
  if (porGrupo) return porGrupo
  const texto = `${normalizarGrupo(item.grupo) ?? ''} ${item.nombre ?? ''}`.toLowerCase()
  if (/\b(asistencia|seguro)\b/.test(texto)) return 'asistencia'
  return 'otro'
}

function texto(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

/** `AAAA-MM-DD` si el texto empieza por una fecha ISO válida; si no, `null` (no se adivina). */
export function fechaIso(v: unknown): string | null {
  const t = texto(v)
  const m = t ? /^(\d{4})-(\d{2})-(\d{2})/.exec(t) : null
  if (!m) return null
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}`) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

/**
 * Proveedor y fecha leídos del pantallazo de la línea, si los hay. Lo leído PROPONE: la fila
 * dice «Falta el proveedor» cuando no se leyó, y quien reserva lo escribe.
 */
export function lecturaDelServicio(item: Pick<ItemParaServicio, 'tarifa_pax'>, tipo: TipoServicio): {
  proveedor: string | null
  fecha: string | null
} {
  if (item.tarifa_pax === null || item.tarifa_pax === undefined) return { proveedor: null, fecha: null }
  let lectura: ReturnType<typeof lecturaDeOpcion> = null
  try {
    lectura = lecturaDeOpcion(leerTarifaPax(item.tarifa_pax))
  } catch {
    return { proveedor: null, fecha: null }
  }
  if (!lectura) return { proveedor: null, fecha: null }
  const id = lectura.identidad ?? {}
  const campo = (etiqueta: string) =>
    texto(lectura?.campos?.find(c => c.label.trim().toLowerCase() === etiqueta)?.valor)
  const proveedor =
    tipo === 'hotel' ? texto(id.hotel)
      : tipo === 'vuelo' ? texto(id.aerolinea) ?? campo('aerolínea')
        : campo('proveedor')
  const fecha =
    tipo === 'hotel' ? fechaIso(id.check_in)
      : tipo === 'vuelo' ? fechaIso(id.fecha_salida)
        : tipo === 'actividad' ? fechaIso(id.fecha)
          : tipo === 'traslado' ? fechaIso(id.fecha_hora)
            : null
  return { proveedor: proveedor ? proveedor.slice(0, MAX_NOMBRE) : null, fecha }
}

function nombreDelServicio(item: Pick<ItemParaServicio, 'nombre' | 'grupo'>): string {
  const propio = texto(item.nombre)
  const nombre = propio ?? (normalizarGrupo(item.grupo) ? etiquetaDeRanura(item.grupo) : 'Servicio')
  return nombre.slice(0, MAX_NOMBRE)
}

/**
 * Las filas de servicio de una tarifa.
 *
 * @param seleccion la selección de la tarifa aceptada (`cotizacion_itinerarios.seleccion`);
 *   `null` si la cotización no tiene tarifas (entonces cuenta lo que aporta al total).
 * @param tipoRanuraPorItem el tipo de la ranura de cada ítem, por id (de `items.ranura_id`).
 */
export function filasDeServicioDeTarifa(args: {
  items: ItemParaServicio[]
  seleccion: string[] | null
  params: ParametrosCascada
  tipoRanuraPorItem?: Record<string, string | null | undefined>
}): FilaServicioNueva[] {
  const { items, seleccion, params } = args
  const ids = seleccion ? itemsDelItinerario(items, seleccion) : itemsQueAportanAlTotal(items)
  const porId = new Map(items.map(i => [i.id, i]))
  const incluidos = ids
    .map(id => porId.get(id))
    .filter((i): i is ItemParaServicio => !!i && i.es_ajuste !== true)

  const filas: FilaServicioNueva[] = incluidos.map((item, orden) => {
    const tipo = tipoDeServicio(item, args.tipoRanuraPorItem?.[item.id])
    const { proveedor, fecha } = lecturaDelServicio(item, tipo)
    return {
      item_id: item.id,
      tipo,
      nombre: nombreDelServicio(item),
      proveedor_nombre: proveedor,
      fecha_servicio: fecha,
      costo_cotizado: Math.max(0, calcularCascada([item], params).costoDirecto),
      orden,
    }
  })

  // Cuadre al peso contra el costo directo de la tarifa: el redondeo de cada línea no puede
  // dejar la suma de las filas distinta del número con que se midió el margen.
  const total = Math.max(0, calcularCascada(incluidos, params).costoDirecto)
  const suma = filas.reduce((s, f) => s + f.costo_cotizado, 0)
  const residuo = total - suma
  if (residuo !== 0 && filas.length > 0) {
    const mayor = filas.reduce((a, f) => (f.costo_cotizado > a.costo_cotizado ? f : a), filas[0])
    mayor.costo_cotizado = Math.max(0, mayor.costo_cotizado + residuo)
  }
  return filas
}
