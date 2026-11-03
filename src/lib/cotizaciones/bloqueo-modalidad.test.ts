import { describe, expect, it } from 'vitest'

import { leerModalidadDelViaje, modalidadDesdeFilas } from './bloqueo-modalidad'

describe('modalidad del viaje', () => {
  it('sin el campo, o vacío, es A medida', () => {
    expect(modalidadDesdeFilas([])).toEqual({ bloqueo: false, operador: null })
    expect(modalidadDesdeFilas([{ modalidad_viaje: '' }, { modalidad_viaje: null }])).toEqual({ bloqueo: false, operador: null })
  })
  it('A medida con operador escrito no es bloqueo', () => {
    expect(modalidadDesdeFilas([{ modalidad_viaje: 'a_medida', operador_bloqueo: 'Aliados' }])).toEqual({ bloqueo: false, operador: null })
  })
  it('Bloqueo con su operador, aunque vengan en filas distintas', () => {
    expect(modalidadDesdeFilas([{ modalidad_viaje: 'bloqueo' }, { operador_bloqueo: '  Tu Reserva ' }])).toEqual({ bloqueo: true, operador: 'Tu Reserva' })
    expect(modalidadDesdeFilas([{ modalidad_viaje: 'Bloqueo' }])).toEqual({ bloqueo: true, operador: null })
  })
  it('la lectura devuelve el error, no lo convierte en A medida en silencio', async () => {
    const sb = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: '42501' } }) }) }) }
    expect(await leerModalidadDelViaje(sb, 'n-1')).toEqual({ modalidad: { bloqueo: false, operador: null }, error: '42501' })
    const ok = { from: () => ({ select: () => ({ eq: async () => ({ data: [{ modalidad_viaje: 'bloqueo', operador_bloqueo: 'Aliados Travel' }], error: null }) }) }) }
    expect(await leerModalidadDelViaje(ok, 'n-1')).toEqual({ modalidad: { bloqueo: true, operador: 'Aliados Travel' }, error: null })
  })
})
