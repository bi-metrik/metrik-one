/**
 * La factura se marca en cuanto existe, y lo demás corre después de responder.
 *
 * El caso que lo motivó (SOENA, V0549, FV-2-602, 2026-10-05): la acción tardó 61 s. La
 * marca se guardó 41 s después de empezar porque esperaba al PDF, que no respondió en
 * 20 s: en ese hueco la factura existía en Siigo y ONE no lo sabía.
 *
 * LO QUE FIJA:
 *  1. La marca se guarda ANTES de pedir el PDF (también en línea).
 *  2. Dentro de un request la emisión responde con la marca guardada y SIN haber pedido
 *     PDF, archivo ni abonos (`completando`). Lo que se le manda a Siigo es lo mismo.
 *  3. Lo agendado archiva, agrega CUFE y archivo a la marca y abona; lo que sale mal
 *     queda en la actividad del negocio (nadie está mirando la pantalla).
 *
 * `after` de `next/server` se sustituye por una cola que la prueba vacía a mano.
 *
 * VISTO FALLAR (2026-10-05, una mutación a la vez): la respuesta esperando las
 * consecuencias → 1 roja; sin la anotación en la actividad → 2 rojas; sin agregar CUFE y
 * archivo a la marca → 1 roja.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const WS = 'ws-soena'
const NEG = 'neg-v0549'

const agendadas: Array<() => Promise<void>> = []
const pasos: string[] = []
const actividad: string[] = []
let fila: { id: string; precio_aprobado: number; linea_id: string | null; metadata: Record<string, unknown> }
let pdfResponde = true

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
        single: async () => ({ data: structuredClone(fila), error: null }),
        maybeSingle: async () => ({ data: structuredClone(fila), error: null }),
        update: (patch: Record<string, unknown>) => {
          const upd = {
            eq: () => upd,
            then: (resolve: (v: { error: null }) => unknown) => {
              Object.assign(fila, structuredClone(patch))
              const m = (patch.metadata as { siigo_factura?: { cufe?: string | null } } | undefined)?.siigo_factura
              if (m) pasos.push(m.cufe ? 'marca+cufe' : 'marca')
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

vi.mock('next/server', () => ({ after: (fn: () => Promise<void>) => { agendadas.push(fn) } }))
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
    siigoRequest: async (_ws: string, ruta: string, opts?: { method?: string }) => {
      if (ruta.startsWith('/v1/invoices?')) return { results: [] }
      if (ruta.endsWith('/pdf')) {
        pasos.push('pdf')
        if (!pdfResponde) throw new real.SiigoError('Siigo no respondió en 20 s (GET pdf)', 0, ['timeout'])
        return { base64: Buffer.from('%PDF').toString('base64'), cufe: 'cufe-602' }
      }
      if (opts?.method === 'POST') pasos.push('POST')
      return { id: 'siigo-fv-602', name: 'FV-2-602', total: 425000 }
    },
  }
})
vi.mock('./clientes', () => ({
  asegurarClienteSiigo: async () => ({ estado: 'ya_existia' as const, identificacion: '900831342', siigo_id: 'cli-1' }),
  guardarCorreccionesDeFactura: async () => ({ ok: true as const, contactoCambiado: false, titularCambiado: false }),
  empujarCorreccionesAlTercero: async () => ({ ok: true as const, empujado: false }),
}))
vi.mock('./concepto-negocio', () => ({
  resolverConceptoDeNegocio: async () => ({ code: '11', servicio: 'completo', porDefecto: false }),
}))
vi.mock('./archivar-documento', () => ({
  archivarPdfEnBloque: async () => { pasos.push('archivo'); return { ok: true as const, url: 'one://archivo/fv-602.pdf' } },
}))
vi.mock('./abonos-factura', () => ({
  abonarPagosDelNegocio: async () => {
    pasos.push('abonos')
    return { emitidos: [], a_mano: [{ cobro_id: 'c1', valor: 1, motivo: 'x' }], fallidos: [] }
  },
}))
vi.mock('@/lib/facturacion/leer-factura-del-negocio', () => ({ leerFacturaDeUnNegocio: async () => null }))
vi.mock('@/app/(app)/negocios/negocio-v2-actions', () => ({
  cerrarNegocioSiQuedaResuelto: async () => { pasos.push('cierre') },
}))
vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: async (_s: unknown, f: { contenido: string }) => { actividad.push(f.contenido) },
}))

import { emitirFacturaNegocio } from './facturas'

const emitir = () =>
  emitirFacturaNegocio(WS, NEG, 'Diana', { emitir: true, bloqueFacturaSlug: 'factura' }, { ivaPct: 19, staffId: 'staff-diana' })

const marca = () => fila.metadata.siigo_factura as { numero: string; cufe: string | null; archivo_url: string | null }

async function correrAgendadas() {
  while (agendadas.length) await agendadas.shift()!()
}

beforeEach(() => {
  agendadas.length = 0
  pasos.length = 0
  actividad.length = 0
  pdfResponde = true
  fila = { id: NEG, precio_aprobado: 425000, linea_id: null, metadata: {} }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('emitirFacturaNegocio — la marca primero, lo demás después de responder', () => {
  it('responde con la factura marcada y sin haber pedido PDF, archivo ni abonos', async () => {
    const r = await emitir()

    expect(r).toMatchObject({ ok: true, numero: 'FV-2-602', completando: true, archivada: null, abonos: null })
    expect(pasos).toEqual(['POST', 'marca'])
    expect(marca()).toMatchObject({ numero: 'FV-2-602', cufe: null, archivo_url: null })
    expect(agendadas).toHaveLength(1)
  })

  it('lo agendado archiva, completa la marca con CUFE y archivo, abona y anota lo pendiente', async () => {
    await emitir()
    await correrAgendadas()

    expect(pasos).toEqual(['POST', 'marca', 'pdf', 'archivo', 'marca+cufe', 'abonos', 'cierre'])
    expect(marca()).toMatchObject({ numero: 'FV-2-602', cufe: 'cufe-602', archivo_url: 'one://archivo/fv-602.pdf' })
    expect(actividad).toEqual(['Factura FV-2-602: 1 abono(s) quedan para Tesorería'])
  })

  it('un PDF que no responde no deja la factura sin marca, y queda dicho en la actividad', async () => {
    pdfResponde = false
    await emitir()
    // Lo que importa: la marca ya estaba antes de que el PDF fallara.
    expect(marca().numero).toBe('FV-2-602')
    await correrAgendadas()

    expect(pasos.indexOf('marca')).toBeLessThan(pasos.indexOf('pdf'))
    expect(marca().archivo_url).toBeNull()
    expect(actividad[0]).toContain('el PDF no quedó cargado en el negocio')
  })
})
