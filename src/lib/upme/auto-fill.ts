/**
 * Puente entre el motor de auto_fill de bloques `datos` y el helper de tarifa UPME.
 *
 * Un campo de un bloque `datos` puede declarar en su config:
 *   auto_fill: { field: '<slug del valor sin IVA>', source_bloque_slug: 'factura_venta_vehiculo',
 *                computed: 'tarifa_upme', computed_anio?: 2026 }
 *
 * Cuando el motor resuelve ese auto_fill, si trae `computed`, en vez de copiar el
 * valor crudo aplica la transformación aquí. Esto mantiene el motor genérico:
 * agregar un nuevo cómputo = agregar un case, sin tocar el resto del flujo.
 *
 * REGLA DURA: el resultado es SOLO una referencia editable (nunca gate/bloqueo).
 */

import { calcularTarifaUpmePorAnio } from './tarifa'

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
    default:
      return undefined
  }
}
