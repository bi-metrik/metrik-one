/**
 * Lo que la pantalla dice al borrar una opción o un bloque entero de la cotización de viaje
 * (P12 del caso Providencia, 2026-09-23).
 *
 *  · Borrar se hace sin diálogo y con «Deshacer» unos segundos: el aviso dice qué se fue.
 *  · Un bloque se lleva datos, así que el aviso cuenta cuántas opciones y cuántas ya tenían
 *    costo: «Se borran 2 opciones (ninguna con costo)».
 *  · Lo único que se pregunta ANTES es si lo que se borra está en una tarifa marcada para la
 *    propuesta: esa tarifa se queda sin su componente y sale de la propuesta
 *    (`desmarcarLosQueYaNoPueden`).
 *
 * Puro: sin red, sin base.
 */

export interface TarifaParaBorrado {
  nombre: string | null
  vaEnPropuesta: boolean
  seleccion: readonly string[]
}

/** «Se borran 2 opciones (ninguna con costo)». */
export function avisoDeBorradoDeBloque(opciones: readonly { conCosto: boolean }[]): string {
  const n = opciones.length
  const conCosto = opciones.filter(o => o.conCosto).length
  const cuantas = n === 1 ? 'Se borra 1 opción' : `Se borran ${n} opciones`
  const costo = conCosto === 0
    ? (n === 1 ? 'sin costo' : 'ninguna con costo')
    : conCosto === n
      ? (n === 1 ? 'con costo' : `las ${n} con costo`)
      : `${conCosto} con costo`
  return `${cuantas} (${costo}).`
}

/**
 * Las tarifas marcadas para la propuesta que llevan alguna de estas opciones, por su nombre
 * («Tarifa 2» si no tiene). Vacío = se puede borrar sin preguntar.
 */
export function tarifasMarcadasCon(tarifas: readonly TarifaParaBorrado[], itemIds: readonly string[]): string[] {
  const ids = new Set(itemIds)
  return tarifas
    .map((t, i) => ({ t, nombre: t.nombre?.trim() || `Tarifa ${i + 1}` }))
    .filter(({ t }) => t.vaEnPropuesta && t.seleccion.some(id => ids.has(id)))
    .map(({ nombre }) => nombre)
}

/** La pregunta antes de borrar algo que está en una tarifa de la propuesta. */
export function preguntaTarifaMarcada(nombres: readonly string[], que: 'opcion' | 'bloque'): string {
  const sujeto = que === 'opcion' ? 'Esta opción' : 'Este bloque'
  const tarifas = nombres.length === 1
    ? `la tarifa «${nombres[0]}», que está marcada`
    : `las tarifas ${nombres.map(n => `«${n}»`).join(', ')}, que están marcadas`
  const efecto = nombres.length === 1 ? 'esa tarifa sale' : 'esas tarifas salen'
  const pronombre = que === 'opcion' ? 'la' : 'lo'
  return `${sujeto} está en ${tarifas} para la propuesta. Si ${pronombre} borras, ${efecto} de la propuesta. ¿Borrar?`
}
