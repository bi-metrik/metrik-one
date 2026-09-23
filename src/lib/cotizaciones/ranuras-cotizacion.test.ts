import { describe, expect, it } from 'vitest'

import {
  bloquesPorRanura,
  ciudadCorta,
  esNombreDeOpcion,
  formaDesdeGrupo,
  grupoDeRanura,
  nombreAutomaticoDeRanura,
  nombreDeOpcion,
  repartoPorPrecio,
  siguienteNumeroDeOpcion,
  siguienteNumeroDeTipo,
} from './ranuras-cotizacion'

/**
 * La ranura como entidad (B1 del brief de captura del 2026-09-23): se nombra sola, sus
 * opciones son hermanas y las tres tarifas se reparten por precio (paso 4 de Noor).
 */

describe('el nombre de la ranura se arma solo (hallazgo 23)', () => {
  it('tipo y destino: «Hotel en Cancún»', () => {
    expect(nombreAutomaticoDeRanura({ tipo: 'hotel', lugar: 'Cancún' })).toBe('Hotel en Cancún')
  })

  it('un vuelo con origen y destino lleva la ruta; sin origen, «a» destino', () => {
    expect(nombreAutomaticoDeRanura({ tipo: 'vuelo', origen: 'Bogotá (BOG)', destino: 'Cancún CUN' })).toBe('Vuelo Bogotá–Cancún')
    expect(nombreAutomaticoDeRanura({ tipo: 'vuelo', destino: 'cancún' })).toBe('Vuelo a Cancún')
  })

  it('sin lugar queda el tipo a secas: no se inventa un destino', () => {
    expect(nombreAutomaticoDeRanura({ tipo: 'hotel' })).toBe('Hotel')
    expect(nombreAutomaticoDeRanura({ tipo: 'vuelo' })).toBe('Vuelo')
  })

  it('un segundo hotel en la misma ciudad no se llama igual que el primero', () => {
    expect(nombreAutomaticoDeRanura({ tipo: 'hotel', lugar: 'Cancún', numero: 2, nombresEnUso: ['Hotel en Cancún'] }))
      .toBe('Hotel 2 en Cancún')
  })

  it('una caja mezclada se respeta; todo en mayúscula o en minúscula se escribe como nombre propio', () => {
    expect(ciudadCorta('SAN ANDRÉS')).toBe('San Andrés')
    expect(ciudadCorta('punta de mita')).toBe('Punta de Mita')
    expect(ciudadCorta('McAllen')).toBe('McAllen')
  })

  it('la ciudad se recorta al nombre: sin país ni código de aeropuerto', () => {
    expect(ciudadCorta('Cancún, Quintana Roo, México')).toBe('Cancún')
    expect(ciudadCorta('San Andrés Isla (ADZ)')).toBe('San Andrés Isla')
    expect(ciudadCorta('  ')).toBeNull()
  })
})

describe('el grupo sale de la ranura, y la ranura del grupo', () => {
  it('ida y vuelta: el nombre y el ordinal se conservan', () => {
    const grupo = grupoDeRanura({ tipo: 'hotel', numero: 2, nombre: 'Hotel 2 en Cancún' })
    expect(formaDesdeGrupo(grupo)).toEqual({ tipo: 'hotel', numero: 2, nombre: 'Hotel 2 en Cancún' })
  })

  it('un grupo libre que no es ranura del catálogo no es ranura', () => {
    expect(formaDesdeGrupo('avianca bog - adz')).toBeNull()
    expect(formaDesdeGrupo(null)).toBeNull()
  })

  it('el siguiente del tipo: ninguno = el primero; con uno, el 2; con 2 ocupado, el 3', () => {
    expect(siguienteNumeroDeTipo('hotel', [])).toBeNull()
    expect(siguienteNumeroDeTipo('hotel', ['hotel'])).toBe(2)
    expect(siguienteNumeroDeTipo('hotel', ['hotel', grupoDeRanura({ tipo: 'hotel', numero: 2, nombre: null })])).toBe(3)
    // Un vuelo no ocupa el número de un hotel.
    expect(siguienteNumeroDeTipo('vuelo', ['hotel'])).toBeNull()
  })
})

describe('la opción nace con nombre de relleno, nunca con el de la vecina (hallazgo 10)', () => {
  it('«Opción N», reconocible con o sin tilde y en mayúsculas', () => {
    expect(nombreDeOpcion(2)).toBe('Opción 2')
    expect(esNombreDeOpcion('OPCIÓN 2')).toBe(true)
    expect(esNombreDeOpcion('opcion 12')).toBe(true)
    expect(esNombreDeOpcion('RIU PALACE (alternativa)')).toBe(false)
  })

  it('el número siguiente no repite uno que ya se usa como nombre', () => {
    expect(siguienteNumeroDeOpcion(['CROWN'])).toBe(2)
    // Se borró la 2 y quedan «Opción 1» y «Opción 3»: la nueva es la 4, no otra «Opción 3».
    expect(siguienteNumeroDeOpcion(['OPCIÓN 1', 'OPCIÓN 3'])).toBe(4)
  })
})

describe('los bloques de la pantalla (hallazgo 11)', () => {
  it('las opciones de una ranura van juntas, en el orden de la primera; lo suelto va solo', () => {
    const lineas = [
      { id: 'h1', grupo: 'hotel' },
      { id: 'seguro', grupo: null },
      { id: 'v1', grupo: 'vuelo' },
      // El motor agrupa por el grupo sin espacios de sobra (y SÍ distingue mayúsculas): el
      // bloque tiene que decir lo mismo que el total.
      { id: 'h2', grupo: 'hotel ' },
      { id: 'aj', grupo: 'hotel', es_ajuste: true },
    ]
    const b = bloquesPorRanura(lineas)
    expect(b.map(x => [x.grupo, x.lineas.map(l => l.id)])).toEqual([
      ['hotel', ['h1', 'h2']],
      [null, ['seguro']],
      ['vuelo', ['v1']],
    ])
    expect(b[0].tipo).toBe('hotel')
  })

  it('«Hotel» y «hotel» son dos grupos para el motor: la pantalla no los junta', () => {
    const b = bloquesPorRanura([{ id: 'a', grupo: 'hotel' }, { id: 'b', grupo: 'Hotel' }])
    expect(b.filter(x => x.lineas.length === 2)).toEqual([])
  })

  it('un grupo libre no se agrupa: cada línea en su sitio, como hoy (R6)', () => {
    const b = bloquesPorRanura([{ id: 'a', grupo: 'avianca bog - adz' }, { id: 'b', grupo: 'avianca bog - adz' }])
    expect(b.map(x => x.grupo)).toEqual([null, null])
  })
})

describe('las tres tarifas se reparten por precio (paso 4 de Noor)', () => {
  const precios: Record<string, number | null> = { a: 300, b: 100, c: 200, d: 400, sin: null, cero: 0 }
  const precioDe = (id: string) => precios[id] ?? null

  it('tres opciones: barata, media y cara', () => {
    expect(repartoPorPrecio([{ grupo: 'hotel', candidatos: ['a', 'b', 'c'] }], precioDe))
      .toEqual({ Económica: ['b'], Recomendada: ['c'], Premium: ['a'] })
  })

  it('dos opciones: la Recomendada es la más barata de las dos', () => {
    expect(repartoPorPrecio([{ grupo: 'hotel', candidatos: ['a', 'b'] }], precioDe))
      .toEqual({ Económica: ['b'], Recomendada: ['b'], Premium: ['a'] })
  })

  it('cuatro opciones: la del medio se toma hacia abajo', () => {
    expect(repartoPorPrecio([{ grupo: 'hotel', candidatos: ['a', 'b', 'c', 'd'] }], precioDe))
      .toEqual({ Económica: ['b'], Recomendada: ['c'], Premium: ['d'] })
  })

  it('una opción sin precio (todavía sin pantallazo) no entra al reparto', () => {
    expect(repartoPorPrecio([{ grupo: 'hotel', candidatos: ['sin', 'cero', 'a'] }], precioDe))
      .toEqual({ Económica: ['a'], Recomendada: ['a'], Premium: ['a'] })
    // Y una ranura sin ninguna con precio no le da nada a nadie: queda por elegir.
    expect(repartoPorPrecio([{ grupo: 'vuelo', candidatos: ['sin'] }], precioDe))
      .toEqual({ Económica: [], Recomendada: [], Premium: [] })
  })

  it('a igual precio decide el orden de carga, no el azar', () => {
    const iguales = (id: string) => (id === 'x' || id === 'y' ? 500 : null)
    expect(repartoPorPrecio([{ grupo: 'hotel', candidatos: ['y', 'x'] }], iguales).Económica).toEqual(['y'])
  })

  it('cada ranura se reparte por su cuenta', () => {
    const r = repartoPorPrecio([
      { grupo: 'hotel', candidatos: ['a', 'b'] },
      { grupo: 'vuelo', candidatos: ['c', 'd'] },
    ], precioDe)
    expect(r.Económica).toEqual(['b', 'c'])
    expect(r.Premium).toEqual(['a', 'd'])
  })
})
