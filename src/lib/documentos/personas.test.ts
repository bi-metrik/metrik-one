import { describe, expect, it } from 'vitest'
import { esPersonaJuridica, parsearPersonas, serializarPersonas } from './personas'

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

describe('esPersonaJuridica', () => {
  it('NIT de sociedad (9 dígitos, o 10 con DV, empezando por 8 o 9) o sigla societaria', () => {
    expect(esPersonaJuridica({ nombre: 'INNVENTOR ELECTRONICS SAS', documento: '901045219' })).toBe(true)
    expect(esPersonaJuridica({ nombre: 'X', documento: '9010452190' })).toBe(true)
    expect(esPersonaJuridica({ nombre: 'BANCO DE BOGOTA', documento: '860002964' })).toBe(true)
    expect(esPersonaJuridica({ nombre: 'Motores y Máquinas S.A.' })).toBe(true)
    expect(esPersonaJuridica({ nombre: 'AUTOGERMANA S A S' })).toBe(true)
    expect(esPersonaJuridica({ nombre: 'Comercial Ltda.' })).toBe(true)
  })

  it('una persona natural no es jurídica, aunque su cédula sea larga', () => {
    expect(esPersonaJuridica({ nombre: 'ELMY LUCELLY ESCOBAR JIMENEZ', documento: '31965359' })).toBe(false)
    expect(esPersonaJuridica({ nombre: 'CASTELLANOS SALAMANCA MIGUEL ANGEL', documento: '1014267473' })).toBe(false)
    expect(esPersonaJuridica({ nombre: 'ANA SAAVEDRA', documento: '52022753' })).toBe(false)
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
