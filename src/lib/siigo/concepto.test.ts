import { describe, it, expect } from 'vitest'
import { conceptoFactura, esServicioContratado } from './concepto'

// Mapeo con la forma que tendrá SOENA. Los códigos son los del catálogo real
// de Siigo, pero cuál va en cada concepto lo confirma la financiera: aquí solo
// se prueba el mecanismo.
const CONCEPTOS = { completo: '11', solo_iva: '11', solo_upme: '22', default: '11' }
const BASE = '22' // siigo_config.productoCode de hoy

describe('esServicioContratado', () => {
  it('acepta los tres del catálogo y rechaza lo demás', () => {
    expect(esServicioContratado('completo')).toBe(true)
    expect(esServicioContratado('solo_upme')).toBe(true)
    expect(esServicioContratado('solo_iva')).toBe(true)
    expect(esServicioContratado('')).toBe(false)
    expect(esServicioContratado(null)).toBe(false)
    expect(esServicioContratado('SOLO_IVA')).toBe(false)
  })
})

describe('conceptoFactura', () => {
  it('completo y solo IVA comparten concepto, que es la regla de Diana', () => {
    const a = conceptoFactura('completo', CONCEPTOS, BASE)
    const b = conceptoFactura('solo_iva', CONCEPTOS, BASE)
    expect(a.code).toBe(b.code)
    expect(a.porDefecto).toBe(false)
  })

  it('solo certificación UPME lleva concepto propio', () => {
    expect(conceptoFactura('solo_upme', CONCEPTOS, BASE).code).toBe('22')
  })

  it('un caso sin servicio declarado cae al default y queda MARCADO', () => {
    const r = conceptoFactura(null, CONCEPTOS, BASE)
    expect(r.code).toBe('11')
    expect(r.servicio).toBeNull()
    expect(r.porDefecto).toBe(true)
  })

  it('un servicio declarado SIN concepto configurado cae al default, marcado', () => {
    // Hueco de configuración: la línea declaró conceptos pero se le olvidó uno.
    const r = conceptoFactura('solo_upme', { completo: '11', default: '11' }, BASE)
    expect(r.code).toBe('11')
    expect(r.servicio).toBe('solo_upme')
    expect(r.porDefecto).toBe(true)
  })

  it('⚠️ una línea SIN conceptos configurados factura exactamente como hoy', () => {
    // Es la garantía de que ningún workspace ajeno cambia de comportamiento.
    for (const s of ['completo', 'solo_iva', 'solo_upme', null, 'basura']) {
      const r = conceptoFactura(s, undefined, BASE)
      expect(r.code, String(s)).toBe(BASE)
      expect(r.porDefecto).toBe(true)
    }
  })

  it('sin conceptos y sin default, el respaldo es el producto base', () => {
    expect(conceptoFactura('completo', {}, BASE).code).toBe(BASE)
  })
})
