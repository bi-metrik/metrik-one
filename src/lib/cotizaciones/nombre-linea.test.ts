import { describe, expect, it } from 'vitest'

import { gruposCanonicos } from './ranuras-pantallazo'
import { esNombreDeRelleno, nombreAlConfirmarLectura, nombreDeAlternativa, nombreProvisionalDeGrupo } from './nombre-linea'

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

describe('el nombre provisional de una línea creada con un botón de tipo', () => {
  const LATAM = 'LATAM Bogotá BOG–Orlando MCO'

  it('cada botón nace con la etiqueta de su grupo, y en ESE grupo es relleno', () => {
    for (const g of gruposCanonicos()) {
      const provisional = nombreProvisionalDeGrupo(g.label)
      expect(provisional).toBe(g.label)
      expect(esNombreDeRelleno(provisional, g.label)).toBe(true)
      expect(esNombreDeRelleno(` ${provisional.toUpperCase()} `, g.label)).toBe(true)
    }
  })

  it('sin saber el grupo, o en otro grupo, «Vuelo» sigue siendo de la persona', () => {
    expect(esNombreDeRelleno('Vuelo')).toBe(false)
    expect(esNombreDeRelleno('Vuelo', 'Hotel')).toBe(false)
  })

  it('al confirmar el costo, el nombre leído reemplaza al provisional', () => {
    expect(nombreAlConfirmarLectura({ nombreActual: 'Vuelo', nombreLeido: LATAM, etiquetaRanura: 'Vuelo' })).toBe(LATAM)
    expect(nombreAlConfirmarLectura({ nombreActual: 'Hotel', nombreLeido: 'Hard Rock Punta Cana', etiquetaRanura: 'Hotel' })).toBe('Hard Rock Punta Cana')
  })

  it('un nombre escrito a mano sigue sin tocarse, aunque empiece por la etiqueta', () => {
    expect(nombreAlConfirmarLectura({ nombreActual: 'Vuelo WINGO', nombreLeido: LATAM, etiquetaRanura: 'Vuelo' })).toBeNull()
    expect(nombreAlConfirmarLectura({ nombreActual: 'PRUEBA Vuelo LATAM', nombreLeido: LATAM, etiquetaRanura: 'Vuelo' })).toBeNull()
  })

  it('si la lectura no trajo nombre, el provisional se queda', () => {
    expect(nombreAlConfirmarLectura({ nombreActual: 'Hotel', nombreLeido: 'Hotel', etiquetaRanura: 'Hotel' })).toBeNull()
    expect(nombreAlConfirmarLectura({ nombreActual: 'Hotel', nombreLeido: '', etiquetaRanura: 'Hotel' })).toBeNull()
  })
})
