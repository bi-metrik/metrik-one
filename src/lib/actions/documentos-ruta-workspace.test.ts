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
  descargasDrive: [] as string[],
  updates: [] as Array<{ tabla: string; filtros: Fila; payload: Fila }>,
}

const escenario: {
  tablas: Record<string, Fila[]>
  descargaFalla: boolean
  /** El workspace habla con Drive con las credenciales GLOBALES de MeTRIK (sin Drive propio). */
  driveGlobal: boolean
  /** Padres de cada id en el Drive de MeTRIK, que guarda archivos de varios clientes. */
  padres: Record<string, string[]>
} = {
  tablas: {},
  descargaFalla: true,
  driveGlobal: true,
  padres: {},
}

function limpiar() {
  efectos.descargas.length = 0
  efectos.borrados.length = 0
  efectos.descargasOne.length = 0
  efectos.borradosDrive.length = 0
  efectos.subidasDrive.length = 0
  efectos.descargasDrive.length = 0
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
// La puerta de Clarity (riesgo 11, cuarta ronda) se ejercita con el criterio real sobre un
// workspace con Clarity: lo que se prueba aqui es lo que pasa DESPUES de la puerta.
vi.mock('@/lib/modulos/exigir-modulo', async () =>
  (await import('../../../test/exigir-modulo-doble')).dobleExigirModulo())
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
  downloadDriveFile: async (id: string) => {
    efectos.descargasDrive.push(id)
    return Buffer.from('%PDF-1.4')
  },
  usaCredencialesDriveGlobales: async () => escenario.driveGlobal,
  padresDeArchivoDrive: async (id: string) => escenario.padres[id] ?? null,
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
import {
  actualizarCamposNegocioBloque,
  confirmarUploadDocumentoNegocio,
  procesarDocumentoNegocio,
} from './ve-documentos-negocio'

function sembrar(dataBloque: Fila = {}, configExtra: Fila = {}) {
  escenario.descargaFalla = true
  escenario.driveGlobal = true
  // Los archivos de ESTE negocio cuelgan de su carpeta; los del otro cliente, de la suya.
  escenario.padres = {
    'drv-viejo': ['sub-2-documentos'],
    'drv-propio': ['sub-2-documentos'],
    'sub-2-documentos': ['carpeta-neg'],
    'carpeta-neg': ['raiz-drive'],
    'drv-de-otro-cliente': ['carpeta-de-otro-negocio'],
    'carpeta-de-otro-negocio': ['raiz-de-otro-cliente'],
  }
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

/**
 * TERCERA RONDA (2026-09-16).
 *
 * 1. Un id de Drive guardado en `data` no se opera si no cuelga de una carpeta del
 *    workspace, cuando el workspace no tiene Drive propio: esas credenciales son las
 *    GLOBALES de MeTRIK, que guardan archivos de varios clientes.
 * 2. `procesarDocumentoNegocio` no hace `fetch` a la URL guardada (SSRF): solo lee
 *    referencias y archivos de Drive por su API.
 * 3. `actualizarCamposNegocioBloque` solo escribe los campos extraídos.
 *
 * VISTO FALLAR contra `origin/main`: caen 7 (los dos borrados ajenos, la descarga ajena del
 * reproceso, la URL arbitraria, los dos enlaces de Drive y la clave `docs`); los 2 CONTROL
 * siguen verdes. Mutaciones sobre los archivos nuevos: sin la comprobación de ancestros en
 * `procesarDocumento` caen 2; en `reprocesarDocumento`, 1; en `procesarDocumentoNegocio`, 1;
 * volviendo a `fetch(url)`, 3; sin la lista blanca de `actualizarCamposNegocioBloque`, 1;
 * contando la propia carpeta como ancestro, 1.
 */
describe('ids de Drive guardados en data — sin Drive propio', () => {
  it('el archivo anterior de otro cliente no se borra', async () => {
    sembrar({ drive_file_id: 'drv-de-otro-cliente' })
    escenario.descargaFalla = false
    const r = await procesarDocumento(BLOQUE, NEG, RUTA_PROPIA, 'documento.pdf')
    expect(r.success).toBe(true)
    expect(efectos.borradosDrive).toEqual([])
  })

  it('la carpeta del negocio no pasa por "archivo anterior"', async () => {
    sembrar({ drive_file_id: 'carpeta-neg' })
    escenario.descargaFalla = false
    await procesarDocumento(BLOQUE, NEG, RUTA_PROPIA, 'documento.pdf')
    expect(efectos.borradosDrive).toEqual([])
  })

  it('CONTROL — con Drive propio el anterior se borra sin preguntar por carpetas', async () => {
    sembrar({ drive_file_id: 'drv-sin-padres-conocidos' })
    escenario.driveGlobal = false
    escenario.descargaFalla = false
    await procesarDocumento(BLOQUE, NEG, RUTA_PROPIA, 'documento.pdf')
    expect(efectos.borradosDrive).toEqual(['drv-sin-padres-conocidos'])
  })

  it('reprocesar no descarga el archivo de otro cliente', async () => {
    sembrar(
      { drive_file_id: 'drv-de-otro-cliente', file_name: 'Factura.pdf' },
      { campos_extraccion: [{ slug: 'nit', label: 'NIT', tipo: 'texto' }] },
    )
    const r = await reprocesarDocumento(BLOQUE, NEG)
    expect(r).toEqual({ success: false, error: 'Archivo no encontrado' })
    expect(efectos.descargasDrive).toEqual([])
  })

  it('CONTROL — reprocesar sí descarga uno de este negocio', async () => {
    sembrar(
      { drive_file_id: 'drv-propio', file_name: 'Factura.pdf' },
      { campos_extraccion: [{ slug: 'nit', label: 'NIT', tipo: 'texto' }] },
    )
    await reprocesarDocumento(BLOQUE, NEG)
    expect(efectos.descargasDrive).toEqual(['drv-propio'])
  })
})

describe('procesarDocumentoNegocio — nunca fetch a la URL guardada', () => {
  const fetchEspia = vi.fn(async () => new Response('secreto', { status: 200 }))
  beforeEach(() => {
    fetchEspia.mockClear()
    vi.stubGlobal('fetch', fetchEspia)
  })

  it('una URL arbitraria no se pide desde el servidor', async () => {
    sembrar({ docs: { factura: 'http://169.254.169.254/latest/meta-data/' } })
    const r = await procesarDocumentoNegocio(BLOQUE, 'factura')
    expect(r.success).toBe(false)
    expect(fetchEspia).not.toHaveBeenCalled()
    expect(efectos.descargasDrive).toEqual([])
  })

  it('un enlace de Drive de este negocio se baja por la API', async () => {
    sembrar({ docs: { factura: 'https://drive.google.com/file/d/drv-propio/view?usp=drivesdk' } })
    await procesarDocumentoNegocio(BLOQUE, 'factura')
    expect(fetchEspia).not.toHaveBeenCalled()
    expect(efectos.descargasDrive).toEqual(['drv-propio'])
  })

  it('un enlace de Drive de otro cliente no se baja', async () => {
    sembrar({ docs: { factura: 'https://drive.google.com/file/d/drv-de-otro-cliente/view' } })
    const r = await procesarDocumentoNegocio(BLOQUE, 'factura')
    expect(r.success).toBe(false)
    expect(fetchEspia).not.toHaveBeenCalled()
    expect(efectos.descargasDrive).toEqual([])
  })
})

describe('actualizarCamposNegocioBloque — solo campos extraídos', () => {
  it('no escribe la referencia de un documento', async () => {
    sembrar({ docs: { factura: `one://ve-documentos/${RUTA_PROPIA}` } })
    const campos = { marca: 'BYD', docs: { factura: 'http://169.254.169.254/' } }
    const r = await actualizarCamposNegocioBloque(BLOQUE, campos as unknown as Parameters<typeof actualizarCamposNegocioBloque>[1])
    expect(r.success).toBe(true)
    const data = efectos.updates.at(-1)?.payload.data as Fila
    expect(data.marca).toBe('BYD')
    expect(data.docs).toEqual({ factura: `one://ve-documentos/${RUTA_PROPIA}` })
  })
})
