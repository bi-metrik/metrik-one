/**
 * `cargarFacturaManual`: que la acción de servidor OBEDEZCA la barrera.
 *
 * La decisión es pura y está probada en `lib/facturacion/factura-del-negocio.test.ts`. Lo
 * que se fija aquí es el cableado: que un PDF de otro emisor no llegue a
 * `archivarPdfEnBloque`, que se escriba con origen `cargada_manual` en el slug del bloque
 * ORIGINAL, y que quede constancia en el negocio. Una acción de servidor es una puerta
 * pública: si el cableado se rompe, la pantalla puede verse bien y la barrera no existir.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const WS = 'ws-soena'
const espias = vi.hoisted(() => ({
  archivar: vi.fn(),
  actividad: vi.fn(),
  leido: { emisor_nit: '901874885', numero_factura: 'FV-2-700' } as Record<string, string>,
  factura: null as unknown,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: () => {
      const chain = {
        select: () => chain, eq: () => chain, limit: () => chain,
        maybeSingle: async () => ({ data: { name: 'SOENA', full_name: 'Diana Parra' }, error: null }),
        then: (r: (v: unknown) => unknown) => r({ data: [{ config_extra: { campos_extraccion: [] } }], error: null }),
      }
      return chain
    },
  }),
  createClient: async () => ({}),
}))
vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: WS, staffId: 'staff-diana', role: 'owner', areas: ['financiera'], supabase: null }),
}))
vi.mock('@/lib/negocios/negocio-abierto', () => ({ bloqueoPorNegocioCerrado: async () => null }))
vi.mock('@/lib/facturacion/leer-factura-del-negocio', async (orig) => ({
  ...(await orig<typeof import('@/lib/facturacion/leer-factura-del-negocio')>()),
  leerFacturaDeUnNegocio: async () => espias.factura,
}))
vi.mock('@/lib/siigo/archivar-documento', () => ({ archivarPdfEnBloque: espias.archivar }))
vi.mock('@/lib/activity/registrar-actividad', () => ({ registrarActividad: espias.actividad }))
vi.mock('@/lib/server-keys', () => ({ getServerKey: () => 'clave' }))
vi.mock('@/lib/ai/extract-fields', () => ({
  extractFieldsFromDocument: async () => ({
    data: Object.fromEntries(Object.entries(espias.leido).map(([k, v]) => [k, { value: v, confidence: 1 }])),
  }),
}))
vi.mock('@/app/(app)/negocios/negocio-v2-actions', () => ({ cerrarNegocioSiQuedaResuelto: async () => {} }))
vi.mock('@/lib/siigo/client', () => ({ siigoRequest: async () => ({ results: [] }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { cargarFacturaManual } from './facturacion-actions'
import { resolverFacturaDelNegocio } from '@/lib/facturacion/factura-del-negocio'

const GATE = { bloque_slug: 'factura_emitida', emisor_nit_esperado: '901874885' }

function sinFactura(original: Record<string, unknown> | null = null) {
  return {
    resolucion: resolverFacturaDelNegocio({ original, marca: null, emisorNitEsperado: GATE.emisor_nit_esperado }),
    original, marca: null, slug: 'factura_emitida', gate: GATE, lineaId: 'linea-ve',
  }
}

function formulario(modo: 'leer' | 'guardar', extra: Record<string, string> = {}) {
  const fd = new FormData()
  fd.set('negocio_id', 'neg-v0428')
  fd.set('modo', modo)
  fd.set('archivo', new File([new Uint8Array([37, 80, 68, 70])], 'factura.pdf', { type: 'application/pdf' }))
  for (const [k, v] of Object.entries(extra)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  espias.archivar.mockReset().mockResolvedValue({ ok: true, url: 'https://drive/nuevo' })
  espias.actividad.mockReset().mockResolvedValue(undefined)
  espias.leido = { emisor_nit: '901874885', numero_factura: 'FV-2-700' }
  espias.factura = sinFactura()
})

describe('cargarFacturaManual', () => {
  it('la factura del VEHÍCULO no se guarda: ni al leer ni al guardar', async () => {
    espias.leido = { emisor_nit: '800041629', numero_factura: 'FV04 1199' }
    const leer = await cargarFacturaManual(formulario('leer'))
    expect(leer.ok).toBe(false)
    expect(leer.error).toMatch(/^Este documento no es una factura emitida por SOENA/)

    const guardar = await cargarFacturaManual(formulario('guardar', { numero: 'FV04 1199' }))
    expect(guardar.ok).toBe(false)
    expect(espias.archivar).not.toHaveBeenCalled()
    expect(espias.actividad).not.toHaveBeenCalled()
  })

  it('leer no escribe nada y prellena el número', async () => {
    const r = await cargarFacturaManual(formulario('leer'))
    expect(r).toMatchObject({ ok: true, leido: { numero: 'FV-2-700', emisor: '901874885' }, reemplaza: false })
    expect(espias.archivar).not.toHaveBeenCalled()
  })

  it('guardar escribe en el ORIGINAL con origen cargada_manual y deja constancia', async () => {
    const r = await cargarFacturaManual(formulario('guardar', { numero: 'FV-2-700' }))
    expect(r).toMatchObject({ ok: true, numero: 'FV-2-700' })
    expect(espias.archivar).toHaveBeenCalledTimes(1)
    const args = espias.archivar.mock.calls[0]
    expect(args[0]).toBe(WS)
    expect(args[1]).toBe('neg-v0428')
    expect(args[2]).toBe('factura_emitida')
    expect(args[4]).toBe('FV-2-700.pdf')
    expect(args[5]).toMatchObject({ numero_factura: 'FV-2-700', emisor_nit: '901874885' })
    expect(args[7]).toBe('cargada_manual')
    expect(espias.actividad).toHaveBeenCalledTimes(1)
    expect(espias.actividad.mock.calls[0][1]).toMatchObject({
      tipo: 'sistema', autor_id: 'staff-diana',
      contenido: expect.stringContaining('Factura FV-2-700 cargada a mano desde Tesorería'),
    })
  })

  it('reemplazar sin motivo no escribe; con motivo sí, y lo registra', async () => {
    espias.factura = sinFactura({
      campos: { numero_factura: { value: 'FV-2-600' }, emisor_nit: { value: '901874885' } },
      drive_url: 'https://drive/anterior', file_name: 'FV-2-600.pdf', origen: 'cargada_manual',
    })
    const sinMotivo = await cargarFacturaManual(formulario('guardar', { numero: 'FV-2-700' }))
    expect(sinMotivo.ok).toBe(false)
    expect(espias.archivar).not.toHaveBeenCalled()

    const conMotivo = await cargarFacturaManual(formulario('guardar', { numero: 'FV-2-700', motivo: 'El PDF anterior era otro caso' }))
    expect(conMotivo).toMatchObject({ ok: true, reemplaza: true })
    expect(espias.archivar.mock.calls[0][6]).toMatchObject({
      clave: '_cargas_manuales',
      entrada: { reemplaza: true, motivo: 'El PDF anterior era otro caso', anterior: { file_name: 'FV-2-600.pdf' } },
    })
    expect(espias.actividad.mock.calls[0][1].contenido).toContain('reemplaza FV-2-600')
  })

  it('sobre un PDF que trajo Siigo no se gasta ni una lectura', async () => {
    espias.factura = sinFactura({
      campos: { numero_factura: { value: 'FV-2-248' } }, drive_url: 'https://drive/siigo', origen: 'emitido_en_siigo',
    })
    const r = await cargarFacturaManual(formulario('guardar', { numero: 'FV-2-248', motivo: 'motivo suficientemente largo' }))
    expect(r.ok).toBe(false)
    expect(espias.archivar).not.toHaveBeenCalled()
  })

  it('un archivo que no es PDF se rechaza', async () => {
    const fd = formulario('leer')
    fd.set('archivo', new File(['hola'], 'foto.jpg', { type: 'image/jpeg' }))
    expect(await cargarFacturaManual(fd)).toMatchObject({ ok: false, error: 'La factura tiene que ser un PDF' })
  })
})
