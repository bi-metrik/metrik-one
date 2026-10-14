import { describe, expect, it } from 'vitest'
import { entidadFinancieraEn, esEntidadFinanciera, nombreDeEntidadFinanciera } from './entidad-financiera'
import { parsearPersonas } from './personas'

describe('nombreDeEntidadFinanciera', () => {
  it('reconoce bancos, leasing, fiduciarias y compañías de financiamiento', () => {
    for (const n of [
      'BANCOLOMBIA',
      'Bancolombia S.A.',
      'BANCO DE BOGOTA',
      'Banco de Occidente S.A.',
      'BANCO DAVIVIENDA S.A.',
      'DAVIVIENDA',
      'BBVA COLOMBIA',
      'Itaú Colombia S.A.',
      'SCOTIABANK COLPATRIA S.A.',
      'BANCO GNB SUDAMERIS',
      'BANCO COMERCIAL AV VILLAS S.A.',
      'LEASING BANCOLOMBIA S.A. COMPAÑÍA DE FINANCIAMIENTO',
      'Compañía de Financiamiento Tuya S.A.',
      'FIDUCIARIA BOGOTA S.A.',
      'GM FINANCIAL COLOMBIA S.A. C.F.',
      'RCI COLOMBIA S.A. C.F.',
      'BANCO FINANDINA S.A. BIC',
      'FINANDINA',
      'Corporación Financiera Colombiana',
      'BANCOOMEVA',
      'BANCAMIA S.A.',
    ]) {
      expect(nombreDeEntidadFinanciera(n), n).toBe(true)
    }
  })

  it('personas naturales y empresas no financieras no cuentan', () => {
    for (const n of [
      'LUYAN INGENIERIA SAS',
      'AUTOGERMANA S A S',
      'INNVENTOR ELECTRONICS SAS',
      'RUIZ LOPEZ CARLOS ANDRES',
      'TUYA MARTINEZ ANA',
      'CARLOS FERNANDO C F',
      'JUAN CARLOS FINO',
      '',
      null,
    ]) {
      expect(nombreDeEntidadFinanciera(n), String(n)).toBe(false)
    }
  })
})

describe('esEntidadFinanciera / entidadFinancieraEn', () => {
  it('el documento solo no decide: una cédula de 10 dígitos que empieza por 8 o 9 no es un banco', () => {
    expect(esEntidadFinanciera({ nombre: 'GOMEZ ARIAS LUISA', documento: '8012345678' })).toBe(false)
    expect(esEntidadFinanciera({ nombre: 'X', documento: '8909039388' })).toBe(false)
  })

  it('devuelve la primera entidad financiera de la lista de compradores', () => {
    const personas = parsearPersonas('PEREZ GOMEZ ANA MARIA (52000111); BANCOLOMBIA (8909039388)')
    expect(entidadFinancieraEn(personas)).toEqual({ nombre: 'BANCOLOMBIA', documento: '8909039388' })
    expect(entidadFinancieraEn(parsearPersonas('LUYAN INGENIERIA SAS (901234567)'))).toBeNull()
    expect(entidadFinancieraEn([])).toBeNull()
  })
})
