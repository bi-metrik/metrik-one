/**
 * El modo `direccion`, con los patrones que se midieron comparando el certificado UPME
 * contra el RUT en los casos abiertos de SOENA el 2026-09-28. Las direcciones son
 * inventadas: reproducen la forma de cada diferencia real, no los datos del cliente.
 */
import { describe, expect, it } from 'vitest'
import { coinciden } from './comparar-valores'
import { leerCruces } from './cruces'
import { direccionesCoinciden, leerDireccion } from './direccion-predio'

describe('leerDireccion', () => {
  it('separa placa, tipo de vía y unidades, y deja fuera barrio y edificio', () => {
    expect(leerDireccion('BRR LOS ALPES ED TORRES DEL MAR AP 804 CR 3 8 115')).toEqual({
      placa: ['3', '8', '115'],
      via: 'kr',
      unidades: { ap: ['804'] },
      palabras: ['alpes', 'torres', 'mar'],
    })
  })

  it('pega la letra al número y quita ceros a la izquierda', () => {
    expect(leerDireccion('CR 31 52 A 07').placa).toEqual(['31', '52a', '7'])
  })

  it('una letra sola después de la unidad es su nombre (torre A)', () => {
    expect(leerDireccion('CL 20 N 5 C 40 AP 902 TO A').unidades).toEqual({ ap: ['902'], to: ['a'] })
  })
})

describe('coinciden en modo direccion', () => {
  const MISMA: Array<[string, string]> = [
    // Abreviaturas, signos y rellenos.
    ['CALLE 12 A # 34 B 56 IN 2 AP 301', 'CL 12 A # 34 B - 56 IN 2 AP 301'],
    ['CLL 20 N 5 C 40 AP 902 TO A', 'CL 20 N 5 C 40 AP 902 TO A'],
    ['calle 18c N° 40- 22', 'CL 18 C 40 22 BRR LAS FLORES'],
    ['Calle 50 numero 12-30 Barrio el Prado', 'CL 50 12 30 BRR PRADO'],
    ['CL 9 SUR 25 60 INT 3 AP 204', 'CL 9 SUR 25 60 IN 3 AP 204'],
    ['AV CLL 26 70 15 AP 110 BL 2', 'AV CL 26 70 15 AP 110 BL 2'],
    ['CR 14 33A 21 APTO 605', 'CR 14 33 A 21 AP 605 ED MIRADOR ΟΙ'],
    // El tipo de vía mal escrito no impide leer la placa.
    ['Trasnvsersal. 45 N. 8 B 12', 'TV 45 8 B 12'],
    // «Calle» suelta seguida de la vía de verdad.
    ['CALLE cra 7 # 98 - 14', 'CR 7 98 14 AP 402'],
    // Un lado sin apartamento o sin torre no contradice al otro.
    ['Calle 100 No 9-15', 'CL 100 9 15 AP 201 TO 3'],
    // Letras griegas y cirílicas de la lectura del PDF.
    ['CL 140 B 20 30 ΤΟ 2 AP 704', 'CL 140 B 20 30 TO 2 AP 704'],
    ['CL 80 11 05 ΤΟ 1 ΑΡ 502 BRR SAN LUIS', 'CL 80 11 05 TO 1 AP 502 BRR SAN LUIS'],
    ['CIR 4 70 B 120', 'CIR 4 70 В 120'],
    // El barrio que un lado trae y el otro no.
    ['Calle 3 # 10 - 45', 'CL 3 10 45 BRR SANTA ANA'],
    // Rural, sin placa: las mismas palabras con otras abreviaturas.
    ['FCA EL LAUREL VDA ALTAMIRA', 'FINCA EL LAUREL VEREDA ALTAMIRA'],
  ]
  it.each(MISMA)('«%s» = «%s»', (a, b) => {
    expect(coinciden(a, b, 'direccion')).toBe(true)
    expect(coinciden(b, a, 'direccion')).toBe(true)
  })

  const OTRA: Array<[string, string]> = [
    // Dígitos transpuestos, cambiados o de más en la placa.
    ['CL 142 C 10 A 20', 'CL 124 C 10 A 20'],
    ['CR 60 A 5 A 30 IN 1 AP 808', 'CR 60 A # 3A 30 IN 1 AP 808'],
    ['CL 12 30 40 CA 5', 'CL 12 30 00 CA 5'],
    ['CL 6 70 D 150 AP 1201', 'CL 70 D 150 AP 1201'],
    // Otro apartamento en el mismo edificio.
    ['CR 30 60 10 AP 201', 'CR 30 60 10 AP 202'],
    // Calle y carrera con los mismos números no son el mismo predio.
    ['CL 45 12 30', 'KR 45 12 30'],
    // Otra dirección entera, o una rural contra una urbana.
    ['Cra 20 #50-10 casa 4', 'CL 33 21 40 AP 1101'],
    ['FCA EL LAUREL VDA ALTAMIRA', 'CRA 150 # 60-20 APTO 301'],
    ['FCA EL LAUREL VDA ALTAMIRA', 'FCA LA ESPERANZA VDA ALTAMIRA'],
  ]
  it.each(OTRA)('«%s» ≠ «%s»', (a, b) => {
    expect(coinciden(a, b, 'direccion')).toBe(false)
    expect(coinciden(b, a, 'direccion')).toBe(false)
  })

  it('avenida sola no contradice a la calle o carrera', () => {
    expect(direccionesCoinciden('AV 68 12 30', 'AK 68 12 30')).toBe(true)
  })

  it('falta un lado: no coinciden (quien llama decide que calla)', () => {
    expect(direccionesCoinciden('', 'CL 1 2 3')).toBe(false)
    expect(direccionesCoinciden('CL 1 2 3', null)).toBe(false)
    expect(direccionesCoinciden('', '')).toBe(false)
  })
})

describe('cruce con modo direccion', () => {
  it('la línea lo acepta (el código viejo lo descartaba: la migración es inerte sin este PR)', () => {
    const cruce = {
      slug: 'certificado_direccion_titular',
      tipo: 'coincide',
      mensaje: '«{a_valor}» / «{b_valor}»',
      a: { source_bloque_slug: 'concepto_upme', field: 'direccion_certificado' },
      b: [{ source_bloque_slug: 'rut', field: 'direccion' }],
      modo: 'direccion',
    }
    expect(leerCruces({ cruces: [cruce] }).map(c => c.slug)).toEqual(['certificado_direccion_titular'])
  })
})
