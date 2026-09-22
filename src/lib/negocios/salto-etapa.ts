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

import { saldoCuadrado } from './tolerancia-saldo'

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
 * Con `conciliar_sobrepago` activo salta el pago CUADRADO: un sobrepago real tiene que entrar
 * a la etapa para conciliarse en vez de pasar de largo. Sin él, salta todo saldo CUBIERTO:
 * cualquier saldo a favor del cliente (cero o negativo) y también un faltante inmaterial,
 * dentro del piso de `tolerancia-saldo.ts`.
 *
 * ⚠️ En ninguna de las dos ramas "cubierto" es el cero absoluto. Es el piso de materialidad
 * (`saldoCuadrado`), el mismo con el que juzgan los gates `saldo_cero` y `saldo:handoff`.
 * Exigir el cero exacto abría una franja donde el motor retenía un caso que sus propios gates
 * ya daban por cuadrado, y eso pasó por los dos lados:
 *
 *  - por sobrepago, en la rama con conciliación (SOENA 2026-08-06: V0276 con $120 de más,
 *    V0274 con $688, varados a conciliar una plata que no había que resolver);
 *  - por faltante, en la rama sin conciliación, que hasta 2026-09-22 seguía exigiendo
 *    `saldo <= 0`. V0498 debía $261 (valor a recaudar $1.195.159, recibido $1.194.898) y al
 *    salir de Certificación cayó en "Segundo cobro" (`saltar_si_saldo_cero: true`) en vez
 *    de saltarla, aunque $261 está bajo el piso con el que juzgan los gates de saldo. El
 *    salto no puede ser más estricto que los gates.
 *
 * Decisión de Mauricio (2026-08-06): el piso aplica a TODO el sistema, y el número lo decide
 * el CFO en `tolerancia-saldo.ts`, no aquí. La tolerancia solo destraba el AVANCE: no crea un
 * cobro, no reconoce ingreso y no toca el precio; los $261 siguen en los datos y a la vista.
 *
 * Un negocio sin precio nunca salta: sin monto de referencia el saldo no significa nada.
 */
export function debeSaltarPorSaldo(
  precio: number,
  saldo: number,
  conciliarSobrepago: boolean,
): boolean {
  if (!(precio > 0)) return false
  if (conciliarSobrepago) return saldoCuadrado(saldo)
  return saldo <= 0 || saldoCuadrado(saldo)
}
