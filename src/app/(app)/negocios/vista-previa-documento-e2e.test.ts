/**
 * H4 · D7 (verificación D de Vera, 2026-10-14): «Revisar y enviar» muestra el documento que recibe
 * el cliente. Es el MISMO PDF de «Descargar PDF» (mismas props de la plantilla), y verlo no escribe
 * nada: ni almacenamiento, ni Drive, ni el registro de la salida, ni la pérdida de la autorización.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, escrituras, tomarRegistro } from '../../../../test/igualdad-servidor-doble'
import { COT_SAN_ANDRES } from '../../../../test/caso-san-andres'
import { tablasPorPasos } from '../../../../test/caso-por-pasos'

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/actions/get-workspace', async () => {
  const { memoDeRuta } = await import('@/lib/actions/memo-de-ruta')
  const { WS_TRAPPVEL } = await import('../../../../test/caso-san-andres')
  return {
    getWorkspace: memoDeRuta(async () => ({
      supabase: clienteFalso(), workspaceId: WS_TRAPPVEL, userId: 'p-asesora', staffId: 's-asesora',
      role: 'operator', areas: [], impersonating: false, realRole: 'operator', error: null,
    })),
  }
})
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso(), createClient: async () => clienteFalso() }))
vi.mock('@/lib/modulos/exigir-modulo', () => ({
  exigirModulo: async () => ({ ok: true }),
  MENSAJE_MODULO_NO_ACTIVO: 'sin módulo',
  REQUISITO: { clarity: 'clarity' },
}))
const subidas = vi.hoisted(() => [] as string[])
vi.mock('@/lib/almacenamiento/proveedor', () => ({ usaAlmacenamientoExterno: async () => true }))
vi.mock('@/lib/almacenamiento/supabase-externo', () => ({
  almacenamientoExternoDe: async () => ({
    subirArchivo: async (a: { nombre: string }) => {
      subidas.push(a.nombre)
      return { referencia: `sbext://one-documentos/${a.nombre}`, path: '', bytes: 0, sha256: '' }
    },
  }),
}))
vi.mock('@/lib/google-drive', () => ({
  uploadFileToDrive: async () => { throw new Error('Drive no debe llamarse') },
  createDriveFolder: async () => { throw new Error('Drive no debe llamarse') },
}))
vi.mock('@/lib/pdf/pdf-render-client', () => ({
  isPdfRenderConfigured: () => false,
  renderViaService: async () => { throw new Error('no debería llamarse') },
}))
const captura = vi.hoisted(() => ({ props: [] as unknown[] }))
vi.mock('@/lib/pdf/plantillas-cotizacion', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/pdf/plantillas-cotizacion')>()
  return {
    ...real,
    compositorDePlantilla: (slug: string | null | undefined) => {
      const c = real.compositorDePlantilla(slug)
      if (!c) return null
      return async (props: Parameters<typeof c>[0]) => {
        captura.props.push(structuredClone(props))
        return c(props)
      }
    },
  }
})

import { recalcularTotales } from './cotizacion-actions'
import { generateCotizacionPDF } from './cotizacion-pdf-actions'
import { GET as vistaPreviaRuta } from '@/app/api/cotizaciones/[id]/vista-previa/route'

beforeAll(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secreto-de-prueba')
})

async function sembrar() {
  base.tablas = tablasPorPasos()
  base.secuencia = 0
  base.registro = []
  await recalcularTotales(COT_SAN_ANDRES)
  tomarRegistro()
  subidas.length = 0
  captura.props = []
}

describe('H4 · D7 · el documento en Revisar es el PDF, y verlo no escribe nada', () => {
  it('mismas props que «Descargar PDF»; la vista previa no escribe, no sube ni registra', async () => {
    await sembrar()
    const descarga = await generateCotizacionPDF(COT_SAN_ANDRES) as { success: boolean; pdf?: string }
    expect(descarga.success).toBe(true)
    const escriturasDescarga = escrituras(tomarRegistro())
    const subidasDescarga = subidas.length
    const propsDescarga = captura.props[0]

    await sembrar()
    const previa = await generateCotizacionPDF(COT_SAN_ANDRES, { vistaPrevia: true }) as { success: boolean; pdf?: string; vistaPrevia?: boolean }
    expect(previa.success).toBe(true)
    expect(previa.vistaPrevia).toBe(true)
    expect(captura.props[0]).toEqual(propsDescarga)
    expect(escrituras(tomarRegistro())).toEqual([])
    expect(subidas).toEqual([])
    // Con la descarga sí se guarda: la diferencia es solo la vista previa.
    expect(subidasDescarga + escriturasDescarga.length).toBeGreaterThan(0)
  }, 60_000)

  it('la ruta lo sirve en línea, como PDF, sin caché', async () => {
    await sembrar()
    const res = await vistaPreviaRuta(new Request(`https://x/api/cotizaciones/${COT_SAN_ANDRES}/vista-previa`), { params: Promise.resolve({ id: COT_SAN_ANDRES }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(escrituras(tomarRegistro())).toEqual([])
  }, 60_000)
})
