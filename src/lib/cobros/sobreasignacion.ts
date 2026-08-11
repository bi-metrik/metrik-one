/**
 * Referencia sobre-asignada — el control que atrapa el pago contado dos veces.
 *
 * ⚠️ ESTO NO ES, NI PUEDE SER, UNA RESTRICCION DE UNICIDAD SOBRE `external_ref`.
 *
 * Una referencia se repite de forma LEGITIMA cuando un mismo pago se reparte entre
 * varios negocios, y en produccion hay casos correctos asi (V0043/V0064, y el 50/50 de
 * V0277/V0287). Bloquear la repeticion romperia el reparto, que es una necesidad real
 * del negocio.
 *
 * El control es sobre el MONTO: se alerta cuando la suma de lo registrado bajo una
 * referencia SUPERA el valor del pago original. Eso atrapa el duplicado y deja pasar el
 * reparto.
 *
 * ── El caso que lo motivo ───────────────────────────────────────────────────
 *
 * La referencia 378962162 era un pago real de $1.020.000 y termino con $2.040.000
 * registrados: el reparto de V0256 consumio el total y, tres dias despues, alguien
 * volvio a registrar el total completo contra V0258. Quien lo cargo no tenia como
 * saberlo: la pantalla no mostraba nada de lo ya registrado. Corregido a mano el
 * 2026-08-11.
 *
 * Con este control, ese segundo registro habria salido con "esta referencia ya tiene
 * $1.020.000 de $1.020.000 asignados" ANTES de guardar.
 *
 * ── De donde sale el total ──────────────────────────────────────────────────
 *
 * De quien declara el pago. En el primer registro de una referencia, el total es el
 * valor que se registra (o el que se declare, si ya se sabe que se va a repartir). En
 * los siguientes, el total ya esta declarado y esta funcion mide contra el.
 *
 * Puro: no toca DB ni red.
 */

import { TOLERANCIA_SALDO_COP } from '@/lib/negocios/tolerancia-saldo'

export type EstadoReferencia =
  /** Nada registrado todavia bajo esta referencia. */
  | 'libre'
  /** Lo registrado cubre el total declarado (dentro de la tolerancia). */
  | 'cuadra'
  /** Falta plata por asignar: un reparto a medias. Se muestra, no se bloquea. */
  | 'incompleta'
  /** Lo registrado SUPERA el pago original. Es la alerta. */
  | 'sobreasignada'

export interface EntradaReferencia {
  /** Valor del pago original declarado para la referencia. */
  total: number
  /** Suma de lo ya registrado bajo la referencia (solo cobros VIGENTES). */
  registrado: number
  /** Lo que se pretende registrar ahora. 0 al evaluar lo ya guardado. */
  nuevo?: number
}

export interface VeredictoReferencia {
  estado: EstadoReferencia
  /** Total declarado del pago. */
  total: number
  /** Lo que quedaria asignado si la operacion se ejecuta. */
  asignado: number
  /** Plata del pago que nadie ha reclamado (0 si no aplica). */
  sin_asignar: number
  /** Cuanto se pasa del pago original (0 si no aplica). Es el numero de la alerta. */
  excedente: number
}

/**
 * Evalua una referencia. `nuevo` permite preguntar "¿que pasaria si registro esto?"
 * ANTES de escribir, que es donde el control sirve.
 *
 * La tolerancia es la misma vara de materialidad del resto del sistema
 * (`TOLERANCIA_SALDO_COP`): un residuo de redondeo no es un pago duplicado.
 */
export function evaluarReferencia(
  entrada: EntradaReferencia,
  tolerancia: number = TOLERANCIA_SALDO_COP,
): VeredictoReferencia {
  const margen = Number.isFinite(tolerancia) && tolerancia >= 0 ? tolerancia : 0
  const total = numero(entrada.total)
  const registrado = numero(entrada.registrado)
  const nuevo = numero(entrada.nuevo)
  const asignado = registrado + nuevo

  const base = { total, asignado }

  if (registrado <= 0 && nuevo <= 0) {
    return { ...base, estado: 'libre', sin_asignar: Math.max(0, total), excedente: 0 }
  }

  // Sin total declarado no hay vara contra la cual medir: no se inventa una. Lo
  // registrado se toma como el pago. Es el caso normal de un pago a un solo negocio.
  if (!(total > 0)) {
    return { ...base, estado: 'cuadra', sin_asignar: 0, excedente: 0 }
  }

  const diferencia = asignado - total
  if (diferencia > margen) {
    return { ...base, estado: 'sobreasignada', sin_asignar: 0, excedente: diferencia }
  }
  if (-diferencia > margen) {
    return { ...base, estado: 'incompleta', sin_asignar: -diferencia, excedente: 0 }
  }
  return { ...base, estado: 'cuadra', sin_asignar: 0, excedente: 0 }
}

/**
 * Total declarado de una referencia a partir de lo que ya hay registrado.
 *
 * El mayor `split_total` declarado entre sus cobros; si ninguno lo declaro, el total es
 * la suma de lo registrado (un pago a un solo negocio se declara a si mismo). Es la
 * misma regla que ya usa el panel de conciliacion para `total_declarado`.
 */
export function totalDeclaradoDeReferencia(
  cobros: Array<{ monto: number | null; split_json?: { split_total?: unknown } | null }>,
): number {
  let declarado = 0
  let suma = 0
  for (const c of cobros ?? []) {
    const st = Number(c?.split_json?.split_total ?? 0)
    if (Number.isFinite(st) && st > declarado) declarado = st
    suma += numero(c?.monto)
  }
  return declarado > 0 ? declarado : suma
}

function numero(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
