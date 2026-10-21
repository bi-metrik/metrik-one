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
 *   · `duda`: nombres parecidos sin ser iguales («Iberostar Selection Bávaro» y «Iberostar Selection
 *     Bávaro Suites»). Desde el 2026-10-21 (brief «cotizar con tarifa», punto 5) NO se pregunta:
 *       - un ÚNICO candidato parecido y en la MISMA ciudad → se asocia igual (`seguro`, `porDuda`);
 *         la tarjeta dice «Fotos de: <ficha> · <ciudad>» con «No es este» para deshacer;
 *       - dos o más candidatos, o uno sin la misma ciudad → `duda`: no se asocia ni se crea ficha;
 *         el caso va a «Por clasificar» de Proveedores, con sus `candidatos`.
 *   · `nuevo`: nada parecido. Perfil propio.
 *
 * La ciudad: la del pantallazo; si no trae, la del destino del viaje (`ciudadDelViaje`). Solo para
 * comparar: la llave del nombre (`clave`) no cambia.
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

export interface CandidatoDuda {
  clavePerfil: string
  nombre: string
  ciudad: string | null
}

export type Reconocimiento =
  | { tipo: 'exacto' | 'seguro'; clavePerfil: string; /** Era una duda con un solo candidato en la misma ciudad. */ porDuda?: true }
  | { tipo: 'duda'; clavePerfil: string; nombre: string; ciudad: string | null; candidatos: CandidatoDuda[] }
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
export function reconocer(
  o: Pick<ObjetivoFoto, 'clave' | 'nombre' | 'ciudad'> & { tipo: TipoPerfil },
  conocidos: readonly NombreConocido[],
  /**
   * `preguntarDudas`: lo que crea una persona a propósito («Agregar proveedor», el importador) no se
   * une solo a un parecido: con un candidato también es `duda` (como antes del 2026-10-21).
   */
  opciones?: { ciudadDelViaje?: string | null; preguntarDudas?: boolean },
): Reconocimiento {
  const delTipo = conocidos.filter((c) => c.tipo === o.tipo)
  const exacto = delTipo.find((c) => c.clave === o.clave)
  if (exacto) return { tipo: 'exacto', clavePerfil: exacto.clavePerfil }

  // Sin ciudad en el pantallazo, la del destino del viaje (solo para comparar).
  const ciudad = o.ciudad ?? opciones?.ciudadDelViaje ?? null
  const mias = palabrasDelNombre(o.tipo, o.nombre, ciudad)
  const seguros = new Set<string>()
  const parecidos = new Map<string, { c: NombreConocido; p: number }>()
  for (const c of delTipo) {
    if (!ciudadCompatible(ciudad, c.ciudad)) continue
    const suyas = palabrasDelNombre(o.tipo, c.nombre, c.ciudad)
    const p = parecido(mias, suyas)
    if (p === 1 && mias.length === suyas.length && ciudadComparable(ciudad) === ciudadComparable(c.ciudad)) seguros.add(c.clavePerfil)
    if (p >= UMBRAL_DUDA && (!parecidos.has(c.clavePerfil) || p > (parecidos.get(c.clavePerfil)?.p ?? 0))) parecidos.set(c.clavePerfil, { c, p })
  }
  // Iguales con UN solo perfil: el mismo. Iguales con dos perfiles distintos: duda.
  if (seguros.size === 1) return { tipo: 'seguro', clavePerfil: [...seguros][0] }
  const candidatos = [...parecidos.values()].sort((a, b) => b.p - a.p)
  if (candidatos.length === 0) return { tipo: 'nuevo' }
  const [mejor] = candidatos
  // Un único parecido, en la misma ciudad (con ciudad de los dos lados): se asocia sin preguntar.
  const mismaCiudad = !!ciudadComparable(ciudad) && ciudadComparable(ciudad) === ciudadComparable(mejor.c.ciudad)
  if (candidatos.length === 1 && seguros.size === 0 && mismaCiudad && !opciones?.preguntarDudas) return { tipo: 'seguro', clavePerfil: mejor.c.clavePerfil, porDuda: true }
  return {
    tipo: 'duda',
    clavePerfil: mejor.c.clavePerfil,
    nombre: mejor.c.nombre,
    ciudad: mejor.c.ciudad,
    candidatos: candidatos.map(({ c }) => ({ clavePerfil: c.clavePerfil, nombre: c.nombre, ciudad: c.ciudad })),
  }
}
