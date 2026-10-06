/**
 * El cargue no retiene la pantalla: `procesarDocumento` y `reprocesarDocumento` validan,
 * dejan la marca «leyendo» y responden; la lectura corre después de responder (`after()`).
 *
 * LO QUE ESTAS PRUEBAS FIJAN:
 *  1. Dentro de un request la acción responde SIN leer: ni Drive, ni modelo, ni campos.
 *     El bloque queda `pendiente` (los gates no lo cuentan) con su `estado_previo`.
 *  2. La lectura agendada deja el resultado en la marca (`lista`) y el bloque completo.
 *  3. Gana el último: una lectura reemplazada antes de lo destructivo no toca Drive, y una
 *     reemplazada mientras leía no pisa la fila y borra el archivo que subió.
 *  4. Lo que no prospera queda escrito (error o rechazo) y el bloque vuelve a su estado.
 *
 * `after` de `next/server` se sustituye por una cola que la prueba vacía a mano: así se
 * ve el estado de la fila ENTRE la respuesta y el final de la lectura.
 *
 * VISTO FALLAR (2026-10-05, una mutación a la vez, 1 roja cada una): sin el chequeo de
 * token antes de lo destructivo; sin el filtro por token en la escritura final; sin heredar
 * `estado_previo` de la marca anterior; sin reponer el estado al cerrar con error; sin
 * releer la fila antes de escribir el reproceso; sin poner el bloque en `pendiente`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Reconocimiento } from '@/lib/documentos/tipo-documento'
import {
  LECTURA_VENCE_MS,
  bloqueLeyendo,
  estadoVisible,
  leerMarca,
  lecturaVigente,
  type MarcaLectura,
} from '@/lib/documentos/lectura-en-curso'

type Fila = Record<string, unknown>

const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const NEG = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const BLOQUE = '11111111-2222-4333-8444-555555555555'
const RUTA = `${WS}/negocios/${NEG}/${BLOQUE}/documento.pdf`

const agendadas: Array<() => Promise<void>> = []

const efectos = {
  borradosDrive: [] as string[],
  subidasDrive: [] as string[],
  extracciones: 0,
}

const escenario: {
  tablas: Record<string, Fila[]>
  reconocimiento: Reconocimiento | null
  /** Corre en medio de la extracción: simula otra subida mientras el modelo lee. */
  duranteExtraccion: (() => Promise<void>) | null
  extraccionLanza: boolean
} = { tablas: {}, reconocimiento: null, duranteExtraccion: null, extraccionLanza: false }

function valorEnRuta(f: Fila, columna: string): unknown {
  if (!columna.includes('->')) return f[columna]
  const partes = columna.split(/->>?/)
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

/** La base devuelve copias: lo leído no cambia solo cuando otro escribe después. */
function copia(f: Fila | undefined): Fila | null {
  return f ? structuredClone(f) : null
}

vi.mock('next/server', () => ({
  after: (fn: () => Promise<void>) => { agendadas.push(fn) },
}))
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
vi.mock('@/lib/ai/reconocer-documento', () => ({
  reconocerDocumento: async () =>
    escenario.reconocimiento ? { data: escenario.reconocimiento } : { data: null, error: 'sin lector' },
}))
vi.mock('@/lib/ai/reintentar-extraccion', () => ({
  extraerConReintento: async () => {
    efectos.extracciones++
    if (escenario.duranteExtraccion) {
      const f = escenario.duranteExtraccion
      escenario.duranteExtraccion = null
      await f()
    }
    if (escenario.extraccionLanza) throw new Error('Gemini se cayó')
    return { data: { nit: { value: '900831342', confidence: 0.95, manual: false } } }
  },
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

import { procesarDocumento, reprocesarDocumento } from './documento-actions'

const CONFIG = {
  label: '007_RUT',
  documento_esperado: 'rut',
  campos_extraccion: [{ slug: 'nit', label: 'NIT', tipo: 'texto', required: true, descripcion_ai: '...' }],
}
const RUT: Reconocimiento = { tipo: 'rut', confianza: 0.97, evidencia: 'Formulario RUT' }
const CAMARA: Reconocimiento = { tipo: 'camara_comercio', confianza: 0.98, evidencia: 'Cámara de Comercio' }

function sembrar(estado: 'pendiente' | 'completo' = 'completo') {
  escenario.tablas = {
    negocio_bloques: [{
      id: BLOQUE,
      negocio_id: NEG,
      estado,
      data: {
        drive_file_id: 'drv-viejo',
        drive_url: 'https://drive.google.com/file/d/drv-viejo/view',
        file_name: 'rut-viejo.pdf',
        campos: { nit: { value: '111', confidence: 0.9, manual: false } },
      },
      bloque_config_id: 'cfg-1',
      bloque_configs: { config_extra: CONFIG },
    }],
    workspaces: [{ id: WS, drive_folder_id: 'raiz-drive' }],
    negocios: [{ id: NEG, workspace_id: WS, codigo: 'V0202', carpeta_url: 'https://drive.google.com/drive/folders/carpeta-neg' }],
  }
}

const fila = () => escenario.tablas.negocio_bloques[0]
const marca = () => leerMarca(fila().data) as MarcaLectura

/** Corre lo agendado, en orden, como lo haría Vercel tras la respuesta. */
async function correrAgendadas() {
  while (agendadas.length) await agendadas.shift()!()
}

beforeEach(() => {
  agendadas.length = 0
  efectos.borradosDrive.length = 0
  efectos.subidasDrive.length = 0
  efectos.extracciones = 0
  subidas = 0
  escenario.reconocimiento = RUT
  escenario.duranteExtraccion = null
  escenario.extraccionLanza = false
  sembrar()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('procesarDocumento — responde sin leer', () => {
  it('deja la marca «leyendo», el bloque pendiente y no toca Drive ni el modelo', async () => {
    const r = await procesarDocumento(BLOQUE, NEG, RUTA, 'rut-nuevo.pdf')

    expect(r).toMatchObject({ success: true, leyendo: true, lectura: { bloque_id: BLOQUE } })
    expect(r.lectura?.token).toBe(marca().token)
    expect(marca()).toMatchObject({ estado: 'leyendo', tipo: 'carga', estado_previo: 'completo', storage_path: RUTA })
    // El gate (`puede_avanzar_etapa`) solo mira el estado: mientras lee, no cuenta.
    expect(fila().estado).toBe('pendiente')
    expect(bloqueLeyendo(fila().data)).toBe(true)
    expect(efectos.subidasDrive).toHaveLength(0)
    expect(efectos.borradosDrive).toHaveLength(0)
    expect(efectos.extracciones).toBe(0)
    expect((fila().data as Fila).drive_file_id).toBe('drv-viejo')
    expect(agendadas).toHaveLength(1)
  })

  it('la lectura agendada deja el resultado en la marca y el bloque completo', async () => {
    await procesarDocumento(BLOQUE, NEG, RUTA, 'rut-nuevo.pdf')
    await correrAgendadas()

    expect(marca().estado).toBe('lista')
    expect(fila().estado).toBe('completo')
    const data = fila().data as Fila
    expect(data.drive_file_id).toBe('drv-nuevo-1')
    expect((data.campos as Fila).nit).toMatchObject({ value: '900831342' })
    expect(efectos.borradosDrive).toEqual(['drv-viejo'])
    expect(bloqueLeyendo(data)).toBe(false)
  })
})

describe('procesarDocumento — gana el último', () => {
  it('una lectura reemplazada antes de empezar no toca Drive; la nueva sí', async () => {
    await procesarDocumento(BLOQUE, NEG, RUTA, 'primero.pdf')
    const r2 = await procesarDocumento(BLOQUE, NEG, RUTA, 'segundo.pdf')
    // La segunda hereda el estado REAL del bloque, no el `pendiente` que puso la primera.
    expect(marca().estado_previo).toBe('completo')

    await correrAgendadas()

    expect(efectos.subidasDrive).toEqual(['007_RUT.pdf']) // una sola subida: la del segundo
    expect(efectos.borradosDrive).toEqual(['drv-viejo'])
    expect(marca()).toMatchObject({ estado: 'lista', token: r2.lectura?.token, file_name: 'segundo.pdf' })
    expect((fila().data as Fila).file_name).toBe('segundo.pdf')
  })

  it('una lectura reemplazada MIENTRAS leía no pisa la fila y borra lo que subió', async () => {
    let r2: Awaited<ReturnType<typeof procesarDocumento>> | null = null
    // Mientras el modelo lee el primero, llega el segundo.
    escenario.duranteExtraccion = async () => { r2 = await procesarDocumento(BLOQUE, NEG, RUTA, 'segundo.pdf') }

    await procesarDocumento(BLOQUE, NEG, RUTA, 'primero.pdf')
    await agendadas.shift()!() // corre solo la primera

    // La primera subió su archivo, perdió la carrera y lo borró: la fila no es suya.
    expect(efectos.subidasDrive).toHaveLength(1)
    expect(efectos.borradosDrive).toContain('drv-nuevo-1')
    expect(marca()).toMatchObject({ estado: 'leyendo', token: r2!.lectura!.token })
    expect((fila().data as Fila).file_name).toBe('rut-viejo.pdf')

    await correrAgendadas() // ahora la segunda
    expect(marca()).toMatchObject({ estado: 'lista', token: r2!.lectura!.token })
    expect((fila().data as Fila).file_name).toBe('segundo.pdf')
  })
})

describe('procesarDocumento — lo que no prospera queda a la vista', () => {
  it('un documento equivocado queda rechazado y el bloque vuelve a completo', async () => {
    escenario.reconocimiento = CAMARA
    await procesarDocumento(BLOQUE, NEG, RUTA, 'camara.pdf')
    await correrAgendadas()

    expect(marca().estado).toBe('rechazado')
    expect(marca().documento_rechazado?.visto_tipo).toBe('camara_comercio')
    expect(fila().estado).toBe('completo')
    expect((fila().data as Fila).drive_file_id).toBe('drv-viejo')
    expect(efectos.borradosDrive).toHaveLength(0)
  })

  it('una falla a mitad queda como error con su mensaje, no como spinner', async () => {
    escenario.extraccionLanza = true
    sembrar('pendiente')
    await procesarDocumento(BLOQUE, NEG, RUTA, 'rut.pdf')
    await correrAgendadas()

    expect(marca().estado).toBe('error')
    expect(marca().error).toContain('Gemini se cayó')
    expect(marca().storage_path).toBe(RUTA) // para «Reintentar» sin volver a subir
    expect(fila().estado).toBe('pendiente')
  })
})

describe('reprocesarDocumento — misma regla', () => {
  it('responde leyendo y la relectura conserva lo corregido a mano mientras leía', async () => {
    const r = await reprocesarDocumento(BLOQUE, NEG)
    expect(r).toMatchObject({ success: true, leyendo: true })
    expect(marca()).toMatchObject({ estado: 'leyendo', tipo: 'reproceso' })
    expect(efectos.extracciones).toBe(0)

    // Alguien corrige el NIT a mano mientras el modelo lee.
    const data = fila().data as Fila
    fila().data = { ...data, campos: { nit: { value: '222', confidence: 1, manual: true } } }

    await correrAgendadas()
    expect(marca().estado).toBe('lista')
    expect(((fila().data as Fila).campos as Fila).nit).toMatchObject({ value: '222', manual: true })
  })
})

describe('lectura-en-curso — la marca que nunca termina', () => {
  const base: MarcaLectura = { token: 't', estado: 'leyendo', tipo: 'carga', iniciada_at: '2026-10-05T15:00:00.000Z' }
  const t0 = Date.parse(base.iniciada_at)

  it('dentro del plazo frena; pasado el plazo es un error visible y deja de frenar', () => {
    expect(lecturaVigente(base, t0 + 10_000)).toBe(true)
    expect(estadoVisible(base, t0 + 10_000)).toBe('leyendo')
    expect(lecturaVigente(base, t0 + LECTURA_VENCE_MS)).toBe(false)
    expect(estadoVisible(base, t0 + LECTURA_VENCE_MS)).toBe('vencida')
    expect(bloqueLeyendo({ _lectura: base }, t0 + LECTURA_VENCE_MS + 1)).toBe(false)
  })

  it('una marca mal formada no existe', () => {
    expect(leerMarca({ _lectura: { estado: 'leyendo' } })).toBeNull()
    expect(leerMarca({ _lectura: { ...base, estado: 'otra' } })).toBeNull()
    expect(leerMarca(null)).toBeNull()
  })
})
