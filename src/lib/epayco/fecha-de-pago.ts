/**
 * Qué fecha se muestra para un pago del bloque «Pagos» (ePayco) — SOE-013.
 *
 * `negocio_bloques.data.pagos[].fecha` de los pagos registrados antes de SOE-013 es el
 * día del REGISTRO en ONE, no el del pago: mostrarla tal cual corría un día el pago de
 * V0136 (ref 386159602: bloque 2026-09-17, cobro 2026-09-16). La fecha del pago vive en
 * `cobros.fecha` (decisión de Mauricio 2026-08-18), y el cobro se enlaza por
 * `external_ref = String(ref_payco)`: la referencia de ePayco es numérica pura y no se
 * normaliza (las escritas a mano llevan `EXT-`, ver `lib/cobros/referencia-externa.ts`).
 *
 * Respaldo: si no hay cobro con esa referencia se usa `pagos[].fecha`. El cobro se crea
 * ANTES que el pago en la misma acción, así que un pago sin cobro solo se ve en el
 * instante entre registrar y releer la ficha, y ahí `pagos[].fecha` ya es la del pago
 * (desde SOE-013 se guarda la misma del cobro). Esconderla dejaría sin fecha justo el
 * pago que se acaba de registrar.
 *
 * Módulo puro: lo usan el bloque y sus pruebas.
 */

export interface CobroConFecha {
  external_ref: string | null
  fecha: string | null
}

export function fechaDelPagoEpayco(
  pago: { ref_payco: number; fecha?: string | null },
  cobros: ReadonlyArray<CobroConFecha>,
): string | null {
  const ref = String(pago.ref_payco)
  const cobro = cobros.find((c) => c.external_ref === ref && !!c.fecha)
  return cobro?.fecha ?? pago.fecha ?? null
}
