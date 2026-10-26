/**
 * La «Factura emitida» se carga desde la COPIA (etapas posteriores) y se escribe en su ORIGEN.
 *
 * El defecto (SOENA, 2026-10-05): en «Notificación» la copia de la factura se veía editable
 * (`editable_siempre`), el usuario subía el PDF, lo veía procesar y al final recibía «Este
 * bloque es una copia de solo lectura de la etapa 7». El cliente y el servidor usaban dos
 * criterios distintos. Ahora hay uno (`copia-heredada.ts`): la copia escribible escribe en
 * la fila del origen; la que no, no ofrece nada y el servidor la rechaza igual.
 *
 * Aquí `casilla-compartida` NO se sustituye: se ejercita el `resolverDestino` real contra un
 * doble de la base que aplica las escrituras, así que se ve EN QUÉ FILA quedó cada cosa.
 *
 * Criterios de aceptación del brief que cubre cada bloque de pruebas:
 *   C1  cargar desde la copia deja el origen completo con NIT, número, fecha y valor
 *       (también cuando el caso nunca tuvo la fila del origen).
 *   C2  la copia y el origen pintan la misma factura (`dataDeFacturaParaCopias`).
 *   C3  corregir un campo desde la copia queda en el origen, y la copia lo refleja.
 *   C4  reprocesar desde la copia relee y reescribe el origen: no quedan dos datos.
 *   C6  ninguna escritura desde una copia termina en «copia de solo lectura» cuando la
 *       pantalla la ofreció; y la que no se ofrece se rechaza con el mismo criterio.
 *   C5 (formularios 010/1668) va en `lib/negocios/copia-heredada.test.ts` y en las pruebas
 *       de formularios que ya existen: este cambio no toca su acción.
 *
 * VISTO FALLAR (2026-10-06): con `documento-actions.ts` de `origin/main` caen 5 de 7 (las
 * cargas, la corrección y el reproceso reciben «copia de solo lectura»; el origen ambiguo
 * escribía en la copia); sin `origenDeCopiaEscribible` en `resolverDestino` caen 4; sin el
 * rechazo de la copia sin origen resuelto cae 1.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { leerMarca, type MarcaLectura } from '@/lib/documentos/lectura-en-curso'
import { copiaDeSoloLectura } from '@/lib/negocios/copia-heredada'
import { dataDeFacturaParaCopias, resolverFacturaDelNegocio } from '@/lib/facturacion/factura-del-negocio'

type Fila = Record<string, unknown>

const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const NEG = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const LINEA = 'linea-ve'
const COPIA = '11111111-2222-4333-8444-555555555555'
const ORIGEN = '99999999-8888-4777-8666-555555555555'
const RUTA = `${WS}/negocios/${NEG}/${COPIA}/factura.pdf`

const agendadas: Array<() => Promise<void>> = []
const efectos = { subidasDrive: [] as string[], borradosDrive: [] as string[] }
const escenario: { tablas: Record<string, Fila[]> } = { tablas: {} }

function valorEnRuta(f: Fila, columna: string): unknown {
  const partes = columna.split(/->>?|\./)
  let v: unknown = f[partes[0]]
  for (const k of partes.slice(1)) v = v && typeof v === 'object' ? (v as Fila)[k] : undefined
  return v
}

function cliente() {
  return {
    from: (tabla: string) => constructor(tabla),
    storage: {
      from: () => ({
        download: async () => ({
          data: new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' }),
          error: null,
        }),
        remove: async () => ({ data: [], error: null }),
      }),
    },
  }
}

/** La config que acompaña a una fila nueva, como la devolvería el embed de PostgREST. */
function configDe(bloqueConfigId: unknown): Fila | undefined {
  return (escenario.tablas.bloque_configs ?? []).find(c => c.id === bloqueConfigId)
}

function constructor(tabla: string) {
  const eqs: Fila = {}
  let payload: Fila | null = null
  let tope: number | null = null
  const filtradas = () => {
    const fs = (escenario.tablas[tabla] ?? []).filter(f =>
      Object.entries(eqs).every(([c, v]) => valorEnRuta(f, c) === v))
    return tope == null ? fs : fs.slice(0, tope)
  }
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => { eqs[c] = v; return q },
    limit: (n: number) => { tope = n; return q },
    update: (p: Fila) => { payload = p; return q },
    upsert: async (p: Fila) => {
      const filas = (escenario.tablas[tabla] ??= [])
      const ya = filas.find(f => f.negocio_id === p.negocio_id && f.bloque_config_id === p.bloque_config_id)
      if (!ya) {
        const cfg = configDe(p.bloque_config_id)
        filas.push({
          id: ORIGEN,
          ...structuredClone(p),
          bloque_configs: { config_extra: cfg?.config_extra, slug: cfg?.slug },
        })
      }
      return { data: null, error: null }
    },
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

vi.mock('next/server', () => ({ after: (fn: () => Promise<void>) => { agendadas.push(fn) } }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: cliente(), workspaceId: WS, userId: 'user-1', role: 'owner', staffId: 'staff-1', error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => cliente() }))
vi.mock('@/lib/modulos/exigir-modulo', async () =>
  (await import('../../../test/exigir-modulo-doble')).dobleExigirModulo())
vi.mock('@/lib/permissions/guard-negocio', () => ({ guardEditarBloque: async () => ({ ok: true }) }))
vi.mock('@/app/(app)/negocios/negocio-v2-actions', () => ({ cerrarNegocioSiQuedaResuelto: async () => false }))
vi.mock('@/lib/server-keys', () => ({ getServerKey: () => 'llave-de-prueba' }))
vi.mock('@/lib/ai/reconocer-documento', () => ({ reconocerDocumento: async () => ({ data: null, error: 'x' }) }))
vi.mock('@/lib/ai/reintentar-extraccion', () => ({
  extraerConReintento: async () => ({
    data: {
      emisor_nit: { value: '901234567', confidence: 0.95, manual: false },
      numero_factura: { value: 'FV-2-600', confidence: 0.95, manual: false },
      fecha_factura: { value: '2026-10-05', confidence: 0.95, manual: false },
      valor_total: { value: '1500000', confidence: 0.95, manual: false },
    },
  }),
}))
vi.mock('@/lib/ai/extract-fields', () => ({ extractFieldsFromDocument: async () => ({ data: null }) }))
let subidas = 0
vi.mock('@/lib/google-drive', () => ({
  createSubfolderPath: async () => 'carpeta-destino',
  uploadFileToDrive: async (_b: unknown, nombre: string) => {
    subidas++
    efectos.subidasDrive.push(nombre)
    return { fileId: `drv-nuevo-${subidas}`, webViewLink: `https://drive.google.com/file/d/drv-nuevo-${subidas}/view` }
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
vi.mock('@/lib/negocios/cerrar-devolucion', () => ({
  cerrarDevolucionAlCompletar: async (_id: string, data: Fila) => data,
}))
vi.mock('@/lib/negocios/seccional-desde-documento', () => ({ sembrarSeccionalDesdeRut: async () => {} }))
vi.mock('@/lib/almacenamiento/supabase-externo', () => ({ almacenamientoExternoDe: async () => null }))
vi.mock('@/lib/almacenamiento/proveedor', () => ({ usaAlmacenamientoExterno: async () => false }))
vi.mock('@/lib/almacenamiento/one', () => ({ descargarDeOne: async () => { throw new Error('no aplica') } }))

import { procesarDocumento, reprocesarDocumento, actualizarCampoDocumento } from './documento-actions'

const CAMPOS = [
  { slug: 'emisor_nit', label: 'NIT emisor', tipo: 'texto', required: true, descripcion_ai: '...' },
  { slug: 'numero_factura', label: 'Número', tipo: 'texto', required: true, descripcion_ai: '...' },
  { slug: 'fecha_factura', label: 'Fecha', tipo: 'fecha', required: true, descripcion_ai: '...' },
  { slug: 'valor_total', label: 'Valor', tipo: 'currency', required: true, descripcion_ai: '...' },
]
// Lo que hay en producción (SOENA, 2026-10-06): el origen en Cargue (orden 7) y 12 copias.
const CFG_ORIGEN = { label: 'Factura emitida', editable_siempre: true, corregir_campos_gerencial: true, campos_extraccion: CAMPOS }
const CFG_COPIA = {
  label: 'Factura emitida',
  editable_siempre: true,
  corregir_campos_gerencial: true,
  readonly: true,
  heredado: true,
  modo: 'visible',
  source_etapa_orden: 7,
  source_bloque_slug: 'factura_emitida',
  campos_extraccion: CAMPOS,
}

function filaCopia(configExtra: Fila = CFG_COPIA): Fila {
  return {
    id: COPIA,
    negocio_id: NEG,
    estado: 'pendiente',
    data: {},
    bloque_config_id: 'cfg-copia',
    bloque_configs: { config_extra: configExtra, slug: null, etapas_negocio: { linea_id: LINEA } },
  }
}

function filaOrigen(data: Fila = {}, estado = 'pendiente'): Fila {
  return {
    id: ORIGEN,
    negocio_id: NEG,
    estado,
    data,
    bloque_config_id: 'cfg-origen',
    bloque_configs: { config_extra: CFG_ORIGEN, slug: 'factura_emitida', etapas_negocio: { linea_id: LINEA } },
  }
}

function sembrar(bloques: Fila[]) {
  escenario.tablas = {
    negocio_bloques: bloques,
    bloque_configs: [
      { id: 'cfg-origen', slug: 'factura_emitida', config_extra: CFG_ORIGEN, etapas_negocio: { linea_id: LINEA } },
      { id: 'cfg-copia', slug: null, config_extra: CFG_COPIA, etapas_negocio: { linea_id: LINEA } },
    ],
    workspaces: [{ id: WS, drive_folder_id: 'raiz-drive' }],
    negocios: [{
      id: NEG, workspace_id: WS, linea_id: LINEA, codigo: 'V0600',
      carpeta_url: 'https://drive.google.com/drive/folders/carpeta-neg',
    }],
  }
}

const fila = (id: string) => escenario.tablas.negocio_bloques.find(f => f.id === id) as Fila
const camposDe = (id: string) => ((fila(id).data as Fila).campos ?? {}) as Record<string, { value?: unknown }>

async function correrAgendadas() {
  while (agendadas.length) await agendadas.shift()!()
}

/** Lo que pinta la ficha en la copia: la misma resolución que `getNegocioDetalle`. */
function loQuePintaLaCopia(): Fila {
  const original = (escenario.tablas.negocio_bloques.find(f => f.id === ORIGEN)?.data ?? null) as Fila | null
  return dataDeFacturaParaCopias(original, resolverFacturaDelNegocio({ original, marca: null }))
}

beforeEach(() => {
  agendadas.length = 0
  efectos.subidasDrive.length = 0
  efectos.borradosDrive.length = 0
  subidas = 0
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('C1 + C2 + C6 — cargar la factura desde la copia', () => {
  it('la pantalla la ofrece: la config de producción NO es copia de solo lectura', () => {
    expect(copiaDeSoloLectura(CFG_COPIA)).toBe(false)
  })

  it('escribe en el ORIGEN, lo deja completo con los 4 campos y la copia pinta lo mismo', async () => {
    sembrar([filaCopia(), filaOrigen()])

    const r = await procesarDocumento(COPIA, NEG, RUTA, 'factura.pdf')
    expect(r.error).toBeUndefined()
    // La espera de la tarjeta pregunta por la fila del origen, no por la de la copia.
    expect(r).toMatchObject({ success: true, leyendo: true, lectura: { bloque_id: ORIGEN } })
    await correrAgendadas()

    const marca = leerMarca(fila(ORIGEN).data) as MarcaLectura
    expect(marca.estado).toBe('lista')
    expect(fila(ORIGEN).estado).toBe('completo')
    expect(camposDe(ORIGEN)).toMatchObject({
      emisor_nit: { value: '901234567' },
      numero_factura: { value: 'FV-2-600' },
      fecha_factura: { value: '2026-10-05' },
      valor_total: { value: '1500000' },
    })
    // La fila propia de la copia no se toca: nadie la pinta.
    expect(fila(COPIA).data).toEqual({})
    // C2: la copia (y tras recargar) muestra exactamente la data del origen.
    expect(loQuePintaLaCopia()).toEqual(fila(ORIGEN).data)
  })

  it('si el caso nunca tuvo la fila del origen, la crea y escribe ahí', async () => {
    sembrar([filaCopia()])

    const r = await procesarDocumento(COPIA, NEG, RUTA, 'factura.pdf')
    expect(r).toMatchObject({ success: true, lectura: { bloque_id: ORIGEN } })
    await correrAgendadas()

    expect(fila(ORIGEN)).toMatchObject({ negocio_id: NEG, bloque_config_id: 'cfg-origen', estado: 'completo' })
    expect(camposDe(ORIGEN).numero_factura).toMatchObject({ value: 'FV-2-600' })
    expect(fila(COPIA).data).toEqual({})
    expect(loQuePintaLaCopia()).toEqual(fila(ORIGEN).data)
  })
})

const FACTURA_CARGADA = {
  drive_file_id: 'drv-viejo',
  drive_url: 'https://drive.google.com/file/d/drv-viejo/view',
  file_name: 'factura-vieja.pdf',
  campos: {
    emisor_nit: { value: '901234567', confidence: 0.9, manual: false },
    numero_factura: { value: 'FV-2-500', confidence: 0.9, manual: false },
    fecha_factura: { value: '2026-09-01', confidence: 0.9, manual: false },
    valor_total: { value: '900000', confidence: 0.9, manual: false },
  },
}

describe('C3 — corregir un campo desde la copia', () => {
  it('la corrección queda en el origen y la copia la refleja', async () => {
    sembrar([filaCopia(), filaOrigen(structuredClone(FACTURA_CARGADA), 'completo')])

    const r = await actualizarCampoDocumento(COPIA, NEG, 'valor_total', '950000', CAMPOS as never)
    expect(r).toMatchObject({ success: true, isComplete: true })

    expect(camposDe(ORIGEN).valor_total).toMatchObject({ value: '950000', manual: true })
    expect(fila(COPIA).data).toEqual({})
    expect((loQuePintaLaCopia().campos as Fila).valor_total).toMatchObject({ value: '950000' })
  })
})

describe('C4 — reprocesar desde la copia', () => {
  it('relee el archivo del origen y reescribe el origen: no quedan dos datos', async () => {
    sembrar([filaCopia(), filaOrigen(structuredClone(FACTURA_CARGADA), 'completo')])

    const r = await reprocesarDocumento(COPIA, NEG)
    expect(r.error).toBeUndefined()
    expect(r).toMatchObject({ success: true, leyendo: true, lectura: { bloque_id: ORIGEN } })
    await correrAgendadas()

    expect(camposDe(ORIGEN).numero_factura).toMatchObject({ value: 'FV-2-600' })
    expect(fila(COPIA).data).toEqual({})
    expect(loQuePintaLaCopia()).toEqual(fila(ORIGEN).data)
  })
})

describe('C6 — la copia que la pantalla NO ofrece se rechaza con el mismo criterio', () => {
  const SIN_FLAG = { ...CFG_COPIA, editable_siempre: undefined }

  it('una copia sin `editable_siempre` es de solo lectura en los dos lados', async () => {
    expect(copiaDeSoloLectura(SIN_FLAG)).toBe(true)
    sembrar([filaCopia(SIN_FLAG), filaOrigen(structuredClone(FACTURA_CARGADA), 'completo')])

    const r = await procesarDocumento(COPIA, NEG, RUTA, 'factura.pdf')
    expect(r).toMatchObject({ success: false })
    expect(r.error).toMatch(/copia de solo lectura de la etapa 7/)
    const c = await actualizarCampoDocumento(COPIA, NEG, 'valor_total', '1', CAMPOS as never)
    expect(c.error).toMatch(/copia de solo lectura/)
    expect(agendadas).toHaveLength(0)
    expect(fila(ORIGEN).data).toEqual(FACTURA_CARGADA)
  })

  it('si el origen es ambiguo NO cae a la fila de la copia: rechaza sin escribir', async () => {
    sembrar([filaCopia(), filaOrigen(), { ...filaOrigen(), id: 'otra-fila-con-el-slug' }])

    const r = await procesarDocumento(COPIA, NEG, RUTA, 'factura.pdf')
    expect(r).toMatchObject({ success: false })
    expect(r.error).toMatch(/casilla de origen/)
    expect(agendadas).toHaveLength(0)
    expect(fila(COPIA).data).toEqual({})
    expect(fila(ORIGEN).data).toEqual({})
  })
})
