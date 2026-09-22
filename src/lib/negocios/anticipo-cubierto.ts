/**
 * ¿El saldo del negocio ya cubre su anticipo? La regla, sin base de datos.
 *
 * La consulta vive en `anticipoCubiertoPorSaldo` (negocio-v2-actions), que lee el precio,
 * el plan aprobado y el recaudo confirmado. Aquí queda solo la decisión, para poder
 * probarla: un archivo `'use server'` no exporta helpers síncronos.
 *
 * La consumen tres puntos, y los tres tienen que ver la misma vara:
 *   - `autocompletarGatesAnticipoPorSaldo` cierra el gate de anticipo con la marca
 *     `_completado_via: 'saldo'`;
 *   - `recalcularNegocioPorCambioDeRecaudo` reabre esos gates cuando un cobro se anula y el
 *     saldo deja de cubrir;
 *   - el panel que sale tras registrar un pago (`fab-pago-actions`) deja de listar el gate
 *     de anticipo entre lo que retiene, porque el motor lo cierra solo al avanzar.
 *
 * ⚠️ Cubierto NO es el cero exacto. Hasta 2026-09-22 se exigía `cobrado >= esperado - 1`:
 * un peso de tolerancia, mientras los gates `saldo_cero` y `saldo:handoff` y el salto de
 * etapa ya perdonaban un faltante de hasta `TOLERANCIA_SALDO_COP`. Decisión de Mauricio
 * (2026-08-06): el piso de materialidad aplica a TODO el sistema, y el número lo decide el
 * CFO en `tolerancia-saldo.ts`, no aquí.
 *
 * La tolerancia solo deja AVANZAR el caso: no crea un cobro, no reconoce ingreso y no toca
 * el precio. El faltante sigue en los datos, y la nota que deja el cierre lo dice con su
 * cifra (`notaAnticipoCubierto`) para que "cubierto" no se lea como "pagado completo".
 *
 * Puro: no toca DB ni red.
 */

import { saldoCuadrado } from './tolerancia-saldo'
import { formatearSaldo } from './confirmacion-avance'

// Fracción del precio que es anticipo en el Plan 1 (50/50). Plan 2 (pago único) y la
// ausencia de plan exigen el precio completo: sin plan no se asume un anticipo parcial.
export const ANTICIPO_PCT_PLAN1 = 0.5

export type PlanAprobado = 1 | 2 | null

/** Lo que el cliente debe haber pagado para que el anticipo cuente como cubierto. */
export function anticipoEsperado(precio: number, plan: PlanAprobado): number {
  return plan === 1 ? Math.round(precio * ANTICIPO_PCT_PLAN1) : precio
}

export interface EstadoAnticipo {
  cubierto: boolean
  /** Lo que falta para el anticipo exacto. 0 si ya está pagado completo o de más. */
  faltante: number
}

/**
 * Con el anticipo esperado y lo cobrado, ¿está cubierto?
 *
 * Cubierto = pagado completo o de más, o con un faltante dentro del piso de materialidad.
 * Un anticipo esperado de 0 o menos no se da por cubierto: sin monto no hay nada que
 * cubrir, y el caso del honorario en cero deliberado lo resuelve quien consulta, antes.
 */
export function estadoAnticipo(esperado: number, cobrado: number): EstadoAnticipo {
  if (!(esperado > 0)) return { cubierto: false, faltante: 0 }
  const faltante = esperado - cobrado
  if (!Number.isFinite(faltante)) return { cubierto: false, faltante: 0 }
  return {
    cubierto: faltante <= 0 || saldoCuadrado(faltante),
    faltante: faltante > 0 ? faltante : 0,
  }
}

/**
 * La nota que queda en el bloque y en el timeline cuando el gate se cierra por saldo.
 *
 * Con un faltante dentro del piso la nota lo nombra con su cifra: decir solo "cubierto"
 * sobre un anticipo al que le faltan $261 haría pasar la tolerancia por un pago completo.
 */
export function notaAnticipoCubierto(faltante: number): string {
  const base = 'Anticipo cubierto por el saldo del negocio (reparto/otro pago)'
  if (!(faltante > 0)) return `${base}; gate cerrado automáticamente.`
  return (
    `${base}, con un faltante de ${formatearSaldo(faltante)} dentro del piso de ` +
    'materialidad; gate cerrado automáticamente. El faltante no se da por pagado.'
  )
}
