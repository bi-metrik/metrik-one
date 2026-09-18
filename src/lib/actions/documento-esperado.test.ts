/**
 * Un bloque documental declara qué documento espera, y no se guarda con otro.
 *
 * El caso que lo motivó (SOENA, V0497/V0498): un certificado de Cámara de Comercio
 * cargado en el bloque `rut`. El bloque exige 22 campos, el certificado tiene siete, y el
 * modelo devolvió los quince restantes **inventados con confianza 0.95** — entre ellos la
 * seccional de la DIAN, que quedó sembrada en el negocio.
 *
 * LO QUE ESTAS PRUEBAS FIJAN, y por qué cada una:
 *
 *  1. El rechazo corta ANTES de lo destructivo. `procesarDocumento` BORRA el archivo
 *     anterior de Drive antes de subir el nuevo: si el control llegara después, el
 *     negocio se quedaría sin el documento bueno Y sin el malo. El doble registra
 *     borrados, subidas y updates, así que la prueba mira EL EFECTO, no el mensaje.
 *  2. Sin `documento_esperado`, el lector NO se llama. Son 37 bloques con extracción en
 *     la línea de SOENA: si el control se colara ahí, cada carga pagaría una llamada más
 *     y podría empezar a rechazar sin que nadie lo hubiera pedido.
 *  3. Lo dudoso PASA. `ilegible` y la confianza baja no rechazan: un falso rechazo frena
 *     a un operador sobre un documento correcto, y eso es peor que dejar las cosas como
 *     estaban. La asimetría es deliberada y aquí queda fijada.
 *  4. Reprocesar pasa por el mismo control. Reescribe todos los campos y vuelve a sembrar
 *     la seccional: es la segunda puerta por la que un documento equivocado siembra datos.
 *
 * VISTO FALLAR (medido el 2026-09-18, una mutación a la vez, restaurando entre cada una):
 *   - `if (false && …)` en lugar del corte del veredicto de `procesarDocumento`
 *     → **2 rojas** (se sube a Drive, se borra el anterior, se escribe la fila y se
 *     siembra la seccional; las dos aserciones que lo miran son las que caen);
 *   - el mismo corte anulado en `reprocesarDocumento` → **1 roja**;
 *   - `expectativaDeDocumento` con `?? 'rut'`, o sea expectativa siempre presente
 *     → **1 roja**: la del bloque que no declara nada, que pasaría a llamar al lector;
 *   - `veredictoDocumento` rechazando también `ilegible` y la confianza baja
 *     → **3 rojas**, que son justo las del control asimétrico.
 * Ninguna mutación quedó huérfana y la suite volvió a verde tras restaurar.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Reconocimiento } from '@/lib/documentos/tipo-documento'

type Fila = Record<string, unknown>

const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const NEG = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const BLOQUE = '11111111-2222-4333-8444-555555555555'
const RUTA = `${WS}/negocios/${NEG}/${BLOQUE}/documento.pdf`

const efectos = {
  descargas: [] as string[],
  borradosStorage: [] as string[],
  borradosDrive: [] as string[],
  subidasDrive: [] as string[],
  updates: [] as Array<{ tabla: string; payload: Fila }>,
  seccionalSembrada: [] as Array<Record<string, unknown> | null>,
  lecturasDocumento: [] as string[],
  extracciones: [] as number[],
}

const escenario: {
  tablas: Record<string, Fila[]>
  /** Lo que devuelve el lector de tipo de documento. `null` = no pudo. */
  reconocimiento: Reconocimiento | null
} = { tablas: {}, reconocimiento: null }

function limpiar() {
  efectos.descargas.length = 0
  efectos.borradosStorage.length = 0
  efectos.borradosDrive.length = 0
  efectos.subidasDrive.length = 0
  efectos.updates.length = 0
  efectos.seccionalSembrada.length = 0
  efectos.lecturasDocumento.length = 0
  efectos.extracciones.length = 0
}

function cliente() {
  return {
    from: (tabla: string) => constructor(tabla),
    storage: {
      from: () => ({
        download: async (path: string) => {
          efectos.descargas.push(path)
          return { data: new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' }), error: null }
        },
        remove: async (paths: string[]) => {
          efectos.borradosStorage.push(...paths)
          return { data: [], error: null }
        },
      }),
    },
  }
}

function constructor(tabla: string) {
  const eqs: Fila = {}
  let payload: Fila | null = null
  const filtradas = () =>
    (escenario.tablas[tabla] ?? []).filter(f => Object.entries(eqs).every(([c, v]) => f[c] === v))
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => { eqs[c] = v; return q },
    update: (p: Fila) => { payload = p; return q },
    maybeSingle: async () => ({ data: filtradas()[0] ?? null, error: null }),
    single: async () => ({ data: filtradas()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      if (payload) {
        efectos.updates.push({ tabla, payload })
        return Promise.resolve({ error: null }).then(ok, ko)
      }
      return Promise.resolve({ data: filtradas(), error: null }).then(ok, ko)
    },
  }
  return q
}

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

// El lector de tipo de documento: lo que devuelva decide el veredicto.
vi.mock('@/lib/ai/reconocer-documento', () => ({
  reconocerDocumento: async (buffer: Buffer) => {
    efectos.lecturasDocumento.push(`${buffer.length}B`)
    return escenario.reconocimiento
      ? { data: escenario.reconocimiento }
      : { data: null, error: 'el lector no respondió' }
  },
}))

// La extracción devuelve campos REALES: así se puede afirmar que, cuando se rechaza,
// no quedaron escritos en ninguna parte.
vi.mock('@/lib/ai/reintentar-extraccion', () => ({
  extraerConReintento: async () => {
    efectos.extracciones.push(1)
    return {
      data: {
        nit: { value: '900831342', confidence: 0.95, manual: false },
        direccion_seccional: { value: 'Impuestos de Bogota', confidence: 0.95, manual: false },
      },
    }
  },
}))
vi.mock('@/lib/ai/extract-fields', () => ({ extractFieldsFromDocument: async () => ({ data: null }) }))

vi.mock('@/lib/google-drive', () => ({
  createSubfolderPath: async () => 'carpeta-destino',
  uploadFileToDrive: async (_b: unknown, nombre: string) => {
    efectos.subidasDrive.push(nombre)
    return { fileId: 'drv-nuevo', webViewLink: 'https://drive.google.com/file/d/drv-nuevo/view' }
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
vi.mock('@/lib/negocios/casilla-compartida', () => ({
  resolverDestino: async (_s: unknown, id: string) => ({ id, redirigido: false, creado: false }),
}))
vi.mock('@/lib/negocios/cerrar-devolucion', () => ({
  cerrarDevolucionAlCompletar: async (_id: string, data: Fila) => data,
}))
vi.mock('@/lib/negocios/seccional-desde-documento', () => ({
  sembrarSeccionalDesdeRut: async (_s: unknown, a: { campos: Record<string, unknown> | null }) => {
    efectos.seccionalSembrada.push(a.campos)
  },
}))
vi.mock('@/lib/almacenamiento/supabase-externo', () => ({ almacenamientoExternoDe: async () => null }))
vi.mock('@/lib/almacenamiento/proveedor', () => ({ usaAlmacenamientoExterno: async () => false }))
vi.mock('@/lib/almacenamiento/one', () => ({ descargarDeOne: async () => { throw new Error('no aplica') } }))
vi.mock('@/lib/ve/parse-ve-docs', () => ({ parseVeDocuments: async () => ({ data: null, error: 'x' }) }))
vi.mock('@/lib/rut/parse-rut', () => ({ parseRut: async () => ({ data: null, error: 'x' }) }))

import { procesarDocumento, reprocesarDocumento } from './documento-actions'

/** El bloque `rut` de SOENA, recortado a lo que este control necesita. */
const CONFIG_RUT = {
  label: '007_RUT',
  documento_esperado: 'rut',
  drive_subfolder: '2. Comercial',
  campos_extraccion: [
    { slug: 'nit', label: 'NIT', tipo: 'texto', required: true, descripcion_ai: '...' },
    { slug: 'direccion_seccional', label: 'Dirección seccional', tipo: 'texto', required: true, descripcion_ai: '...' },
  ],
}

function sembrar(configExtra: Fila, dataBloque: Fila = { drive_file_id: 'drv-viejo' }) {
  escenario.tablas = {
    negocio_bloques: [{
      id: BLOQUE,
      negocio_id: NEG,
      data: dataBloque,
      bloque_config_id: 'cfg-1',
      bloque_configs: { config_extra: configExtra },
    }],
    workspaces: [{ id: WS, drive_folder_id: 'raiz-drive' }],
    negocios: [{ id: NEG, workspace_id: WS, codigo: 'V0497', carpeta_url: 'https://drive.google.com/drive/folders/carpeta-neg' }],
  }
}

/** Lo que el lector dijo del certificado de Cámara real de V0497. */
const CAMARA: Reconocimiento = {
  tipo: 'camara_comercio',
  confianza: 0.98,
  evidencia: 'Certificado de existencia y representación legal — Cámara de Comercio de Bogotá',
}
const RUT_LEIDO: Reconocimiento = {
  tipo: 'rut',
  confianza: 0.97,
  evidencia: 'Formulario del Registro Único Tributario, DIAN',
}

beforeEach(() => {
  limpiar()
  escenario.reconocimiento = null
  sembrar(CONFIG_RUT)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('procesarDocumento — el bloque declara qué documento espera', () => {
  it('una Cámara de Comercio en el bloque del RUT no se guarda, y nada se toca', async () => {
    escenario.reconocimiento = CAMARA

    const r = await procesarDocumento(BLOQUE, NEG, RUTA, 'documento.pdf')

    expect(r.success).toBe(false)
    // El efecto, no el mensaje: si esto pasara DESPUÉS de Drive, el negocio se
    // quedaría sin el documento anterior y sin el nuevo.
    expect(efectos.borradosDrive).toHaveLength(0)
    expect(efectos.subidasDrive).toHaveLength(0)
    expect(efectos.updates).toHaveLength(0)
    expect(efectos.seccionalSembrada).toHaveLength(0)
    // Y ni siquiera se gastó la extracción: no hay campos que inventar.
    expect(efectos.extracciones).toHaveLength(0)
  })

  it('el rechazo dice qué se esperaba, qué llegó y con qué evidencia', async () => {
    escenario.reconocimiento = CAMARA

    const r = await procesarDocumento(BLOQUE, NEG, RUTA, 'documento.pdf')

    expect(r.documento_rechazado).toEqual({
      esperado: 'RUT de la DIAN',
      visto: 'Certificado de Cámara de Comercio',
      visto_tipo: 'camara_comercio',
      confianza: 0.98,
      evidencia: CAMARA.evidencia,
    })
    expect(r.error).toContain('RUT de la DIAN')
    expect(r.error).toContain('Certificado de Cámara de Comercio')
  })

  it('el documento correcto se guarda igual que siempre, y queda anotado qué se leyó', async () => {
    escenario.reconocimiento = RUT_LEIDO

    const r = await procesarDocumento(BLOQUE, NEG, RUTA, 'documento.pdf')

    expect(r.success).toBe(true)
    expect(efectos.subidasDrive).toEqual(['007_RUT.pdf'])
    expect(efectos.borradosDrive).toEqual(['drv-viejo'])
    expect(efectos.seccionalSembrada).toHaveLength(1)

    const data = efectos.updates.at(-1)?.payload.data as Record<string, unknown>
    expect((data._documento as Record<string, unknown>).tipo).toBe('rut')
    expect((data._documento as Record<string, unknown>).motivo).toBe('coincide')
  })

  it('el archivo se baja UNA sola vez aunque se lea para identificarlo', async () => {
    escenario.reconocimiento = RUT_LEIDO
    await procesarDocumento(BLOQUE, NEG, RUTA, 'documento.pdf')
    expect(efectos.descargas).toEqual([RUTA])
  })
})

describe('procesarDocumento — un bloque que no declara nada', () => {
  it('no llama al lector y se comporta como siempre', async () => {
    // Los 37 bloques con extracción de la línea son así hoy.
    const sinExpectativa = { ...CONFIG_RUT, documento_esperado: undefined }
    sembrar(sinExpectativa)
    escenario.reconocimiento = CAMARA // daría rechazo si se consultara

    const r = await procesarDocumento(BLOQUE, NEG, RUTA, 'documento.pdf')

    expect(efectos.lecturasDocumento).toHaveLength(0)
    expect(r.success).toBe(true)
    expect(efectos.subidasDrive).toEqual(['007_RUT.pdf'])
  })

  it('un tipo esperado que no está en el catálogo se ignora, no rechaza', async () => {
    sembrar({ ...CONFIG_RUT, documento_esperado: 'formulario_inventado' })
    escenario.reconocimiento = CAMARA

    const r = await procesarDocumento(BLOQUE, NEG, RUTA, 'documento.pdf')

    expect(efectos.lecturasDocumento).toHaveLength(0)
    expect(r.success).toBe(true)
  })
})

describe('procesarDocumento — lo dudoso pasa, y queda anotado', () => {
  it('un archivo ilegible no rechaza', async () => {
    escenario.reconocimiento = { tipo: 'ilegible', confianza: 0.9, evidencia: 'Escaneo en blanco' }

    const r = await procesarDocumento(BLOQUE, NEG, RUTA, 'documento.pdf')

    expect(r.success).toBe(true)
    const data = efectos.updates.at(-1)?.payload.data as Record<string, unknown>
    expect((data._documento as Record<string, unknown>).motivo).toBe('no_concluyente')
  })

  it('otro tipo conocido pero con confianza baja tampoco rechaza', async () => {
    escenario.reconocimiento = { tipo: 'camara_comercio', confianza: 0.4, evidencia: 'Podría ser un certificado' }

    const r = await procesarDocumento(BLOQUE, NEG, RUTA, 'documento.pdf')

    expect(r.success).toBe(true)
    const data = efectos.updates.at(-1)?.payload.data as Record<string, unknown>
    expect((data._documento as Record<string, unknown>).motivo).toBe('no_concluyente')
  })

  it('un lector caído no frena al operador', async () => {
    escenario.reconocimiento = null // el doble devuelve error

    const r = await procesarDocumento(BLOQUE, NEG, RUTA, 'documento.pdf')

    expect(r.success).toBe(true)
    const data = efectos.updates.at(-1)?.payload.data as Record<string, unknown>
    expect(data._documento).toBeUndefined()
  })

  it('el umbral se puede subir por bloque', async () => {
    // Con el default (0.70) un 0.80 rechaza; declarando 0.95, no.
    sembrar({ ...CONFIG_RUT, documento_esperado_confianza_min: 0.95 })
    escenario.reconocimiento = { tipo: 'camara_comercio', confianza: 0.8, evidencia: 'Cámara de Comercio' }

    const r = await procesarDocumento(BLOQUE, NEG, RUTA, 'documento.pdf')

    expect(r.success).toBe(true)
  })
})

describe('reprocesarDocumento — la otra puerta que siembra datos', () => {
  it('no reescribe campos ni siembra seccional si el archivo no es el esperado', async () => {
    sembrar(CONFIG_RUT, { drive_file_id: 'drv-viejo', drive_url: 'https://drive.google.com/file/d/drv-viejo/view' })
    escenario.reconocimiento = CAMARA

    const r = await reprocesarDocumento(BLOQUE, NEG)

    expect(r.success).toBe(false)
    expect(r.documento_rechazado?.visto_tipo).toBe('camara_comercio')
    expect(efectos.updates).toHaveLength(0)
    expect(efectos.seccionalSembrada).toHaveLength(0)
    expect(efectos.extracciones).toHaveLength(0)
  })

  it('con el documento correcto reprocesa y deja la marca de lo leído', async () => {
    sembrar(CONFIG_RUT, { drive_file_id: 'drv-viejo', drive_url: 'https://drive.google.com/file/d/drv-viejo/view' })
    escenario.reconocimiento = RUT_LEIDO

    const r = await reprocesarDocumento(BLOQUE, NEG)

    expect(r.success).toBe(true)
    expect(efectos.seccionalSembrada).toHaveLength(1)
    const data = efectos.updates.at(-1)?.payload.data as Record<string, unknown>
    expect((data._documento as Record<string, unknown>).tipo).toBe('rut')
  })
})
