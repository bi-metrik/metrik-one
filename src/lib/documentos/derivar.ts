/**
 * Campos que calcula el código y alertas de coherencia entre montos (SOE-041). Puro: sin
 * base, sin red. Corre en el servidor como pasadas 5 y 6 de `aplicarNormalizaciones` y en la
 * pantalla al corregir a mano una fuente de un campo derivado.
 */

import type { CampoExtraccion, CampoResultado } from '@/lib/ai/extract-fields'
import { parseMontoCop } from '@/lib/negocios/monto-cop'
import { bajarConfianza, campoProtegido } from './confianza'

export interface CambioDerivado {
  campo: string
  antes: string | null
  despues: string | null
  motivo: 'resta' | 'restaurado' | 'sin_valor_antes' | 'resultado_no_positivo' | 'sin_descuento_valor_distinto'
}

/** Diferencia de pesos que no cuenta como distinta (redondeos de la factura). */
const TOLERANCIA_PESOS = 1

/**
 * `derivar: { resta: [a, b] }` (SOE-041): el campo vale a − b, calculado por el código. El
 * modelo transcribe lo impreso (valor antes del descuento y el descuento) y la resta no se
 * le confía: con el prompt que la pedía, V0552 salió con el valor de lista igual.
 *
 * - b > 0 y a presente, a − b > 0: el campo = a − b. Lo que había devuelto el modelo queda en
 *   `derivado.leido`. Confianza: la menor de las dos fuentes.
 * - b en 0, vacío o ausente: no se toca el valor. Si a está y no coincide con el valor leído,
 *   el campo baja a «Verificar» (sin descuento, el valor y el valor antes de descuento son el
 *   mismo número: V0650 leyó un dígito de más, V0531 le restó el IVA). Si el campo venía de
 *   una resta anterior (una persona corrigió el descuento a 0), vuelve a lo leído.
 * - b > 0 sin a, o a − b ≤ 0: no se toca el valor y baja a «Verificar».
 * - Nunca pisa un campo protegido.
 *
 * `soloDesde`: recalcula solo los campos que dependen de ese slug (corrección a mano de una
 * fuente en `actualizarCampoDocumento`).
 */
export function derivarCampos(
  campos: CampoExtraccion[],
  resultado: Record<string, CampoResultado>,
  soloDesde?: string,
): CambioDerivado[] {
  const cambios: CambioDerivado[] = []
  for (const campo of campos) {
    const resta = campo.derivar?.resta
    if (!resta || resta.length !== 2) continue
    const [sa, sb] = resta
    if (soloDesde && soloDesde !== sa && soloDesde !== sb) continue
    const r = resultado[campo.slug]
    if (campoProtegido(r)) continue
    const a = parseMontoCop(resultado[sa]?.value)
    const b = parseMontoCop(resultado[sb]?.value)
    const actual = r?.value ?? null

    if (b == null || b <= 0) {
      if (r?.derivado) {
        r.value = r.derivado.leido
        if (r.value == null) r.manual = true
        delete r.derivado
        cambios.push({ campo: campo.slug, antes: actual, despues: r.value, motivo: 'restaurado' })
      }
      const leidoN = parseMontoCop(r?.value)
      if (r?.value && a != null && leidoN != null && Math.abs(a - leidoN) > TOLERANCIA_PESOS) {
        bajarConfianza(r)
        cambios.push({ campo: campo.slug, antes: r.value, despues: r.value, motivo: 'sin_descuento_valor_distinto' })
      }
      continue
    }
    if (a == null || a - b <= 0) {
      if (r?.value) bajarConfianza(r)
      cambios.push({ campo: campo.slug, antes: actual, despues: actual, motivo: a == null ? 'sin_valor_antes' : 'resultado_no_positivo' })
      continue
    }
    const nuevo = String(Math.round(a - b))
    const confidence = Math.min(resultado[sa]!.confidence, resultado[sb]!.confidence)
    resultado[campo.slug] = {
      value: nuevo,
      confidence,
      manual: false,
      derivado: { formula: `${sa} - ${sb}`, leido: r?.derivado ? r.derivado.leido : actual },
    }
    if (nuevo !== actual) cambios.push({ campo: campo.slug, antes: actual, despues: nuevo, motivo: 'resta' })
  }
  return cambios
}

export interface AlertaCoherencia {
  campo: string
  valor: string | null
  bases: Record<string, number>
}

/**
 * `coherencia_pct: { de, pct, tolerancia }` (SOE-041): el monto del campo dividido por alguna
 * de las bases presentes de `de` tiene que caer en algún `pct ± tolerancia` (absoluta sobre la
 * proporción, 0.002 por defecto). Dos bases cubren el IVA liquidado sobre el precio de lista
 * con el descuento después (V0126). Si no cuadra con ninguna, el campo y la primera base bajan
 * a «Verificar». Un monto en 0 o vacío con base presente también alerta (V0531).
 *
 * Solo alerta: no recalcula, no borra, no frena (decisión de Mauricio del 2026-08-02 para el
 * cruce de montos). No toca campos protegidos. Sin ninguna base presente no dice nada.
 */
export function revisarCoherenciaPct(
  campos: CampoExtraccion[],
  resultado: Record<string, CampoResultado>,
): AlertaCoherencia[] {
  const alertas: AlertaCoherencia[] = []
  for (const campo of campos) {
    const cfg = campo.coherencia_pct
    if (!cfg || !cfg.de?.length || !cfg.pct?.length) continue
    const tol = cfg.tolerancia ?? 0.002
    const bases: Record<string, number> = {}
    for (const s of cfg.de) {
      const n = parseMontoCop(resultado[s]?.value)
      if (n != null && n > 0) bases[s] = n
    }
    const valoresBase = Object.values(bases)
    if (valoresBase.length === 0) continue
    const r = resultado[campo.slug]
    const monto = parseMontoCop(r?.value)
    const cuadra = monto != null && monto > 0 &&
      valoresBase.some((base) => cfg.pct.some((p) => Math.abs(monto / base - p) <= tol))
    if (cuadra) continue
    if (r?.value && !campoProtegido(r)) bajarConfianza(r)
    const principal = resultado[cfg.de[0]]
    if (principal?.value && !campoProtegido(principal)) bajarConfianza(principal)
    alertas.push({ campo: campo.slug, valor: r?.value ?? null, bases })
  }
  return alertas
}
