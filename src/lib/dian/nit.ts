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
 *
 * ⚠️ ÁMBITO — LEER ANTES DE APLICARLO A UN CAMPO NUEVO.
 *
 * `separarNitDv` no LEE si el valor trae DV: lo ADIVINA, viendo si el último
 * dígito resulta ser el DV válido de los anteriores. Esa condición se cumple por
 * azar ~1 de cada 11 veces sobre cualquier identificador limpio, y entonces
 * borra un dígito REAL. No es hipotético, y no se limita a las cédulas:
 *
 *  - Sobre CÉDULAS: `nit_sin_dv` estuvo aplicado a `rut.nit` (casilla 5) y mutiló
 *    14 de 290 RUT. Uno de esos Formularios 010 (caso V0206, una cédula de 8
 *    dígitos que quedó en 7) se radicó así ante la DIAN. La casilla 5 nunca trae
 *    el DV: el RUT lo imprime aparte, en la casilla 6.
 *  - Sobre NIT DE EMPRESA limpios — el uso para el que se escribió: el NIT de
 *    Bancolombia (890903938, DV 8 impreso aparte) queda recortado a 89090393,
 *    porque 8 es también el DV de 89090393. Medido: 1 de 14 NIT públicos, y 2
 *    NIT de proveedor recortados en la Factura (casos V0086 y V0024).
 *
 * Conclusión: solo tiene sentido donde la extracción DEMOSTRADAMENTE entrega el
 * DV pegado y el dato no puede leerse con su separador. Si el documento imprime
 * el DV en su propia casilla —como el RUT—, se extrae de ahí, no se adivina.
 * `nit.test.ts` fija esta trampa a propósito: si un test de esos "se arregla"
 * cambiando el valor esperado, el defecto vuelve.
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
 *
 * ⚠️ Heurística, no lectura: ver el aviso de ÁMBITO al inicio del archivo antes
 * de aplicarla a cualquier campo nuevo.
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
 *
 * ⚠️ Solo para NIT de empresa con el DV pegado por la extracción. Sobre una
 * cédula BORRA UN DÍGITO REAL cuando el último resulta ser un DV válido —
 * ver el aviso de ÁMBITO al inicio del archivo.
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

// ── El NIT del RUT con el DV pegado ──────────────────────────────────────────
//
// Desde ~2026-08-21 la extracción del RUT devuelve la casilla 5 con el DV de la
// casilla 6 pegado al final (`numero_identificacion` 52217225, DV 2 → `nit`
// 522172252), aunque la instrucción del campo dice lo contrario. Medido en SOENA
// el 2026-09-14: 20 bloques, y en los 20 el dígito sobrante es EXACTAMENTE el DV
// módulo 11 de la identificación. Más prompt no lo arregló, así que se corrige de
// forma determinista.
//
// ⚠️ Esto NO es `separarNitDv` con otro nombre. Aquella ADIVINA mirando solo el
// NIT, y por eso mutiló 14 cédulas (ver el aviso de ÁMBITO arriba). Aquí se
// recorta únicamente con un TESTIGO independiente:
//
//  1. `numero_identificacion` (casilla 26): si el NIT es esa identificación más su
//     DV, el sobrante es el DV. Dos casillas distintas coinciden; no hay azar.
//  2. Sin identificación que calce, el DV que la extracción leyó en la casilla 6.
//     Pero ese testigo solo NO alcanza, y el caso que lo prueba es público:
//     Bancolombia, 890903938 con DV 8. El 8 final es a la vez el DV de 89090393
//     y el DV leído — y el NIT está limpio. Lo que separa los dos casos es el DV
//     del NIT COMPLETO: en un NIT limpio coincide con el leído (siempre); en uno
//     con el DV pegado solo por azar (1 de cada 11). Cuando coinciden los tres, no
//     hay forma de saberlo desde el dato, y se devuelve `dudoso` en vez de recortar.

export type AccionNitDv = 'sin_cambio' | 'quitar_dv' | 'dudoso'

export interface DiagnosticoNitDv {
  accion: AccionNitDv
  /** NIT a guardar: la base sin el DV cuando `quitar_dv`, el valor intacto si no. */
  nit: string
  /** Por qué. Sirve para el log y para las pruebas, no para la pantalla. */
  motivo:
    | 'sin_nit'
    | 'limpio'
    | 'pegado_a_la_identificacion'
    | 'pegado_segun_dv_leido'
    | 'ambiguo_dv_leido_valido_para_ambos'
}

/**
 * ¿`nit` es exactamente `numeroIdentificacion` seguido de su DV?
 *
 * Es la condición que usa la guarda del Formulario 010 y la primera regla de la
 * normalización. Exige las tres cosas —un dígito más, mismo prefijo y ese dígito
 * igual al DV— porque cualquiera sola ocurre por azar.
 */
export function nitTraeDvDeLaIdentificacion(
  nit: string | null | undefined,
  numeroIdentificacion: string | null | undefined,
): boolean {
  const n = soloDigitos(nit)
  const id = soloDigitos(numeroIdentificacion)
  if (!n || !id) return false
  if (n.length !== id.length + 1) return false
  if (!n.startsWith(id)) return false
  return n.slice(-1) === calcularDvNit(id)
}

/**
 * Decide si el NIT extraído trae el DV pegado. Puro: no muta nada.
 *
 * @param nit                   valor extraído del campo `nit`.
 * @param numeroIdentificacion  valor extraído de la casilla 26, si el bloque lo tiene.
 * @param dvLeido               DV que la extracción leyó en la casilla 6, ANTES de
 *                              cualquier recálculo. Si ya viene recalculado sobre el
 *                              NIT crudo, es inútil como testigo.
 */
export function diagnosticarNitDv(input: {
  nit: string | null | undefined
  numeroIdentificacion?: string | null
  dvLeido?: string | null
}): DiagnosticoNitDv {
  const crudo = (input.nit ?? '').trim()
  const n = soloDigitos(crudo)
  if (!n) return { accion: 'sin_cambio', nit: crudo, motivo: 'sin_nit' }

  const id = soloDigitos(input.numeroIdentificacion)
  if (nitTraeDvDeLaIdentificacion(n, id)) {
    return { accion: 'quitar_dv', nit: id, motivo: 'pegado_a_la_identificacion' }
  }
  // La identificación calza con el NIT tal cual: es la prueba de que está limpio.
  if (id && id === n) return { accion: 'sin_cambio', nit: crudo, motivo: 'limpio' }

  // Sin identificación, o una que no calza: el único testigo es el DV leído.
  const dv = soloDigitos(input.dvLeido)
  if (n.length < 2 || dv.length !== 1) return { accion: 'sin_cambio', nit: crudo, motivo: 'limpio' }
  const ultimo = n.slice(-1)
  const base = n.slice(0, -1)
  const ultimoEsDvDeLaBase = calcularDvNit(base) === ultimo
  const dvLeidoEsElUltimo = dv === ultimo
  if (!ultimoEsDvDeLaBase || !dvLeidoEsElUltimo) {
    return { accion: 'sin_cambio', nit: crudo, motivo: 'limpio' }
  }
  if (calcularDvNit(n) === dv) {
    return { accion: 'dudoso', nit: crudo, motivo: 'ambiguo_dv_leido_valido_para_ambos' }
  }
  return { accion: 'quitar_dv', nit: base, motivo: 'pegado_segun_dv_leido' }
}
