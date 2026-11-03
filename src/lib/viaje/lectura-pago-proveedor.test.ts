/**
 * M-12 (QA Trappvel 2026-10-29, v03:M3-3): de lo que el lector leyó del soporte del pago a
 * proveedor a la propuesta que prellena el formulario. Los campos son los que devolvería Gemini
 * para los soportes de la QA (`viajes/soportes/png/pagoprov-*.png`); aquí no se llama a nadie.
 */

import { describe, it, expect } from 'vitest'
import { avisosDeLectura, CAMPOS_PAGO_PROVEEDOR, medioPorLectura, numeroLeido, propuestaPagoProveedor } from './lectura-pago-proveedor'
import type { MedioPagoProveedor } from './reglas-pago'

const MEDIOS: MedioPagoProveedor[] = [
  { id: 'bancolombia-empresa', label: 'Bancolombia ahorros empresa ••3241', titular: 'empresa' },
  { id: 'tc-edgar', label: 'Tarjeta personal Edgar ••0932', titular: 'personal' },
]

const leido = (o: Record<string, string | null>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }]))

describe('M-12 · campos que se le piden al lector', () => {
  it('reúsa los del comprobante del viajero y suma los de un pago en otra moneda', () => {
    const slugs = CAMPOS_PAGO_PROVEEDOR.map(c => c.slug)
    expect(slugs).toEqual(expect.arrayContaining(['monto', 'fecha', 'banco_origen', 'referencia', 'destinatario', 'cuenta_origen', 'moneda', 'monto_moneda', 'tasa_cambio']))
    expect(slugs).not.toContain('cuenta_destino')
  })
})

describe('M-12 · propuesta desde el soporte', () => {
  it('pagoprov-avianca-viaje03: valor, fecha, medio y número de comprobante, en pesos', () => {
    const p = propuestaPagoProveedor(leido({
      monto: '1.000.000', fecha: '2026-10-29', banco_origen: 'Bancolombia', cuenta_origen: '32800003241',
      referencia: '0000PRUEBA03P1', destinatario: 'Avianca S.A.', moneda: null, monto_moneda: null, tasa_cambio: null,
    }), { medios: MEDIOS, moneda: null })
    expect(p).toEqual({
      monto: 1_000_000, fecha: '2026-10-29', medioId: 'bancolombia-empresa', referencia: '0000PRUEBA03P1',
      banco: 'Bancolombia', destinatario: 'Avianca S.A.', moneda: null, montoMoneda: null, tasa: null,
    })
  })

  it('pagoprov-renaissance-trm4230-viaje06: USD 2,084.40 a TRM 4.230 sobre un servicio cotizado en USD a 4.150', () => {
    const p = propuestaPagoProveedor(leido({
      monto: '8.817.012', fecha: '2026-10-29', banco_origen: 'Bancolombia', cuenta_origen: '32800003241',
      referencia: '0000PRUEBA06P4', destinatario: 'Renaissance Curaçao Resort', moneda: 'USD', monto_moneda: '2,084.40', tasa_cambio: '4.230',
    }), { medios: MEDIOS, moneda: { moneda: 'USD', monto: 2084.4, tasa: 4150 } })
    expect(p).toMatchObject({ monto: 8_817_012, moneda: 'USD', montoMoneda: 2084.4, tasa: 4230, referencia: '0000PRUEBA06P4' })
  })

  it('sin TRM escrita, sale de los pesos y el monto en la moneda', () => {
    const p = propuestaPagoProveedor(leido({ monto: '380700', moneda: 'usd', monto_moneda: '90' }), { medios: MEDIOS, moneda: { moneda: 'USD', monto: 90, tasa: 4150 } })
    expect(p.tasa).toBe(4230)
  })

  it('una moneda que no es la del servicio, o una TRM increíble, no se propone', () => {
    const otra = propuestaPagoProveedor(leido({ monto: '8817012', moneda: 'EUR', monto_moneda: '2084.40', tasa_cambio: '4230' }), { medios: MEDIOS, moneda: { moneda: 'USD', monto: 2084.4, tasa: 4150 } })
    expect(otra).toMatchObject({ moneda: null, tasa: null })
    const lejos = propuestaPagoProveedor(leido({ monto: '8817012', moneda: 'USD', monto_moneda: '2084.40', tasa_cambio: '42.30' }), { medios: MEDIOS, moneda: { moneda: 'USD', monto: 2084.4, tasa: 4150 } })
    expect(lejos.tasa).toBeNull()
  })

  it('lo que no se lee queda vacío para escribirlo a mano', () => {
    expect(propuestaPagoProveedor({}, { medios: MEDIOS, moneda: null })).toEqual({
      monto: null, fecha: null, medioId: null, referencia: null, banco: null, destinatario: null, moneda: null, montoMoneda: null, tasa: null,
    })
    expect(propuestaPagoProveedor(leido({ fecha: '29 oct 2026', monto: 'cero' }), { medios: MEDIOS, moneda: null })).toMatchObject({ fecha: null, monto: null })
  })
})

describe('M-12 · medio y números', () => {
  it('el medio sale por los últimos dígitos o por el banco si lo nombra uno solo; si hay duda, ninguno', () => {
    expect(medioPorLectura(MEDIOS, '****0932', null)).toBe('tc-edgar')
    expect(medioPorLectura(MEDIOS, null, 'Bancolombia')).toBe('bancolombia-empresa')
    expect(medioPorLectura(MEDIOS, null, 'Davivienda')).toBeNull()
    expect(medioPorLectura([...MEDIOS, { id: 'b2', label: 'Bancolombia corriente', titular: 'empresa' }], null, 'Bancolombia')).toBeNull()
  })

  it('lee los números en formato de EE. UU. y colombiano', () => {
    expect(numeroLeido('2,084.40')).toBe(2084.4)
    expect(numeroLeido('2.084,40')).toBe(2084.4)
    expect(numeroLeido('4.230')).toBe(4230)
    expect(numeroLeido('4230.5')).toBe(4230.5)
    expect(numeroLeido('US$ 90')).toBe(90)
    expect(numeroLeido('')).toBeNull()
  })
})

describe('M-12 · lo que se ve antes de guardar', () => {
  it('el valor leído distinto de lo que faltaba pagar se dice con la diferencia', () => {
    expect(avisosDeLectura({ monto: 1_000_000, destinatario: 'Avianca' }, 689_400, 'Avianca')).toEqual([
      'El soporte dice $1.000.000 y faltaba pagar $689.400 (+$310.600).',
    ])
    expect(avisosDeLectura({ monto: 1_141_400, destinatario: null }, 1_452_000, 'Hotel Caribe')).toEqual([
      'El soporte dice $1.141.400 y faltaba pagar $1.452.000 (−$310.600).',
    ])
    expect(avisosDeLectura({ monto: 689_400, destinatario: 'AVIANCA S.A.' }, 689_400, 'Avianca')).toEqual([])
  })

  it('un soporte pagado a otro destinatario se avisa', () => {
    expect(avisosDeLectura({ monto: null, destinatario: 'Copa Airlines' }, 0, 'Renaissance Curaçao Resort')).toEqual([
      'El soporte dice que se le pagó a «Copa Airlines», no a Renaissance Curaçao Resort: revísalo.',
    ])
  })
})
