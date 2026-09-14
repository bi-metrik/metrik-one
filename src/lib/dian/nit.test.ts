import { describe, it, expect } from 'vitest'
import {
  calcularDvNit,
  separarNitDv,
  nitSinDv,
  nitConGuion,
  nitTraeDvDeLaIdentificacion,
  diagnosticarNitDv,
} from './nit'

/**
 * Los pares NIT-DV de `NITS_PUBLICOS` NO salen de este código: son NIT de
 * empresas colombianas con su dígito de verificación tal como lo imprimen sus
 * facturas y registros públicos. Comprobar el algoritmo contra su propia salida
 * no comprueba nada; contra DV emitidos por la DIAN, sí.
 */
const NITS_PUBLICOS: Array<[base: string, dv: string, quien: string]> = [
  ['800197268', '4', 'DIAN'],
  ['890903938', '8', 'Bancolombia'],
  ['899999068', '1', 'Ecopetrol'],
  ['890904996', '1', 'EPM'],
  ['890900608', '9', 'Almacenes Éxito'],
  ['890100577', '6', 'Avianca'],
  ['860005224', '6', 'Bavaria'],
  ['860002964', '4', 'Banco de Bogotá'],
  ['800153993', '7', 'Comcel / Claro'],
  ['860034313', '7', 'Davivienda'],
  ['830095213', '0', 'Terpel'],
  ['890100251', '0', 'Cementos Argos'],
  ['860016610', '3', 'ISA'],
]

describe('calcularDvNit', () => {
  it.each(NITS_PUBLICOS)('%s-%s (%s)', (base, dv) => {
    expect(calcularDvNit(base)).toBe(dv)
  })

  it('ignora puntos, guiones y espacios', () => {
    expect(calcularDvNit('890.903.938')).toBe('8')
    expect(calcularDvNit(' 890 903 938 ')).toBe('8')
  })

  it('devuelve null cuando no hay base utilizable', () => {
    expect(calcularDvNit('')).toBeNull()
    expect(calcularDvNit(null)).toBeNull()
    expect(calcularDvNit(undefined)).toBeNull()
    expect(calcularDvNit('abc')).toBeNull()
    // más de 15 dígitos: excede los pesos del algoritmo DIAN
    expect(calcularDvNit('1234567890123456')).toBeNull()
  })
})

describe('separarNitDv / nitSinDv — el caso para el que existen', () => {
  it('separa el DV que la extracción de la Factura trae pegado', () => {
    expect(separarNitDv('8600190638')).toEqual({ base: '860019063', dv: '8' })
    expect(nitSinDv('8600190638')).toBe('860019063')
    expect(nitConGuion('8600190638')).toBe('860019063-8')
  })

  it('deja intacto el NIT que ya viene limpio, y le calcula el DV', () => {
    expect(separarNitDv('899999068')).toEqual({ base: '899999068', dv: '1' })
    expect(nitSinDv('899999068')).toBe('899999068')
    expect(nitConGuion('899999068')).toBe('899999068-1')
  })

  it('no duplica el DV cuando el valor ya viene con guion', () => {
    expect(nitConGuion('860019063-8')).toBe('860019063-8')
  })

  it('devuelve null / el valor original cuando no hay dígitos', () => {
    expect(separarNitDv('')).toBeNull()
    expect(separarNitDv(null)).toBeNull()
    expect(nitSinDv(null)).toBeNull()
    expect(nitSinDv('sin datos')).toBe('sin datos')
  })
})

/**
 * La trampa, fijada a propósito.
 *
 * `separarNitDv` no LEE si el valor trae DV: lo ADIVINA, viendo si el último
 * dígito resulta ser el DV válido de los anteriores. Sobre una cédula limpia esa
 * condición se cumple por azar ~1 de cada 11 veces, y entonces borra un dígito
 * REAL en silencio.
 *
 * Estos tests NO describen un comportamiento deseable: describen por qué
 * `nit_sin_dv` no puede aplicarse a la identificación de una persona (casilla 5
 * del RUT, cédula). Pasó: 14 de 290 RUT quedaron con la cédula mutilada y uno de
 * esos formularios se radicó ante la DIAN. Si alguien "arregla" este test
 * cambiando el valor esperado, está reintroduciendo el defecto.
 *
 * Los números son sintéticos: cumplen la condición de la trampa sin ser la
 * cédula de nadie.
 */
describe('nitSinDv — por qué NUNCA sobre una cédula', () => {
  const CEDULAS_QUE_MUTILA: Array<[cedula: string, loQueQueda: string]> = [
    ['12345672', '1234567'],
    ['123456788', '12345678'],
    ['111111116', '11111111'],
    ['987654328', '98765432'],
    ['12345678902', '1234567890'],
  ]

  it.each(CEDULAS_QUE_MUTILA)('%s pierde su último dígito y queda en %s', (cedula, queda) => {
    expect(nitSinDv(cedula)).toBe(queda)
  })

  it('el DV se CALCULA sobre la cédula completa, nunca recortándola', () => {
    const cedula = '12345672'
    expect(calcularDvNit(cedula)).toBe('4')   // el DV de esa cédula es 4
    expect(nitSinDv(cedula)).toBe('1234567')  // ← el daño, si se aplica donde no va
  })
})

/**
 * El daño no se limita a las cédulas.
 *
 * La misma coincidencia ocurre sobre NIT de EMPRESA limpios de 9 dígitos —el uso
 * para el que la heurística fue escrita—. El NIT de Bancolombia es el
 * contraejemplo público: 890903938 no trae DV pegado (su DV es 8, impreso
 * aparte), pero como 8 resulta ser el DV válido de 89090393, la heurística lo
 * recorta a 8 dígitos.
 *
 * Medido en producción: 1 de 14 NIT públicos cae en la trampa (~1/11, la
 * probabilidad esperada), y 2 NIT de proveedor quedaron recortados en la
 * Factura (casos V0086 y V0024).
 */
describe('nitSinDv — tampoco es seguro sobre un NIT de empresa limpio', () => {
  it('recorta el NIT de Bancolombia, que no traía DV pegado', () => {
    expect(calcularDvNit('890903938')).toBe('8')  // su DV real, impreso aparte
    expect(separarNitDv('890903938')).toEqual({ base: '89090393', dv: '8' })
    expect(nitSinDv('890903938')).toBe('89090393') // ← un dígito menos que el NIT real
  })
})

/**
 * El NIT del RUT con el DV pegado (2026-09-14).
 *
 * Los cinco pares de `DV_REALES` son de casos de SOENA medidos en producción: la
 * identificación de la casilla 26 y el DV que la extracción pegó al final del NIT.
 * En los 20 bloques afectados el dígito sobrante era EXACTAMENTE ese DV.
 *
 * A diferencia de la trampa de arriba, aquí el recorte exige un TESTIGO: la
 * identificación, o el DV leído en la casilla 6. Y el testigo solo no alcanza:
 * Bancolombia prueba que un NIT limpio puede cumplir las dos condiciones.
 */
const DV_REALES: Array<[identificacion: string, dv: string]> = [
  ['52217225', '2'],
  ['16727057', '9'],
  ['1032392837', '6'],
  ['75072970', '0'],
  ['43970194', '8'],
]

describe('calcularDvNit — identificaciones reales del RUT', () => {
  it.each(DV_REALES)('%s → DV %s', (id, dv) => {
    expect(calcularDvNit(id)).toBe(dv)
  })
})

describe('nitTraeDvDeLaIdentificacion', () => {
  it.each(DV_REALES)('%s con su DV %s pegado → sí', (id, dv) => {
    expect(nitTraeDvDeLaIdentificacion(id + dv, id)).toBe(true)
  })

  it('el NIT igual a la identificación → no', () => {
    expect(nitTraeDvDeLaIdentificacion('52217225', '52217225')).toBe(false)
  })

  it('un dígito de más que NO es el DV → no (es otro error, no este)', () => {
    expect(nitTraeDvDeLaIdentificacion('522172257', '52217225')).toBe(false)
  })

  it('el DV correcto pero otro prefijo → no', () => {
    expect(nitTraeDvDeLaIdentificacion('522172262', '52217225')).toBe(false)
  })

  it('sin identificación no hay testigo → no', () => {
    expect(nitTraeDvDeLaIdentificacion('522172252', null)).toBe(false)
    expect(nitTraeDvDeLaIdentificacion('522172252', '')).toBe(false)
  })
})

describe('diagnosticarNitDv', () => {
  it.each(DV_REALES)('con identificación %s: quita el DV %s pegado', (id, dv) => {
    expect(diagnosticarNitDv({ nit: id + dv, numeroIdentificacion: id, dvLeido: dv }))
      .toEqual({ accion: 'quitar_dv', nit: id, motivo: 'pegado_a_la_identificacion' })
  })

  it('con identificación, aunque el DV leído falte o esté mal', () => {
    expect(diagnosticarNitDv({ nit: '522172252', numeroIdentificacion: '52217225', dvLeido: null }).nit)
      .toBe('52217225')
    expect(diagnosticarNitDv({ nit: '522172252', numeroIdentificacion: '52217225', dvLeido: '7' }).nit)
      .toBe('52217225')
  })

  it('NIT que calza con la identificación: limpio, aunque cumpla la trampa', () => {
    // 12345672 → su último dígito es el DV de 1234567. La identificación lo salva.
    expect(diagnosticarNitDv({ nit: '12345672', numeroIdentificacion: '12345672', dvLeido: '2' }))
      .toEqual({ accion: 'sin_cambio', nit: '12345672', motivo: 'limpio' })
  })

  it('sin identificación: quita el DV si el leído lo confirma y el NIT completo no lo explica', () => {
    // 522172252: DV(52217225)=2 = último = leído, y DV(522172252) ≠ 2.
    expect(calcularDvNit('522172252')).not.toBe('2')
    expect(diagnosticarNitDv({ nit: '522172252', dvLeido: '2' }))
      .toEqual({ accion: 'quitar_dv', nit: '52217225', motivo: 'pegado_segun_dv_leido' })
  })

  it('Bancolombia: NIT limpio que cumple todo → dudoso, NUNCA recortado', () => {
    // 890903938 con DV 8: DV(89090393)=8 = último = leído, y DV(890903938) también es 8.
    expect(diagnosticarNitDv({ nit: '890903938', dvLeido: '8' }))
      .toEqual({ accion: 'dudoso', nit: '890903938', motivo: 'ambiguo_dv_leido_valido_para_ambos' })
  })

  it('sin identificación y con el DV correcto leído, la trampa de las cédulas no muerde', () => {
    // 12345672: DV real 4. El leído no coincide con el último dígito → no hay recorte.
    expect(diagnosticarNitDv({ nit: '12345672', dvLeido: '4' }).accion).toBe('sin_cambio')
  })

  it('RIESGO RESIDUAL, fijado: sin identificación y con el DV MAL leído igual al último dígito, recorta', () => {
    // Pasó en producción (V0309, rut_solicitante_2: 34545752 con dv guardado 2, real 3).
    // Allá la identificación estaba y lo salva; este test documenta qué pasaría sin ella.
    expect(diagnosticarNitDv({ nit: '34545752', dvLeido: '2' }).accion).toBe('quitar_dv')
    expect(diagnosticarNitDv({ nit: '34545752', numeroIdentificacion: '34545752', dvLeido: '2' }).accion)
      .toBe('sin_cambio')
  })

  it('sin DV leído no hay testigo: no toca nada', () => {
    expect(diagnosticarNitDv({ nit: '522172252' }).accion).toBe('sin_cambio')
  })

  it('sin NIT', () => {
    expect(diagnosticarNitDv({ nit: null }).motivo).toBe('sin_nit')
    expect(diagnosticarNitDv({ nit: '  ' }).motivo).toBe('sin_nit')
  })
})
