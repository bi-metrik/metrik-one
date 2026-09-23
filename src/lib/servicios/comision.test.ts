/**
 * Las dos formas de comisión que Mauricio fijó el 2026-09-15, y la regla que las gobierna:
 * un campo ausente nunca autoriza una comisión.
 */
import { describe, it, expect } from 'vitest'
import {
  calcularComision,
  problemasDeComision,
  refComisionCiclo,
  refComisionFeeUnico,
  type Comision,
} from './comision'

const AFI: Comision = {
  beneficiario_empresa_id: 'e1b1c1d1-0000-4000-8000-000000000001',
  beneficiario_nit: '901234567',
  modo: 'monto_fijo',
  monto_fijo: 50_000,
  base: 'cada_cobro',
}

const PROMOTORA_4DSOFT: Comision = {
  beneficiario_empresa_id: 'e1b1c1d1-0000-4000-8000-000000000002',
  beneficiario_nit: '1020304050',
  modo: 'porcentaje',
  pct: 20,
  base: 'cada_cobro',
}

describe('los dos casos decididos el 2026-09-15', () => {
  it('licencia de un CDA: paga $150.000 y AFI se queda con $50.000 fijos', () => {
    const r = calcularComision(AFI, { valor: 150_000, esPrimerCobro: true })
    expect(r.valor).toBe(50_000)
    expect(r.motivo).toBe('monto_fijo')
  })

  it('el monto fijo NO se mueve con el valor del cobro', () => {
    // Es lo que distingue el monto fijo del porcentaje: si el precio de la licencia sube a
    // $180.000, AFI sigue en $50.000 hasta que se renegocie el contrato.
    expect(calcularComision(AFI, { valor: 180_000, esPrimerCobro: false }).valor).toBe(50_000)
    expect(calcularComision(AFI, { valor: 90_000, esPrimerCobro: false }).valor).toBe(50_000)
  })

  it('paquete de Valida API: 20 % sobre el paquete', () => {
    const r = calcularComision(PROMOTORA_4DSOFT, { valor: 1_400_000, esPrimerCobro: true })
    expect(r.valor).toBe(280_000) // el mismo número del gasto `comision-X1-26-1-paq1` de hoy
    expect(r.motivo).toBe('porcentaje')
  })

  it('el porcentaje SÍ se mueve con el valor del cobro', () => {
    expect(calcularComision(PROMOTORA_4DSOFT, { valor: 2_000_000, esPrimerCobro: false }).valor).toBe(400_000)
  })

  it('el porcentaje redondea al peso, sin centavos', () => {
    // 20 % de 150.001 = 30.000,2 → 30.000. Un decimal en una cuenta por pagar es un descuadre
    // que nadie puede cerrar.
    const r = calcularComision(PROMOTORA_4DSOFT, { valor: 150_001, esPrimerCobro: false })
    expect(r.valor).toBe(30_000)
    expect(Number.isInteger(r.valor)).toBe(true)
  })
})

describe('un contrato sin comisión no genera ninguna', () => {
  it('null no es «usá el default»', () => {
    const r = calcularComision(null, { valor: 1_000_000, esPrimerCobro: true })
    expect(r.valor).toBe(0)
    expect(r.motivo).toBe('sin_comision_pactada')
  })

  it('undefined tampoco', () => {
    expect(calcularComision(undefined, { valor: 1_000_000, esPrimerCobro: true }).valor).toBe(0)
  })
})

describe('base primer_cobro', () => {
  const solaVez: Comision = { ...PROMOTORA_4DSOFT, base: 'primer_cobro' }

  it('el primer cobro la genera', () => {
    expect(calcularComision(solaVez, { valor: 1_400_000, esPrimerCobro: true }).valor).toBe(280_000)
  })

  it('las renovaciones no', () => {
    const r = calcularComision(solaVez, { valor: 1_400_000, esPrimerCobro: false })
    expect(r.valor).toBe(0)
    expect(r.motivo).toBe('base_primer_cobro_ya_pasado')
  })
})

describe('fee único', () => {
  const conFee: Comision = { ...AFI, fee_unico: 200_000 }

  it('sale solo en el primer cobro, aparte de la comisión', () => {
    const p = calcularComision(conFee, { valor: 150_000, esPrimerCobro: true })
    expect(p).toMatchObject({ valor: 50_000, feeUnico: 200_000 })
    const s = calcularComision(conFee, { valor: 150_000, esPrimerCobro: false })
    expect(s).toMatchObject({ valor: 50_000, feeUnico: 0 })
  })

  it('sale también cuando la comisión por cobro no corresponde', () => {
    // Son dos pactos distintos: el fee de cierre no depende de la base de la comisión.
    const r = calcularComision({ ...conFee, base: 'primer_cobro' }, { valor: 150_000, esPrimerCobro: true })
    expect(r.feeUnico).toBe(200_000)
  })
})

describe('una comisión a medias se rechaza, no se completa con ceros', () => {
  const casos: [string, unknown][] = [
    ['porcentaje sin pct', { ...PROMOTORA_4DSOFT, pct: undefined }],
    ['monto fijo sin monto', { ...AFI, monto_fijo: undefined }],
    ['porcentaje en 0', { ...PROMOTORA_4DSOFT, pct: 0 }],
    ['porcentaje mayor que 100', { ...PROMOTORA_4DSOFT, pct: 120 }],
    ['monto fijo negativo', { ...AFI, monto_fijo: -50_000 }],
    ['sin NIT del beneficiario', { ...AFI, beneficiario_nit: '' }],
    ['sin empresa del beneficiario', { ...AFI, beneficiario_empresa_id: '' }],
    ['sin modo', { ...AFI, modo: undefined }],
    ['modo inventado', { ...AFI, modo: 'mitad' }],
    ['base inventada', { ...AFI, base: 'cuando_quiera' }],
    ['los dos campos a la vez', { ...AFI, pct: 20 }],
    ['fee único en cero', { ...AFI, fee_unico: 0 }],
    ['no es un objeto', 'veinte por ciento'],
  ]

  for (const [nombre, valor] of casos) {
    it(`${nombre}: problemasDeComision lo marca`, () => {
      expect(problemasDeComision(valor).length).toBeGreaterThan(0)
    })
    it(`${nombre}: calcularComision lanza en vez de inventar un número`, () => {
      expect(() => calcularComision(valor as Comision, { valor: 150_000, esPrimerCobro: true })).toThrow(
        /comisión incoherente/,
      )
    })
  }

  it('las dos declaradas bien no tienen problemas', () => {
    expect(problemasDeComision(AFI)).toEqual([])
    expect(problemasDeComision(PROMOTORA_4DSOFT)).toEqual([])
  })
})

describe('llaves de idempotencia', () => {
  it('la del ciclo depende solo del ciclo: un evento repetido no crea dos comisiones', () => {
    expect(refComisionCiclo('abc')).toBe('comision-ciclo-abc')
    expect(refComisionCiclo('abc')).toBe(refComisionCiclo('abc'))
  })

  it('la del fee depende del contrato, no del ciclo', () => {
    expect(refComisionFeeUnico('c1')).toBe('comision-fee-c1')
  })
})

describe('AFI desde el 2026-09-23: $50.000 fijos por CDA + 20 % de lo adicional', () => {
  const AFI_CDA: Comision = {
    beneficiario_empresa_id: 'ecc378c7-10c4-4984-a31d-5533a598ad71',
    beneficiario_nit: '902003244-6',
    modo: 'fijo_mas_porcentaje',
    monto_fijo: 50_000,
    pct: 20,
    base: 'cada_cobro',
  }

  it('es una comisión coherente', () => {
    expect(problemasDeComision(AFI_CDA)).toEqual([])
  })

  it('cuota sin adicionales: solo los $50.000', () => {
    const r = calcularComision(AFI_CDA, { valor: 150_000, esPrimerCobro: false, valorAdicional: 0 })
    expect(r).toMatchObject({ valor: 50_000, motivo: 'fijo_mas_porcentaje' })
  })

  it('cuota con un usuario adicional y su prorrata: 20 % de lo adicional, nunca de la licencia', () => {
    // 150.000 de licencia + 48.333 de prorrata + 50.000 del periodo = 248.333; adicional 98.333.
    const r = calcularComision(AFI_CDA, { valor: 248_333, esPrimerCobro: false, valorAdicional: 98_333 })
    expect(r.valor).toBe(50_000 + 19_667)
  })

  it('sin declarar la parte adicional no se paga porcentaje (un campo ausente no autoriza comisión)', () => {
    expect(calcularComision(AFI_CDA, { valor: 248_333, esPrimerCobro: false }).valor).toBe(50_000)
  })

  it('le faltan el fijo o el porcentaje: se rechaza', () => {
    expect(problemasDeComision({ ...AFI_CDA, pct: undefined }).map((p) => p.campo)).toContain('pct')
    expect(problemasDeComision({ ...AFI_CDA, monto_fijo: undefined }).map((p) => p.campo)).toContain('monto_fijo')
    expect(problemasDeComision({ ...AFI_CDA, pct: 120 }).map((p) => p.campo)).toContain('pct')
  })
})
