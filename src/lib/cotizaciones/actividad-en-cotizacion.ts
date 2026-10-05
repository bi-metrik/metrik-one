/**
 * Qué va y qué no va de las actividades de una cotización de viaje (brief del 2026-10-05,
 * «última limpieza de la cotización de Trappvel antes de presentar», punto 0 y D1–D5).
 *
 * Mauricio, 2026-10-05: *«la puedo dejar para revisarlo o por si la pide después […] por defecto
 * todo seleccionado pero con la posibilidad de quitar el check»*. Cada actividad está en uno de
 * tres estados, y los marca la operadora a propósito (el día ya no es el interruptor: solo ordena
 * el itinerario):
 *
 * | estado     | va en la cotización | suma | día | dónde sale en el PDF                  |
 * |------------|---------------------|------|-----|---------------------------------------|
 * | `incluida` | sí                  | sí   | sí  | «Día a día» (con día) y lo incluido   |
 * | `opcional` | sí                  | no   | lo guarda | «Opcionales», con su precio     |
 * | `no_va`    | no                  | no   | lo guarda | no sale                         |
 *
 * El día se conserva en los tres (brief del 2026-10-05, «actividades tras la limpieza», punto 2:
 * Kayak en Día 2 → Opcional → Incluida volvía «Sin día»). Una opcional no sale en «Día a día» por
 * estar fuera del precio (`diasDelItinerario`), no por no tener día; al volver a Incluida recupera
 * el suyo.
 *
 * ## Sin columna nueva: los dos interruptores que ya existían
 *
 * `items.entra_al_precio` (¿suma?) y `items.mostrar_en_sugeridos` (¿se le muestra al cliente?)
 * describen los tres estados sin una migración:
 *
 *  · incluida = entra al precio.
 *  · opcional = fuera del precio y a la vista. Conserva su `dia_relativo`.
 *  · no va    = fuera del precio y oculta. Conserva su `dia_relativo`.
 *
 * Lo único que esas dos columnas no dicen es si una «No va» era incluida u opcional antes de
 * quitarle el check. Eso se guarda en `tarifa_pax.noVa.era` mientras dure, para que al marcarla
 * otra vez vuelva exactamente como estaba. Sin la marca vuelve Incluida (D5: lo nuevo entra
 * Incluido).
 *
 * Puro: sin red ni base. Lo usan la tarjeta, el editor, la acción del servidor y la bandeja.
 */

import { diaDeItem, fueraDelPrecio, hayDiasAsignados, type ItemConDia } from './dia-relativo'
import { ranuraDeGrupo } from './ranuras-pantallazo'

export type EstadoActividad = 'incluida' | 'opcional' | 'no_va'

const SLUG_ACTIVIDAD = 'actividad_detalle'

/** ¿La línea es una actividad del flujo de viaje? Solo ellas llevan el check y el estado. */
export function esActividad(grupo: string | null | undefined): boolean {
  return ranuraDeGrupo(grupo ?? null)?.slug === SLUG_ACTIVIDAD
}

/** El estado de una actividad, leído de los dos interruptores. */
export function estadoDeActividad(item: Pick<ItemConDia, 'entra_al_precio' | 'mostrar_en_sugeridos'>): EstadoActividad {
  if (item.entra_al_precio !== false) return 'incluida'
  return item.mostrar_en_sugeridos === false ? 'no_va' : 'opcional'
}

/** Lo que pide la operadora: marcar o quitar el check, o pasar de Incluida a Opcional. */
export type PedidoActividad = { va: boolean } | { modo: 'incluida' | 'opcional' }

/**
 * Lo que hay que escribir en la línea para cumplir el pedido. `null` = ya está así. Nunca toca el
 * día: ningún cambio de estado lo borra.
 */
export interface CambiosDeActividad {
  entra_al_precio: boolean
  mostrar_en_sugeridos: boolean
  /** La marca de cómo era antes de quitarle el check; `null` la retira. */
  noVa: { era: 'incluida' | 'opcional' } | null
}

export function cambiosDeActividad(
  actual: { estado: EstadoActividad; dia: number | null; era: 'incluida' | 'opcional' | null },
  pedido: PedidoActividad,
): CambiosDeActividad | null {
  if ('va' in pedido) {
    if (!pedido.va) {
      if (actual.estado === 'no_va') return null
      // Queda donde estaba, con su día: solo deja de sumar y de salir en el documento.
      return { entra_al_precio: false, mostrar_en_sugeridos: false, noVa: { era: actual.estado } }
    }
    if (actual.estado !== 'no_va') return null
    const era = actual.era ?? 'incluida'
    return era === 'incluida'
      ? { entra_al_precio: true, mostrar_en_sugeridos: true, noVa: null }
      : { entra_al_precio: false, mostrar_en_sugeridos: true, noVa: null }
  }
  // Incluida u Opcional solo se eligen con el check puesto.
  if (actual.estado === 'no_va' || actual.estado === pedido.modo) return null
  return pedido.modo === 'incluida'
    ? { entra_al_precio: true, mostrar_en_sugeridos: true, noVa: null }
    // Opcional guarda su día: no sale en «Día a día» y al volver a Incluida lo recupera.
    : { entra_al_precio: false, mostrar_en_sugeridos: true, noVa: null }
}

// ── Los días del viaje ────────────────────────────────────────────────────────

export interface FechasDelViaje {
  inicio: string | null
  fin: string | null
}

const DIA_MS = 86_400_000
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** Una fecha `AAAA-MM-DD` (con lo que venga detrás, «2026-11-13/vie») en milisegundos UTC. */
function enMs(iso: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? '').trim())
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(ms) ? ms : null
}

/**
 * Cuántos días tiene el viaje: de la salida al regreso, los dos incluidos (9 al 13 nov = 5).
 * `null` sin las dos fechas: entonces el día se escribe y no se valida el tope (punto 1).
 */
export function diasDelViaje(fechas: FechasDelViaje | null | undefined): number | null {
  const a = enMs(fechas?.inicio)
  const b = enMs(fechas?.fin)
  if (a === null || b === null || b < a) return null
  return Math.round((b - a) / DIA_MS) + 1
}

/** «Día 3 · miércoles 11 nov»; sin fechas del viaje, «Día 3». */
export function etiquetaDeDiaDelViaje(dia: number, fechas: FechasDelViaje | null | undefined): string {
  const a = enMs(fechas?.inicio)
  if (a === null) return `Día ${dia}`
  const d = new Date(a + (dia - 1) * DIA_MS)
  return `Día ${dia} · ${SEMANA[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`
}

/** Los días que se pueden elegir, 1 a N, cada uno con su fecha. Vacío sin fechas del viaje. */
export function opcionesDeDia(fechas: FechasDelViaje | null | undefined): { dia: number; etiqueta: string }[] {
  const n = diasDelViaje(fechas)
  if (n === null) return []
  return Array.from({ length: n }, (_, i) => ({ dia: i + 1, etiqueta: etiquetaDeDiaDelViaje(i + 1, fechas) }))
}

/**
 * El día del viaje en que cae una fecha (13 nov en un viaje 9–13 nov → 5), o `null` si no hay
 * fecha, no hay fechas del viaje, o cae fuera (punto 2: entonces llega «Sin día»).
 */
export function diaDeFecha(fecha: string | null | undefined, fechas: FechasDelViaje | null | undefined): number | null {
  const f = enMs(fecha)
  const a = enMs(fechas?.inicio)
  const n = diasDelViaje(fechas)
  if (f === null || a === null || n === null) return null
  const dia = Math.round((f - a) / DIA_MS) + 1
  return dia >= 1 && dia <= n ? dia : null
}

/** ¿Este día se puede guardar? Sin fechas del viaje, cualquier entero desde 1 (punto 1). */
export function diaValido(dia: number, fechas: FechasDelViaje | null | undefined): boolean {
  if (!Number.isInteger(dia) || dia < 1) return false
  const n = diasDelViaje(fechas)
  return n === null || dia <= n
}

/** Por qué no se guarda un día, en palabras de quien cotiza. */
export function motivoDiaInvalido(dia: number, fechas: FechasDelViaje | null | undefined): string | null {
  if (diaValido(dia, fechas)) return null
  const n = diasDelViaje(fechas)
  if (n === null || dia < 1 || !Number.isInteger(dia)) return 'El día tiene que ser un número entero desde 1.'
  return `El viaje tiene ${n} días: elige un día del 1 al ${n}.`
}

/**
 * El aviso de la tarjeta cuando el día guardado quedó fuera del viaje (cambiaron las fechas del
 * negocio después, punto 3). `null` si está dentro o no hay con qué comparar.
 */
export function avisoDiaFueraDelViaje(dia: number | null, fechas: FechasDelViaje | null | undefined): string | null {
  if (dia === null) return null
  const n = diasDelViaje(fechas)
  if (n === null || dia <= n) return null
  return `Tiene el Día ${dia} y el viaje ahora tiene ${n} días: elige otro día.`
}

// ── Lo que «Revisar y enviar» dice de las actividades ─────────────────────────

/** Lo mínimo de una línea para decir sus avisos. */
export interface LineaDeActividad extends ItemConDia {
  nombre: string
}

function lista(nombres: readonly string[]): string {
  if (nombres.length <= 1) return nombres.join('')
  if (nombres.length === 2) return `${nombres[0]} y ${nombres[1]}`
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
}

/**
 * D1 · las actividades que SUMAN al precio y no tienen día, con el itinerario en uso (alguna
 * línea que va ya tiene día). Es un aviso, no un bloqueo: el PDF las imprime en lo incluido.
 *
 * @param aportan Los ids que suman al total (`itemsQueAportanAlTotal`): una alternativa que la
 *   ranura descartó no la paga nadie y no pide día.
 */
export function actividadesSinDia(items: readonly LineaDeActividad[], aportan: Iterable<string>): LineaDeActividad[] {
  if (!hayDiasAsignados([...items])) return []
  const suman = new Set(aportan)
  return items.filter(i => suman.has(i.id) && esActividad(i.grupo) && diaDeItem(i) === null && !fueraDelPrecio(i))
}

/** «Falta el día de Snorkel en Crab Cay.» `null` sin ninguna. */
export function textoFaltaDia(actividades: readonly { nombre: string }[]): string | null {
  if (actividades.length === 0) return null
  return `Falta el día de ${lista(actividades.map(a => a.nombre))}.`
}

/** Las actividades a las que les quitaron el check. */
export function actividadesQueNoVan(items: readonly LineaDeActividad[]): LineaDeActividad[] {
  return items.filter(i => esActividad(i.grupo) && estadoDeActividad(i) === 'no_va' && fueraDelPrecio(i))
}

/** «2 actividades no van: Snorkel y Tour en lancha.» `null` sin ninguna. */
export function textoNoVan(actividades: readonly { nombre: string }[]): string | null {
  const n = actividades.length
  if (n === 0) return null
  return `${n} ${n === 1 ? 'actividad no va' : 'actividades no van'}: ${lista(actividades.map(a => a.nombre))}.`
}

/**
 * Lo que el resumen de Componentes dice aparte, sin sumarlo: «1 opcional, no suma · 1 no va».
 * `null` si todas las actividades van incluidas.
 */
export function notaDeActividadesFuera(items: readonly ItemConDia[]): string | null {
  const actividades = items.filter(i => esActividad(i.grupo) && fueraDelPrecio(i))
  const opcionales = actividades.filter(i => estadoDeActividad(i) === 'opcional').length
  const noVan = actividades.filter(i => estadoDeActividad(i) === 'no_va').length
  const partes = [
    opcionales > 0 ? `${opcionales} ${opcionales === 1 ? 'opcional, no suma' : 'opcionales, no suman'}` : null,
    noVan > 0 ? `${noVan} no ${noVan === 1 ? 'va' : 'van'}` : null,
  ].filter((p): p is string => p !== null)
  return partes.length > 0 ? partes.join(' · ') : null
}

/** El texto de la tarjeta de una actividad sin el check. */
export const TEXTO_ACTIVIDAD_NO_VA = 'No va · no suma ni sale en el PDF'
