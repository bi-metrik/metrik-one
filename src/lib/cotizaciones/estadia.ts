/**
 * Las fechas corregidas de una opción de hotel y lo que hacen con el costo (brief del
 * 2026-09-30, `brief-max-2026-09-30-corregir-fechas-recalcula.md`).
 *
 * Caso: COT-2026-0019. Una habitación ingresada a mano con la entrada en octubre por error
 * (35 noches × 100.000 = 3.500.000). Se corrigió la entrada a noviembre en «Corregir datos» y
 * la habitación siguió costando 3.500.000 para una estadía de 4 noches.
 *
 * ## Dónde vive la verdad: en las correcciones, y el costo se DERIVA al calcular
 *
 * La lectura de la habitación no se reescribe. Es la regla de `correcciones.ts`: lo que se
 * escribió (o leyó) queda intacto y la corrección manda encima. Cada vez que se calcula el
 * costo (`repartirHabitaciones`, `resolverTarifa` por `casillasConEstadia`) la habitación
 * pasa por `lecturaConEstadia`, que le pone encima las fechas corregidas de la opción:
 *
 *  · **Ingreso manual** (`origen: 'manual'`): el costo es neto × noches × pasajeros. Con otras
 *    noches, el costo se escala a las noches corregidas. El neto por noche es el mismo: el
 *    formulario guarda `neto × noches × cantidad` por fila, así que dividir y multiplicar por
 *    noches da el mismo neto sin redondeo de por medio.
 *  · **Pantallazo**: el precio es el que mostró la plataforma PARA ESAS FECHAS. No se toca;
 *    se avisa (`avisoDeEstadia`) que hay que volver a pegar el pantallazo.
 *
 * Así la ficha, la tarjeta, la confirmación del costo (rubros y `porHabitacion`), el total y
 * el PDF salen del mismo número, y volver a la fecha leída deshace el cambio solo.
 *
 * ## La corrección es de la opción
 *
 * `tarifa.correcciones` vive a nivel de la línea (la opción = hotel + fechas). Se aplica a
 * TODAS sus habitaciones, campo por campo: una habitación cuya fecha no se corrigió conserva
 * la suya, y si queda con fechas distintas de la opción, se avisa (`avisoDeEstadia`); nada se
 * inventa.
 *
 * Puro y sin dependencias de valor: lo importan `tarifa-pasajero.ts` y `habitaciones.ts`.
 */

import type { Correcciones } from './correcciones'
import type { CasillasLeidas, LecturaCasilla } from './tarifa-pasajero'

const FECHA = /^\d{4}-\d{2}-\d{2}$/

/** Noches entre dos fechas «AAAA-MM-DD». 0 si no se puede. */
export function nochesEntre(entrada: string | null | undefined, salida: string | null | undefined): number {
  const a = (entrada ?? '').trim()
  const b = (salida ?? '').trim()
  if (!FECHA.test(a) || !FECHA.test(b)) return 0
  const n = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
  return Number.isFinite(n) && n > 0 ? n : 0
}

const CAMPOS_DE_FECHA = ['check_in', 'check_out'] as const

/** ¿Una persona corrigió la entrada o la salida de la opción? */
export function fechasCorregidas(correcciones: Correcciones | null | undefined): boolean {
  return CAMPOS_DE_FECHA.some(c => !!correcciones?.[c])
}

export interface EstadiaDeHabitacion {
  /** Las fechas con las correcciones encima. */
  entrada: string | null
  salida: string | null
  /** Las noches de lo leído (o escrito en el formulario). `null` si no se saben. */
  nochesLeidas: number | null
  /** Las noches con las fechas corregidas. `null` si no se saben. */
  noches: number | null
  /** Hay corrección de fechas y las noches cambiaron. */
  cambio: boolean
}

function nochesDeLaLectura(l: LecturaCasilla): number | null {
  const porFechas = nochesEntre(l.identidad?.check_in, l.identidad?.check_out)
  if (porFechas > 0) return porFechas
  const campo = l.campos?.find(c => c.label === 'Noches')?.valor
  const n = Number(String(campo ?? '').trim())
  return Number.isInteger(n) && n > 0 ? n : null
}

/** La estadía de una habitación con las fechas corregidas de su opción encima. */
export function estadiaDeHabitacion(l: LecturaCasilla, correcciones: Correcciones | null | undefined): EstadiaDeHabitacion {
  const leida = (campo: 'check_in' | 'check_out') => (l.identidad?.[campo] ?? '').trim() || null
  const vigente = (campo: 'check_in' | 'check_out') => {
    const c = correcciones?.[campo]
    if (!c) return leida(campo)
    return c.valor === null || c.valor.trim() === '' ? null : c.valor.trim()
  }
  const entrada = vigente('check_in')
  const salida = vigente('check_out')
  const nochesLeidas = nochesDeLaLectura(l)
  if (!fechasCorregidas(correcciones)) return { entrada, salida, nochesLeidas, noches: nochesLeidas, cambio: false }
  const corregidas = nochesEntre(entrada, salida)
  const noches = corregidas > 0 ? corregidas : null
  return {
    entrada,
    salida,
    nochesLeidas,
    noches,
    cambio: noches !== null && nochesLeidas !== null && noches !== nochesLeidas,
  }
}

const escalar = (v: number, factor: number) => Math.round(v * factor * 100) / 100

/**
 * La lectura con la que se calcula el costo de la habitación.
 *
 * Solo cambia una habitación de ingreso manual cuyas noches cambiaron por una corrección: su
 * total y sus filas por pasajero pasan a las noches corregidas. Un pantallazo, o una habitación
 * sin cambio de noches, vuelve tal cual (la MISMA referencia). No toca la entrada.
 */
export function lecturaConEstadia(l: LecturaCasilla, correcciones: Correcciones | null | undefined): LecturaCasilla {
  if (l.origen !== 'manual') return l
  const e = estadiaDeHabitacion(l, correcciones)
  if (!e.cambio || !e.noches || !e.nochesLeidas) return l
  const factor = e.noches / e.nochesLeidas
  return {
    ...l,
    total: escalar(l.total, factor),
    aPagarAgencia: l.aPagarAgencia === null ? null : escalar(l.aPagarAgencia, factor),
    porTipo: l.porTipo.map(f => ({ ...f, subtotal: escalar(f.subtotal, factor) })),
  }
}

/** Las casillas de una opción sin habitaciones, con la estadía corregida encima (`lecturaConEstadia`). */
export function casillasConEstadia(casillas: CasillasLeidas, correcciones: Correcciones | null | undefined): CasillasLeidas {
  if (!fechasCorregidas(correcciones)) return casillas
  const out: CasillasLeidas = {}
  for (const [k, l] of Object.entries(casillas) as [keyof CasillasLeidas, LecturaCasilla | undefined][]) {
    if (l) out[k] = lecturaConEstadia(l, correcciones)
  }
  return out
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const fechaCorta = (f: string) => `${Number(f.slice(8, 10))} ${MESES[Number(f.slice(5, 7)) - 1]}`
const nochesTexto = (n: number) => `${n} ${n === 1 ? 'noche' : 'noches'}`

/**
 * Lo que hay que decir de la estadía de una habitación, o `null`.
 *
 *  · Pantallazo con otras noches: su precio es el de la plataforma para las noches de la
 *    captura, y no se recalcula.
 *  · Una habitación que queda con fechas distintas de las de la opción (`opcion`): se dice,
 *    no se decide cuál es la buena.
 */
export function avisoDeEstadia(
  l: LecturaCasilla,
  correcciones: Correcciones | null | undefined,
  opcion?: { entrada: string | null; salida: string | null } | null,
): string | null {
  const e = estadiaDeHabitacion(l, correcciones)
  if (opcion && e.entrada && e.salida && opcion.entrada && opcion.salida
    && (e.entrada !== opcion.entrada || e.salida !== opcion.salida)
    && FECHA.test(e.entrada) && FECHA.test(e.salida) && FECHA.test(opcion.entrada) && FECHA.test(opcion.salida)) {
    return `Esta habitación va del ${fechaCorta(e.entrada)} al ${fechaCorta(e.salida)} y la opción del ${fechaCorta(opcion.entrada)} al ${fechaCorta(opcion.salida)}. Revisa las fechas.`
  }
  if (l.origen !== 'manual' && e.cambio && e.noches && e.nochesLeidas) {
    return `El precio es el del pantallazo para ${nochesTexto(e.nochesLeidas)}; cambiaste a ${nochesTexto(e.noches)}. Vuelve a pegar el pantallazo.`
  }
  return null
}

/**
 * Qué habitaciones manuales cambiaron de noches, y a cuántas: si cambia después de confirmar
 * el costo, la confirmación queda vieja (`confirmacionDesactualizada`). Vacío cuando ninguna
 * cambió: las confirmaciones de antes siguen vigentes.
 */
export function firmaDeEstadia(
  habitaciones: readonly { id: string; lectura: LecturaCasilla }[],
  correcciones: Correcciones | null | undefined,
): string {
  if (!fechasCorregidas(correcciones)) return ''
  return habitaciones
    .filter(h => h.lectura.origen === 'manual')
    .map(h => ({ id: h.id, e: estadiaDeHabitacion(h.lectura, correcciones) }))
    .filter(x => x.e.cambio)
    .map(x => `${x.id}:${x.e.noches}`)
    .join('|')
}
