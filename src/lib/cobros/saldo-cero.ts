/**
 * El gate `saldo_cero` y lo que la pantalla dice del saldo pendiente: UNA cuenta para los dos.
 *
 * Hasta el 2026-10-22 el gate sumaba `monto` de TODAS las filas de `cobros`: una cuota programada
 * sin fecha cubría el saldo, y un pago anulado por el riel de cobro (que marca `anulado_at`) seguía
 * contando. El viaje pasaba con plata real pendiente mientras la tarjeta de cobros decía otra cosa.
 *
 * La regla, en dos pasos y los dos ya existían:
 *   1. Lo que ENTRÓ: `cobradoConfirmado` (con fecha, sin anular, con la retención de IVA que
 *      practicó el cliente). Es la misma cuenta de la tarjeta del negocio.
 *   2. De eso, solo lo que la financiera ya confirmó: las porciones de un reparto propuesto por el
 *      comercial sin su visto bueno no cubren (`esPorcionPendienteDeConfirmar`).
 *
 * La base del precio es la del gate de siempre: `precio_aprobado`, y si no hay, `precio_estimado`.
 * El sobrepago (saldo negativo) no frena: solo se compara el faltante, con el piso de $1.000.
 *
 * Puro: no toca DB ni red.
 */

import { cobradoConfirmado, type CobroParaSaldo } from './saldo-negocio'
import { esPorcionPendienteDeConfirmar, type CobroParaRecaudo } from '@/lib/negocios/recaudo-confirmado'
import { TOLERANCIA_SALDO_COP } from '@/lib/negocios/tolerancia-saldo'

/** Las columnas de `cobros` que la cuenta necesita. */
export const COLUMNAS_COBRO_SALDO_CERO = 'monto, fecha, retencion_iva, anulado_at, split_json'

export type CobroSaldoCero = CobroParaSaldo & {
  split_json?: CobroParaRecaudo['split_json']
  tipo_cobro?: string | null
}

function pendienteDeFinanciera(c: CobroSaldoCero, conciliado: boolean): boolean {
  return esPorcionPendienteDeConfirmar({ monto: c.monto ?? null, split_json: c.split_json ?? null }, conciliado)
}

/** Lo que cubre el saldo: entró y está confirmado por la financiera. */
export function recaudoParaSaldoCero(cobros: readonly CobroSaldoCero[] | null | undefined, conciliado: boolean): number {
  return cobradoConfirmado((cobros ?? []).filter(c => c && !pendienteDeFinanciera(c, conciliado)))
}

/** Lo que entró pero espera a la financiera: sirve para nombrar el bloqueo. */
export function sinConfirmarParaSaldoCero(cobros: readonly CobroSaldoCero[] | null | undefined, conciliado: boolean): number {
  return cobradoConfirmado((cobros ?? []).filter(c => c && pendienteDeFinanciera(c, conciliado)))
}

/** La base del gate: el precio aprobado; sin él, el estimado. */
export function precioParaSaldoCero(neg: { precio_aprobado?: number | string | null; precio_estimado?: number | string | null } | null | undefined): number {
  const n = Number(neg?.precio_aprobado ?? neg?.precio_estimado ?? 0)
  return Number.isFinite(n) ? n : 0
}

export interface SaldoCero {
  precio: number
  recaudado: number
  /** Precio menos lo que cubre. Negativo = sobrepago. */
  saldo: number
  sinConfirmar: number
  /** `true` si el gate deja pasar (faltante dentro del piso de $1.000). */
  cubierto: boolean
}

export function calcularSaldoCero(e: { precio: number; cobros: readonly CobroSaldoCero[] | null | undefined; conciliado: boolean }): SaldoCero {
  const recaudado = recaudoParaSaldoCero(e.cobros, e.conciliado)
  const saldo = e.precio - recaudado
  return {
    precio: e.precio,
    recaudado,
    saldo,
    sinConfirmar: sinConfirmarParaSaldoCero(e.cobros, e.conciliado),
    cubierto: saldo <= TOLERANCIA_SALDO_COP,
  }
}

const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

/** El texto del bloqueo: «Saldo pendiente: $X (hay $Y de un reparto sin confirmar…)». `null` si cubre. */
export function mensajeSaldoCero(s: SaldoCero): string | null {
  if (s.cubierto) return null
  // Nombrar la plata que está registrada pero sin confirmar: decir solo «faltan $X» manda a la
  // financiera a buscar un pago que YA está en el sistema esperando su visto bueno.
  const detalle = s.sinConfirmar > 0
    ? ` (hay ${COP.format(s.sinConfirmar)} de un reparto sin confirmar por el área financiera)`
    : ''
  return `Saldo pendiente: ${COP.format(s.saldo)}${detalle}`
}
