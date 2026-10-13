/**
 * «Deshacer» de la cotización por pasos (decisión G del diseño; nota técnica de Max §5.1;
 * criterios D1 y D2 de Vera).
 *
 * Todo cambio se escribe y se recalcula EN EL ACTO: el total nunca espera a que venza la cuenta.
 * «Deshacer» es una escritura de vuelta, y es CONDICIONADA: solo revierte si lo que la acción
 * escribió sigue ahí. Si alguien lo cambió en medio, no pisa el cambio nuevo («Ya cambió: no se
 * deshace»).
 *
 * Borrar una opción o un servicio arrastra en cascada sus rubros, sus adicionales y su elección
 * en cada tarifa. Por eso la acción devuelve la FOTO completa y «Deshacer» la reinserta con los
 * MISMOS ids: es la única forma de que vuelva qué opción iba en cada tarifa.
 *
 * Puro: tipos y verificaciones. Lo ejecutan `por-pasos-actions.ts` y `por-pasos-borrar-actions.ts`.
 */

import type { EstadoServicio } from './estado-servicio'

/** Lo que una acción escribió y cómo volver. Viaja al navegador y vuelve tal cual. */
export type OperacionDeshacer =
  | { tipo: 'eleccion'; cotizacionId: string; itinerarioId: string; grupo: string; escrita: string; anterior: string | null }
  | { tipo: 'mandar'; cotizacionId: string; itinerarioId: string; escrita: boolean; anterior: boolean }
  | { tipo: 'estado'; cotizacionId: string; grupo: string; escrito: EstadoServicio; anterior: Record<string, EstadoServicio> }
  | { tipo: 'margen'; cotizacionId: string; escrito: number; anterior: number | null }
  | { tipo: 'mover'; cotizacionId: string; itemId: string; grupoEscrito: string; grupoAnterior: string }
  | { tipo: 'juntar'; cotizacionId: string; movidas: string[]; grupoEscrito: string; grupoAnterior: string }

export const YA_CAMBIO = 'Ya cambió: no se deshace.'

/** La foto de una opción borrada, para reinsertarla con los mismos ids. */
export interface FotoDeOpcion {
  item: Record<string, unknown>
  rubros: Record<string, unknown>[]
  adicionales: Record<string, unknown>[]
  /** En qué tarifas iba (filas de `itinerario_opciones`). */
  selecciones: { itinerario_id: string; item_id: string }[]
}

/** La fila del ítem lista para insertar: sin lo que la base calcula ni lo que se embebió. */
export function itemParaReponer(item: Record<string, unknown>): Record<string, unknown> {
  const { rubros: _r, cotizaciones: _c, ...resto } = item
  void _r
  void _c
  return resto
}

/** El rubro listo para insertar: `valor_total` es GENERATED en la base. */
export function rubroParaReponer(rubro: Record<string, unknown>): Record<string, unknown> {
  const { valor_total: _v, ...resto } = rubro
  void _v
  return resto
}

/**
 * El orden en que se reinsertan las opciones de un servicio: primero las que no cuelgan de otra
 * (`opcion_de` nulo o fuera de la foto), para que la llave foránea encuentre a su titular.
 */
export function ordenParaReponer(fotos: readonly FotoDeOpcion[]): FotoDeOpcion[] {
  const ids = new Set(fotos.map(f => f.item.id as string))
  return [...fotos].sort((a, b) => {
    const pa = a.item.opcion_de && ids.has(a.item.opcion_de as string) ? 1 : 0
    const pb = b.item.opcion_de && ids.has(b.item.opcion_de as string) ? 1 : 0
    return pa - pb || Number(a.item.orden ?? 0) - Number(b.item.orden ?? 0)
  })
}

/** Las referencias de imagen de una opción (capturas y foto del hotel), para soltarlas después. */
export function imagenesDeFoto(foto: FotoDeOpcion): string[] {
  const tp = foto.item.tarifa_pax as Record<string, unknown> | null | undefined
  if (!tp || typeof tp !== 'object') return []
  const refs: string[] = []
  const casillas = (tp.casillas ?? {}) as Record<string, { imagenRef?: unknown } | undefined>
  for (const c of Object.values(casillas)) if (typeof c?.imagenRef === 'string') refs.push(c.imagenRef)
  for (const h of (Array.isArray(tp.habitaciones) ? tp.habitaciones : []) as { lectura?: { imagenRef?: unknown } }[]) {
    if (typeof h?.lectura?.imagenRef === 'string') refs.push(h.lectura.imagenRef)
  }
  const foto2 = tp.fotoHotel as { ref?: unknown } | undefined
  if (typeof foto2?.ref === 'string') refs.push(foto2.ref)
  return [...new Set(refs)]
}
