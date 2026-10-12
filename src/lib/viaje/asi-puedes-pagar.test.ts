/**
 * «Así puedes pagar» (Vera C2 y F2-1). Casos del guion de Vera §8, paso 1, y de Noor §4.1.
 */
import { describe, expect, it } from 'vitest'
import { asiPuedesPagar, entradaAsiPuedesPagar, fechaLarga, notaDeFila, reglaEnPalabras, totalDelDocumento } from './asi-puedes-pagar'
import { fiscalSobreIngresoPropio, liquidarIva } from '@/lib/fiscal/iva-cotizacion'
import { REGLA_POR_DEFECTO, pesos } from './plan-pagos'

const D = '2026-10-12'
const entrada = (fechaSalida: string | null, hoy = D) => ({ fechaSalida, hoy, regla: REGLA_POR_DEFECTO })

describe('asiPuedesPagar', () => {
  it('guion de Vera, paso 1: $4.052.000 con salida a 40 días', () => {
    const r = asiPuedesPagar(4_052_000, entrada('2026-11-21'))
    expect(r.filas).toEqual([
      { monto: 1_216_000, cuando: 'al confirmar (anticipo)', llevas: null },
      { monto: 2_026_000, cuando: 'hasta el 6 de noviembre', llevas: 3_242_000 },
      { monto: 810_000, cuando: 'hasta el 21 de noviembre, día del viaje', llevas: null },
    ])
    expect(r.suma).toBe(4_052_000)
    expect(notaDeFila(r.filas![1], r.pctMinimo, pesos)).toBe('con esto llevas el 80 % ($3.242.000)')
  })

  it('las filas suman el total al peso, también con totales que no cierran en miles', () => {
    for (const total of [9_165_000, 1_234_567, 4_052_001, 3_000]) {
      const r = asiPuedesPagar(total, entrada('2026-12-04'))
      expect(r.suma).toBe(Math.round(total))
    }
  })

  it('a 15 días o menos: 80 % al confirmar y el resto el día del viaje', () => {
    const r = asiPuedesPagar(1_000_000, entrada('2026-10-20'))
    expect(r.filas).toEqual([
      { monto: 800_000, cuando: 'al confirmar (anticipo)', llevas: 800_000 },
      { monto: 200_000, cuando: 'hasta el 20 de octubre, día del viaje', llevas: null },
    ])
  })

  it('sin fecha de salida o con la salida pasada: la regla en palabras, sin montos', () => {
    expect(asiPuedesPagar(4_052_000, entrada(null))).toMatchObject({ filas: null, suma: 0, regla: reglaEnPalabras() })
    expect(asiPuedesPagar(4_052_000, entrada('2026-10-01')).filas).toBeNull()
    expect(reglaEnPalabras()).toBe('El 80 % quince días antes de salir y el resto el día del viaje.')
  })

  it('fecha en palabras', () => {
    expect(fechaLarga('2026-12-04')).toBe('4 de diciembre')
  })
})

describe('interruptor', () => {
  it('sin plan_pagos.activo en la línea, nadie arma la sección', () => {
    expect(entradaAsiPuedesPagar({}, { fechaSalida: '2026-11-21', hoy: D })).toBeNull()
    expect(entradaAsiPuedesPagar({ plan_pagos: { activo: 'true' } }, { fechaSalida: '2026-11-21', hoy: D })).toBeNull()
    expect(entradaAsiPuedesPagar({ plan_pagos: { activo: true } }, { fechaSalida: '2026-11-21', hoy: D })).toMatchObject({ fechaSalida: '2026-11-21' })
  })
})

describe('totalDelDocumento: la pantalla suma lo mismo que el PDF', () => {
  const lineas = [
    { precio: 3_000_000, costoTerceros: 2_400_000, esDeLaAgencia: false },
    { precio: 1_052_000, costoTerceros: 700_000, esDeLaAgencia: false },
  ]
  for (const precio of ['iva_aparte', 'iva_incluido'] as const) {
    it(`con el IVA ${precio === 'iva_aparte' ? 'aparte' : 'incluido'}: igual a fiscal.totalBruto del PDF`, () => {
      const liq = liquidarIva(lineas as never, { tarifaPct: 19, precio })
      const subtotal = 4_052_000
      const delPdf = fiscalSobreIngresoPropio({ subtotal, liquidacion: liq, perfil: null, cliente: {} as never }).totalBruto
      expect(totalDelDocumento({ precioVenta: subtotal, ivaSobreIngresoPropio: true, iva: { valor: liq.iva, precio: liq.precio } })).toBe(Math.round(delPdf))
    })
  }
  it('sin el IVA sobre el ingreso propio, la pantalla no afirma un total', () => {
    expect(totalDelDocumento({ precioVenta: 4_052_000, ivaSobreIngresoPropio: false, iva: null })).toBeNull()
  })
})
