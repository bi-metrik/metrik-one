/**
 * Utilidades de NIT colombiano: dígito de verificación (DV) y separación
 * NIT base ⟺ DV.
 *
 * Contexto: la extracción de la Factura captura el NIT del proveedor con el DV
 * pegado al final, sin separador (ej. "8600190638" = NIT 860019063 + DV 8). Eso
 * es un error: lo que se keyea a la DIAN debe ir SIN el DV (NIT base limpio), y
 * en la Relación de facturas debe verse CON el DV pero separado por guion
 * (860019063-8), para que no parezca un NIT con un dígito de más.
 *
 * El DV es determinista (algoritmo módulo 11 de la DIAN), así que no dependemos
 * de cómo venga la extracción: si el valor trae el DV pegado lo detectamos y
 * separamos; si viene limpio, lo calculamos para el formato con guion.
 */

// Pesos (números primos) del algoritmo DV de la DIAN, aplicados a los dígitos
// de derecha a izquierda. Soporta NIT base de hasta 15 dígitos.
const PESOS_DV = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71]

/** Deja solo dígitos. */
function soloDigitos(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '')
}

/**
 * Calcula el dígito de verificación (módulo 11) de un NIT base (solo dígitos).
 * Retorna null si la base está vacía o excede los pesos soportados.
 */
export function calcularDvNit(base: string | null | undefined): string | null {
  const b = soloDigitos(base)
  if (!b || b.length > PESOS_DV.length) return null
  let suma = 0
  // dígitos de derecha a izquierda: el más a la derecha lleva el primer peso
  for (let i = 0; i < b.length; i++) {
    const digito = Number(b[b.length - 1 - i])
    suma += digito * PESOS_DV[i]
  }
  const resto = suma % 11
  return String(resto > 1 ? 11 - resto : resto)
}

/**
 * Separa un NIT en { base, dv }. Si el último dígito del valor es un DV válido
 * de los anteriores, los separa (el valor traía el DV pegado). Si no, asume que
 * todo el valor es la base y calcula su DV.
 *
 * Devuelve null si no hay dígitos suficientes (no es un NIT/cédula reconocible).
 */
export function separarNitDv(raw: string | null | undefined): { base: string; dv: string | null } | null {
  const d = soloDigitos(raw)
  if (!d) return null
  if (d.length >= 2) {
    const posibleBase = d.slice(0, -1)
    const posibleDv = d.slice(-1)
    if (calcularDvNit(posibleBase) === posibleDv) {
      return { base: posibleBase, dv: posibleDv }
    }
  }
  return { base: d, dv: calcularDvNit(d) }
}

/**
 * NIT base SIN dígito de verificación. Lo que se envía/keyea a la DIAN.
 * Si no logra interpretarlo, devuelve el valor original tal cual.
 */
export function nitSinDv(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const sep = separarNitDv(raw)
  return sep ? sep.base : raw
}

/**
 * NIT con DV separado por guion (ej. "860019063-8"). Para la Relación de
 * facturas. Si no logra calcular el DV, devuelve solo la base.
 */
export function nitConGuion(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const sep = separarNitDv(raw)
  if (!sep) return raw
  return sep.dv != null ? `${sep.base}-${sep.dv}` : sep.base
}
