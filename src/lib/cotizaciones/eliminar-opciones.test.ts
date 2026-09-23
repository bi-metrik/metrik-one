/** El aviso al borrar una opción o un bloque (P12 del caso Providencia). */
import { describe, expect, it } from 'vitest'

import { avisoDeBorradoDeBloque, preguntaTarifaMarcada, tarifasMarcadasCon } from './eliminar-opciones'

describe('el aviso al borrar un bloque dice cuántas opciones y cuántas con costo', () => {
  it('ninguna con costo', () => {
    expect(avisoDeBorradoDeBloque([{ conCosto: false }, { conCosto: false }])).toBe('Se borran 2 opciones (ninguna con costo).')
  })
  it('algunas con costo', () => {
    expect(avisoDeBorradoDeBloque([{ conCosto: true }, { conCosto: false }, { conCosto: false }])).toBe('Se borran 3 opciones (1 con costo).')
  })
  it('todas con costo', () => {
    expect(avisoDeBorradoDeBloque([{ conCosto: true }, { conCosto: true }])).toBe('Se borran 2 opciones (las 2 con costo).')
  })
  it('una sola', () => {
    expect(avisoDeBorradoDeBloque([{ conCosto: false }])).toBe('Se borra 1 opción (sin costo).')
    expect(avisoDeBorradoDeBloque([{ conCosto: true }])).toBe('Se borra 1 opción (con costo).')
  })
})

describe('las tarifas marcadas que llevan lo que se borra', () => {
  const tarifas = [
    { nombre: 'Económica', vaEnPropuesta: true, seleccion: ['a', 'x'] },
    { nombre: null, vaEnPropuesta: true, seleccion: ['b'] },
    { nombre: 'Borrador', vaEnPropuesta: false, seleccion: ['a'] },
  ]
  it('solo las marcadas para la propuesta, con su nombre o «Tarifa N»', () => {
    expect(tarifasMarcadasCon(tarifas, ['a'])).toEqual(['Económica'])
    expect(tarifasMarcadasCon(tarifas, ['a', 'b'])).toEqual(['Económica', 'Tarifa 2'])
  })
  it('lo que no está en ninguna marcada se borra sin preguntar', () => {
    expect(tarifasMarcadasCon(tarifas, ['z'])).toEqual([])
  })
  it('la pregunta nombra la tarifa y dice que sale de la propuesta', () => {
    expect(preguntaTarifaMarcada(['Económica'], 'opcion')).toBe(
      'Esta opción está en la tarifa «Económica», que está marcada para la propuesta. Si la borras, esa tarifa sale de la propuesta. ¿Borrar?',
    )
    expect(preguntaTarifaMarcada(['A', 'B'], 'bloque')).toContain('las tarifas «A», «B»')
  })
})
