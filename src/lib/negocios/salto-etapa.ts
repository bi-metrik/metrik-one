/**
 * Salto automático de etapas ya saldadas: FUENTE ÚNICA de las dos decisiones.
 *
 * El motor de avance salta una etapa cuando no queda nada por cobrar en ella. Hasta ahora
 * eso se decidía con una sola señal, el `stage` de la etapa destino:
 *
 *     if (destStage.stage === 'cobro') { ...si el saldo da, saltar... }
 *
 * Mezclar las dos cosas tiene dos consecuencias, y ambas se cobraron en SOENA:
 *
 *  1. **Una etapa donde se PAGA a un tercero se salta como si fuera de cobro.** "Pago UPME"
 *     es de la financiera, así que su `stage` es `cobro`; pero ahí no se le cobra al
 *     cliente, se le paga a la UPME. Que el cliente esté al día no dice nada sobre si ya
 *     se pagó la tarifa, y sin embargo bastaba para saltarse la etapa cuyo gate es el
 *     comprobante de ese pago. Caso V0121 (2026-07-31): el cobro de la tarifa UPME dejaba
 *     el saldo del negocio en negativo, y ese negativo hacía que el motor se saltara la
 *     etapa de Pago UPME. El pago de la tarifa provocaba que se omitiera el registro del
 *     pago de la tarifa.
 *
 *  2. **Una etapa que SÍ conviene saltar no se puede marcar como tal si no es de cobro.**
 *     "Precobro" es gestión comercial (`stage = 'venta'`): si el cliente ya pagó no hay
 *     nada que precobrar, pero el motor nunca la considera.
 *
 * La corrección NO es torcer el `stage` de esas etapas. El `stage` declara QUIÉN EJECUTA
 * y de él dependen permisos por área, avisos y tableros; moverlo para conseguir un efecto
 * de motor le cambia el dueño a la etapa (decisión de Mauricio, 2026-07-29, al dejar Pago
 * UPME en `cobro` a pesar de este mismo síntoma). Se separa en un flag propio:
 *
 *     config_extra.saltar_si_saldo_cero = false  → nunca se salta (Pago UPME)
 *     config_extra.saltar_si_saldo_cero = true   → se salta aunque no sea de cobro (Precobro)
 *     ausente                                    → comportamiento actual (stage === 'cobro')
 *
 * Sin el flag ninguna línea de ningún workspace cambia de comportamiento.
 */

/** Máximo de saltos encadenados en un solo avance. Backstop, no un límite esperado. */
export const MAX_SALTOS_ENCADENADOS = 5

export interface EtapaSalto {
  stage?: string | null
  config_extra?: { saltar_si_saldo_cero?: unknown; conciliar_sobrepago?: unknown } | null
}

/**
 * ¿Esta etapa participa del salto automático por saldo?
 *
 * El flag explícito manda sobre el `stage`. Cualquier valor que no sea booleano se ignora
 * (una config a medio escribir no debe cambiar el comportamiento en silencio).
 */
export function aplicaSaltoPorSaldo(etapa: EtapaSalto | null | undefined): boolean {
  const flag = etapa?.config_extra?.saltar_si_saldo_cero
  if (typeof flag === 'boolean') return flag
  return etapa?.stage === 'cobro'
}

/**
 * Con el saldo ya calculado, ¿corresponde saltar esta etapa?
 *
 * Con `conciliar_sobrepago` activo solo salta el pago EXACTO: un sobrepago tiene que entrar
 * a la etapa para conciliarse en vez de pasar de largo. Sin él, cualquier saldo cubierto
 * (cero o negativo) salta, que es el comportamiento histórico.
 *
 * Un negocio sin precio nunca salta: sin monto de referencia el saldo no significa nada.
 */
export function debeSaltarPorSaldo(
  precio: number,
  saldo: number,
  conciliarSobrepago: boolean,
): boolean {
  if (!(precio > 0)) return false
  return conciliarSobrepago ? saldo === 0 : saldo <= 0
}
