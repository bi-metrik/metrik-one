/**
 * Releer un documento llenando SOLO los campos que faltan (`reprocesarDocumento` con
 * `soloHuecos`, SOE-029).
 *
 * El caso: comprobantes UPME cargados entre el 1 y el 13 de octubre de 2026, cuando Gemini
 * respondía 403. El PDF quedó guardado, la lectura terminó (`_lectura.estado = 'lista'`)
 * pero el bloque quedó sin `campos`, y el RC-3 sale de `campos.valor_pagado`. La fila de
 * prueba tiene EXACTAMENTE las llaves que tienen esos bloques en producción.
 *
 * LO QUE ESTAS PRUEBAS FIJAN:
 *  1. La relectura llena los campos y no borra ni cambia nada más del bloque: el archivo
 *     (`drive_url`, `drive_file_id`, `file_name`, `mime_type`, `uploaded_at`) sigue igual,
 *     la marca `_lectura` sigue ahí y bien formada, y el error viejo se va.
 *  2. Un campo que el bloque ya trae NO se toca, aunque el modelo lea otra cosa, y la
 *     normalización no lo reescribe.
 *  3. El estado nunca baja: si la lectura no completa el bloque, queda como estaba, y un
 *     bloque completo conserva su fecha de completado.
 *  4. Sin huecos no hay lectura: ni modelo, ni marca, ni cambio de estado.
 *  5. Sin la opción, el reproceso de siempre (reescribe lo extraído) no cambió.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { leerMarca, type MarcaLectura } from '@/lib/documentos/lectura-en-curso'
import type { CampoResultado } from '@/lib/ai/extract-fields'

type Fila = Record<string, unknown>

const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const NEG = 'be02d10f-d8fc-429f-ae55-268a334a1e49'
const BLOQUE = '002f817f-3996-4d89-9459-33383b9563d0'
const RUTA = `${WS}/negocios/${NEG}/${BLOQUE}/documento.pdf`

const agendadas: Array<() => Promise<void>> = []
const efectos = { extracciones: 0, borradosDrive: [] as string[], subidasDrive: [] as string[] }

const escenario: {
  tablas: Record<string, Fila[]>
  extraido: Record<string, CampoResultado> | null
} = { tablas: {}, extraido: null }

function valorEnRuta(f: Fila, columna: string): unknown {
  if (!columna.includes('->')) return f[columna]
  const partes = columna.split(/->>?/)
  let v: unknown = f[partes[0]]
  for (const k of partes.slice(1)) v = v && typeof v === 'object' ? (v as Fila)[k] : undefined
  return v
}

function cliente() {
  return { from: (tabla: string) => constructor(tabla) }
}

function constructor(tabla: string) {
  const eqs: Fila = {}
  let payload: Fila | null = null
  const filtradas = () =>
    (escenario.tablas[tabla] ?? []).filter(f => Object.entries(eqs).every(([c, v]) => valorEnRuta(f, c) === v))
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => { eqs[c] = v; return q },
    update: (p: Fila) => { payload = p; return q },
    maybeSingle: async () => ({ data: copia(filtradas()[0]), error: null }),
    single: async () => ({ data: copia(filtradas()[0]), error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      if (payload) {
        const tocadas = filtradas()
        for (const f of tocadas) Object.assign(f, structuredClone(payload))
        return Promise.resolve({ data: tocadas.map(f => ({ id: f.id })), error: null }).then(ok, ko)
      }
      return Promise.resolve({ data: filtradas().map(copia), error: null }).then(ok, ko)
    },
  }
  return q
}

function copia(f: Fila | undefined): Fila | null {
  return f ? structuredClone(f) : null
}

vi.mock('next/server', () => ({
  after: (fn: () => Promise<void>) => { agendadas.push(fn) },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: cliente(), workspaceId: WS, userId: 'user-1', role: 'supervisor', staffId: 'staff-1', error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => cliente() }))
vi.mock('@/lib/modulos/exigir-modulo', async () =>
  (await import('../../../test/exigir-modulo-doble')).dobleExigirModulo())
vi.mock('@/lib/permissions/guard-negocio', () => ({ guardEditarBloque: async () => ({ ok: true }) }))
vi.mock('@/app/(app)/negocios/negocio-v2-actions', () => ({ cerrarNegocioSiQuedaResuelto: async () => false }))
vi.mock('@/lib/server-keys', () => ({ getServerKey: () => 'llave-de-prueba' }))
vi.mock('@/lib/ai/reconocer-documento', () => ({
  reconocerDocumento: async () => ({ data: null, error: 'sin lector' }),
}))
vi.mock('@/lib/ai/reintentar-extraccion', () => ({
  extraerConReintento: async () => {
    efectos.extracciones++
    return escenario.extraido ? { data: structuredClone(escenario.extraido) } : { data: null, error: 'Error de Gemini (403)' }
  },
}))
vi.mock('@/lib/ai/extract-fields', () => ({ extractFieldsFromDocument: async () => ({ data: null }) }))
vi.mock('@/lib/google-drive', () => ({
  createSubfolderPath: async () => 'carpeta-destino',
  uploadFileToDrive: async (_b: unknown, nombre: string) => {
    efectos.subidasDrive.push(nombre)
    return { fileId: 'drv-otro', webViewLink: 'https://drive.google.com/file/d/drv-otro/view' }
  },
  setFilePublicByLink: async () => {},
  deleteDriveFile: async (id: string) => { efectos.borradosDrive.push(id) },
  downloadDriveFile: async () => Buffer.from('%PDF-1.4'),
  usaCredencialesDriveGlobales: async () => false,
  padresDeArchivoDrive: async () => null,
}))
vi.mock('@/lib/almacenamiento/drive-del-workspace', () => ({ archivoDriveOperable: async () => true }))
vi.mock('@/lib/correcciones/registrar', () => ({
  registrarCorrecciones: async () => {}, contextoCorreccion: async () => null, esCausaValida: () => true,
}))
vi.mock('@/lib/documentos/reemplazo-hacia-atras', () => ({ esReemplazoHaciaAtras: async () => ({ aplica: false }) }))
vi.mock('@/lib/negocios/casilla-compartida', () => ({
  resolverDestino: async (_s: unknown, id: string) => ({ id, redirigido: false, creado: false }),
}))
vi.mock('@/lib/negocios/cerrar-devolucion', () => ({
  cerrarDevolucionAlCompletar: async (_id: string, data: Fila) => data,
}))
vi.mock('@/lib/negocios/seccional-desde-documento', () => ({ sembrarSeccionalDesdeRut: async () => {} }))
vi.mock('@/lib/almacenamiento/supabase-externo', () => ({ almacenamientoExternoDe: async () => null }))
vi.mock('@/lib/almacenamiento/proveedor', () => ({ usaAlmacenamientoExterno: async () => false }))
vi.mock('@/lib/almacenamiento/one', () => ({ descargarDeOne: async () => { throw new Error('no aplica') } }))

import { reprocesarDocumento } from './documento-actions'

const CONFIG = {
  label: 'Comprobante de pago UPME',
  campos_extraccion: [
    { slug: 'numero_cus', label: 'Número CUS', tipo: 'texto', required: true, descripcion_ai: '...' },
    { slug: 'valor_pagado', label: 'Valor pagado a la UPME', tipo: 'currency', required: true, descripcion_ai: '...' },
    { slug: 'nit', label: 'NIT', tipo: 'texto', required: false, descripcion_ai: '...', normalizar: 'nit_sin_dv' },
  ],
}

const LEIDO: Record<string, CampoResultado> = {
  numero_cus: { value: '3387221', confidence: 0.96, manual: false },
  valor_pagado: { value: '701812', confidence: 0.97, manual: false },
  nit: { value: '1020304050', confidence: 0.9, manual: false },
}

/** La marca que dejó la carga del 9-oct: terminó «lista» aunque el modelo respondió 403. */
const LECTURA_VIEJA: MarcaLectura = {
  token: 'token-de-la-carga',
  estado: 'lista',
  tipo: 'carga',
  iniciada_at: '2026-10-09T22:41:02.000Z',
  terminada_at: '2026-10-09T22:41:19.000Z',
  estado_previo: 'pendiente',
  file_name: 'VEH_GEE2026168317.pdf',
  storage_path: RUTA,
}

/** El archivo: lo que la relectura no puede tocar. */
const ARCHIVO = {
  drive_url: 'https://drive.google.com/file/d/drv-comprobante/view',
  drive_file_id: 'drv-comprobante',
  file_name: 'VEH_GEE2026168317.pdf',
  mime_type: 'application/pdf',
  uploaded_at: '2026-10-09T22:41:19.000Z',
}

/** Exactamente las llaves de V0294, V0559 y V0561 en producción. */
function sembrarComoProduccion(extra: Fila = {}, estado: 'pendiente' | 'completo' = 'pendiente', completadoAt: string | null = null) {
  escenario.tablas = {
    negocio_bloques: [{
      id: BLOQUE,
      negocio_id: NEG,
      estado,
      completado_at: completadoAt,
      data: {
        _lectura: LECTURA_VIEJA,
        ...ARCHIVO,
        _extraction_error: 'Error de Gemini (403)',
        _extraction_status: 'failed',
        ...extra,
      },
      bloque_config_id: 'cfg-comprobante',
      bloque_configs: { config_extra: CONFIG },
    }],
    workspaces: [{ id: WS, drive_folder_id: 'raiz-drive' }],
    negocios: [{ id: NEG, workspace_id: WS, codigo: 'V0294', carpeta_url: 'https://drive.google.com/drive/folders/carpeta-neg' }],
  }
}

const fila = () => escenario.tablas.negocio_bloques[0]
const datos = () => fila().data as Fila
const campos = () => datos().campos as Record<string, CampoResultado>

async function correrAgendadas() {
  while (agendadas.length) await agendadas.shift()!()
}

async function releer() {
  const r = await reprocesarDocumento(BLOQUE, NEG, { soloHuecos: true })
  await correrAgendadas()
  return r
}

beforeEach(() => {
  agendadas.length = 0
  efectos.extracciones = 0
  efectos.borradosDrive.length = 0
  efectos.subidasDrive.length = 0
  escenario.extraido = LEIDO
  sembrarComoProduccion()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('releer solo huecos — los comprobantes del 403', () => {
  it('llena los campos y deja el archivo, la marca y el resto del bloque como estaban', async () => {
    const r = await reprocesarDocumento(BLOQUE, NEG, { soloHuecos: true })
    expect(r).toMatchObject({ success: true, leyendo: true })
    await correrAgendadas()

    expect(campos().valor_pagado).toMatchObject({ value: '701812' })
    expect(campos().numero_cus).toMatchObject({ value: '3387221' })
    // El archivo, intacto: ni se baja de Drive para resubirlo ni se borra.
    for (const [llave, valor] of Object.entries(ARCHIVO)) expect(datos()[llave]).toBe(valor)
    expect(efectos.subidasDrive).toHaveLength(0)
    expect(efectos.borradosDrive).toHaveLength(0)
    // La marca sigue ahí, bien formada, ahora de esta lectura.
    expect(leerMarca(datos())).toMatchObject({ estado: 'lista', tipo: 'reproceso', file_name: ARCHIVO.file_name })
    // El error viejo se va: la lectura ya salió bien.
    expect(datos()._extraction_status).toBe('ok')
    expect(datos()).not.toHaveProperty('_extraction_error')
    // Ninguna llave del bloque desapareció.
    for (const llave of ['_lectura', ...Object.keys(ARCHIVO)]) expect(datos()).toHaveProperty(llave)
    expect(fila().estado).toBe('completo')
    expect(typeof fila().completado_at).toBe('string')
  })

  it('no toca otra llave de `data` que el bloque traiga (devolución, documento visto, cruces)', async () => {
    const extra = {
      _devolucion: { motivo: 'ilegible', nota: 'la foto salió borrosa', por_nombre: 'Laura' },
      _algo_de_otro_escritor: { a: 1 },
    }
    sembrarComoProduccion(extra)
    await releer()
    expect(datos()._devolucion).toEqual(extra._devolucion)
    expect(datos()._algo_de_otro_escritor).toEqual({ a: 1 })
  })

  it('un campo que ya está NO se toca, aunque el modelo lea otra cosa', async () => {
    sembrarComoProduccion({
      campos: {
        // Leído antes y sin marca manual: el reproceso completo lo pisaría.
        numero_cus: { value: '1111111', confidence: 0.8, manual: false },
        // Con DV pegado: la normalización del NIT lo reescribiría si corriera sobre él.
        nit: { value: '860019063-8', confidence: 0.9, manual: false },
      },
    })
    await releer()
    expect(campos().numero_cus).toEqual({ value: '1111111', confidence: 0.8, manual: false })
    expect(campos().nit).toEqual({ value: '860019063-8', confidence: 0.9, manual: false })
    expect(campos().valor_pagado).toMatchObject({ value: '701812' })
  })

  it('si la lectura no completa el bloque, el estado queda como estaba', async () => {
    escenario.extraido = { ...LEIDO, valor_pagado: { value: null, confidence: 0, manual: true } }
    await releer()
    expect(fila().estado).toBe('pendiente')
    expect(fila().completado_at).toBeNull()
    expect(campos().numero_cus).toMatchObject({ value: '3387221' })
    expect(campos().valor_pagado).toMatchObject({ value: null })
  })

  it('un bloque completo no baja a pendiente ni pierde su fecha de completado', async () => {
    escenario.extraido = { ...LEIDO, valor_pagado: { value: null, confidence: 0, manual: true } }
    sembrarComoProduccion({}, 'completo', '2026-10-10T15:00:00.000Z')
    await releer()
    expect(fila().estado).toBe('completo')
    expect(fila().completado_at).toBe('2026-10-10T15:00:00.000Z')

    escenario.extraido = LEIDO
    sembrarComoProduccion({}, 'completo', '2026-10-10T15:00:00.000Z')
    await releer()
    expect(fila().estado).toBe('completo')
    expect(fila().completado_at).toBe('2026-10-10T15:00:00.000Z')
  })

  it('si el modelo vuelve a fallar, el archivo y el estado quedan y el error se ve', async () => {
    escenario.extraido = null
    await releer()
    for (const [llave, valor] of Object.entries(ARCHIVO)) expect(datos()[llave]).toBe(valor)
    expect(datos()).not.toHaveProperty('campos')
    expect(leerMarca(datos())).toMatchObject({ estado: 'error', tipo: 'reproceso' })
    expect(fila().estado).toBe('pendiente')
  })

  it('sin huecos no hay lectura: ni modelo, ni marca, ni cambio de estado', async () => {
    sembrarComoProduccion({ campos: structuredClone(LEIDO) }, 'completo', '2026-10-10T15:00:00.000Z')
    const antes = structuredClone(fila())
    const r = await reprocesarDocumento(BLOQUE, NEG, { soloHuecos: true })
    expect(r.success).toBe(false)
    expect(r.error).toContain('no hay nada que leer')
    expect(agendadas).toHaveLength(0)
    expect(efectos.extracciones).toBe(0)
    expect(fila()).toEqual(antes)
  })
})

describe('reproceso completo — sin la opción no cambió', () => {
  it('reescribe lo extraído que no está corregido a mano', async () => {
    sembrarComoProduccion({ campos: { numero_cus: { value: '1111111', confidence: 0.8, manual: false } } })
    await reprocesarDocumento(BLOQUE, NEG)
    await correrAgendadas()
    expect(campos().numero_cus).toMatchObject({ value: '3387221' })
  })
})
