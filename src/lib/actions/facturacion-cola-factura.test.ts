/**
 * La cola de Tesorería y la FACTURA de cada caso: qué se enlaza, qué se puede cargar, y
 * que los negocios cerrados ya facturados se puedan encontrar.
 *
 * Usa el doble que recorta como PostgREST (`test/cola-facturacion-doble.ts`). Los datos se
 * siembran con la forma medida en SOENA el 2026-09-14.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LINEA, WS, estado, reiniciarDoble, sembrar, servicioFalso } from '../../../test/cola-facturacion-doble'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
  createClient: async () => servicioFalso(),
}))
vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: WS, staffId: 'staff-diana', role: 'owner', areas: ['financiera'], supabase: null }),
}))
vi.mock('@/lib/siigo/client', () => ({ siigoRequest: async () => ({ results: [] }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { getColaFacturacion } from './facturacion-actions'

beforeEach(reiniciarDoble)

const URL_PDF = 'https://drive.google.com/file/d/1XrMeN5uCm0KnETJ3_GlrznswQr04nIlc/view?usp=drivesdk'
const neg = (i: number) => estado.fixtures.negocios[i] as Record<string, unknown>
/** La fila del bloque ORIGINAL de la factura del caso `i`. */
const original = (i: number) => estado.fixtures.negocio_bloques.find(
  f => f.negocio_id === `neg-${String(i).padStart(4, '0')}` && (f.bloque_configs as { slug: string | null }).slug === 'factura_emitida',
) as Record<string, unknown>

describe('la factura de cada caso en la cola', () => {
  it('un facturado trae el enlace al PDF del bloque ORIGINAL', async () => {
    sembrar({ casos: 3, facturados: [1], bloqueFacturaSlug: true })
    original(1).data = { campos: { numero_factura: { value: 'FV-2-248' } }, origen: 'emitido_en_siigo', drive_url: URL_PDF }
    const { data } = await getColaFacturacion()
    const c = data!.casos.find(x => x.codigo === 'V0001')!
    expect(c).toMatchObject({
      ya_facturado: true, factura_numero: 'FV-2-248', factura_pdf_url: URL_PDF,
      factura_origen: 'emitido_en_siigo', factura_sin_pdf: false, cerrado: false,
    })
    // Un PDF que trajo Siigo no se reemplaza a mano.
    expect(c.carga_manual.permitida).toBe(false)
  })

  it('facturado por marca sin archivo: sin soporte, y la carga manual queda permitida', async () => {
    sembrar({ casos: 2, metadata: i => (i === 0 ? { siigo_factura: { numero: 'FV-2-459', archivo_url: null } } : {}) })
    const { data } = await getColaFacturacion()
    const c = data!.casos.find(x => x.codigo === 'V0000')!
    expect(c).toMatchObject({ ya_facturado: true, factura_sin_pdf: true, factura_pdf_url: null })
    expect(c.carga_manual).toEqual({ permitida: true, reemplaza: false, razon: null })
  })

  it('un documento de OTRO emisor en el original no factura el caso, y se reporta', async () => {
    sembrar({ casos: 2, bloqueFacturaSlug: true })
    estado.fixtures.etapas_negocio = [{
      id: 'et-fact', linea_id: LINEA,
      config_extra: { factura_gate: { bloque_slug: 'factura_emitida', emisor_nit_esperado: '901874885' } },
    }]
    original(0).data = {
      campos: { numero_factura: { value: 'VNYC 638' }, emisor_nit: { value: '800041629' } },
      drive_url: 'https://drive/vehiculo',
    }
    const { data } = await getColaFacturacion()
    const c = data!.casos.find(x => x.codigo === 'V0000')!
    expect(c.ya_facturado).toBe(false)
    expect(c.factura_documento_ajeno).toEqual({ emisor: '800041629', numero: 'VNYC 638' })
    expect(c.carga_manual).toEqual({ permitida: true, reemplaza: true, razon: null })
  })

  it('los CERRADOS facturados entran como registro; los cerrados sin factura, no', async () => {
    // 15 negocios de SOENA cerrados y facturados no se podían encontrar en Tesorería.
    sembrar({ casos: 4, facturados: [2], bloqueFacturaSlug: true })
    neg(2).estado = 'completado'
    neg(3).estado = 'completado'
    original(2).data = { campos: { numero_factura: { value: 'FV-2-510' } }, drive_url: URL_PDF, origen: 'emitido_en_siigo' }
    const { data } = await getColaFacturacion()
    const codigos = data!.casos.map(c => c.codigo)
    expect(codigos).toContain('V0002')
    expect(codigos).not.toContain('V0003')
    const cerrado = data!.casos.find(c => c.codigo === 'V0002')!
    expect(cerrado).toMatchObject({ cerrado: true, ya_facturado: true, factura_pdf_url: URL_PDF })
    expect(cerrado.carga_manual.permitida).toBe(false)
    // No infla el trabajo de hoy.
    expect(data!.totales.listos).toBe(2)
  })

  it('la cola dice de qué empresa tiene que ser la factura', async () => {
    sembrar({ casos: 1 })
    ;(estado.fixtures.workspaces[0] as Record<string, unknown>).name = 'SOENA'
    const { data } = await getColaFacturacion()
    expect(data!.workspace_nombre).toBe('SOENA')
  })
})
