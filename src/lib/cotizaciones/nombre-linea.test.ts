import { describe, expect, it } from 'vitest'

import { esNombreDeRelleno, nombreAlConfirmarLectura, nombreDeAlternativa } from './nombre-linea'

describe('qué nombre de línea es un relleno', () => {
  it('vacío, espacios o nulo', () => {
    expect(esNombreDeRelleno(null)).toBe(true)
    expect(esNombreDeRelleno(undefined)).toBe(true)
    expect(esNombreDeRelleno('')).toBe(true)
    expect(esNombreDeRelleno('   ')).toBe(true)
  })

  it('el «Item sin nombre» que pinta el editor', () => {
    expect(esNombreDeRelleno('Item sin nombre')).toBe(true)
    expect(esNombreDeRelleno('  item   sin nombre ')).toBe(true)
  })

  it('el nombre con que nace una alternativa: se reconoce el mismo que se genera', () => {
    expect(nombreDeAlternativa('PRUEBA Vuelo LATAM')).toBe('PRUEBA Vuelo LATAM (alternativa)')
    expect(nombreDeAlternativa(null)).toBe('Opción (alternativa)')
    expect(esNombreDeRelleno(nombreDeAlternativa('PRUEBA Vuelo LATAM'))).toBe(true)
    expect(esNombreDeRelleno(nombreDeAlternativa(null))).toBe(true)
  })

  it('lo que escribió una persona no es relleno, aunque sea genérico', () => {
    expect(esNombreDeRelleno('PRUEBA Vuelo LATAM')).toBe(false)
    expect(esNombreDeRelleno('Vuelo')).toBe(false)
    expect(esNombreDeRelleno('WINGO')).toBe(false)
  })
})

describe('el nombre al confirmar el costo leído', () => {
  const LATAM = 'LATAM Bogotá BOG–Orlando MCO'

  it('caso real: la línea con nombre propio no se toca', () => {
    expect(nombreAlConfirmarLectura({ nombreActual: 'PRUEBA Vuelo LATAM', nombreLeido: LATAM, etiquetaRanura: 'Vuelo' })).toBeNull()
  })

  it('la línea sin nombre propio toma el leído', () => {
    expect(nombreAlConfirmarLectura({ nombreActual: '', nombreLeido: LATAM, etiquetaRanura: 'Vuelo' })).toBe(LATAM)
    expect(nombreAlConfirmarLectura({ nombreActual: 'X (alternativa)', nombreLeido: ` ${LATAM} `, etiquetaRanura: 'Vuelo' })).toBe(LATAM)
  })

  it('si la lectura no trajo nombre (vacío o la etiqueta de la ranura), nada', () => {
    expect(nombreAlConfirmarLectura({ nombreActual: '', nombreLeido: 'Hotel', etiquetaRanura: 'Hotel' })).toBeNull()
    expect(nombreAlConfirmarLectura({ nombreActual: '', nombreLeido: '', etiquetaRanura: 'Hotel' })).toBeNull()
    expect(nombreAlConfirmarLectura({ nombreActual: null, nombreLeido: null, etiquetaRanura: 'Hotel' })).toBeNull()
  })
})
