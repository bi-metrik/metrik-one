/**
 * La categoría de una foto de HOTEL (Mauricio, 2026-10-16): la asesora elige por pestaña
 * —Fachada, Habitaciones, Zonas comunes— y la propuesta lleva, de preferencia, una de cada una.
 * Puro.
 *
 *   · `fachada`: el hotel por fuera (el edificio, la entrada).
 *   · `habitacion`: el cuarto, la cama, el baño de la habitación.
 *   · `zonas_comunes`: lobby, recepción, restaurante, bar, piscina, terraza, spa.
 *   · `otra`: la eligió una persona sin decir cuál (o la foto vieja, de antes de las categorías).
 *
 * La columna `fotos_catalogo.categoria` es nula en las filas que ya existían: se leen como «sin
 * categoría» y el reparto las trata como `otra`.
 */
import { MAX_FOTOS_POR_ELEMENTO } from './clave'

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

interface FotoConCategoria {
  id: string
  categoria: CategoriaFoto | null
  principal: boolean
  posicion: number
}

export type Puesto = { tipo: 'agregar' } | { tipo: 'reemplazar'; id: string } | { tipo: 'tope' }

/**
 * Dónde entra una foto nueva de `categoria` en un hotel que ya tiene `actuales` (hasta 3):
 *  · si ya hay una de ESA categoría, la reemplaza (una por categoría; conserva su puesto y si es
 *    la principal, que la eligió la asesora);
 *  · si cabe, se agrega;
 *  · si no cabe, reemplaza una que sobre: primero una sin categoría, luego una de una categoría
 *    repetida, nunca la principal si hay otra;
 *  · si las tres son de categorías distintas y ninguna es la suya: tope.
 * Sin categoría (o `otra`), solo se agrega si cabe.
 */
export function puestoParaCategoria(
  actuales: readonly FotoConCategoria[],
  categoria: CategoriaFoto | null,
  max = MAX_FOTOS_POR_ELEMENTO,
): Puesto {
  const real = categoria && categoria !== 'otra' ? categoria : null
  const porPuesto = [...actuales].sort((a, b) => b.posicion - a.posicion)
  const noPrincipalPrimero = (fs: FotoConCategoria[]) => [...fs.filter((f) => !f.principal), ...fs.filter((f) => f.principal)]
  if (real) {
    const misma = noPrincipalPrimero(porPuesto.filter((f) => f.categoria === real))[0]
    if (misma) return { tipo: 'reemplazar', id: misma.id }
  }
  if (actuales.length < max) return { tipo: 'agregar' }
  if (!real) return { tipo: 'tope' }
  const sinCategoria = noPrincipalPrimero(porPuesto.filter((f) => !f.categoria || f.categoria === 'otra'))
  const cuenta = new Map<string, number>()
  for (const f of actuales) if (f.categoria) cuenta.set(f.categoria, (cuenta.get(f.categoria) ?? 0) + 1)
  const repetidas = noPrincipalPrimero(porPuesto.filter((f) => f.categoria && (cuenta.get(f.categoria) ?? 0) > 1))
  const sale = sinCategoria[0] ?? repetidas[0]
  return sale ? { tipo: 'reemplazar', id: sale.id } : { tipo: 'tope' }
}

/** Qué tiene el hotel por categoría (para los puestos del selector). */
export function fotosPorCategoria<F extends { categoria: CategoriaFoto | null }>(fotos: readonly F[]): Record<CategoriaHotel, F | null> & { sin: F[] } {
  const salida = { fachada: null, habitacion: null, zonas_comunes: null, sin: [] } as Record<CategoriaHotel, F | null> & { sin: F[] }
  for (const f of fotos) {
    const c = f.categoria
    if (c && c !== 'otra' && !salida[c]) salida[c] = f
    else salida.sin.push(f)
  }
  return salida
}
