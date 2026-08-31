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

export interface EntradaGuardiaTarifa {
  /** El negocio opera bajo el modelo de tarifa (existe el bloque de confirmación). */
  usaModeloTarifa: boolean
  /** El SERVICIO contratado declara que este caso no lleva tarifa (hoy: `solo_iva`). */
  servicioNiegaTarifa: boolean
  /** Tarifa resuelta por `fuenteDeLaTarifa`. */
  tarifaUpme: number
}

/**
 * ¿Hay que FRENAR la emisión de la propuesta porque falta confirmar la tarifa?
 *
 * ⚠️ Una tarifa en 0 tiene dos causas que no son la misma, y hasta ahora no había que
 * distinguirlas: `servicio_contratado` vivía en Negociación, una etapa DESPUÉS de donde
 * se genera la propuesta, así que su consulta volvía siempre vacía y todo 0 significaba
 * "falta confirmarla". Al subir ese bloque a Propuesta, un caso de **solo IVA** empieza a
 * dar 0 legítimamente — y frenarlo con "falta confirmar la tarifa UPME en Validación"
 * sería mandar a corregir un dato que ya está bien, sobre un caso que sí puede recibir su
 * propuesta (sin línea de tarifa, que es lo que el PDF ya hace con tarifa 0).
 *
 * Se frena solo cuando el negocio opera bajo el modelo de tarifa, su servicio SÍ la
 * lleva, y aun así no hay valor: ahí el documento hablaría de una tarifa en cinco puntos
 * legales sin decir cuánto.
 */
export function faltaConfirmarTarifa(e: EntradaGuardiaTarifa): boolean {
  if (!e.usaModeloTarifa) return false
  if (e.servicioNiegaTarifa) return false
  return !(Number.isFinite(e.tarifaUpme) && e.tarifaUpme > 0)
}
