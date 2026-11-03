import { describe, expect, it } from 'vitest'

import { campoModalidadDesdeFilas, dataConModalidad, esValorModalidad, ofreceMarcarBloqueo, valorDeModalidad, type FilaConConfig } from './modalidad-campo'

const conCampo = (id: string, data: Record<string, unknown>, tipo = 'datos'): FilaConConfig => ({
  id,
  data,
  bloque_configs: { config_extra: { fields: [{ slug: 'destino' }, { slug: 'modalidad_viaje', tipo: 'select' }] }, bloque_definitions: { tipo } },
})
const sinCampo = (id: string): FilaConConfig => ({ id, data: {}, bloque_configs: { config_extra: { fields: [{ slug: 'destino' }] }, bloque_definitions: { tipo: 'datos' } } })

describe('el campo «Modalidad» del negocio', () => {
  it('lo encuentra en el bloque de datos que lo declara, con su valor', () => {
    const c = campoModalidadDesdeFilas([sinCampo('a'), conCampo('b', { destino: 'SAN ANDRÉS', modalidad_viaje: '' })])
    expect(c).toEqual({ negocioBloqueId: 'b', data: { destino: 'SAN ANDRÉS', modalidad_viaje: '' }, valor: '' })
  })

  it('sin el campo declarado (otro workspace), no hay modalidad', () => {
    expect(campoModalidadDesdeFilas([sinCampo('a')])).toBeNull()
    // Un bloque que no es de datos no cuenta aunque traiga la clave.
    expect(campoModalidadDesdeFilas([conCampo('a', {}, 'documento')])).toBeNull()
  })

  it('normaliza el valor: la etiqueta escrita a mano cuenta', () => {
    expect(valorDeModalidad('bloqueo')).toBe('bloqueo')
    expect(valorDeModalidad('Bloqueo')).toBe('bloqueo')
    expect(valorDeModalidad('a_medida')).toBe('a_medida')
    expect(valorDeModalidad('')).toBe('')
    expect(valorDeModalidad(null)).toBe('')
  })

  it('la data nueva solo cambia la modalidad', () => {
    const antes = { destino: 'SAN ANDRÉS', adultos: 3, modalidad_viaje: '', _sugeridos: { destino: {} } }
    expect(dataConModalidad(antes, 'bloqueo')).toEqual({ ...antes, modalidad_viaje: 'bloqueo' })
    expect(antes.modalidad_viaje).toBe('')
  })

  it('solo acepta los dos valores', () => {
    expect(esValorModalidad('bloqueo')).toBe(true)
    expect(esValorModalidad('a_medida')).toBe(true)
    expect(esValorModalidad('Bloqueo')).toBe(false)
    expect(esValorModalidad('playa')).toBe(false)
  })

  it('el botón sale solo con el campo, la cotización editable y por pasos', () => {
    expect(ofreceMarcarBloqueo({ campoDisponible: true, editable: true, porPasos: true })).toBe(true)
    expect(ofreceMarcarBloqueo({ campoDisponible: false, editable: true, porPasos: true })).toBe(false)
    expect(ofreceMarcarBloqueo({ campoDisponible: true, editable: false, porPasos: true })).toBe(false)
    expect(ofreceMarcarBloqueo({ campoDisponible: true, editable: true, porPasos: false })).toBe(false)
  })
})
