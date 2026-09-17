import { describe, expect, it } from 'vitest'

import { bloqueDeclaraComposicionViaje, lineaCotizaPorTipo } from './lineas-por-tipo'

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

describe('qué BLOQUE captura quiénes viajan', () => {
  it('el de condiciones del viaje sí; el de al lado no', () => {
    expect(bloqueDeclaraComposicionViaje([{ slug: 'destino' }, { slug: 'adultos' }])).toBe(true)
    expect(bloqueDeclaraComposicionViaje([{ slug: 'proveedor_prerreserva' }])).toBe(false)
  })

  it('es EL MISMO criterio que usa la línea, no una segunda lista', () => {
    // Si se separaran, el bloque escribiría en mayúscula donde la cotización no ofrece
    // líneas por tipo (o al revés), y el caso se leería a medias.
    const bloque = [{ slug: 'ninos' }]
    expect(bloqueDeclaraComposicionViaje(bloque)).toBe(lineaCotizaPorTipo([bloque]))
  })

  it('ausente o mal formado no enciende nada ni revienta', () => {
    expect(bloqueDeclaraComposicionViaje(undefined)).toBe(false)
    expect(bloqueDeclaraComposicionViaje(null)).toBe(false)
    expect(bloqueDeclaraComposicionViaje('adultos')).toBe(false)
    expect(bloqueDeclaraComposicionViaje([null, { slug: 3 }])).toBe(false)
  })
})
