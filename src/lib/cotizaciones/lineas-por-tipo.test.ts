import { describe, expect, it } from 'vitest'

import { lineaCotizaPorTipo } from './lineas-por-tipo'

describe('qué línea de negocio cotiza por tipo de línea', () => {
  it('la línea de viaje: un bloque declara la composición (forma real de Trappvel)', () => {
    const condicionesDelViaje = [
      { slug: 'destino' }, { slug: 'fecha_salida' }, { slug: 'adultos' },
      { slug: 'ninos' }, { slug: 'infantes' }, { slug: 'requisitos_especiales' },
    ]
    expect(lineaCotizaPorTipo([null, [{ slug: 'nombre' }], condicionesDelViaje])).toBe(true)
  })

  it('basta con uno de los tres campos', () => {
    expect(lineaCotizaPorTipo([[{ slug: 'infantes' }]])).toBe(true)
  })

  it('una línea sin esos campos ve lo de hoy', () => {
    expect(lineaCotizaPorTipo([[{ slug: 'servicio' }, { slug: 'numero_pasajeros' }], [{ slug: 'fecha_cita_dian' }]])).toBe(false)
    expect(lineaCotizaPorTipo([])).toBe(false)
  })

  it('una configuración con forma inesperada no enciende nada ni revienta', () => {
    expect(lineaCotizaPorTipo([undefined, null, 'adultos', { slug: 'adultos' }, [null, 'adultos', { slug: 3 }]])).toBe(false)
  })
})
