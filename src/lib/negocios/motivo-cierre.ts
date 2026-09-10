/**
 * Cómo se cerró un negocio, derivado de `estado`.
 *
 * ⚠️ La columna `negocios.cierre_motivo` está MUERTA y no se vuelve a leer. No es que
 * falte poblarla: **no se puede**. La gobierna el CHECK `negocios_cierre_motivo_coherente`
 * (migración `20260520000003`), que exige `stage_actual = 'cerrado'` para admitir un valor,
 * y los cierres de este producto no mueven el stage — en SOENA la etapa de cierre es
 * Facturación, stage `cobro`, y la línea no tiene ni una etapa con stage `cerrado`.
 * Escribirla devuelve `23514` y el negocio no cierra.
 *
 * La prueba de que no aporta nada: es **1 a 1 con `estado`**. Medido contra producción el
 * 2026-09-10, en TODA la base hay 5 filas con `cierre_motivo` no nulo, las 5 `completado` +
 * `exitoso`. O sea que el valor que tendría ya se sabe mirando `estado`.
 *
 * ⚠️ El mapa es una lista CERRADA de tres estados, no un `estado !== 'abierto'`. En
 * producción conviven negocios con `estado = 'activo'` (2 filas del workspace `metrik`,
 * medido el 2026-09-10): un estado desconocido no tiene motivo de cierre y devuelve `null`,
 * en vez de inventarle uno.
 */

/** Los tres desenlaces que el producto sabe nombrar. */
export type MotivoCierre = 'exitoso' | 'perdido' | 'cancelado'

/**
 * Cada estado terminal y su desenlace. Los estados que no están aquí (`abierto`, `activo`,
 * cualquiera que aparezca después) no tienen motivo: la búsqueda devuelve `undefined`.
 */
const ESTADO_A_MOTIVO: Readonly<Record<string, MotivoCierre>> = {
  completado: 'exitoso',
  perdido: 'perdido',
  cancelado: 'cancelado',
}

/** El desenlace de un negocio, o `null` si su estado no es un cierre reconocido. */
export function motivoCierreDeEstado(estado: string | null | undefined): MotivoCierre | null {
  if (!estado) return null
  return ESTADO_A_MOTIVO[estado] ?? null
}

/**
 * ¿Este negocio está cerrado? Mismo criterio que el desenlace: la lista CERRADA de
 * `ESTADO_A_MOTIVO`, no un `estado !== 'abierto'`.
 *
 * Es el único predicado del producto para "de solo lectura". Un negocio cerrado se
 * puede ver y descargar, pero no recibe pagos, ni horas, ni gastos, ni cobros
 * programados, ni datos nuevos en sus bloques.
 *
 * ⚠️ `activo` NO es cerrado (2 negocios del workspace `metrik`, medido el
 * 2026-09-10), y un estado que aparezca mañana tampoco: sale abierto hasta que
 * alguien lo agregue al mapa a propósito.
 */
export function negocioCerrado(estado: string | null | undefined): boolean {
  return motivoCierreDeEstado(estado) !== null
}

/**
 * Lo que ve quien intenta alimentar un negocio cerrado. Una sola frase para todas
 * las puertas: si cada acción escribe la suya, el mismo bloqueo se explica de
 * cinco formas distintas y ninguna dice qué hacer.
 */
export const MENSAJE_NEGOCIO_CERRADO =
  'Este negocio está cerrado y no admite cambios. Si hay que retomarlo, reábrelo primero.'
