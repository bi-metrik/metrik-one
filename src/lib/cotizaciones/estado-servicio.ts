/**
 * «Incluido · Opcional · No va» de un SERVICIO en la cotización por pasos (decisión 4 del diseño;
 * pieza C3 para el traslado Opcional).
 *
 * El estado es del servicio entero: todas sus opciones van, se ofrecen aparte o no van juntas. Se
 * escribe con los MISMOS dos interruptores de la línea que ya leen el total y el PDF
 * (`entra_al_precio`, `mostrar_en_sugeridos`), así que no hay lectura nueva:
 *
 * | estado     | entra_al_precio | mostrar_en_sugeridos | qué pasa                                   |
 * |------------|-----------------|----------------------|--------------------------------------------|
 * | incluido   | true            | true                 | suma                                       |
 * | opcional   | false           | true                 | no suma; sale en «Opcionales» con su precio |
 * | no         | false           | false                | no suma ni sale; se recuerda cómo era       |
 *
 * | Tipo                       | Valores                      |
 * |----------------------------|------------------------------|
 * | vuelo, hotel               | Incluido · No va             |
 * | traslado, actividad, otro  | Incluido · Opcional · No va  |
 *
 * Puro: lo usan la acción del servidor y la pantalla.
 */

import { ranuraDeGrupo } from './ranuras-pantallazo'

export type EstadoServicio = 'incluido' | 'opcional' | 'no'

export const ETIQUETA_ESTADO: Record<EstadoServicio, string> = {
  incluido: 'Incluido',
  opcional: 'Opcional',
  no: 'No va',
}

/** Qué estados admite un grupo. Vuelo y hotel no tienen «Opcional». Sin tipo reconocido, ninguno. */
export function estadosPermitidos(grupo: string | null | undefined): EstadoServicio[] {
  const slug = ranuraDeGrupo(grupo ?? null)?.slug
  // El tren (QA G9) va o no va, como el vuelo del que puede ser alternativa.
  if (slug === 'vuelo_detalle' || slug === 'hotel_detalle' || slug === 'tren_detalle') return ['incluido', 'no']
  // «Otro servicio» (asistencia médica, seguro) también puede ir Opcional: el cliente decide.
  if (slug === 'traslado_detalle' || slug === 'actividad_detalle' || slug === 'otro_detalle') return ['incluido', 'opcional', 'no']
  return []
}

type Linea = { grupo?: string | null; entra_al_precio?: boolean | null; mostrar_en_sugeridos?: boolean | null }

/**
 * El estado de UNA línea, leído de sus dos interruptores. Un vuelo o un hotel fuera del precio
 * es «No va» aunque una marca vieja diga que se muestra: nunca son opcionales (`fueraDelPrecio`).
 */
export function estadoDeLinea(item: Linea): EstadoServicio {
  if (item.entra_al_precio !== false) return 'incluido'
  if (!estadosPermitidos(item.grupo).includes('opcional') && item.grupo) return 'no'
  return item.mostrar_en_sugeridos === false ? 'no' : 'opcional'
}

/**
 * El estado del servicio: el de sus líneas. Si quedaron distintas (una cotización hecha con la
 * pantalla de siempre, donde el check era por línea), manda la primera por orden.
 */
export function estadoDelServicio(lineas: readonly (Linea & { orden?: number | null })[]): EstadoServicio {
  const primera = [...lineas].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))[0]
  return primera ? estadoDeLinea(primera) : 'incluido'
}

export interface CambiosDeEstado {
  entra_al_precio: boolean
  mostrar_en_sugeridos: boolean
  /** La marca de cómo era antes de «No va» (`tarifa_pax.noVa.era`); `null` la retira. */
  noVa: { era: 'incluida' | 'opcional' } | null
}

/** Qué escribir en una línea para dejarla en `estado`. `null` = ya está así. */
export function cambiosDeEstado(actual: Linea, estado: EstadoServicio): CambiosDeEstado | null {
  const hoy = estadoDeLinea(actual)
  if (hoy === estado) return null
  if (estado === 'incluido') return { entra_al_precio: true, mostrar_en_sugeridos: true, noVa: null }
  if (estado === 'opcional') return { entra_al_precio: false, mostrar_en_sugeridos: true, noVa: null }
  return { entra_al_precio: false, mostrar_en_sugeridos: false, noVa: { era: hoy === 'opcional' ? 'opcional' : 'incluida' } }
}
