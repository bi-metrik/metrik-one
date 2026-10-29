import { describe, expect, it } from 'vitest'

import {
  diferenciaDeCambio,
  diferenciaDeCambioDelServicio,
  marcaTrm,
  monedaDelServicio,
  montoEnMoneda,
  tasaPagoValida,
  textoDiferenciaDeCambio,
  textoPagoEnMoneda,
  trmDeDescripcion,
} from './moneda-servicio'
import { calcularCierre } from './cierre-viaje'
import { configReglasPago, reglasQueRompe } from './reglas-pago'

const COMP = { adultos: 2, ninos: 0, infantes: 0 }
const tarifaUSD = { confirmada: { composicion: COMP, costos: [], costoTotalCOP: 8_650_260, moneda: 'USD', tasa: 4150, confirmadaEn: '2026-10-29T10:00:00Z' } }

describe('moneda del servicio (H6-1, H9-1, H6-3 · QA Trappvel 2026-10-29)', () => {
  it('sale del ítem de la cotización: Renaissance US$ 2.084,40 a 4.150', () => {
    const m = monedaDelServicio(tarifaUSD, 8_650_260)
    expect(m).toEqual({ moneda: 'USD', tasa: 4150, monto: 2084.4 })
    expect(textoPagoEnMoneda(m!)).toBe('Se le paga en USD: USD 2.084,40, cotizados a 4.150.')
    expect(montoEnMoneda(90, 'USD')).toBe('USD 90')
  })

  it('en pesos no hay moneda', () => {
    expect(monedaDelServicio({ confirmada: { ...tarifaUSD.confirmada, moneda: 'COP', tasa: null } }, 3_789_200)).toBeNull()
    expect(monedaDelServicio(null, 100)).toBeNull()
  })

  it('la TRM del pago queda en el texto del gasto y se vuelve a leer', () => {
    const d = `Pago a Renaissance · Hotel ${marcaTrm('usd', 4230)}`
    expect(d).toBe('Pago a Renaissance · Hotel · USD a TRM 4.230')
    expect(trmDeDescripcion(d, 'USD')).toBe(4230)
    expect(trmDeDescripcion(d, 'EUR')).toBeNull()
    expect(trmDeDescripcion('Pago a Renaissance · Hotel', 'USD')).toBeNull()
    expect(trmDeDescripcion(`x ${marcaTrm('EUR', 4620.5)}`, 'EUR')).toBe(4620.5)
  })

  it('una TRM a más del 20 % de la cotizada es un error de dedo', () => {
    expect(tasaPagoValida(4230, 4150)).toBe(true)
    expect(tasaPagoValida(423, 4150)).toBe(false)
    expect(tasaPagoValida(null, 4150)).toBe(false)
  })

  it('viaje 06: US$ 2.084,40 pagados a 4.230 son $166.752 de diferencia de cambio', () => {
    expect(diferenciaDeCambio(8_817_012, 4150, 4230)).toBe(166_752)
    const m = monedaDelServicio(tarifaUSD, 8_650_260)!
    const c = diferenciaDeCambioDelServicio(m, [{ monto: 8_817_012, descripcion: `Pago ${marcaTrm('USD', 4230)}` }])
    expect(c).toEqual({ pesos: 166_752, tasas: [4230] })
    expect(textoDiferenciaDeCambio(m, c.tasas)).toBe('diferencia de cambio: TRM 4.230 frente a 4.150 cotizada')
  })

  it('la diferencia de cambio no pide a Edgar; el sobrecosto en dólares sí', () => {
    const base = {
      pagadoAntes: 0,
      costoCotizado: 8_650_260,
      medio: { id: 'empresa', label: 'Cuenta empresa', titular: 'empresa' as const },
      cobradoCliente: 5_000_000,
      precioAprobado: 10_000_000,
      config: configReglasPago(null),
    }
    // TRM 4.400 (+6 %): sin la TRM, pediría «desviación de costo».
    const monto = Math.round(2084.4 * 4400)
    expect(reglasQueRompe({ ...base, monto }).map(r => r.tipo)).toEqual(['desviacion_costo'])
    expect(reglasQueRompe({ ...base, monto, diferenciaCambio: diferenciaDeCambio(monto, 4150, 4400) })).toEqual([])
    // El hotel cobró US$ 300 más (+14 %) a la misma TRM nueva: eso sí es del proveedor.
    const caro = Math.round(2384.4 * 4400)
    const rotas = reglasQueRompe({ ...base, monto: caro, diferenciaCambio: diferenciaDeCambio(caro, 4150, 4400) })
    expect(rotas.map(r => r.tipo)).toEqual(['desviacion_costo'])
    expect(rotas[0].texto).toMatch(/Sin contar \$[\d.]+ de diferencia de cambio\./)
  })

  it('el Cierre económico la llama diferencia de cambio', () => {
    const c = calcularCierre({
      precioAprobado: 10_000_000,
      cobrado: 10_000_000,
      iva: 0,
      recargo: 0,
      servicios: [{
        id: 's1', nombre: 'Renaissance', proveedor_nombre: null, estado: 'reservado', costo_cotizado: 8_650_260,
        valor_por_pagar: null, comision_esperada: null, comision_estado: null, moneda: { moneda: 'USD', monto: 2084.4, tasa: 4150 },
      }],
      gastos: [{ monto: 8_817_012, servicio_id: 's1', categoria: 'proveedor_viaje', descripcion: `Pago ${marcaTrm('USD', 4230)}` }],
    })
    expect(c.explicacion).toBe('Dejó $166.752 menos de lo cotizado: Renaissance (+$166.752, diferencia de cambio).')
  })
})
