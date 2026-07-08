/**
 * UVT (Unidad de Valor Tributario) por año — valor público anual DIAN.
 *
 * La tarifa UPME (Res. UPME 135/2025, Art. 13) se calcula sobre el valor del
 * vehículo sin IVA convertido a UVT, así que el cálculo depende del UVT del año.
 *
 * Este es el hogar canónico del UVT para el cálculo de la tarifa UPME. Al
 * empezar un año nuevo, agregar la entrada aquí (valor oficial publicado por la
 * DIAN). NO hardcodear el UVT disperso en otros archivos.
 */

export const UVT_POR_ANIO: Record<number, number> = {
  2025: 49_799,
  2026: 52_374,
}

/** Año más reciente con UVT definido — fallback cuando no se pasa año. */
const ANIO_UVT_DEFAULT = Math.max(...Object.keys(UVT_POR_ANIO).map(Number))

/**
 * Devuelve el UVT del año dado. Si el año no está en la tabla, cae al año más
 * reciente disponible (no lanza — el cálculo de la tarifa es informativo y nunca
 * debe romper el flujo).
 */
export function uvtDelAnio(anio?: number): number {
  if (anio && UVT_POR_ANIO[anio] !== undefined) return UVT_POR_ANIO[anio]
  return UVT_POR_ANIO[ANIO_UVT_DEFAULT]
}
