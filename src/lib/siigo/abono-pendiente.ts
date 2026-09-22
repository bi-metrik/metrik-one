/**
 * ¿Este cobro todavía pide que su honorario se ABONE a la factura?
 *
 * Brief del 2026-09-22 (Mauricio, «Tesorería solo emite recibos de la tarifa UPME»): el
 * abono del honorario (RC-1 `DebtPayment`) es 100 % automático. Sale en tres momentos, y
 * los tres le preguntan a ESTA función qué cobro abonar:
 *
 *   1. al emitir la factura, por los pagos que llegaron antes (`abonarPagosDelNegocio`
 *      desde `facturas.ts`);
 *   2. al registrarse un pago en un negocio que ya tiene factura (`abonarAlRegistrarPago`);
 *   3. el lote del rezago, para los pagos que quedaron sin abono (`rezago-abonos.ts`).
 *
 * Si cada uno decidiera por su cuenta, el lote contaría una cifra y el disparo automático
 * haría otra: la misma respuesta tiene que salir del mismo sitio.
 *
 * Puro: no toca base ni red.
 */

import { abonosAManoDelCobro, componentesEmitidos, hayReciboPorElTotal } from './recibo-componentes'
import { esPorcionPendienteDeConfirmar, type CobroParaRecaudo } from '@/lib/negocios/recaudo-confirmado'

/** Por qué un cobro NO se abona. `null` = sí se abona. */
export type RazonSinAbono =
  /** El corte histórico del 2026-09-07: no lleva recibo retroactivo, y un abono lo es. */
  | 'no_aplica'
  /** El pago no trae honorario: todo es tarifa UPME, que no está en la factura. */
  | 'sin_honorario'
  /** Ya tiene su abono, un RC-1 de anticipo, o una marca vieja por el total. */
  | 'ya_acusado'
  /** Una emisión anterior lo dejó para Tesorería, con su razón. No se reintenta. */
  | 'a_mano'
  /** Es una porción que el comercial propuso y la financiera no ha aceptado. */
  | 'por_confirmar'

export interface CobroParaAbono {
  siigo_recibo: unknown
  recibo_no_aplica?: unknown
  split_json?: CobroParaRecaudo['split_json']
}

export function porQueNoSeAbona(
  cobro: CobroParaAbono,
  ctx: {
    /**
     * Honorario del cobro según `v_cobro_valor` (tramos + excedente). `null` = no se sabe
     * (no hay fila de reparto): no es razón para saltarlo, la emisión lo reporta como
     * faltante en vez de callarlo.
     */
    honorario: number | null
    /** `negocio_conciliacion.conciliado`: respaldo de las porciones aceptadas antes de la marca. */
    negocioConciliado: boolean
    /** El negocio tiene factura CON vínculo a Siigo (`metadata.siigo_factura.siigo_id`). */
    facturaVinculada: boolean
  },
): RazonSinAbono | null {
  if (cobro.recibo_no_aplica) return 'no_aplica'
  if (ctx.honorario != null && !(Math.round(ctx.honorario * 100) / 100 > 0)) return 'sin_honorario'

  // Dos documentos por la misma plata no se deshacen: el anticipo y la marca vieja por el
  // total los cruza o los anula Tesorería, no ONE.
  if (hayReciboPorElTotal(cobro.siigo_recibo) || componentesEmitidos(cobro.siigo_recibo).has('honorario')) {
    return 'ya_acusado'
  }

  // Un «a mano» no se reintenta en cada pago nuevo: su causa (la retención, la factura
  // saldada, las cuotas) no cambia sola, y volver a preguntarle a Siigo en cada registro
  // solo reescribiría la misma explicación. La ÚNICA causa que sí se resuelve desde ONE es
  // la factura sin vínculo: el día que alguien la adopta, el abono ya tiene a qué cruzarse.
  const aMano = abonosAManoDelCobro(cobro.siigo_recibo).find(m => m.componente === 'honorario')
  if (aMano && !(aMano.abono_a_mano.motivo === 'factura_sin_vinculo' && ctx.facturaVinculada)) return 'a_mano'

  // ⚠️ Un abono es un documento contable que no se deshace desde ONE. Una porción que el
  // comercial PROPUSO todavía puede cambiar de negocio (la financiera la corrige con
  // `redistribuirReferencia`), y un abono emitido sobre ella quedaría en Siigo cruzado
  // contra la factura equivocada. Espera a que la financiera la acepte: ese momento
  // (`aceptarRepartoComercial`) vuelve a llamar al abono.
  if (esPorcionPendienteDeConfirmar({ monto: 0, split_json: cobro.split_json ?? null }, ctx.negocioConciliado)) {
    return 'por_confirmar'
  }
  return null
}
