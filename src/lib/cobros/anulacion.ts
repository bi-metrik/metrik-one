/**
 * Anular un cobro — la forma de corregir plata sin borrarla.
 *
 * Criterio de Carmen (CFO), decision de Mauricio (2026-08-11): un cobro NO se borra.
 * Borrar deja un hueco que nadie puede auditar, y este es el modulo con el que se
 * concilia contra el banco. La fila se conserva, marcada, con motivo, autor y fecha.
 *
 * ── Que significa "anulado" en los datos ────────────────────────────────────
 *
 * `cobros.monto` queda en **0** y el valor original se preserva en `monto_anulado`.
 * No es un atajo: es lo que hace que la anulacion sea cierta en TODO el sistema sin
 * depender de que 55 sumadores distintos se acuerden de filtrarla. El razonamiento
 * completo (y la medicion que lo sostiene) esta en la cabecera de la migracion
 * `20260811000001_cobros_anulacion_y_soporte.sql`.
 *
 * Corolario para quien lea datos: en una fila anulada, `monto` NO es el monto. Usa
 * `montoRegistrado()`.
 *
 * ── Lo que el cero NO resuelve ──────────────────────────────────────────────
 *
 * Todo lo que cuenta por PRESENCIA en vez de por suma: control de duplicado de
 * referencia, idempotencia del registro, congelamiento por duplicado y el badge de
 * Tesoreria. Esos sitios filtran `anulado_at is null` explicitamente y estan marcados
 * en el codigo con una referencia a este modulo.
 *
 * Puro: no toca DB ni red.
 */

/** Largo minimo del motivo. Un motivo de dos letras no es una traza, es un tramite. */
export const MOTIVO_ANULACION_MIN = 10

/** Largo maximo que se persiste (el resto se recorta). */
export const MOTIVO_ANULACION_MAX = 300

/** Campos de anulacion tal como viven en `cobros`. */
export interface CamposAnulacion {
  anulado_at?: string | null
  anulado_por?: string | null
  anulacion_motivo?: string | null
  monto_anulado?: number | null
  monto?: number | null
}

/** ¿Esta fila esta anulada? */
export function esCobroAnulado(cobro: CamposAnulacion | null | undefined): boolean {
  return !!cobro?.anulado_at
}

/**
 * Monto que el cobro REGISTRO, este anulado o no.
 *
 * Para una fila viva es `monto`; para una anulada es `monto_anulado`, porque su `monto`
 * vale 0 justamente para que nadie la sume. Es el numero que va en pantalla (tachado),
 * nunca el que va a un total.
 */
export function montoRegistrado(cobro: CamposAnulacion | null | undefined): number {
  if (!cobro) return 0
  const bruto = esCobroAnulado(cobro) ? cobro.monto_anulado : cobro.monto
  const n = Number(bruto ?? 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * Normaliza el motivo escrito por la persona. `null` si no alcanza el minimo: la
 * anulacion se rechaza antes de tocar la base.
 */
export function normalizarMotivoAnulacion(raw: string | null | undefined): string | null {
  const limpio = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (limpio.length < MOTIVO_ANULACION_MIN) return null
  return limpio.slice(0, MOTIVO_ANULACION_MAX)
}

/**
 * Texto que se le antepone a `cobros.notas` al anular.
 *
 * Existe porque hay superficies genericas que listan cobros sin saber nada de esta
 * funcionalidad (`/movimientos`, el export al contador). Ahi la fila apareceria en $0
 * sin explicacion; con esto, la explicacion viaja en el propio registro.
 */
export function notaAnulacion(motivo: string, fechaIso: string): string {
  return `ANULADO ${fechaIso.slice(0, 10)} — ${motivo}`
}
