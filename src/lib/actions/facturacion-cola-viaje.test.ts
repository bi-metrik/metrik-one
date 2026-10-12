/**
 * La cola de facturación con viajes (F5, Vera C4, F5-1, F5-5, F5-6) y el arreglo de
 * `desde_etapa_numero` por línea (Max §7).
 *
 * Mismo doble que las demás pruebas de la cola (`test/cola-facturacion-doble`): las de SOENA
 * siguen en verde sin tocarse, que es la prueba de que su cola no cambia.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WS, reiniciarDoble, sembrar, servicioFalso, estado, type Fila } from '../../../test/cola-facturacion-doble'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
  createClient: async () => servicioFalso(),
}))
vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({
    workspaceId: WS, staffId: 'staff-diana', role: 'owner', areas: ['financiera'], supabase: null,
  }),
}))
vi.mock('@/lib/siigo/client', () => ({ siigoRequest: async () => ({ results: [] }), SiigoError: class extends Error {} }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
// La idempotencia tiene su propia prueba; aquí solo importa la guarda de la emisión.
vi.mock('@/lib/idempotencia/accion', () => ({ accionIdempotente: (_o: unknown, fn: () => unknown) => fn() }))

import { getColaFacturacion, emitirFacturaDeNegocio } from './facturacion-actions'
import { FALTA_FACTURA_VIAJE } from '@/lib/facturacion/cola-viaje'

const VIAJE = 'linea-viaje'
const EMPRESA = { tipo: 'empresa', tipo_documento: '31', numero_documento: '900123456', nombre: 'Viajes Corporativos SAS', correo: 'facturas@corp.co', telefono: '3001234567', direccion: 'CL 10 20 30', municipio: 'Medellín', departamento: 'Antioquia' }
const PERSONA = { tipo: 'viajero', tipo_documento: '13', numero_documento: '52100200', nombre: 'Carolina Prueba Duarte', correo: 'caro@example.com', telefono: '3001112233', direccion: 'CR 5 6 7', municipio: 'Bogotá', departamento: 'Bogotá D.C.' }
const CONFIRMADA = { registrada_at: '2026-10-12T10:00:00Z' }

function lineaViaje(extra: Record<string, unknown> = {}): Fila {
  return { id: VIAJE, workspace_id: WS, config_extra: { facturacion: { desde_etapa_numero: 4, por_titular: { activo: true }, ...extra } } }
}

function viaje(id: string, metadata: Record<string, unknown>, etapa = 2, precio = 9_000_000): Fila {
  return {
    id, codigo: id.toUpperCase(), nombre: `Viaje ${id}`, workspace_id: WS, estado: 'abierto', precio_aprobado: precio,
    contacto_id: null, linea_id: VIAJE, metadata, etapas_negocio: { nombre: 'Confirmación', numero: etapa },
  }
}

const ids = async () => {
  const { data, error } = await getColaFacturacion()
  expect(error).toBeUndefined()
  return data!.casos.map(c => c.negocio_id).sort()
}

beforeEach(() => {
  reiniciarDoble()
  sembrar({ casos: 1 })
  estado.fixtures.aprobaciones_excepcion = []
})

describe('desde_etapa_numero por línea', () => {
  it('cada línea usa el suyo; antes la primera mandaba para todas', async () => {
    estado.fixtures.lineas_negocio.push({ id: 'linea-2', workspace_id: WS, config_extra: { facturacion: { desde_etapa_numero: 7 } } })
    estado.fixtures.negocios.push({ id: 'neg-l2', codigo: 'L2', nombre: 'L2', workspace_id: WS, estado: 'abierto', precio_aprobado: 1, contacto_id: null, linea_id: 'linea-2', metadata: {}, etapas_negocio: { nombre: 'X', numero: 6 } })
    expect(await ids()).toEqual(['neg-0000'])
    estado.fixtures.negocios.at(-1)!.etapas_negocio = { nombre: 'X', numero: 8 }
    expect(await ids()).toEqual(['neg-0000', 'neg-l2'])
  })

  it('una línea sin valor propio hereda el primero (ninguna cola cambia)', async () => {
    estado.fixtures.lineas_negocio.push({ id: 'linea-3', workspace_id: WS, config_extra: {} })
    estado.fixtures.negocios.push({ id: 'neg-l3', codigo: 'L3', nombre: 'L3', workspace_id: WS, estado: 'abierto', precio_aprobado: 1, contacto_id: null, linea_id: 'linea-3', metadata: {}, etapas_negocio: { nombre: 'X', numero: 6 } })
    expect(await ids()).toEqual(['neg-0000', 'neg-l3'])
  })
})

describe('viajes: por evento y no por etapa (C4)', () => {
  beforeEach(() => {
    estado.fixtures.lineas_negocio.push(lineaViaje())
  })

  it('empresa: entra al registrar la confirmación, en cualquier etapa (sin el bloqueo circular)', async () => {
    estado.fixtures.negocios.push(viaje('emp-ok', { titular_facturacion: EMPRESA, confirmacion_cliente: CONFIRMADA }, 2))
    estado.fixtures.negocios.push(viaje('emp-no', { titular_facturacion: EMPRESA }, 9))
    expect(await ids()).toEqual(['emp-ok', 'neg-0000'])
  })

  it('el desde_etapa_numero = 4 heredado NO manda en la línea del viaje', async () => {
    estado.fixtures.negocios.push(viaje('persona-etapa', { titular_facturacion: PERSONA }, 9))
    expect(await ids()).toEqual(['neg-0000'])
  })

  it('persona natural: entra con el paquete enviado Y el saldo en cero', async () => {
    const paquete = { paquete_viaje: { enviado_at: '2026-11-01T10:00:00Z' } }
    estado.fixtures.negocios.push(viaje('per-ok', { titular_facturacion: PERSONA, ...paquete }, 6, 1_000_000))
    estado.fixtures.negocios.push(viaje('per-saldo', { titular_facturacion: PERSONA, ...paquete }, 6, 1_000_000))
    estado.fixtures.negocios.push(viaje('per-sin-paquete', { titular_facturacion: PERSONA }, 6, 1_000_000))
    estado.fixtures.cobros.push(
      { id: 'c1', workspace_id: WS, negocio_id: 'per-ok', monto: 1_000_000, fecha: '2026-10-20', anulado_at: null },
      { id: 'c2', workspace_id: WS, negocio_id: 'per-saldo', monto: 800_000, fecha: '2026-10-20', anulado_at: null },
      // Una cuota programada (sin fecha) no es plata: no deja el saldo en cero.
      { id: 'c3', workspace_id: WS, negocio_id: 'per-saldo', monto: 200_000, fecha: null, anulado_at: null },
      { id: 'c4', workspace_id: WS, negocio_id: 'per-sin-paquete', monto: 1_000_000, fecha: '2026-10-20', anulado_at: null },
    )
    expect(await ids()).toEqual(['neg-0000', 'per-ok'])
  })

  it('forzada por la dirección: entra antes de su evento', async () => {
    estado.fixtures.negocios.push(viaje('forzada', { titular_facturacion: PERSONA }, 5))
    estado.fixtures.aprobaciones_excepcion.push({ id: 'ap', workspace_id: WS, negocio_id: 'forzada', tipo: 'forzar_factura', estado: 'aprobada' })
    expect(await ids()).toEqual(['forzada', 'neg-0000'])
    // Una pedida o rechazada no cuenta.
    estado.fixtures.aprobaciones_excepcion[0].estado = 'rechazada'
    expect(await ids()).toEqual(['neg-0000'])
  })

  it('a nombre del titular de la confirmación (también un tercero), con su dirección y ciudad; y nunca listo sin los productos de viaje', async () => {
    estado.fixtures.negocios.push(viaje('emp-ok', { titular_facturacion: EMPRESA, confirmacion_cliente: CONFIRMADA }))
    const { data } = await getColaFacturacion()
    const caso = data!.casos.find(c => c.negocio_id === 'emp-ok')!
    expect(caso.identificacion).toBe('900123456')
    expect(caso.cliente).toBe('Viajes Corporativos SAS')
    expect(caso.titular.tipo_documento).toBe('31')
    expect(caso.email).toBe('facturas@corp.co')
    expect(caso.faltan_cliente).toEqual([])
    expect(caso.faltan_factura).toContain(FALTA_FACTURA_VIAJE)
  })

  it('sin dirección ni ciudad, la cola lo dice antes de emitir', async () => {
    const { direccion: _d, municipio: _m, departamento: _dep, ...sinUbicacion } = EMPRESA
    estado.fixtures.negocios.push(viaje('emp-ok', { titular_facturacion: sinUbicacion, confirmacion_cliente: CONFIRMADA }))
    const { data } = await getColaFacturacion()
    const caso = data!.casos.find(c => c.negocio_id === 'emp-ok')!
    expect(caso.faltan_cliente).toEqual(expect.arrayContaining(['dirección']))
    expect(caso.faltan_cliente.some(f => f.startsWith('ciudad'))).toBe(true)
  })
})

describe('apagado (F5-6)', () => {
  it('facturacion.activo = false: ningún negocio de la línea entra, tampoco por etapa', async () => {
    estado.fixtures.lineas_negocio.push(lineaViaje({ activo: false }))
    estado.fixtures.negocios.push(viaje('emp-ok', { titular_facturacion: EMPRESA, confirmacion_cliente: CONFIRMADA }, 9))
    expect(await ids()).toEqual(['neg-0000'])
  })

  it('un espacio con SOLO la línea del viaje no sale vacío por no tener desde', async () => {
    estado.fixtures.lineas_negocio = [{ id: VIAJE, workspace_id: WS, config_extra: { facturacion: { por_titular: { activo: true } } } }]
    estado.fixtures.negocios = [viaje('emp-ok', { titular_facturacion: EMPRESA, confirmacion_cliente: CONFIRMADA })]
    expect(await ids()).toEqual(['emp-ok'])
  })
})

describe('emisión de un viaje', () => {
  beforeEach(() => {
    estado.fixtures.lineas_negocio.push(lineaViaje())
  })

  it('no emite lo que no entró a la cola, ni con el producto de SOENA', async () => {
    estado.fixtures.negocios.push(viaje('emp-no', { titular_facturacion: EMPRESA }))
    expect(await emitirFacturaDeNegocio('emp-no')).toMatchObject({ ok: false, error: expect.stringContaining('todavía no entra') })
    estado.fixtures.negocios.push(viaje('emp-ok', { titular_facturacion: EMPRESA, confirmacion_cliente: CONFIRMADA }))
    expect(await emitirFacturaDeNegocio('emp-ok')).toMatchObject({ ok: false, error: expect.stringContaining('productos de viaje') })
  })
})
