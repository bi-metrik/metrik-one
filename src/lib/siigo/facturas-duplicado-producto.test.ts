/**
 * El guardián de duplicados tenía un punto ciego del tamaño de una factura
 * electrónica.
 *
 * `facturasDelClienteEnSiigo` filtraba las facturas del cliente **por el producto
 * que se iba a emitir**. Medido el 2026-09-07 sobre las 482 facturas del Siigo de
 * SOENA: las 269 que emitió ONE van bajo el producto `11`, y de las 213 que ningún
 * negocio de ONE reclama, 146 van bajo el `22`. O sea que una factura hecha a mano
 * bajo el 22 **pasaba el guard sin ruido** cuando ONE iba a emitir bajo el 11.
 *
 * Es exactamente lo que le pasó a V0345: ya tenía factura del 31 de marzo por su
 * valor exacto ($637.500), y lo único que evitó la segunda fue un error de
 * sucursal — un accidente, no un control.
 *
 * La primera prueba se vio FALLAR contra el código de `main` (2026-09-07): con el
 * filtro por producto, la emisión salía `ok: true` y radicaba la segunda factura.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const WS = 'ws-soena'
const NEG = 'neg-v0345'

/** Única fila de `negocios`. */
let fila: { id: string; precio_aprobado: number; linea_id: string | null; metadata: Record<string, unknown> }
/** Lo que Siigo devuelve al preguntar por las facturas del cliente. */
let facturasEnSiigo: Array<{ id: string; name: string; date: string; total: number; items: Array<{ code: string }> }>
/** La URL con la que se consultaron las facturas, para poder mirarla. */
let rutaDeConsulta = ''

function servicioFalso() {
  return {
    from(tabla: string) {
      if (tabla !== 'negocios') throw new Error(`tabla inesperada en el doble: ${tabla}`)
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        // El listado de marcas del workspace (`marcasDeFacturaDelWorkspace`) los usa.
        // Aquí vuelve vacío: ningún negocio reclama nada, así que TODAS las facturas
        // de este archivo son libres y el guardián las juzga. Las reclamadas se
        // prueban en `facturas-duplicado-hermanos.test.ts`.
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
    siigoRequest: async (_ws: string, ruta: string) => {
      if (ruta.startsWith('/v1/invoices?')) {
        rutaDeConsulta = ruta
        return { results: facturasEnSiigo }
      }
      if (ruta.endsWith('/pdf')) return {}
      return { id: 'siigo-fv-nueva', name: 'FV-2-999', total: 637500 }
    },
  }
})

vi.mock('./clientes', () => ({
  asegurarClienteSiigo: async () => ({
    estado: 'ya_existia' as const,
    identificacion: '52644999',
    siigo_id: 'siigo-cli-1',
    branch_office: 1,
  }),
  corregirContactoParaFactura: async () => ({ ok: true as const, cambiado: false }),
  identificacionDelNegocio: async () => ({ identificacion: '52644999', marca: null }),
}))

vi.mock('./concepto-negocio', () => ({
  resolverConceptoDeNegocio: async () => ({ code: '11', servicio: 'completo', porDefecto: false }),
}))

vi.mock('./archivar-documento', () => ({
  archivarPdfEnBloque: async () => ({ ok: true as const, url: null }),
}))

vi.mock('@/lib/negocios/copias-del-bloque', () => ({ idsDeCopiasDelBloque: async () => [] }))

// Arrastra media aplicación y no interviene en lo que se mide.
vi.mock('@/app/(app)/negocios/negocio-v2-actions', () => ({
  cerrarNegocioSiQuedaResuelto: async () => {},
}))

import { emitirFacturaNegocio, clasificarDuplicados, type FacturaEnSiigo } from './facturas'

const emitir = (justificacionDuplicado?: string) =>
  emitirFacturaNegocio(
    WS, NEG,
    'Diana',
    { emitir: true, justificacionDuplicado },
    // Honorario cubierto: lo único que puede frenar es lo que se prueba.
    { modelo: null, recaudado: 637500, ivaPct: 19, staffId: null },
  )

beforeEach(() => {
  rutaDeConsulta = ''
  fila = { id: NEG, precio_aprobado: 637500, linea_id: null, metadata: {} }
  // La factura real de V0345: producto 22 (hecha a mano), no el 11 que emite ONE.
  facturasEnSiigo = [
    { id: 'fv-78', name: 'FV-2-78', date: '2026-03-31', total: 637500, items: [{ code: '22' }] },
  ]
})

describe('el guardián ve las facturas de OTRO producto', () => {
  it('una factura del producto 22 BLOQUEA la emisión bajo el 11', async () => {
    const r = await emitir()

    expect(r).toMatchObject({ ok: false, motivo: 'duplicado_en_siigo' })
    if (r.ok || r.motivo !== 'duplicado_en_siigo') throw new Error('debía bloquear')
    expect(r.existentes).toHaveLength(1)
    expect(r.existentes[0]).toMatchObject({
      name: 'FV-2-78', date: '2026-03-31', total: 637500, mismo_producto: false,
    })
    // Y nada se emitió: el negocio sigue sin marca.
    expect(fila.metadata.siigo_factura).toBeUndefined()
  })

  it('la consulta a Siigo NO lleva filtro de producto', async () => {
    // Es la causa del punto ciego, y se comprueba en la URL y no en el resultado:
    // un filtro que volviera no se vería si el doble devuelve una sola factura.
    await emitir()
    expect(rutaDeConsulta).toContain('customer_identification=52644999')
    expect(rutaDeConsulta).not.toContain('code')
    expect(rutaDeConsulta).not.toContain('product')
  })

  it('con justificación escrita SÍ emite, y la justificación queda guardada', async () => {
    const r = await emitir('La del 22 es de otro servicio, confirmado con Diana')

    expect(r).toMatchObject({ ok: true, numero: 'FV-2-999' })
    expect(fila.metadata.siigo_factura).toMatchObject({
      justificacion_duplicado: 'La del 22 es de otro servicio, confirmado con Diana',
    })
  })

  it('una factura del MISMO producto sigue bloqueando, como siempre', async () => {
    facturasEnSiigo = [
      { id: 'fv-90', name: 'FV-2-90', date: '2026-08-05', total: 318750, items: [{ code: '11' }] },
    ]
    const r = await emitir()

    expect(r).toMatchObject({ ok: false, motivo: 'duplicado_en_siigo' })
    if (r.ok || r.motivo !== 'duplicado_en_siigo') throw new Error('debía bloquear')
    expect(r.existentes[0].mismo_producto).toBe(true)
  })

  it('sin facturas del cliente, emite sin pedir nada', async () => {
    facturasEnSiigo = []
    expect(await emitir()).toMatchObject({ ok: true, numero: 'FV-2-999' })
  })
})

describe('clasificarDuplicados', () => {
  const base: FacturaEnSiigo[] = [
    { id: 'a', name: 'FV-2-78', date: '2026-03-31', total: 637500, productos: ['22'] },
    { id: 'b', name: 'FV-2-90', date: '2026-08-05', total: 318750, productos: ['11'] },
    { id: 'c', name: 'FV-2-91', date: '2026-08-06', total: 100000, productos: ['22', '11'] },
    { id: 'd', name: 'FV-2-92', date: '2026-08-07', total: 100000, productos: [] },
  ]
  /** Nadie las reclama: es el escenario de este archivo. */
  const libres = new Map<string, { negocio_id: string; codigo: string | null }>()

  it('marca el mismo producto sin descartar el resto', () => {
    expect(clasificarDuplicados(base, '11', libres).duplicados.map(f => f.mismo_producto))
      .toEqual([false, true, true, false])
    // Ninguna se pierde: informar es el punto.
    expect(clasificarDuplicados(base, '11', libres).duplicados).toHaveLength(4)
    expect(clasificarDuplicados(base, '11', libres).hermanos).toEqual([])
  })

  it('una factura sin ítems legibles NO se da por del mismo producto', () => {
    // Asumir que sí la escondería del bloqueo evidente; asumir que no la deja
    // igual visible como advertencia, que es el lado seguro.
    expect(clasificarDuplicados([base[3]], '11', libres).duplicados[0].mismo_producto).toBe(false)
  })
})
