import { describe, it, expect } from 'vitest'
import { nombreMostrable, nombreParaDuplicado } from './nombre-cotizacion'

describe('nombreMostrable', () => {
  it('devuelve el nombre cuando lo hay', () => {
    expect(nombreMostrable('España, 7 días')).toBe('España, 7 días')
  })

  it('trata el vacío de las DOS formas en que llega', () => {
    // `null` es lo que devuelve la base; `''` es lo que deja un campo que alguien
    // borró. Un `??` solo atrapa el primero, y ese hueco es el que pintaba un
    // nombre en blanco en la lista en vez de la etiqueta genérica.
    expect(nombreMostrable(null)).toBeNull()
    expect(nombreMostrable(undefined)).toBeNull()
    expect(nombreMostrable('')).toBeNull()
    expect(nombreMostrable('   ')).toBeNull()
  })

  it('recorta los espacios de los bordes', () => {
    expect(nombreMostrable('  Portugal, 5 días  ')).toBe('Portugal, 5 días')
  })
})

describe('nombreParaDuplicado', () => {
  it('propone (2) cuando el original es el único con ese nombre', () => {
    expect(nombreParaDuplicado('España, 7 días', ['España, 7 días']))
      .toBe('España, 7 días (2)')
  })

  it('salta al primer número libre cuando el (2) ya está tomado', () => {
    expect(nombreParaDuplicado('España, 7 días', ['España, 7 días', 'España, 7 días (2)']))
      .toBe('España, 7 días (3)')
  })

  it('no deja huecos sin usar: toma el (3) si el (4) existe pero el (3) no', () => {
    expect(nombreParaDuplicado('España, 7 días', ['España, 7 días', 'España, 7 días (2)', 'España, 7 días (4)']))
      .toBe('España, 7 días (3)')
  })

  it('un original SIN nombre deja la copia sin nombre', () => {
    // La regla que más importa: no se inventa una etiqueta donde no había ninguna.
    // Si la copia naciera con un nombre, el negocio pasaría de dos filas mudas a
    // una muda y otra nombrada, que es peor que el problema que se vino a resolver.
    expect(nombreParaDuplicado(null, ['España, 7 días'])).toBeNull()
    expect(nombreParaDuplicado('', ['España, 7 días'])).toBeNull()
    expect(nombreParaDuplicado('   ', [])).toBeNull()
  })

  it('no encadena sufijos: duplicar una copia sigue la cuenta', () => {
    expect(nombreParaDuplicado('España, 7 días (2)', ['España, 7 días', 'España, 7 días (2)']))
      .toBe('España, 7 días (3)')
  })

  it('conserva un paréntesis que es parte del nombre y no un contador', () => {
    // Un año entre paréntesis no es una copia. Sin el tope, el tronco quedaría en
    // "Modelo 500" y la propuesta borraría el 2024, que es información del nombre.
    expect(nombreParaDuplicado('Modelo 500 (2024)', ['Modelo 500 (2024)']))
      .toBe('Modelo 500 (2024) (2)')
  })

  it('un nombre que es SOLO un número entre paréntesis no se queda sin tronco', () => {
    expect(nombreParaDuplicado('(2)', ['(2)'])).toBe('(2) (2)')
  })

  it('la colisión no distingue mayúsculas ni espacios de sobra', () => {
    expect(nombreParaDuplicado('España, 7 días', ['España, 7 días', '  españa,  7 días (2) ']))
      .toBe('España, 7 días (3)')
  })

  it('NO funde nombres que difieren en una tilde', () => {
    // Son dos nombres que una persona escribió distinto. Tratarlos como el mismo
    // produciría un "(2)" sobre una variante que nadie llamó igual.
    expect(nombreParaDuplicado('España', ['España', 'Espana (2)']))
      .toBe('España (2)')
  })

  it('ignora los hermanos sin nombre al buscar hueco', () => {
    expect(nombreParaDuplicado('España', ['España', null, '', '   ']))
      .toBe('España (2)')
  })

  it('propone (2) aunque el original no venga en la lista de hermanos', () => {
    // El resultado tiene que ser distinto del original pase lo que pase, incluso si
    // quien llama acota la consulta y deja al propio original fuera.
    expect(nombreParaDuplicado('España, 7 días', [])).toBe('España, 7 días (2)')
  })

  it('recorta el nombre propuesto', () => {
    expect(nombreParaDuplicado('  España  ', [])).toBe('España (2)')
  })
})
