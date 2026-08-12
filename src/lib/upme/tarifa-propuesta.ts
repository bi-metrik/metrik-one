/**
 * De dónde sale la tarifa UPME que imprime la propuesta económica.
 *
 * Extraído puro porque es la decisión que define si el PDF dice la verdad sobre el
 * precio: la propuesta es lo que el cliente firma, y hasta el 2026-08-12 salía
 * afirmando "Tarifa UPME $0" en las 103 propuestas que llevaban el campo, porque la
 * única vía que sabía llenarlo (`config_extra.tarifa_upme.enabled`) nunca se activó
 * en SOENA.
 *
 * La regla: manda lo que el sistema COBRA. La tarifa confirmada en Validación es la
 * que entra a `valorARecaudar`, así que si la propuesta imprimiera otra cosa, el
 * documento y la cartera dirían cifras distintas sobre el mismo negocio.
 */
export type FuenteTarifaPropuesta = 'confirmada' | 'editada' | 'auto' | 'ninguna'

export interface EntradaFuenteTarifa {
  /** Tarifa confirmada del negocio (`tarifaConfirmadaPorNegocio`). 0 si no hay. */
  confirmada: number
  /** Valor escrito a mano en la propuesta, o null si nadie la editó. */
  editadaAMano: number | null
  /** `config_extra.tarifa_upme.enabled`: recalcular desde la Factura (legacy). */
  autoCalculoHabilitado: boolean
}

/**
 * Precedencia: confirmada → editada a mano → auto-cálculo → ninguna.
 *
 * La confirmada gana sobre la edición manual a propósito. Es la vía legacy previa al
 * bloque de confirmación (cero usos medidos en producción el 2026-08-12) y dejarla
 * arriba permitiría que alguien imprimiera un total que la cartera no va a cobrar.
 *
 * Un valor no positivo NO cuenta como respuesta en ninguna de las vías: es la misma
 * regla de `tarifaConfirmadaDeData`, y evita que un 0 escrito a mano tape una tarifa
 * real confirmada aguas arriba.
 */
export function fuenteDeLaTarifa(e: EntradaFuenteTarifa): FuenteTarifaPropuesta {
  if (Number.isFinite(e.confirmada) && e.confirmada > 0) return 'confirmada'
  if (e.editadaAMano != null && Number.isFinite(e.editadaAMano) && e.editadaAMano > 0) return 'editada'
  if (e.autoCalculoHabilitado) return 'auto'
  return 'ninguna'
}
