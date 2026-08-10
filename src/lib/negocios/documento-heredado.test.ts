import { describe, it, expect } from 'vitest'
import { documentoHeredadoNaceCompleto } from './bloque-visible-completo'

/**
 * Lo que destapó esta regla: al mover el bloque de factura en SOENA (2026-08-10),
 * 754 instancias de "Factura emitida" nacieron marcadas como completas sin que
 * existiera ninguna factura. La pantalla afirmaba que el documento estaba.
 */
describe('documentoHeredadoNaceCompleto', () => {
  it('un documento heredado con el origen VACÍO no nace completo', () => {
    expect(documentoHeredadoNaceCompleto(true, true, false)).toBe(false)
  })

  it('un documento heredado cuyo origen SÍ tiene archivo nace completo', () => {
    // Los 69 casos de Certificado UPME, Factura Venta Vehículo y RUT: se ven bien
    // hoy y marcarlos pendientes sería ruido sin motivo.
    expect(documentoHeredadoNaceCompleto(true, true, true)).toBe(true)
  })

  it('el bloque ORIGEN de un documento no le aplica: no hereda de nadie', () => {
    expect(documentoHeredadoNaceCompleto(true, false, false)).toBe(true)
  })

  it('un bloque que no es documento no cambia de comportamiento', () => {
    // La regla ancha (todo bloque visible con campos vacíos) ya se descartó por
    // ruidosa; esta toca solo documentos.
    expect(documentoHeredadoNaceCompleto(false, true, false)).toBe(true)
  })
})
