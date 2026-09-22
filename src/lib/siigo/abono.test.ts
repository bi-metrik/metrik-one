/**
 * La regla pura del abono del honorario a la factura (`./abono`).
 *
 * Los fixtures son las formas REALES leídas del Siigo de SOENA el 2026-09-22, solo con
 * GET: FV-2-540 (la factura, con su `prefix: "SOE"` que NO es el del vencimiento) y los
 * abonos que Tesorería hizo a mano (RC-1-22 contra FV-1-17, RC-1-41 contra FV-2-225).
 */
import { describe, it, expect } from 'vitest'
import {
  decidirAbono,
  ETIQUETA_ABONO_A_MANO,
  MOTIVOS_ABONO_A_MANO,
  redondearCentavos,
  retencionDelCobro,
  vencimientoDeFactura,
  type FacturaSiigoLeida,
} from './abono'

/** `GET /v1/invoices/{id}` de FV-2-540, tal como respondió Siigo el 2026-09-22. */
const FV_2_540: FacturaSiigoLeida = {
  name: 'FV-2-540', prefix: 'SOE', number: 540, date: '2026-09-21',
  total: 637_500, balance: 637_500,
  customer: { identification: '80815711', branch_office: 0 },
  payments: [{ id: 1055, value: 637_500, due_date: '2026-09-21' }],
} as FacturaSiigoLeida

const decidir = (honorario: number, factura: Partial<FacturaSiigoLeida> = {}) =>
  decidirAbono({
    honorario,
    factura: { ...FV_2_540, ...factura },
    numeroFactura: 'FV-2-540',
    identificacionCliente: '80815711',
  })

describe('vencimientoDeFactura — el vencimiento sale del NOMBRE', () => {
  it('FV-2-540 cruza el prefijo FV-2, no el `prefix` SOE de la factura', () => {
    // RC-1-41, hecho a mano, cruza `due.prefix: "FV-2"` contra FV-2-225. El campo
    // `prefix` de la factura es el de la resolución DIAN y mandarlo le aplicaría el pago
    // a un vencimiento que no existe.
    expect(vencimientoDeFactura(FV_2_540)).toEqual({
      prefix: 'FV-2', consecutive: 540, quote: 1, date: '2026-09-21',
    })
  })

  it('la forma de RC-1-22: FV-1 / 17 / cuota 1 / su fecha de vencimiento', () => {
    const fv117 = { name: 'FV-1-17', number: 17, payments: [{ due_date: '2025-08-20' }] }
    expect(vencimientoDeFactura(fv117)).toEqual({ prefix: 'FV-1', consecutive: 17, quote: 1, date: '2025-08-20' })
  })

  it('sin cuota con fecha, el vencimiento sale sin fecha (el campo es opcional en Siigo)', () => {
    expect(vencimientoDeFactura({ name: 'FV-2-9', number: 9 })).toEqual({ prefix: 'FV-2', consecutive: 9, quote: 1 })
  })

  it('un nombre sin consecutivo no se adivina', () => {
    expect(vencimientoDeFactura({ name: 'FV-2' })).toBeNull()
    expect(vencimientoDeFactura({ name: '' })).toBeNull()
  })

  it('un `number` que contradice al nombre no se adivina', () => {
    expect(vencimientoDeFactura({ name: 'FV-2-540', number: 541 })).toBeNull()
  })
})

describe('decidirAbono — el tope es el saldo de Siigo', () => {
  it('con saldo de sobra, abona el honorario completo', () => {
    expect(decidir(318_750)).toMatchObject({
      tipo: 'emitir', valor: 318_750, sinAbonar: 0,
      vencimiento: { prefix: 'FV-2', consecutive: 540 }, fechaFactura: '2026-09-21',
    })
  })

  it('con saldo corto, abona SOLO hasta el saldo y dice cuánto no cupo', () => {
    // El saldo de Siigo ya descuenta lo que Tesorería haya cruzado a mano: es el único
    // tope que no abona de más.
    expect(decidir(637_500, { balance: 200_000 })).toMatchObject({
      tipo: 'emitir', valor: 200_000, sinAbonar: 437_500,
    })
  })

  it('con la factura saldada no abona nada: el honorario es sobrepago', () => {
    const d = decidir(637_500, { balance: 0 })
    expect(d).toMatchObject({ tipo: 'a_mano', motivo: 'factura_saldada', sinAbonar: 637_500 })
  })

  it('un saldo que no llegó es un ERROR reintentable, no un abono sin tope', () => {
    expect(decidir(637_500, { balance: undefined }).tipo).toBe('error')
    expect(decidir(637_500, { balance: null }).tipo).toBe('error')
  })

  it('el saldo puede venir como texto y se respeta', () => {
    expect(decidir(637_500, { balance: '100000' })).toMatchObject({ tipo: 'emitir', valor: 100_000 })
  })
})

describe('decidirAbono — lo que no se cruza a ciegas', () => {
  it('factura anulada', () => {
    expect(decidir(637_500, { annulled: true })).toMatchObject({ tipo: 'a_mano', motivo: 'factura_anulada' })
  })

  it('factura a nombre de OTRO tercero', () => {
    expect(decidir(637_500, { customer: { identification: '900660737' } }))
      .toMatchObject({ tipo: 'a_mano', motivo: 'factura_de_otro_tercero' })
  })

  it('factura con varias cuotas: ONE no decide a cuál abonar', () => {
    expect(decidir(637_500, { payments: [{ due_date: '2026-09-21' }, { due_date: '2026-10-21' }] }))
      .toMatchObject({ tipo: 'a_mano', motivo: 'factura_con_cuotas' })
  })

  it('factura ilegible', () => {
    expect(decidir(637_500, { name: 'FV-2' })).toMatchObject({ tipo: 'a_mano', motivo: 'factura_ilegible' })
  })

  it('CONTROL: la misma factura, sana, sí se abona', () => {
    expect(decidir(637_500).tipo).toBe('emitir')
  })
})

describe('retencionDelCobro', () => {
  it('cero, nulo o basura no son retención', () => {
    expect(retencionDelCobro(0)).toBe(0)
    expect(retencionDelCobro(null)).toBe(0)
    expect(retencionDelCobro('')).toBe(0)
    expect(retencionDelCobro('abc')).toBe(0)
  })

  it('un valor positivo sí', () => {
    expect(retencionDelCobro(50_000)).toBe(50_000)
    expect(retencionDelCobro('12500.5')).toBe(12_500.5)
  })
})

describe('redondearCentavos y las etiquetas', () => {
  it('no deja viajar fracciones largas a Siigo', () => {
    expect(redondearCentavos(0.1 + 0.2)).toBe(0.3)
  })

  it('cada motivo tiene su frase: la lista es cerrada', () => {
    for (const m of MOTIVOS_ABONO_A_MANO) expect(ETIQUETA_ABONO_A_MANO[m]).toBeTruthy()
  })
})
