/**
 * La categoría de una foto de HOTEL (Mauricio, 2026-10-16): la galería la muestra por pestaña
 * —Fachada, Habitaciones, Zonas comunes, Todas—. La categoría ordena la galería; NO limita lo que
 * se marca: la propuesta lleva hasta 3 de cualquier categoría (dos habitaciones, si la asesora
 * quiere). Puro.
 *
 *   · `fachada`: el hotel por fuera (el edificio, la entrada).
 *   · `habitacion`: el cuarto, la cama, el baño de la habitación.
 *   · `zonas_comunes`: lobby, recepción, restaurante, bar, piscina, terraza, spa.
 *   · `otra`: la eligió una persona sin decir cuál (o la foto vieja, de antes de las categorías).
 *
 * La columna `fotos_catalogo.categoria` es nula en las filas que ya existían: se leen como «sin
 * categoría» y la galería las muestra aparte, en todas las pestañas.
 */
export type CategoriaFoto = 'fachada' | 'habitacion' | 'zonas_comunes' | 'otra'

/** Las pestañas del selector de un hotel, en el orden de Mauricio. */
export const CATEGORIAS_HOTEL = ['fachada', 'habitacion', 'zonas_comunes'] as const
export type CategoriaHotel = (typeof CATEGORIAS_HOTEL)[number]

export const CATEGORIAS: readonly CategoriaFoto[] = [...CATEGORIAS_HOTEL, 'otra']

export const NOMBRE_CATEGORIA: Record<CategoriaFoto, string> = {
  fachada: 'Fachada',
  habitacion: 'Habitaciones',
  zonas_comunes: 'Zonas comunes',
  otra: 'Otra',
}

/** En singular, para «Ya tiene una foto de …». */
export const NOMBRE_CATEGORIA_SINGULAR: Record<CategoriaFoto, string> = {
  fachada: 'fachada',
  habitacion: 'habitación',
  zonas_comunes: 'zonas comunes',
  otra: 'otra',
}

export function esCategoria(x: unknown): x is CategoriaFoto {
  return typeof x === 'string' && (CATEGORIAS as readonly string[]).includes(x)
}

/** Lo que dice el clasificador de una foto candidata: una categoría o «no es un hotel». */
export type Clasificacion = CategoriaHotel | 'no_es_hotel'
