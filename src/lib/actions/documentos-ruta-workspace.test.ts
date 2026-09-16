/**
 * Las acciones de documentos solo leen y borran archivos del workspace de la sesion.
 *
 * El hueco (riesgo 11, segunda ronda): `procesarDocumento` y
 * `confirmarUploadDocumentoNegocio` reciben del navegador la ruta del archivo en
 * `ve-documentos` y la usaban con el cliente de SERVICIO, que no pasa por las policies
 * del bucket: con la ruta de otro cliente se descargaba su documento, se le extraian los
 * campos, se subia al Drive de quien llamaba y se BORRABA el original. De paso:
 *   - `procesarDocumento` recibia tambien el id del archivo anterior de Drive y lo borraba
 *     con las credenciales del workspace (o las globales de MeTRIK, que guardan archivos de
 *     varios clientes). Ahora ese id sale de la fila que se reemplaza.
 *   - `reprocesarDocumento` y `procesarDocumentoNegocio` descargan la referencia `one://`
 *     guardada en `data`, que tiene mas de un escritor: ahora tambien miran que su ruta sea
 *     del workspace de la sesion.
 *
 * EL DOBLE REGISTRA CADA DESCARGA, BORRADO, SUBIDA Y UPDATE: la prueba mira que no haya
 * efecto, no solo el mensaje.
 *
 * VISTO FALLAR (2026-09-16):
 *   - con `documento-actions.ts` y `ve-documentos-negocio.ts` de `origin/main` (y el
 *     `referencia.ts` nuevo, para aislar las acciones): caen 8 de 12; los 4 caminos sanos
 *     (ruta o referencia propia) siguen verdes.
 *   - mutando una guarda a la vez sobre los archivos nuevos: sin la guarda de ruta de
 *     `procesarDocumento` caen 2; volviendo a borrar el id de Drive que manda el navegador
 *     caen 2; sin la de `reprocesarDocumento`, 1; sin la de `confirmarUploadDocumentoNegocio`,
 *     2; sin la de `procesarDocumentoNegocio`, 1. Ninguna mutacion quedo huerfana.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Fila = Record<string, unknown>

const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const OTRO_WS = 'a21bfc88-1a60-48c3-afcd-144226aa2392'
const NEG = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const BLOQUE = '11111111-2222-4333-8444-555555555555'

const RUTA_PROPIA = `${WS}/negocios/${NEG}/${BLOQUE}/documento.pdf`
const RUTA_AJENA = `${OTRO_WS}/negocios/${NEG}/${BLOQUE}/documento.pdf`
const RUTA_ESCAPE = `${WS}/%2e%2e/${OTRO_WS}/negocios/${NEG}/${BLOQUE}/documento.pdf`

const efectos = {
  descargas: [] as string[],
  borrados: [] as string[],
  descargasOne: [] as string[],
  borradosDrive: [] as string[],
  subidasDrive: [] as string[],
  updates: [] as Array<{ tabla: string; filtros: Fila; payload: Fila }>,
}

const escenario: { tablas: Record<string, Fila[]>; descargaFalla: boolean } = {
  tablas: {},
  descargaFalla: true,
}

function limpiar() {
  efectos.descargas.length = 0
  efectos.borrados.length = 0
  efectos.descargasOne.length = 0
  efectos.borradosDrive.length = 0
  efectos.subidasDrive.length = 0
  efectos.updates.length = 0
}

function cliente() {
  return {
    from: (tabla: string) => constructor(tabla),
    storage: {
      from: () => ({
        download: async (path: string) => {
          efectos.descargas.push(path)
          if (escenario.descargaFalla) return { data: null, error: { message: 'no existe' } }
          return { data: new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' }), error: null }
        },
        remove: async (paths: string[]) => {
          efectos.borrados.push(...paths)
          return { data: [], error: null }
        },
        createSignedUploadUrl: async () => ({ data: { token: 't' }, error: null }),
      }),
    },
  }
}

function constructor(tabla: string) {
  const eqs: Fila = {}
  let payload: Fila | null = null
  const filtradas = () =>
    (escenario.tablas[tabla] ?? []).filter((f) => Object.entries(eqs).every(([c, v]) => f[c] === v))
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => {
      eqs[c] = v
      return q
    },
    update: (p: Fila) => {
      payload = p
      return q
    },
    maybeSingle: async () => ({ data: filtradas()[0] ?? null, error: null }),
    single: async () => ({ data: filtradas()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      if (payload) {
        efectos.updates.push({ tabla, filtros: { ...eqs }, payload })
        return Promise.resolve({ error: null }).then(ok, ko)
      }
      return Promise.resolve({ data: filtradas(), error: null }).then(ok, ko)
    },
  }
  return q
}

const guardEditarBloque = vi.fn(async (_id: string) => ({ ok: true }))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: cliente(),
    workspaceId: WS,
    userId: 'user-1',
    role: 'owner',
    staffId: 'staff-1',
    error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => cliente() }))
vi.mock('@/lib/permissions/guard-negocio', () => ({
  guardEditarBloque: (id: string) => guardEditarBloque(id),
}))
vi.mock('@/app/(app)/negocios/negocio-v2-actions', () => ({
  cerrarNegocioSiQuedaResuelto: async () => false,
}))
vi.mock('@/lib/server-keys', () => ({ getServerKey: () => 'llave-de-prueba' }))
vi.mock('@/lib/ai/extract-fields', () => ({ extractFieldsFromDocument: async () => ({ data: null }) }))
vi.mock('@/lib/ai/reintentar-extraccion', () => ({ extraerConReintento: async () => ({ data: null, error: 'x' }) }))
vi.mock('@/lib/google-drive', () => ({
  createSubfolderPath: async () => 'carpeta-destino',
  uploadFileToDrive: async (_b: unknown, nombre: string) => {
    efectos.subidasDrive.push(nombre)
    return { fileId: 'drv-nuevo', webViewLink: 'https://drive.google.com/file/d/drv-nuevo/view' }
  },
  setFilePublicByLink: async () => {},
  deleteDriveFile: async (id: string) => {
    efectos.borradosDrive.push(id)
  },
  downloadDriveFile: async () => Buffer.from('x'),
}))
vi.mock('@/lib/correcciones/registrar', () => ({
  registrarCorrecciones: async () => {},
  contextoCorreccion: async () => null,
  esCausaValida: () => true,
}))
vi.mock('@/lib/negocios/casilla-compartida', () => ({
  resolverDestino: async (_s: unknown, id: string) => ({ id, redirigido: false, creado: false }),
}))
vi.mock('@/lib/negocios/cerrar-devolucion', () => ({
  cerrarDevolucionAlCompletar: async (_id: string, data: Fila) => data,
}))
vi.mock('@/lib/negocios/seccional-desde-documento', () => ({ sembrarSeccionalDesdeRut: async () => {} }))
vi.mock('@/lib/almacenamiento/supabase-externo', () => ({ almacenamientoExternoDe: async () => null }))
vi.mock('@/lib/almacenamiento/proveedor', () => ({ usaAlmacenamientoExterno: async () => false }))
vi.mock('@/lib/almacenamiento/one', () => ({
  descargarDeOne: async (ref: string) => {
    efectos.descargasOne.push(ref)
    throw new Error('detenido por la prueba')
  },
}))
vi.mock('@/lib/ve/parse-ve-docs', () => ({ parseVeDocuments: async () => ({ data: null, error: 'x' }) }))
vi.mock('@/lib/rut/parse-rut', () => ({ parseRut: async () => ({ data: null, error: 'x' }) }))

import { procesarDocumento, reprocesarDocumento } from './documento-actions'
import { confirmarUploadDocumentoNegocio, procesarDocumentoNegocio } from './ve-documentos-negocio'

function sembrar(dataBloque: Fila = {}, configExtra: Fila = {}) {
  escenario.descargaFalla = true
  escenario.tablas = {
    negocio_bloques: [
      {
        id: BLOQUE,
        negocio_id: NEG,
        data: dataBloque,
        bloque_config_id: 'cfg-1',
        bloque_configs: { config_extra: configExtra },
        negocios: { codigo: 'V0001', carpeta_url: 'https://drive.google.com/drive/folders/carpeta-neg' },
      },
    ],
    workspaces: [{ id: WS, drive_folder_id: 'raiz-drive' }],
    negocios: [{ id: NEG, workspace_id: WS, codigo: 'V0001', carpeta_url: 'https://drive.google.com/drive/folders/carpeta-neg' }],
  }
}

beforeEach(() => {
  limpiar()
  guardEditarBloque.mockClear()
  sembrar()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('procesarDocumento — la ruta del archivo', () => {
  it('una ruta del propio workspace se descarga', async () => {
    const r = await procesarDocumento(BLOQUE, NEG, RUTA_PROPIA, 'documento.pdf')
    expect(efectos.descargas).toEqual([RUTA_PROPIA])
    // La descarga del doble falla a proposito para cortar ahi.
    expect(r.success).toBe(false)
  })

  it('la ruta de otro workspace no se descarga ni se borra', async () => {
    const r = await procesarDocumento(BLOQUE, NEG, RUTA_AJENA, 'documento.pdf')
    expect(r).toEqual({ success: false, error: 'Archivo no encontrado' })
    expect(efectos.descargas).toHaveLength(0)
    expect(efectos.borrados).toHaveLength(0)
    expect(efectos.updates).toHaveLength(0)
  })

  it('un salto de carpeta codificado tampoco', async () => {
    const r = await procesarDocumento(BLOQUE, NEG, RUTA_ESCAPE, 'documento.pdf')
    expect(r).toEqual({ success: false, error: 'Archivo no encontrado' })
    expect(efectos.descargas).toHaveLength(0)
    expect(efectos.borrados).toHaveLength(0)
  })
})

describe('procesarDocumento — el archivo anterior de Drive', () => {
  it('se borra el que tiene la fila, nunca uno que mande el navegador', async () => {
    sembrar({ drive_file_id: 'drv-viejo', drive_url: 'https://drive.google.com/file/d/drv-viejo/view' })
    escenario.descargaFalla = false
    const procesarCrudo = procesarDocumento as unknown as (...a: unknown[]) => Promise<{ success: boolean }>
    const r = await procesarCrudo(BLOQUE, NEG, RUTA_PROPIA, 'documento.pdf', 'drv-de-otro-cliente')
    expect(r.success).toBe(true)
    expect(efectos.borradosDrive).toEqual(['drv-viejo'])
  })

  it('sin archivo anterior en la fila no se borra nada de Drive', async () => {
    escenario.descargaFalla = false
    const procesarCrudo = procesarDocumento as unknown as (...a: unknown[]) => Promise<{ success: boolean }>
    const r = await procesarCrudo(BLOQUE, NEG, RUTA_PROPIA, 'documento.pdf', 'drv-de-otro-cliente')
    expect(r.success).toBe(true)
    expect(efectos.borradosDrive).toHaveLength(0)
  })
})

describe('reprocesarDocumento — la referencia guardada', () => {
  const CAMPOS = { campos_extraccion: [{ slug: 'nit', label: 'NIT', tipo: 'texto' }] }

  it('una referencia de ONE del propio workspace se descarga', async () => {
    sembrar({ drive_url: `one://ve-documentos/${RUTA_PROPIA}` }, CAMPOS)
    await reprocesarDocumento(BLOQUE, NEG)
    expect(efectos.descargasOne).toEqual([`one://ve-documentos/${RUTA_PROPIA}`])
  })

  it('una referencia a otro workspace no se descarga', async () => {
    sembrar({ drive_url: `one://ve-documentos/${RUTA_AJENA}` }, CAMPOS)
    const r = await reprocesarDocumento(BLOQUE, NEG)
    expect(r).toEqual({ success: false, error: 'Archivo no encontrado' })
    expect(efectos.descargasOne).toHaveLength(0)
  })
})

describe('confirmarUploadDocumentoNegocio — la ruta del archivo', () => {
  it('una ruta del propio workspace queda guardada como referencia', async () => {
    const r = await confirmarUploadDocumentoNegocio(BLOQUE, 'factura', RUTA_PROPIA)
    expect(r).toEqual({ success: true, url: `one://ve-documentos/${RUTA_PROPIA}` })
    expect(efectos.updates).toHaveLength(1)
  })

  it('la ruta de otro workspace no se guarda, no se descarga y no se borra', async () => {
    const r = await confirmarUploadDocumentoNegocio(BLOQUE, 'factura', RUTA_AJENA)
    expect(r).toEqual({ success: false, error: 'Archivo no encontrado' })
    expect(efectos.updates).toHaveLength(0)
    expect(efectos.descargas).toHaveLength(0)
    expect(efectos.borrados).toHaveLength(0)
  })

  it('con subcarpeta de Drive, la ruta ajena tampoco se descarga ni se borra', async () => {
    sembrar({}, { drive_subfolder: '2. Documentos' })
    escenario.descargaFalla = false
    const r = await confirmarUploadDocumentoNegocio(BLOQUE, 'factura', RUTA_ESCAPE)
    expect(r).toEqual({ success: false, error: 'Archivo no encontrado' })
    expect(efectos.descargas).toHaveLength(0)
    expect(efectos.borrados).toHaveLength(0)
    expect(efectos.subidasDrive).toHaveLength(0)
  })
})

describe('procesarDocumentoNegocio — la referencia guardada', () => {
  it('una referencia de ONE del propio workspace se descarga', async () => {
    sembrar({ docs: { factura: `one://ve-documentos/${RUTA_PROPIA}` } })
    await procesarDocumentoNegocio(BLOQUE, 'factura')
    expect(efectos.descargasOne).toEqual([`one://ve-documentos/${RUTA_PROPIA}`])
  })

  it('una referencia a otro workspace no se descarga', async () => {
    sembrar({ docs: { factura: `one://ve-documentos/${RUTA_AJENA}` } })
    const r = await procesarDocumentoNegocio(BLOQUE, 'factura')
    expect(r.success).toBe(false)
    expect(efectos.descargasOne).toHaveLength(0)
  })
})
