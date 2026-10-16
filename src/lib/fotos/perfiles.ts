/**
 * Reconocer el mismo hotel o tour entre cotizaciones (Mauricio, 2026-10-16). PURO, sin IA.
 *
 * «Catalonia Puerta del Sol» y «Hotel Catalonia Puerta del Sol Madrid» dan llaves distintas
 * (`claveDeFoto`), pero son el mismo hotel. Aquí se decide, contra los nombres que el espacio ya
 * conoce (perfiles, sus alias y las fotos de antes), qué es un nombre nuevo:
 *
 *   · `exacto`: la llave ya es de un perfil (propia o de un alias). Sin preguntar.
 *   · `seguro`: misma ciudad y las MISMAS palabras de nombre una vez quitadas las genéricas
 *     («hotel», artículos), la ciudad, tildes, mayúsculas, signos y el orden. Se guarda el alias
 *     solo, sin preguntar.
 *   · `duda`: misma ciudad y nombres parecidos sin ser iguales («Iberostar Selection Bávaro» y
 *     «Iberostar Selection Bávaro Suites», que en la vida real son dos hoteles). La tarjeta pregunta
 *     «¿Es el mismo hotel que …?» y la respuesta se guarda (alias o perfil propio).
 *   · `nuevo`: nada parecido. Perfil propio.
 *
 * Por qué sin modelo: los nombres llegan de pantallazos de mayoristas y la regla de palabras lo
 * cubre; la duda la resuelve la persona, que es quien sabe. Un modelo gastaría cuota por cada
 * tarjeta y su error se pegaría en silencio a la biblioteca.
 */
import { claveDeCiudad } from '@/lib/pdf/cotizacion-trappvel-formato'
import { nombreLlano, type ObjetivoFoto, type TipoPerfil } from './clave'

/** Un nombre que el espacio ya conoce: su llave (la de sus fotos) y el perfil al que pertenece. */
export interface NombreConocido {
  tipo: TipoPerfil
  /** La llave de este nombre (la del perfil o la de un alias). */
  clave: string
  /** La llave del perfil, donde viven las fotos. */
  clavePerfil: string
  nombre: string
  ciudad: string | null
}

export type Reconocimiento =
  | { tipo: 'exacto' | 'seguro'; clavePerfil: string }
  | { tipo: 'duda'; clavePerfil: string; nombre: string; ciudad: string | null }
  | { tipo: 'nuevo' }

/** Palabras que no distinguen un hotel de otro. */
const GENERICAS_HOTEL = new Set(['hotel', 'hoteles', 'hotels', 'the', 'el', 'la', 'los', 'las', 'de', 'del', 'y', 'and', 'by', 'en'])
/** En un tour, «tour» o «excursión» SÍ cuentan («Tour Toledo» no es lo mismo que «Toledo y Segovia»). */
const GENERICAS_ACTIVIDAD = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'y', 'and', 'en', 'a', 'al', 'the', 'con', 'por'])

/** Desde cuánto parecido (0 a 1, Dice sobre palabras) se pregunta. */
const UMBRAL_DUDA = 0.6

function ciudadComparable(ciudad: string | null | undefined): string {
  return claveDeCiudad(ciudad ?? '').toLowerCase()
}

/**
 * Las palabras que distinguen el nombre: sin genéricas y sin las de la ciudad. Si al quitarlas no
 * queda nada («Hotel Madrid» en Madrid), se dejan las de la ciudad: ese ES el nombre.
 */
export function palabrasDelNombre(tipo: TipoPerfil, nombre: string, ciudad: string | null): string[] {
  const genericas = tipo === 'hotel' ? GENERICAS_HOTEL : GENERICAS_ACTIVIDAD
  const todas = nombreLlano(nombre).split(' ').filter((p) => p && !genericas.has(p))
  const deCiudad = new Set([...nombreLlano(ciudad).split(' '), ...nombreLlano(ciudadComparable(ciudad)).split(' ')].filter((p) => p.length > 1))
  const sinCiudad = todas.filter((p) => !deCiudad.has(p))
  return [...new Set(sinCiudad.length > 0 ? sinCiudad : todas)].sort()
}

/** ¿Dos palabras son la misma con un error de tipeo? (largas, a una letra de distancia). */
function casiIgual(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false
  // Distancia de edición ≤ 1.
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

/** Parecido de dos nombres: Dice sobre palabras (una palabra casi igual cuenta como igual). */
export function parecido(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const usadas = new Set<number>()
  let comunes = 0
  for (const x of a) {
    const j = b.findIndex((y, k) => !usadas.has(k) && casiIgual(x, y))
    if (j >= 0) {
      usadas.add(j)
      comunes += 1
    }
  }
  return (2 * comunes) / (a.length + b.length)
}

/** ¿Pueden ser el mismo lugar por la ciudad? La misma, o alguno sin ciudad. */
function ciudadCompatible(a: string | null, b: string | null): boolean {
  const x = ciudadComparable(a)
  const y = ciudadComparable(b)
  return !x || !y || x === y
}

/** Qué es este hotel o tour para el espacio (ver arriba). */
export function reconocer(o: Pick<ObjetivoFoto, 'clave' | 'nombre' | 'ciudad'> & { tipo: TipoPerfil }, conocidos: readonly NombreConocido[]): Reconocimiento {
  const delTipo = conocidos.filter((c) => c.tipo === o.tipo)
  const exacto = delTipo.find((c) => c.clave === o.clave)
  if (exacto) return { tipo: 'exacto', clavePerfil: exacto.clavePerfil }

  const mias = palabrasDelNombre(o.tipo, o.nombre, o.ciudad)
  let mejor: { c: NombreConocido; p: number } | null = null
  const seguros = new Set<string>()
  for (const c of delTipo) {
    if (!ciudadCompatible(o.ciudad, c.ciudad)) continue
    const suyas = palabrasDelNombre(o.tipo, c.nombre, c.ciudad)
    const p = parecido(mias, suyas)
    if (p === 1 && mias.length === suyas.length && ciudadComparable(o.ciudad) === ciudadComparable(c.ciudad)) seguros.add(c.clavePerfil)
    if (p >= UMBRAL_DUDA && (!mejor || p > mejor.p)) mejor = { c, p }
  }
  // Iguales con UN solo perfil: el mismo. Iguales con dos perfiles distintos: que decida la persona.
  if (seguros.size === 1) return { tipo: 'seguro', clavePerfil: [...seguros][0] }
  if (mejor) return { tipo: 'duda', clavePerfil: mejor.c.clavePerfil, nombre: mejor.c.nombre, ciudad: mejor.c.ciudad }
  return { tipo: 'nuevo' }
}
