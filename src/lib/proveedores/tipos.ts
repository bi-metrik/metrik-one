/**
 * Proveedores de la agencia (Mauricio, 2026-10-18). PURO.
 *
 * Un proveedor es UNA fila de `fotos_perfiles` (migración `20261018150000_proveedores.sql`): el
 * perfil de hotel o de tour que ya creaba la cotización se volvió la ficha del proveedor. Dos
 * columnas dicen «qué es»:
 *
 *   · `tipo` (ya existía): el ESPACIO DE LLAVES de sus fotos. `hotel` y `actividad` tienen fotos en
 *     `fotos_catalogo` con la misma llave (`claveDeFoto`); `proveedor` es para lo que no se muestra
 *     en la propuesta (un mayorista, un transportador). No cambia nunca: cambiarlo dejaría las fotos
 *     y los alias colgando de otra llave.
 *   · `tipo_proveedor`: lo que la agencia llama el proveedor (hotel, operador, parque…). Se puede
 *     corregir cuando se quiera; las fotos siguen donde estaban.
 *
 * Etiquetas: texto libre normalizado (sin tildes, minúscula, un espacio entre palabras), varias por
 * proveedor. Con el tipo y la ciudad (la que va en la llave, después de la barra) permiten que una
 * tarjeta de la cotización pida, más adelante, «proveedores tipo X con etiqueta Y en la ciudad Z»
 * con una sola consulta: `tipo_proveedor = X and etiquetas @> '{Y}' and split_part(clave,'|',2) = Z`.
 */
import { claveDeCiudad } from '@/lib/pdf/cotizacion-trappvel-formato'
import { nombreLlano } from '@/lib/fotos/clave'

export const TIPOS_PROVEEDOR = ['hotel', 'operador', 'parque', 'transporte', 'lancha', 'actividad', 'mayorista', 'otro'] as const
export type TipoProveedor = (typeof TIPOS_PROVEEDOR)[number]

export const NOMBRE_TIPO_PROVEEDOR: Record<TipoProveedor, string> = {
  hotel: 'Hotel',
  operador: 'Operador',
  parque: 'Parque',
  transporte: 'Transporte',
  lancha: 'Lancha',
  actividad: 'Actividad o tour',
  mayorista: 'Mayorista',
  otro: 'Otro',
}

export function esTipoProveedor(t: unknown): t is TipoProveedor {
  return typeof t === 'string' && (TIPOS_PROVEEDOR as readonly string[]).includes(t)
}

/** El espacio de llaves de las fotos (columna `tipo` de `fotos_perfiles`). */
export type EspacioProveedor = 'hotel' | 'actividad' | 'proveedor'

/**
 * El espacio de un proveedor NUEVO según su tipo: un hotel tiene fotos de hotel; un parque, una
 * lancha o una actividad, de tour (salen en la propuesta como plan); el resto no tiene fotos.
 */
export function espacioDeTipo(t: TipoProveedor): EspacioProveedor {
  if (t === 'hotel') return 'hotel'
  if (t === 'actividad' || t === 'parque' || t === 'lancha') return 'actividad'
  return 'proveedor'
}

/** ¿Este espacio tiene fotos en la biblioteca? */
export function tieneFotos(espacio: string): espacio is 'hotel' | 'actividad' {
  return espacio === 'hotel' || espacio === 'actividad'
}

/**
 * La llave de un proveedor: la MISMA de `claveDeFoto` para hotel y actividad («h10 metropolitan|
 * barcelona»), así un hotel importado se reconoce cuando llega a una cotización. Vacía si no hay
 * nombre.
 */
export function claveDeProveedor(nombre: string | null | undefined, ciudad: string | null | undefined): string {
  const n = nombreLlano(nombre)
  if (!n) return ''
  return `${n}|${claveDeCiudad(ciudad ?? '').toLowerCase()}`
}

/** Neta (el precio es el costo de la agencia) o comisionable (se le descuenta la comisión). */
export const TARIFA_CANALES = ['neta', 'comisionable'] as const
export type TarifaCanal = (typeof TARIFA_CANALES)[number]

export const NOMBRE_TARIFA_CANAL: Record<TarifaCanal, string> = { neta: 'Neta', comisionable: 'Comisionable' }

export function esTarifaCanal(t: unknown): t is TarifaCanal {
  return typeof t === 'string' && (TARIFA_CANALES as readonly string[]).includes(t)
}

/** La ciudad como iría en la llave: «Cartagena de Indias» → «cartagena de indias». */
export function claveCiudad(ciudad: string | null | undefined): string {
  return claveDeCiudad(ciudad ?? '').toLowerCase()
}

/**
 * El alias que hay que guardar cuando la ficha cambia de nombre o de ciudad (2026-10-19): la llave
 * de la ficha no cambia (de ella cuelgan las fotos), así que la llave NUEVA se guarda como otro
 * nombre del mismo proveedor. Sin él, la próxima cotización que nombre el hotel con su ciudad
 * nueva crearía una ficha duplicada. `null` si no hace falta (sin fotos, o la llave es la misma).
 */
export function aliasPorCambio(f: { espacio: string; clave: string }, nombre: string, ciudad: string | null): { clave: string; nombre: string; ciudad: string | null } | null {
  if (!tieneFotos(f.espacio)) return null
  const clave = claveDeProveedor(nombre, ciudad)
  if (!clave || clave === f.clave) return null
  return { clave, nombre, ciudad }
}

/** La ciudad como va en la llave (después de la barra): para filtrar «en la ciudad Z». */
export function ciudadDeClave(clave: string): string {
  const i = clave.indexOf('|')
  return i < 0 ? '' : clave.slice(i + 1)
}

export const MAX_ETIQUETAS = 30
const LARGO_ETIQUETA = 40

/** Una etiqueta como se guarda: «Luna de Miel » → «luna de miel». Vacía si no queda nada. */
export function normalizarEtiqueta(s: string | null | undefined): string {
  return nombreLlano(s).slice(0, LARGO_ETIQUETA).trim()
}

/** Las etiquetas sin vacías ni repetidas, en el orden en que llegan, hasta `MAX_ETIQUETAS`. */
export function normalizarEtiquetas(lista: readonly unknown[] | null | undefined): string[] {
  const salida: string[] = []
  for (const x of lista ?? []) {
    if (typeof x !== 'string') continue
    const e = normalizarEtiqueta(x)
    if (e && !salida.includes(e)) salida.push(e)
    if (salida.length >= MAX_ETIQUETAS) break
  }
  return salida
}

/** «familias, lujo; luna de miel» → ['familias', 'lujo', 'luna de miel']. */
export function etiquetasDeTexto(texto: string | null | undefined): string[] {
  return normalizarEtiquetas((texto ?? '').split(/[,;\n]/))
}
