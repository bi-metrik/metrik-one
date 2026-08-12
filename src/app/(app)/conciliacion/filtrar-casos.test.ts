import { describe, it, expect } from 'vitest'
import { filtrarCasos } from './conciliacion-client'
import type { CasoPorFacturar } from '@/lib/actions/facturacion-actions'

/**
 * Los FORMATOS de teléfono son los que conviven hoy en la cola real de SOENA
 * (medido el 2026-08-12 sobre los 181 casos, todos con teléfono); los dígitos son
 * inventados a propósito, para no versionar números de clientes.
 */
const caso = (p: Partial<CasoPorFacturar>): CasoPorFacturar => ({
  negocio_id: 'x', codigo: null, nombre: null, etapa: null, etapa_numero: null,
  identificacion: null, cliente: null, telefono: null, honorario: null, valor_upme: null,
  faltan_factura: [], faltan_cliente: [], faltan_recibo: [],
  ya_facturado: false, factura_numero: null, recibo_numero: null,
  base_gravable: null, falta_saldo: 0, descartado: null,
  ...p,
})

const CASOS = [
  caso({ negocio_id: '1', codigo: 'V0006', cliente: 'JUAN PABLO ECHEVERRY', etapa: 'Seguimiento', telefono: '3100000001' }),
  caso({ negocio_id: '2', codigo: 'V0012', cliente: 'GEORGI NIKOLAEV', etapa: 'Cargue', telefono: '+57 316 0000002' }),
  caso({ negocio_id: '3', codigo: 'V0019', cliente: 'CLARA NICHOLLS', etapa: 'Cita', telefono: '310 0000003', identificacion: '52123456' }),
]

describe('filtrarCasos', () => {
  it('sin término devuelve la cola completa', () => {
    expect(filtrarCasos(CASOS, '')).toHaveLength(3)
  })

  it('busca por código', () => {
    expect(filtrarCasos(CASOS, 'v0012').map(c => c.negocio_id)).toEqual(['2'])
  })

  it('busca por nombre del cliente', () => {
    expect(filtrarCasos(CASOS, 'clara').map(c => c.negocio_id)).toEqual(['3'])
  })

  it('busca por etapa y por cédula', () => {
    expect(filtrarCasos(CASOS, 'cargue').map(c => c.negocio_id)).toEqual(['2'])
    expect(filtrarCasos(CASOS, '52123456').map(c => c.negocio_id)).toEqual(['3'])
  })

  it('busca por celular en los tres formatos que conviven en la base', () => {
    expect(filtrarCasos(CASOS, '3100000001').map(c => c.negocio_id)).toEqual(['1'])
    expect(filtrarCasos(CASOS, '3160000002').map(c => c.negocio_id)).toEqual(['2'])
    expect(filtrarCasos(CASOS, '3100000003').map(c => c.negocio_id)).toEqual(['3'])
  })

  it('encuentra por celular aunque se teclee con indicativo o con guiones', () => {
    expect(filtrarCasos(CASOS, '+57 310 000 0001').map(c => c.negocio_id)).toEqual(['1'])
    expect(filtrarCasos(CASOS, '316-000-0002').map(c => c.negocio_id)).toEqual(['2'])
  })

  it('un celular que no está no devuelve nada', () => {
    expect(filtrarCasos(CASOS, '3009998877')).toHaveLength(0)
  })
})
