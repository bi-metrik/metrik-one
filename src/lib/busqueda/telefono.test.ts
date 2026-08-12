import { describe, it, expect } from 'vitest'
import { soloDigitos, numeroNacional, esTerminoTelefonico, telefonoCoincide } from './telefono'

// Los formatos de este archivo NO son inventados: salen de contar los 576
// contactos con teléfono de SOENA el 2026-08-12.
const GUARDADOS_REALES = [
  '+573127226316',      // con indicativo, pegado (393 casos)
  '+57 (312) 7226316',  // con indicativo y separadores (175 casos)
  '312 7226316',        // nacional con espacio
  '3127226316',         // dígitos pelados (43 casos)
]

describe('soloDigitos', () => {
  it('retira todo lo que no sea dígito', () => {
    expect(soloDigitos('+57 (312) 722-6316')).toBe('573127226316')
  })
})

describe('numeroNacional', () => {
  it('recorta el indicativo venga como venga', () => {
    expect(numeroNacional('+573127226316')).toBe('3127226316')
    expect(numeroNacional('+57 (312) 7226316')).toBe('3127226316')
    expect(numeroNacional('573127226316')).toBe('3127226316')
    expect(numeroNacional('3127226316')).toBe('3127226316')
  })

  it('deja intacto lo más corto que 10 dígitos (fijo, extensión)', () => {
    expect(numeroNacional('6013456')).toBe('6013456')
  })
})

describe('esTerminoTelefonico', () => {
  it('exige al menos 3 dígitos, para no listar media base con "31"', () => {
    expect(esTerminoTelefonico('31')).toBe(false)
    expect(esTerminoTelefonico('312')).toBe(true)
  })

  it('un término sin dígitos no es teléfono', () => {
    expect(esTerminoTelefonico('nidia')).toBe(false)
    expect(esTerminoTelefonico('')).toBe(false)
  })
})

describe('telefonoCoincide', () => {
  it('encuentra el mismo número escrito de las cuatro formas que existen en la base', () => {
    for (const guardado of GUARDADOS_REALES) {
      expect(telefonoCoincide(guardado, '3127226316'), guardado).toBe(true)
    }
  })

  it('encuentra aunque quien busca teclee el indicativo y el dato no lo tenga', () => {
    expect(telefonoCoincide('3127226316', '+57 312 722 6316')).toBe(true)
  })

  it('encuentra por un pedazo, que es como se busca en la práctica', () => {
    expect(telefonoCoincide('+57 315 950 9103', '3159509')).toBe(true)
    expect(telefonoCoincide('+57 315 950 9103', '9103')).toBe(true)
  })

  it('tolera separadores en lo tecleado', () => {
    expect(telefonoCoincide('+573127226316', '312-722-6316')).toBe(true)
  })

  it('no coincide con otro número', () => {
    expect(telefonoCoincide('+573127226316', '3009998877')).toBe(false)
  })

  it('un contacto sin teléfono nunca coincide', () => {
    expect(telefonoCoincide(null, '3127226316')).toBe(false)
    expect(telefonoCoincide('', '3127226316')).toBe(false)
  })

  it('un término demasiado corto no arrastra a toda la lista', () => {
    expect(telefonoCoincide('+573127226316', '31')).toBe(false)
  })
})
