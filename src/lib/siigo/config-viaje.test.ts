/**
 * Siigo listo para enchufar (adenda de la ola 4): la config de SOENA sigue intacta, una cuenta sin
 * mapeo no emite con la forma de otra, un negocio de prueba no emite en producción, y la factura de
 * viaje sale con sus dos productos. Cada guarda se probó quitándola (mutación).
 */
import { describe, expect, it } from 'vitest'
import type { SiigoConfig } from './client'
import {
  bloqueoPorEntorno,
  borradorFacturaViaje,
  entornoSiigo,
  esNegocioDePrueba,
  faltantesConfigViaje,
  formaDePagoRecibo,
  MENSAJE_PRUEBA_EN_PRODUCCION,
} from './config-viaje'
import { repartir } from '@/lib/facturacion/reparto-viaje'
import { simularDocumentosViaje } from './simular-viaje'

/** La config viva de SOENA: los 7 ids, nada más. */
const SOENA: SiigoConfig = {
  facturaDocumentId: 1, reciboDocumentId: 2, sellerId: 3, productoCode: '22', ivaId: 4, facturaPaymentId: 5, reciboPaymentId: 6,
}
const VIAJES: SiigoConfig = {
  ...SOENA,
  productoPropioCode: 'FEE', productoTercerosCode: 'TER', centroCostoId: 77, entorno: 'pruebas',
  reciboPaymentIdPorCuenta: { bancolombia: 91, davivienda: 92 },
}

describe('config de SOENA intacta', () => {
  it('sin entorno = producción; sin mapa = la forma de pago de siempre', () => {
    expect(entornoSiigo(SOENA)).toBe('produccion')
    expect(formaDePagoRecibo(SOENA, null)).toEqual({ ok: true, id: 6 })
    expect(formaDePagoRecibo(SOENA, 'cualquiera')).toEqual({ ok: true, id: 6 })
  })
  it('una cuenta con su propio id manda aun sin mapa (#1117)', () => {
    expect(formaDePagoRecibo(SOENA, 'nequi', 44)).toEqual({ ok: true, id: 44 })
  })
  it('sus negocios no son de prueba: la guarda no los toca', () => {
    expect(bloqueoPorEntorno(SOENA, {})).toBeNull()
    expect(bloqueoPorEntorno(SOENA, null)).toBeNull()
  })
})

describe('forma de pago por cuenta', () => {
  it('la de la cuenta donde entró la plata', () => {
    expect(formaDePagoRecibo(VIAJES, 'davivienda')).toEqual({ ok: true, id: 92 })
  })
  it('cuenta sin mapeo → «falta configurar», nunca la de otra ni la de respaldo', () => {
    const r = formaDePagoRecibo(VIAJES, 'nequi')
    expect(r).toEqual({ ok: false, falta: 'configurar en Siigo la forma de pago de la cuenta nequi' })
    expect(formaDePagoRecibo(VIAJES, null).ok).toBe(false)
  })
})

describe('entorno', () => {
  it('un negocio de prueba con entorno producción queda bloqueado (las dos marcas)', () => {
    expect(bloqueoPorEntorno({ ...VIAJES, entorno: 'produccion' }, { prueba: true })).toBe(MENSAJE_PRUEBA_EN_PRODUCCION)
    expect(bloqueoPorEntorno({ ...VIAJES, entorno: undefined }, { es_prueba: true })).toBe(MENSAJE_PRUEBA_EN_PRODUCCION)
  })
  it('en la empresa de pruebas sí emite', () => {
    expect(bloqueoPorEntorno(VIAJES, { prueba: true })).toBeNull()
  })
  it('solo `true` marca de prueba', () => {
    expect(esNegocioDePrueba({ prueba: 'si' })).toBe(false)
  })
})

describe('factura de viaje: dos conceptos', () => {
  it('ingreso propio con IVA y terceros sin IVA; el total cuadra con el precio', () => {
    const { payload, faltantes } = borradorFacturaViaje(VIAJES, '900123456', { propioConIva: 1_190_000, terceros: 7_810_000 }, '2026-10-20', 19)
    expect(faltantes).toEqual([])
    expect(payload.items).toEqual([
      { code: 'FEE', quantity: 1, price: 1_000_000, taxes: [{ id: 4 }] },
      { code: 'TER', quantity: 1, price: 7_810_000, taxes: [] },
    ])
    expect(payload.payments[0].value).toBe(9_000_000)
    expect(payload.cost_center).toBe(77)
    expect(payload.stamp).toEqual({ send: false })
  })
  it('sin los productos de viaje no sale lista (nunca con el producto de SOENA)', () => {
    expect(faltantesConfigViaje(SOENA)).toEqual([
      'configurar en Siigo el producto de ingreso propio',
      'configurar en Siigo el producto recibido para terceros',
    ])
    const { faltantes, payload } = borradorFacturaViaje(SOENA, '900123456', { propioConIva: 119, terceros: 1 }, '2026-10-20', 19)
    expect(faltantes.length).toBeGreaterThan(0)
    expect(payload.items.map(i => i.code)).not.toContain('22')
  })
  it('sin reparto o sin identificación, falta', () => {
    expect(borradorFacturaViaje(VIAJES, '', null, '2026-10-20', 19).faltantes).toEqual(
      expect.arrayContaining(['identificación', 'el reparto del valor entre ingreso propio y terceros']),
    )
  })
})

describe('reparto (la misma liquidación que el PDF)', () => {
  it('propio con IVA = gravable + IVA; terceros = el resto', () => {
    expect(repartir(9_000_000, { baseGravable: 1_000_000, iva: 190_000, precio: 'iva_aparte' }))
      .toEqual({ ok: true, reparto: { propioConIva: 1_190_000, terceros: 7_810_000 }, total: 9_000_000 })
  })
  it('un propio mayor que el precio no se factura', () => {
    expect(repartir(1_000, { baseGravable: 1_000, iva: 190, precio: 'iva_aparte' }).ok).toBe(false)
    expect(repartir(0, { baseGravable: 0, iva: 0, precio: 'iva_aparte' }).ok).toBe(false)
  })
})

describe('simulación: el payload exacto, sin Siigo', () => {
  const metadata = {
    titular_facturacion: { tipo: 'empresa', tipo_documento: '31', numero_documento: '900123456', nombre: 'Corp SAS', correo: 'f@corp.co', telefono: '3001234567', direccion: 'CL 10 20 30', municipio: 'Medellín', departamento: 'Antioquia' },
  }
  it('factura con los productos de viaje y recibo con la forma de pago de su cuenta', () => {
    const sim = simularDocumentosViaje({
      cfg: VIAJES, metadata, contacto: { email: null, telefono: null },
      reparto: { ok: true, reparto: { propioConIva: 1_190_000, terceros: 7_810_000 } },
      cobrosPendientes: [
        { id: 'c1', monto: 2_700_000, fecha: '2026-10-15', cuenta_recaudo: 'bancolombia' },
        { id: 'c2', monto: 100_000, fecha: '2026-10-16', cuenta_recaudo: 'nequi' },
      ],
      cuentas: [], hoy: '2026-10-20', conceptoRecibo: 'Abono a viaje',
    })
    expect(sim.entorno).toBe('pruebas')
    expect(sim.bloqueo).toBeNull()
    expect(sim.cliente.payload.identification).toBe('900123456')
    expect(sim.cliente.faltantes).toEqual([])
    expect(sim.factura?.payload.items.map(i => i.code)).toEqual(['FEE', 'TER'])
    expect(sim.recibos[0].payload?.payment).toEqual({ id: 91, value: 2_700_000 })
    expect(sim.recibos[0].payload?.customer.identification).toBe('900123456')
    expect(sim.recibos[1]).toEqual({ cobroId: 'c2', payload: null, faltantes: ['configurar en Siigo la forma de pago de la cuenta nequi'] })
  })
  it('negocio de prueba con entorno producción: la simulación lo dice', () => {
    const sim = simularDocumentosViaje({
      cfg: { ...VIAJES, entorno: 'produccion' }, metadata: { ...metadata, prueba: true }, contacto: { email: null, telefono: null },
      reparto: null, cobrosPendientes: [], cuentas: [], hoy: '2026-10-20', conceptoRecibo: 'Abono',
    })
    expect(sim.bloqueo).toBe(MENSAJE_PRUEBA_EN_PRODUCCION)
    expect(sim.factura).toBeNull()
  })
})
