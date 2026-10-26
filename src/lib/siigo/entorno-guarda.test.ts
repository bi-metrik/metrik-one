/**
 * Un negocio de prueba NUNCA emite contra el Siigo de producción (adenda Siigo, C7.3, F8-5): ni la
 * factura ni el recibo llegan a pedir nada a Siigo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

let metadata: Record<string, unknown> = {}
let entorno: string | undefined
const pedidasASiigo: string[] = []

function cliente() {
  return {
    from: (tabla: string) => {
      const api: Record<string, unknown> = {
        select: () => api,
        eq: () => api,
        single: async () => ({ data: tabla === 'negocios'
          ? { id: 'n1', precio_aprobado: 100, linea_id: 'l', metadata }
          : { id: 'c1', negocio_id: 'n1', monto: 100, fecha: '2026-10-12', tipo_cobro: 'pago', siigo_recibo: null, anulado_at: null }, error: null }),
        maybeSingle: async () => ({ data: tabla === 'workspaces'
          ? { config_extra: { siigo_config: { entorno } } }
          : { metadata }, error: null }),
      }
      return api
    },
    rpc: async () => ({ data: {}, error: null }),
  }
}

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => cliente(), createClient: async () => cliente() }))
vi.stubGlobal('fetch', async (url: string) => { pedidasASiigo.push(String(url)); throw new Error('no se llama a Siigo en esta prueba') })

const { emitirFacturaNegocio } = await import('./facturas')
const { emitirReciboDeCobro } = await import('./recibos')
const { MENSAJE_PRUEBA_EN_PRODUCCION } = await import('./config-viaje')

beforeEach(() => {
  metadata = { prueba: true }
  entorno = undefined
  pedidasASiigo.length = 0
})

describe('guarda de entorno en la emisión', () => {
  it('factura: negocio de prueba + producción (o sin entorno) = no emite, sin tocar Siigo', async () => {
    expect(await emitirFacturaNegocio('ws', 'n1', null, { emitir: true })).toEqual({ ok: false, motivo: 'error', mensaje: MENSAJE_PRUEBA_EN_PRODUCCION })
    entorno = 'produccion'
    expect(await emitirFacturaNegocio('ws', 'n1', null, { emitir: true })).toMatchObject({ mensaje: MENSAJE_PRUEBA_EN_PRODUCCION })
    expect(pedidasASiigo).toEqual([])
  })

  it('recibo: igual', async () => {
    metadata = { es_prueba: true }
    expect(await emitirReciboDeCobro('ws', 'c1', null)).toEqual({ ok: false, motivo: 'error', mensaje: MENSAJE_PRUEBA_EN_PRODUCCION })
    expect(pedidasASiigo).toEqual([])
  })
})
