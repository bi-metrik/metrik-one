/**
 * Que cobro se puede anular, y cuando NO se puede.
 *
 * La anulacion (`lib/cobros/anulacion.ts`) siempre fue generica: pone el monto en 0,
 * preserva el original en `monto_anulado` y deja motivo, autor y fecha. Lo que no era
 * generico era el PERMISO: la unica accion que la invocaba exigia `tipo_cobro='externo'`,
 * asi que el resto de la plata solo se corregia por SQL a mano.
 *
 * ── Por que `tipo_cobro` era el criterio equivocado ─────────────────────────
 *
 * Medido el 2026-08-18 sobre los 189 cobros de los 4 workspaces: solo **7** eran
 * anulables (`externo`/davivienda) y **182** no. De esos 182, la razon original del
 * bloqueo ("anular un cobro de pasarela tiene una transaccion real detras") aplicaba a
 * **10**. Los otros 172 no tienen pasarela ninguna: son anticipos y pagos registrados a
 * mano, y en SOENA son $72.8M que la financiera no podia corregir sin pedir un SQL.
 *
 * El criterio real no es de que TIPO es el cobro, sino **que quedaria desarmado detras
 * si se anula**. Son tres cosas, y ninguna es el tipo:
 *
 * 1. **Una transaccion viva en la pasarela.** Anular en ONE no le devuelve la plata a
 *    nadie: deja ONE diciendo una cosa y ePayco otra. Se bloquea.
 * 2. **Una cuota de un plan de cobro.** No es plata recibida, es una cuota emitida.
 *    Anularla por este camino la haria desaparecer del plan sin cancelarlo; para eso
 *    esta `cancelarPlan` / el propio plan (`plan-recurrente-actions.ts`).
 * 3. **Una cuenta de cobro emitida que la incluye.** Es el mismo principio que la regla 2
 *    de la redistribucion: si ya se emitio el documento, quitarle plata por debajo
 *    desarma su soporte. La cuenta se anula primero, y despues el cobro.
 *
 * ⚠️ **`negocios.metadata->'siigo_factura'` NO sirve como senal de facturado.** La regla 2
 * de `redistribucion.ts` la usa, y esta medida **inerte**: 0 de 363 negocios tienen esa
 * clave (las que existen son `siigo_cliente` y `siigo_recibo`). El vinculo fiscal real a
 * nivel de cobro es `cuentas_cobro_emitidas.cobros_ids`, que es el que se usa aqui.
 * `cobros.factura_id` tampoco sirve: 0 de 189 filas lo tienen.
 *
 * Puro: no toca DB ni red. El hecho que si depende de la base (si el cobro esta dentro de
 * una cuenta de cobro viva) entra como parametro.
 */

/**
 * Fuentes que representan una transaccion en una pasarela de pago.
 *
 * Es una lista y no un booleano porque el dia que entre otra pasarela el bloqueo tiene
 * que cubrirla sola. `davivienda` NO esta aqui: es el banco por donde llega una
 * transferencia que alguien registro a mano, no una pasarela que ONE pueda contradecir.
 */
export const FUENTES_PASARELA: readonly string[] = ['epayco']

export type MotivoBloqueo =
  | 'ya_anulado'
  | 'pasarela'
  | 'cuota_de_plan'
  | 'cuenta_cobro_emitida'

/** Los campos del cobro que deciden. Deliberadamente pocos. */
export interface CobroParaAnular {
  tipo_cobro?: string | null
  fuente?: string | null
  plan_cobro_id?: string | null
  anulado_at?: string | null
}

/** Hechos que solo la base conoce. Entran como parametro para que esto siga siendo puro. */
export interface ContextoAnulabilidad {
  /**
   * El cobro esta dentro de una cuenta de cobro emitida que NO esta anulada.
   * Se calcula sobre `cuentas_cobro_emitidas.cobros_ids`.
   */
  enCuentaCobroEmitida: boolean
}

export type Anulabilidad =
  | { anulable: true }
  | { anulable: false; motivo: MotivoBloqueo; error: string }

export function esFuentePasarela(fuente: string | null | undefined): boolean {
  const f = (fuente ?? '').trim().toLowerCase()
  return f !== '' && FUENTES_PASARELA.includes(f)
}

/** Una cuota de un plan de cobro: la marca el tipo o el vinculo al plan, cualquiera de los dos. */
export function esCuotaDePlan(cobro: CobroParaAnular): boolean {
  return cobro.tipo_cobro === 'programado' || !!cobro.plan_cobro_id
}

/**
 * ¿Se puede anular este cobro?
 *
 * El mensaje de un bloqueo dice **a donde ir**, no solo que no se puede: quien lo lee
 * tiene un error de plata en la mano y necesita el siguiente paso, no un no.
 */
export function evaluarAnulabilidad(
  cobro: CobroParaAnular,
  ctx: ContextoAnulabilidad,
): Anulabilidad {
  if (cobro.anulado_at) {
    return { anulable: false, motivo: 'ya_anulado', error: 'Este cobro ya estaba anulado' }
  }

  if (esFuentePasarela(cobro.fuente)) {
    return {
      anulable: false,
      motivo: 'pasarela',
      error:
        'Este pago entro por la pasarela y no se anula desde ONE: la transaccion vive en ePayco y anularla aqui dejaria los dos sistemas diciendo cosas distintas. Si el reparto quedo mal, corrigelo redistribuyendo la referencia.',
    }
  }

  if (esCuotaDePlan(cobro)) {
    return {
      anulable: false,
      motivo: 'cuota_de_plan',
      error:
        'Esto es una cuota de un plan de cobro, no un pago recibido. Anularla aqui la borraria del plan sin cancelarlo: cancela o corrige el plan desde el negocio.',
    }
  }

  if (ctx.enCuentaCobroEmitida) {
    return {
      anulable: false,
      motivo: 'cuenta_cobro_emitida',
      error:
        'Este cobro respalda una cuenta de cobro ya emitida. Quitarle la plata por debajo desarma su soporte: anula primero la cuenta de cobro.',
    }
  }

  return { anulable: true }
}
