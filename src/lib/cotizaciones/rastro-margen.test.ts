import { describe, it, expect } from 'vitest'
import { rastroDeCambioDeMargen, MAX_CONTENIDO_ACTIVIDAD, type ItemParaRastro } from './rastro-margen'

const base: ItemParaRastro = {
  nombre: 'Aéreo Bogotá-Miami',
  margenAnterior: 15,
  negocioId: 'neg-1',
  oportunidadId: 'opo-1',
}

describe('rastroDeCambioDeMargen', () => {
  it('anota el cambio con el valor anterior y el nuevo', () => {
    const r = rastroDeCambioDeMargen(base, 8)
    expect(r).not.toBeNull()
    expect(r!.valorAnterior).toBe('15')
    expect(r!.valorNuevo).toBe('8')
    expect(r!.contenido).toBe('Margen de "Aéreo Bogotá-Miami": 15% → 8%')
  })

  it('calla cuando el margen no cambió: guardar el mismo número no es una decisión', () => {
    expect(rastroDeCambioDeMargen(base, 15)).toBeNull()
  })

  it('anota cuando el ítem pasa de no tener margen a tenerlo', () => {
    const r = rastroDeCambioDeMargen({ ...base, margenAnterior: null }, 15)
    expect(r!.valorAnterior).toBeNull()
    expect(r!.contenido).toContain('sin margen → 15%')
  })

  it('distingue "sin margen" de un margen de 0', () => {
    const desdeCero = rastroDeCambioDeMargen({ ...base, margenAnterior: 0 }, 15)
    expect(desdeCero!.valorAnterior).toBe('0')
    expect(desdeCero!.contenido).toContain('0% → 15%')
  })

  it('un margen que baja a 0 sí se anota', () => {
    const r = rastroDeCambioDeMargen(base, 0)
    expect(r).not.toBeNull()
    expect(r!.valorNuevo).toBe('0')
  })

  it('cuelga del negocio cuando la cotización tiene uno', () => {
    const r = rastroDeCambioDeMargen(base, 20)
    expect(r!.entidadTipo).toBe('negocio')
    expect(r!.entidadId).toBe('neg-1')
  })

  it('cuelga de la oportunidad cuando no hay negocio', () => {
    const r = rastroDeCambioDeMargen({ ...base, negocioId: null }, 20)
    expect(r!.entidadTipo).toBe('oportunidad')
    expect(r!.entidadId).toBe('opo-1')
  })

  it('calla cuando no hay dónde colgarlo: entidad_id no admite nulo', () => {
    expect(rastroDeCambioDeMargen({ ...base, negocioId: null, oportunidadId: null }, 20)).toBeNull()
  })

  it('calla ante un valor que no es número', () => {
    expect(rastroDeCambioDeMargen(base, Number.NaN)).toBeNull()
    expect(rastroDeCambioDeMargen(base, Infinity)).toBeNull()
  })

  it('un ítem sin nombre no produce un texto roto', () => {
    expect(rastroDeCambioDeMargen({ ...base, nombre: null }, 20)!.contenido)
      .toContain('"ítem sin nombre"')
    expect(rastroDeCambioDeMargen({ ...base, nombre: '   ' }, 20)!.contenido)
      .toContain('"ítem sin nombre"')
  })

  it('respeta el CHECK de 280 caracteres de activity_log.contenido', () => {
    const r = rastroDeCambioDeMargen({ ...base, nombre: 'x'.repeat(500) }, 20)
    expect(r!.contenido.length).toBe(MAX_CONTENIDO_ACTIVIDAD)
  })

  it('un margen negativo se anota: vender bajo costo es justo lo que hay que ver', () => {
    const r = rastroDeCambioDeMargen(base, -5)
    expect(r!.valorNuevo).toBe('-5')
  })
})
