/**
 * Regla 2 SOENA (2026-07-08) — liquidación de negocios CANCELADOS con plata recibida.
 *
 * Cuando un negocio SOENA se CANCELA/PIERDE con dinero ya recaudado, esa plata debe
 * aparecer en el panel de conciliación para que el área financiera (Diana) la liquide
 * CASO A CASO. El sistema SURTE + REGISTRA + APLICA la acción que elija financiera;
 * NO auto-decide devolución vs penalidad (esa regla depende del contrato SOENA↔cliente).
 *
 * Dos "bolsas" de plata en un negocio cancelado con dinero (dictamen contable Carmen):
 *
 *   1. Honorario anticipado "recaudado, no reconocido" — los cobros NO-pasante. Como el
 *      negocio nunca se completó, esa plata jamás fue ingreso. Destinos que financiera
 *      elige: devolver al cliente (cobro negativo `devolucion_pendiente`) | retener como
 *      penalidad (categoría propia, NO ingreso por servicios) | mixto (parcial).
 *
 *   2. Pasante UPME recaudado — los cobros `tipo_cobro='pasante'`, plata de terceros en
 *      custodia. Destino según si YA se desembolsó a la UPME:
 *        - NO desembolsado → devolver al cliente (trámite no hecho). Nunca es ingreso.
 *        - YA desembolsado → cerrar contra el desembolso (SOENA cumplió el mandato).
 *
 * REGLA DURA (igual que modelo-dinero.ts): nada aquí bloquea ni "auto-decide" la
 * elección de financiera. Estos helpers son PUROS — no tocan DB ni red — para poder
 * probarse sin mocks. Solo COMPONEN las dos bolsas y clasifican los montos.
 *
 * El pasante NUNCA cuenta como ingreso, en TODO escenario (simétrico a P3 Ola 1).
 */

/** Un cobro relevante para la liquidación (subset de la fila real de `cobros`). */
export interface CobroLiquidacion {
  id: string
  monto: number
  /** 'pasante' | 'devolucion_pendiente' | 'pago' | 'anticipo' | ... | null */
  tipo_cobro: string | null
}

/** Las dos bolsas de un negocio cancelado con dinero. */
export interface DosBolsas {
  /**
   * Honorario recaudado-no-reconocido: suma de cobros positivos NO-pasante y
   * NO-devolución (el neto ya recibido del honorario). Nunca fue ingreso porque el
   * negocio no se completó. Financiera decide devolver | penalidad | mixto.
   */
  honorario_recaudado: number
  /**
   * Pasante UPME recaudado (tipo_cobro='pasante'): plata de terceros en custodia.
   * NUNCA es ingreso de SOENA.
   */
  pasante_recaudado: number
  /**
   * Monto ya marcado por devolver (cobros `devolucion_pendiente`, valor absoluto).
   * Descuenta de lo que queda por liquidar (retrocompat con el patrón de sobrepago).
   */
  ya_por_devolver: number
  /**
   * Monto ya retenido como penalidad (cobros `penalidad`). Descuenta del honorario
   * pendiente por liquidar. Marcado aparte para el tratamiento fiscal de Felipe.
   */
  ya_penalidad: number
  /** honorario_recaudado − ya_por_devolver − ya_penalidad. Lo que aún falta liquidar. */
  honorario_por_liquidar: number
}

/**
 * tipos de cobro que representan una SALIDA ya registrada de la liquidación:
 *   - devolucion_pendiente: cobro NEGATIVO, plata marcada por devolver.
 *   - penalidad: honorario retenido como indemnización (categoría propia, no ingreso
 *     por servicios). Marcado para el tratamiento fiscal de Felipe.
 */
const TIPO_DEVOLUCION = 'devolucion_pendiente'
const TIPO_PASANTE = 'pasante'
export const TIPO_PENALIDAD = 'penalidad'

/**
 * Compone las dos bolsas a partir de los cobros de un negocio.
 *
 * - Honorario recaudado = Σ cobros positivos que NO son pasante, NO devolución, NO
 *   penalidad. (Un `penalidad` positivo NO suma al honorario recaudado: ya salió de la
 *   bolsa; se contabiliza en `ya_penalidad`.)
 * - Pasante recaudado = Σ cobros positivos `tipo_cobro='pasante'`.
 * - ya_por_devolver = Σ |cobros `devolucion_pendiente`| (típicamente negativos).
 * - ya_penalidad = Σ cobros `penalidad` (positivos).
 *
 * SIN BARRERAS: si no hay cobros, todo queda en 0 (el negocio no aplica a Regla 2).
 */
export function componerDosBolsas(cobros: CobroLiquidacion[]): DosBolsas {
  let honorario = 0
  let pasante = 0
  let porDevolver = 0
  let penalidad = 0

  for (const c of cobros ?? []) {
    const monto = Number(c.monto)
    if (!Number.isFinite(monto)) continue
    const tipo = c.tipo_cobro ?? ''
    if (tipo === TIPO_DEVOLUCION) {
      porDevolver += Math.abs(monto)
    } else if (tipo === TIPO_PENALIDAD) {
      penalidad += monto
    } else if (tipo === TIPO_PASANTE) {
      if (monto > 0) pasante += monto
    } else {
      // Cobro de honorario (pago/anticipo/saldo/externo/regular/programado/null).
      if (monto > 0) honorario += monto
    }
  }

  const honorarioPorLiquidar = Math.max(0, Math.round(honorario - porDevolver - penalidad))

  return {
    honorario_recaudado: Math.round(honorario),
    pasante_recaudado: Math.round(pasante),
    ya_por_devolver: Math.round(porDevolver),
    ya_penalidad: Math.round(penalidad),
    honorario_por_liquidar: honorarioPorLiquidar,
  }
}

/**
 * ¿Este negocio tiene plata que liquidar bajo Regla 2? True si aún queda honorario
 * por liquidar O pasante en custodia sin resolver. (Un negocio cancelado sin plata,
 * o ya totalmente liquidado, NO aplica.)
 *
 * `pasanteResuelto` = el pasante ya se cerró (devuelto o desembolsado) — lo determina
 * el caller con el estado del gate del comprobante + los cobros de devolución.
 */
export function tienePlataPorLiquidar(bolsas: DosBolsas, pasanteResuelto: boolean): boolean {
  if (bolsas.honorario_por_liquidar > 0) return true
  if (!pasanteResuelto && bolsas.pasante_recaudado > 0) return true
  return false
}

/** Sugerencia de destino del pasante (financiera CONFIRMA; el sistema no decide). */
export type SugerenciaPasante = 'devolver' | 'cerrar_contra_desembolso'

/**
 * Pre-sugiere qué hacer con el pasante en custodia SEGÚN si ya se desembolsó a la UPME:
 *   - desembolsado (pasó el gate del comprobante en "Pago UPME") → cerrar contra el
 *     desembolso (SOENA ya cumplió el mandato; no se devuelve).
 *   - NO desembolsado → devolver al cliente (el trámite no se hizo).
 *
 * Es solo una SUGERENCIA: financiera confirma la acción. Nunca auto-ejecuta.
 */
export function sugerirDestinoPasante(pasanteDesembolsado: boolean): SugerenciaPasante {
  return pasanteDesembolsado ? 'cerrar_contra_desembolso' : 'devolver'
}
