/**
 * Transformaciones `computed` del motor de auto_fill de bloques `datos`.
 *
 * Un campo de un bloque `datos` puede declarar en su config:
 *   auto_fill: { field: '<slug de la fuente>', source_bloque_slug: '<bloque origen>',
 *                computed: '<nombre del computo>', computed_anio?: 2026 }
 *
 * Cuando el motor resuelve ese auto_fill, si trae `computed`, en vez de copiar el
 * valor crudo aplica la transformación aquí. Esto mantiene el motor genérico:
 * agregar un nuevo cómputo = agregar un case, sin tocar el resto del flujo.
 *
 * Cómputos disponibles:
 *  - 'tarifa_upme'   : tarifa UPME por año a partir del valor sin IVA (Res. UPME).
 *  - 'nit_con_guion' : NIT/cédula con DV separado por guion (NNNNNNNNN-D), DV
 *                      recalculado por módulo 11 desde el número base limpio.
 *
 * El resultado es un valor pre-llenado editable por el operador (no es gate ni
 * bloqueo). Para 'nit_con_guion', al ser determinista, es también robusto a que
 * la extracción AI de la fuente venga sucia.
 */

import { calcularTarifaUpmePorAnio } from './tarifa'
import { nitConGuion } from '@/lib/dian/nit'

/** Parsea un valor que puede venir como número o string con separadores COP. */
function aNumero(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  // Limpia separadores de miles y símbolos ("$ 120.000.000" / "120,000,000")
  const limpio = String(raw).replace(/[^\d.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '')
  const n = Number(limpio)
  return Number.isFinite(n) ? n : null
}

/**
 * Aplica una transformación `computed` sobre el valor crudo del auto_fill.
 * Devuelve `undefined` si no se puede computar (valor inválido) → el motor deja
 * el campo sin pre-llenar (el operador lo captura a mano). NUNCA lanza.
 */
export function aplicarComputedAutoFill(
  computed: string,
  rawVal: unknown,
  opts?: { anio?: number },
): unknown {
  switch (computed) {
    case 'tarifa_upme': {
      const valorSinIva = aNumero(rawVal)
      if (valorSinIva === null || valorSinIva <= 0) return undefined
      return calcularTarifaUpmePorAnio(valorSinIva, opts?.anio)
    }
    case 'nit_con_guion': {
      // Construye el NIT/cedula con su digito de verificacion separado por guion
      // (NNNNNNNNN-D) de forma DETERMINISTA (modulo 11 DIAN), reusando el helper
      // canonico. La fuente debe ser el NIT/cedula BASE limpio (sin DV pegado):
      // separarNitDv detecta si el valor ya trae el DV y no lo duplica, pero para
      // ser robusto ante lecturas AI sucias (ej. "900123456-77") la config debe
      // apuntar `field` al numero base (casilla 5), no a un "nit_completo" armado
      // por la IA. Devuelve undefined si el valor no es un NIT/cedula reconocible.
      const con = nitConGuion(typeof rawVal === 'string' || typeof rawVal === 'number' ? String(rawVal) : null)
      if (con == null || con === '') return undefined
      return con
    }
    default:
      return undefined
  }
}
