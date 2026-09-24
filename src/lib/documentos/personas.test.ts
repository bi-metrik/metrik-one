import { describe, expect, it } from 'vitest'
import { parsearPersonas, serializarPersonas } from './personas'

describe('serializarPersonas', () => {
  it('arma la forma canónica NOMBRE (documento); NOMBRE (documento)', () => {
    expect(serializarPersonas([
      { nombre: 'LADY MARLENE ALVARADO BARRUETO', documento: '1.032.426.193' },
      { nombre: 'DIEGO ANDRES  RODRIGUEZ ACEVEDO', documento: '80798054' },
    ])).toBe('LADY MARLENE ALVARADO BARRUETO (1032426193); DIEGO ANDRES RODRIGUEZ ACEVEDO (80798054)')
  })

  it('sin documento deja solo el nombre, y descarta entradas vacías', () => {
    expect(serializarPersonas([{ nombre: 'ANA' }, { nombre: '', documento: '' }, null])).toBe('ANA')
    expect(serializarPersonas([])).toBe('')
  })
})

describe('parsearPersonas', () => {
  it('lee de vuelta lo que serializa', () => {
    const texto = serializarPersonas([
      { nombre: 'LOPEZ VELEZ DIANA PATRICIA', documento: '43201715' },
      { nombre: 'URIBE ESTRADA JUAN FELIPE', documento: '8163544' },
    ])
    expect(parsearPersonas(texto)).toEqual([
      { nombre: 'LOPEZ VELEZ DIANA PATRICIA', documento: '43201715' },
      { nombre: 'URIBE ESTRADA JUAN FELIPE', documento: '8163544' },
    ])
  })

  it('tolera lo que escribe una persona al corregir: saltos de línea y documento al final', () => {
    expect(parsearPersonas('Ana Moreno 1.083.566.465\nFelipe Acosta - 10300471')).toEqual([
      { nombre: 'Ana Moreno', documento: '1083566465' },
      { nombre: 'Felipe Acosta', documento: '10300471' },
    ])
  })

  it('vacío o nulo no es una persona', () => {
    expect(parsearPersonas('')).toEqual([])
    expect(parsearPersonas(null)).toEqual([])
    expect(parsearPersonas(' ; ')).toEqual([])
  })
})
