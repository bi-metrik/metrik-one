/**
 * El cableado de la emisión con un titular corregido.
 *
 * Lo que `titular-tercero.test.ts` prueba de cada pieza aquí se prueba en su ORDEN, que
 * es la protección: primero se guarda en ONE (sin tocar Siigo), después se resuelve el
 * tercero, y solo al final se le empuja lo corregido — y solo si el tercero ya existía.
 * Hasta el 2026-09-22 el PUT salía antes de resolver, contra la marca vieja: con un
 * titular corregido esa marca es la del titular ANTERIOR.
 *
 * Y la factura sale a la identificación que devolvió la resolución (la del titular
 * corregido), no a la del RUT.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const WS = 'ws-soena'
const NEG = 'neg-v0502'

let fila: { id: string; precio_aprobado: number; linea_id: string | null; metadata: Record<string, unknown> }
let pasos: string[]
let facturasEnviadas: Array<{ customer?: { identification?: string } }>
let estadoTercero: 'ya_existia' | 'creado'
let datosGuardados: unknown
let empujeFalla: boolean

function servicioFalso() {
  return {
    from() {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        range: () => chain,
        single: async () => ({ data: { ...fila }, error: null }),
        maybeSingle: async () => ({ data: { ...fila }, error: null }),
        update: (patch: Record<string, unknown>) => {
          const upd = {
            eq: () => upd,
            then: (resolve: (v: { error: null }) => unknown) => {
              Object.assign(fila, patch)
              return resolve({ error: null })
            },
          }
          return upd
        },
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null }),
      }
      return chain
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
  createClient: async () => servicioFalso(),
}))

vi.mock('./client', async () => {
  const real = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...real,
    getSiigoConfig: async () => ({
      facturaDocumentId: 1, reciboDocumentId: 2, sellerId: 3,
      productoCode: '11', ivaId: 4, facturaPaymentId: 5, reciboPaymentId: 6,
    }),
    siigoRequest: async (_ws: string, ruta: string, opciones?: { body?: unknown }) => {
      if (ruta.startsWith('/v1/invoices?')) return { results: [] }
      if (ruta.endsWith('/pdf')) return {}
      pasos.push('factura')
      facturasEnviadas.push((opciones?.body ?? {}) as typeof facturasEnviadas[number])
      return { id: 'siigo-fv-1', name: 'FV-2-700', total: 550035 }
    },
  }
})

vi.mock('./clientes', () => ({
  guardarCorreccionesDeFactura: async (_ws: string, _neg: string, datos: unknown) => {
    pasos.push('guardar')
    datosGuardados = datos
    return { ok: true as const, contactoCambiado: false, titularCambiado: true }
  },
  asegurarClienteSiigo: async () => {
    pasos.push('asegurar')
    return {
      estado: estadoTercero, identificacion: '52100200', siigo_id: 'id-paula',
      branch_office: 0, nombre: 'PAULA ANDREA OLIVEROS',
    }
  },
  empujarCorreccionesAlTercero: async (_ws: string, _neg: string, tercero: { siigo_id: string }) => {
    pasos.push(`empujar:${tercero.siigo_id}`)
    return empujeFalla
      ? { ok: false as const, mensaje: 'Siigo no aceptó el cambio' }
      : { ok: true as const, empujado: false }
  },
}))

vi.mock('./concepto-negocio', () => ({
  resolverConceptoDeNegocio: async () => ({ code: '11', servicio: 'completo', porDefecto: false }),
}))
vi.mock('./archivar-documento', () => ({ archivarPdfEnBloque: async () => ({ ok: true as const, url: null }) }))
vi.mock('./abonos-factura', () => ({ abonarPagosDelNegocio: async () => ({ emitidos: [], a_mano: [], fallidos: [] }) }))
vi.mock('@/lib/facturacion/leer-factura-del-negocio', () => ({ leerFacturaDeUnNegocio: async () => null }))
vi.mock('@/app/(app)/negocios/negocio-v2-actions', () => ({ cerrarNegocioSiQuedaResuelto: async () => {} }))

import { emitirFacturaNegocio } from './facturas'
import { validarTitular } from './titular'

const PAULA = (() => {
  const v = validarTitular({ tipo_documento: '13', numero: '52100200', nombres: 'PAULA ANDREA', apellidos: 'OLIVEROS' })
  if (!v.ok) throw new Error(v.mensaje)
  return v.titular
})()

const emitir = () => emitirFacturaNegocio(
  WS, NEG, 'Diana Parra',
  { emitir: true, datos: { titular: PAULA } },
  { ivaPct: 19, staffId: 'staff-diana' },
)

beforeEach(() => {
  pasos = []
  facturasEnviadas = []
  estadoTercero = 'ya_existia'
  datosGuardados = null
  empujeFalla = false
  fila = { id: NEG, precio_aprobado: 550035, linea_id: null, metadata: {} }
})

describe('emitirFacturaNegocio con titular corregido', () => {
  it('guarda en ONE, resuelve el tercero, empuja, y SOLO después factura', async () => {
    const r = await emitir()
    expect(r).toMatchObject({ ok: true })
    expect(pasos).toEqual(['guardar', 'asegurar', 'empujar:id-paula', 'factura'])
  })

  it('la corrección viaja a guardarse con el titular tal cual se validó', async () => {
    await emitir()
    expect(datosGuardados).toMatchObject({ titular: PAULA })
  })

  it('la factura sale al tercero que devolvió la resolución: el del titular corregido', async () => {
    await emitir()
    expect(facturasEnviadas[0].customer?.identification).toBe('52100200')
  })

  it('un tercero recién creado ya nació corregido: no hay nada que empujar', async () => {
    estadoTercero = 'creado'
    await emitir()
    expect(pasos).toEqual(['guardar', 'asegurar', 'factura'])
  })

  it('si Siigo no acepta el cambio del tercero, NO se factura', async () => {
    // Después de radicar ya no se corrige: el error se dice mientras se puede arreglar.
    empujeFalla = true
    const r = await emitir()
    expect(r).toMatchObject({ ok: false, motivo: 'error' })
    expect(facturasEnviadas).toHaveLength(0)
  })

  it('con factura ya emitida no se guarda ninguna corrección', async () => {
    fila.metadata = { siigo_factura: { numero: 'FV-2-542', siigo_id: 'e290a0f0' } }
    const r = await emitir()
    expect(r).toMatchObject({ ok: false, motivo: 'ya_facturado_en_one', numero: 'FV-2-542' })
    expect(pasos).toEqual([])
  })
})
