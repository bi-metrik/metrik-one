import { describe, expect, it } from 'vitest'
import { esCelularColombiano, esPersonaJuridica, parsearPersonas, serializarPersonas } from './personas'

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

describe('documento con forma de celular', () => {
  it('10 dígitos que empiezan por 3 es un celular; una cédula o un NIT no', () => {
    expect(esCelularColombiano('3173706682')).toBe(true)
    expect(esCelularColombiano('317 370 6682')).toBe(true)
    expect(esCelularColombiano('43495367')).toBe(false)
    expect(esCelularColombiano('1032445129')).toBe(false)
    expect(esCelularColombiano('32747706')).toBe(false) // cédula de 8 dígitos que empieza por 3
    expect(esCelularColombiano('327477061')).toBe(false) // esa cédula con el DV
    expect(esCelularColombiano('31737066821')).toBe(false)
  })

  it('al leer, el celular no cuenta como documento: la persona queda sin él', () => {
    // V0027: la extracción puso el teléfono del comprador en el documento.
    expect(parsearPersonas('MARIA PEREZ (3173706682)')).toEqual([{ nombre: 'MARIA PEREZ', documento: '' }])
    expect(parsearPersonas('Maria Perez 317 370 6682; JUAN GOMEZ (8161174)')).toEqual([
      { nombre: 'Maria Perez', documento: '' },
      { nombre: 'JUAN GOMEZ', documento: '8161174' },
    ])
  })

  it('al guardar tampoco se escribe como documento', () => {
    expect(serializarPersonas([{ nombre: 'MARIA PEREZ', documento: '3173706682' }])).toBe('MARIA PEREZ')
  })
})
