/**
 * La factura sale SIN esperar el recaudo, y al salir se abonan los pagos anteriores.
 *
 * Decisión de Mauricio (2026-09-22), regla 1 del brief: «se quita la condición de
 * recaudo del servidor y de la cola». Del 2026-09-08 al 22 este archivo probaba lo
 * contrario —el gate de tres ramas con su banda del 1%—, y por eso conserva su historia:
 * las dos afirmaciones que importan ahora son que la factura sale con CERO recaudo y que
 * sale por el honorario COMPLETO (nunca por lo recaudado: eso arrastraría la base
 * gravable y el plan de cobro).
 *
 * La otra mitad, regla 2: al emitir se abonan los pagos que el negocio YA tenía. Aquí se
 * fija el cableado (se llama después de guardar la marca, no cuando la emisión falla, y
 * su resultado viaja al llamador). Lo que el abono HACE lo prueba
 * `abono-factura.test.ts`.
 *
 * El doble es de solo lectura salvo en `negocios.metadata`, que es donde queda la
 * marca; contra Siigo no sale una sola petición de red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const WS = 'ws-soena'
const NEG = 'neg-v0224'
const HONORARIO = 850_000

let fila: { id: string; precio_aprobado: number; linea_id: string | null; metadata: Record<string, unknown> }
/** Cuerpos que la emisión mandó a `/v1/invoices`. Lo que de verdad se factura. */
let facturasEnviadas: Array<{ items?: Array<{ price?: number }>; payments?: Array<{ value?: number }> }>
/** Llamadas al abono de los pagos anteriores, con la marca que había en ese momento. */
let abonosPedidos: Array<{ negocio: string; marcaAlLlamar: unknown }>
/** Si está puesto, Siigo tiene una factura libre del cliente (duplicado). */
let conDuplicado: boolean

function servicioFalso() {
  return {
    from(tabla: string) {
      if (tabla !== 'negocios') throw new Error(`tabla inesperada en el doble: ${tabla}`)
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        range: () => chain,
        single: async () => ({ data: { ...fila }, error: null }),
        maybeSingle: async () => ({ data: { ...fila }, error: null }),
        update: (patch: Record<string, unknown>) => {
          const aplicar = { ...patch }
          const upd = {
            eq: () => upd,
            then: (resolve: (v: { error: null }) => unknown) => {
              Object.assign(fila, aplicar)
              return resolve({ error: null })
            },
          }
          return upd
        },
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: [], error: null }),
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
      if (ruta.startsWith('/v1/invoices?')) {
        return conDuplicado
          ? { results: [{ id: 'fv-libre', name: 'FV-2-100', date: '2026-01-01', total: HONORARIO, items: [{ code: '11' }] }] }
          : { results: [] }
      }
      if (ruta.endsWith('/pdf')) return {}
      facturasEnviadas.push((opciones?.body ?? {}) as typeof facturasEnviadas[number])
      return { id: 'siigo-fv-1', name: 'FV-2-600', total: HONORARIO }
    },
  }
})

vi.mock('./clientes', () => ({
  asegurarClienteSiigo: async () => ({
    estado: 'ya_existia' as const, identificacion: '80815711', siigo_id: 'siigo-cli-1',
  }),
  corregirContactoParaFactura: async () => ({ ok: true as const, cambiado: false }),
}))

vi.mock('./concepto-negocio', () => ({
  resolverConceptoDeNegocio: async () => ({ code: '11', servicio: 'completo', porDefecto: false }),
}))

vi.mock('./archivar-documento', () => ({
  archivarPdfEnBloque: async () => ({ ok: true as const, url: null }),
}))

vi.mock('./abonos-factura', () => ({
  abonarPagosPreviosALaFactura: async (_ws: string, negocio: string) => {
    abonosPedidos.push({ negocio, marcaAlLlamar: fila.metadata.siigo_factura ?? null })
    return { emitidos: [{ cobro_id: 'cob-1', numero: 'RC-1-90', valor: 425_000 }], a_mano: [], fallidos: [] }
  },
}))

vi.mock('@/lib/facturacion/leer-factura-del-negocio', () => ({
  leerFacturaDeUnNegocio: async () => null,
}))

vi.mock('@/app/(app)/negocios/negocio-v2-actions', () => ({
  cerrarNegocioSiQuedaResuelto: async () => {},
}))

import { emitirFacturaNegocio } from './facturas'

const emitir = (justificacionDuplicado?: string) =>
  emitirFacturaNegocio(WS, NEG, 'Diana', { emitir: true, justificacionDuplicado }, { ivaPct: 19, staffId: null })

beforeEach(() => {
  facturasEnviadas = []
  abonosPedidos = []
  conDuplicado = false
  fila = { id: NEG, precio_aprobado: HONORARIO, linea_id: null, metadata: {} }
})

describe('emitirFacturaNegocio — sin gate de recaudo', () => {
  it('emite aunque el cliente no haya pagado un peso', async () => {
    // Ya no existe el contexto de recaudo: la emisión ni siquiera lo pide.
    const r = await emitir()
    expect(r).toMatchObject({ ok: true, numero: 'FV-2-600' })
    expect(facturasEnviadas).toHaveLength(1)
  })

  it('⚠️ la factura sale por el honorario COMPLETO, a crédito', async () => {
    await emitir()
    // La base con IVA reconstruye el honorario completo: no baja a lo recaudado.
    expect(facturasEnviadas[0].payments?.[0]?.value).toBe(HONORARIO)
    expect((fila.metadata.siigo_factura as { total: number }).total).toBe(HONORARIO)
  })

  it('ninguna marca nueva lleva justificación de descuadre: esa decisión ya no existe', async () => {
    await emitir()
    expect(fila.metadata.siigo_factura).not.toHaveProperty('justificacion_descuadre')
  })

  it('el duplicado en Siigo sigue bloqueando: esa barrera no era del recaudo', async () => {
    conDuplicado = true
    const r = await emitir()
    expect(r).toMatchObject({ ok: false, motivo: 'duplicado_en_siigo' })
    expect(facturasEnviadas).toHaveLength(0)
  })
})

describe('emitirFacturaNegocio — al emitir se abonan los pagos anteriores', () => {
  it('pide el abono DESPUÉS de guardar la marca: el abono lee la factura de ahí', async () => {
    await emitir()
    expect(abonosPedidos).toHaveLength(1)
    expect(abonosPedidos[0].negocio).toBe(NEG)
    expect(abonosPedidos[0].marcaAlLlamar).toMatchObject({ numero: 'FV-2-600', siigo_id: 'siigo-fv-1' })
  })

  it('lo que salió viaja al llamador, para decirlo en pantalla y en el timeline', async () => {
    const r = await emitir()
    expect(r.ok && r.abonos.emitidos).toEqual([{ cobro_id: 'cob-1', numero: 'RC-1-90', valor: 425_000 }])
  })

  it('si la factura NO sale, no se abona nada', async () => {
    conDuplicado = true
    await emitir()
    expect(abonosPedidos).toHaveLength(0)
  })
})
