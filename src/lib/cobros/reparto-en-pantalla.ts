/**
 * Las cuentas que el modal de «Corregir el reparto» muestra mientras se escribe.
 *
 * ⚠️ Una línea sin negocio NO es plata asignada. Antes el total sumaba todas las líneas
 * y el guardado descartaba en silencio las que no tenían negocio: la pantalla decía
 * «Sin asignar $0», el servidor recibía un reparto idéntico al actual y el toast
 * contestaba «Reparto actualizado» sin haber cambiado nada (Soena, 2026-09-23). Aquí
 * esa línea queda fuera del total y bloquea el guardado: se escoge el negocio o se
 * elimina la línea, pero no se pierde callada.
 *
 * La validación de verdad sigue en el servidor (`planearRedistribucion`).
 *
 * Puro: no toca DB ni red.
 */

export interface LineaEnPantalla {
  negocioId: string
  monto: number
  porDevolver: boolean
}

/** Largo mínimo del motivo. El mismo que exige `planearRedistribucion`. */
export const MOTIVO_REPARTO_MIN = 10

/** La línea tiene plata pero nadie ha escogido a qué negocio va. */
export function lineaSinNegocio(l: LineaEnPantalla): boolean {
  return !l.negocioId && (l.monto || 0) > 0
}

export interface CuentasReparto {
  totalAsignado: number
  totalPorDevolver: number
  sinAsignar: number
  sobrepasa: boolean
  /** Cuántas líneas tienen plata y no tienen negocio. */
  lineasSinNegocio: number
  motivoCorto: boolean
  puedeGuardar: boolean
}

export function cuentasReparto(input: {
  pagoOriginal: number
  lineas: LineaEnPantalla[]
  motivo: string
}): CuentasReparto {
  const conNegocio = input.lineas.filter(l => l.negocioId)
  const totalAsignado = conNegocio
    .filter(l => !l.porDevolver)
    .reduce((s, l) => s + (l.monto || 0), 0)
  const totalPorDevolver = conNegocio
    .filter(l => l.porDevolver)
    .reduce((s, l) => s + (l.monto || 0), 0)
  const sinAsignar = input.pagoOriginal - totalAsignado - totalPorDevolver
  // Mismo listón que tenía la pantalla: un peso de redondeo. El servidor tolera más.
  const sobrepasa = sinAsignar < -1
  const lineasSinNegocio = input.lineas.filter(lineaSinNegocio).length
  const motivoCorto = (input.motivo ?? '').trim().length < MOTIVO_REPARTO_MIN

  return {
    totalAsignado,
    totalPorDevolver,
    sinAsignar,
    sobrepasa,
    lineasSinNegocio,
    motivoCorto,
    puedeGuardar: !sobrepasa && lineasSinNegocio === 0 && !motivoCorto,
  }
}
