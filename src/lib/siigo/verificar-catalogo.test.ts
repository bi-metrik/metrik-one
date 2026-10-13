/**
 * `check-siigo` (adenda Siigo): cada id existe y está activo en ESA empresa, solo con GET.
 */
import { describe, expect, it } from 'vitest'
import { verificarCatalogo } from './verificar-catalogo'

const CATALOGO: Record<string, unknown> = {
  '/v1/document-types?type=FV': [{ id: 1, name: 'FV-1 Factura electrónica', active: true }],
  '/v1/document-types?type=RC': [{ id: 2, name: 'RC-1', active: true }],
  '/v1/taxes': [{ id: 4, name: 'IVA 19%', active: true }],
  '/v1/payment-types?document_type=FV': [{ id: 5, name: 'Crédito', active: true }],
  '/v1/payment-types?document_type=RC': [{ id: 6, name: 'Caja', active: true }, { id: 91, name: 'Bancolombia', active: true }, { id: 92, name: 'Davivienda', active: false }],
  '/v1/users': { results: [{ id: 3, username: 'vendedor', active: true }] },
  '/v1/products?page_size=100': { results: [{ code: 'FEE', name: 'Fee de agencia', active: true }, { code: 'TER', name: 'Recibido para terceros', active: true }] },
  '/v1/cost-centers': [{ id: 77, name: 'Viajes', active: true }],
}

function doble() {
  const llamadas: string[] = []
  const get = async <T,>(path: string): Promise<T> => {
    llamadas.push(path)
    if (!(path in CATALOGO)) throw new Error(`sin ${path}`)
    return CATALOGO[path] as T
  }
  return { get, llamadas }
}

const BASE = { facturaDocumentId: 1, reciboDocumentId: 2, sellerId: 3, productoCode: 'FEE', ivaId: 4, facturaPaymentId: 5, reciboPaymentId: 6 }

describe('verificarCatalogo', () => {
  it('todo existe y está activo: OK, y solo se leyó', async () => {
    const { get, llamadas } = doble()
    const v = await verificarCatalogo({ ...BASE, productoPropioCode: 'FEE', productoTercerosCode: 'TER', centroCostoId: 77, entorno: 'pruebas', reciboPaymentIdPorCuenta: { bancolombia: 91 } }, get)
    expect(v.ok).toBe(true)
    expect(v.entorno).toBe('pruebas')
    expect(v.faltan).toEqual([])
    expect(llamadas.every(p => p.startsWith('/v1/'))).toBe(true)
  })

  it('un id inexistente o inactivo se reporta y no pasa', async () => {
    const { get } = doble()
    const v = await verificarCatalogo({ ...BASE, sellerId: 999, productoPropioCode: 'FEE', productoTercerosCode: 'TER', entorno: 'produccion', reciboPaymentIdPorCuenta: { davivienda: 92 } }, get)
    expect(v.ok).toBe(false)
    expect(v.lineas.filter(l => !l.ok).map(l => l.texto)).toEqual([
      'Vendedor (999): NO EXISTE en esta empresa',
      'Forma de pago del recibo para la cuenta davivienda (92): «Davivienda» (INACTIVO)',
    ])
  })

  it('un espacio con viajes sin entorno o sin mapa por cuenta: lo dice', async () => {
    const { get } = doble()
    const v = await verificarCatalogo({ ...BASE, productoPropioCode: 'FEE' }, get)
    expect(v.ok).toBe(false)
    expect(v.faltan).toEqual([
      'configurar en Siigo el producto recibido para terceros',
      'la forma de pago del recibo por cuenta (reciboPaymentIdPorCuenta)',
      'el entorno (pruebas o produccion)',
    ])
  })

  it('SOENA (sin campos de viaje): no le pide nada de viajes', async () => {
    const { get } = doble()
    const v = await verificarCatalogo(BASE, get)
    expect(v.faltan).toEqual([])
    expect(v.entorno).toBe('produccion')
  })
})
