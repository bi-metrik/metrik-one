/**
 * La copia del PDF que se conserva en Storage para dársela a alguien SIN sesión.
 *
 * EL DEFECTO QUE CIERRA, medido contra producción el 2026-09-21: los PDF del bloque
 * `recibo_caja_upme` devuelven **401** sin sesión (los de factura, el control, devuelven
 * 200). El archivo de Drive nace cerrado desde el 2026-09-16 y el correo al cliente
 * seguía prometiendo "puedes ver y descargar el recibo aquí". 14 avisos `enviado` a 8
 * correos de clientes reales, el 16 y el 17 de septiembre.
 *
 * Como el de Drive no se reabre, la copia de Storage —bucket privado— es la única forma
 * de que el cliente abra su propio documento: se firma por siete días.
 *
 * SE VIERON FALLAR contra la implementación anterior (borraba la copia siempre):
 *   - "conserva la copia en Storage"           → la borraba
 *   - "la entrada del historial lleva su `ref`" → no existía `ref`
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const WS = '11111111-1111-1111-1111-111111111111'
const NEG = '22222222-2222-2222-2222-222222222222'
const CFG = '33333333-3333-3333-3333-333333333333'

let carpetaDeDrive: string | null
let subidosAStorage: string[]
let borradosDeStorage: string[]
let guardado: Record<string, unknown> | null

function servicioFalso() {
  const from = (tabla: string) => {
    if (tabla === 'negocios') {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: { linea_id: 'linea-1', carpeta_url: carpetaDeDrive }, error: null }),
      }
      return chain
    }
    if (tabla === 'bloque_configs') {
      const chain = {
        select: () => chain,
        eq: () => chain,
        limit: async () => ({ data: [{ id: CFG, config_extra: {} }], error: null }),
      }
      return chain
    }
    if (tabla === 'negocio_bloques') {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        insert: async (fila: Record<string, unknown>) => {
          guardado = fila
          return { error: null }
        },
      }
      return chain
    }
    throw new Error(`tabla inesperada en el doble: ${tabla}`)
  }
  return {
    from,
    storage: {
      from: () => ({
        upload: async (path: string) => {
          subidosAStorage.push(path)
          return { error: null }
        },
        remove: async (paths: string[]) => {
          borradosDeStorage.push(...paths)
          return { error: null }
        },
      }),
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => servicioFalso() }))

vi.mock('@/lib/google-drive', () => ({
  createSubfolderPath: async () => 'carpeta-destino',
  uploadFileToDrive: async () => ({
    fileId: 'drive-abc',
    webViewLink: 'https://drive.google.com/file/d/drive-abc/view',
  }),
  setFilePublicByLink: async () => {},
}))

import { archivarPdfEnBloque } from './archivar-documento'

const PDF = Buffer.from('%PDF-falso')
const NOMBRE = 'RC-1-79.pdf'
const RUTA = `${WS}/negocios/${NEG}/${CFG}/${NOMBRE}`
const HISTORIAL = {
  clave: 'recibos',
  entrada: { numero: 'RC-1-79', valor: 637500, concepto: 'Honorarios de asesoría' },
}

beforeEach(() => {
  carpetaDeDrive = 'https://drive.google.com/drive/folders/carpeta-del-negocio'
  subidosAStorage = []
  borradosDeStorage = []
  guardado = null
})

function entradaDelHistorial(): Record<string, unknown> {
  const data = (guardado?.data ?? {}) as Record<string, unknown>
  const lista = (data.recibos ?? []) as Record<string, unknown>[]
  return lista[0] ?? {}
}

describe('con copia para el cliente', () => {
  it('conserva la copia en Storage: el de Drive está cerrado y no hay otra forma de abrirlo', async () => {
    await archivarPdfEnBloque(WS, NEG, 'recibo_caja_upme', PDF, NOMBRE, undefined, HISTORIAL, 'emitido_en_siigo', false, true)

    expect(subidosAStorage).toEqual([RUTA])
    expect(borradosDeStorage).toEqual([])
  })

  it('devuelve la referencia one:// de esa copia', async () => {
    const r = await archivarPdfEnBloque(WS, NEG, 'recibo_caja_upme', PDF, NOMBRE, undefined, HISTORIAL, 'emitido_en_siigo', false, true)

    expect(r.ok).toBe(true)
    expect(r.referenciaCliente).toBe(`one://ve-documentos/${RUTA}`)
  })

  it('la entrada del historial lleva su `ref`, que es lo que el aviso firma por documento', async () => {
    await archivarPdfEnBloque(WS, NEG, 'recibo_caja_upme', PDF, NOMBRE, undefined, HISTORIAL, 'emitido_en_siigo', false, true)

    // Con dos recibos del mismo cobro, un `drive_url` único apunta al último: cada
    // documento necesita su propia referencia o el honorario se queda sin enlace.
    expect(entradaDelHistorial()).toMatchObject({
      numero: 'RC-1-79',
      concepto: 'Honorarios de asesoría',
      ref: `one://ve-documentos/${RUTA}`,
    })
  })

  it('el archivo de Drive NO se reabre: sigue naciendo cerrado', async () => {
    const abiertos: string[] = []
    const drive = await import('@/lib/google-drive')
    vi.spyOn(drive, 'setFilePublicByLink').mockImplementation(async (id: string) => {
      abiertos.push(id)
    })

    await archivarPdfEnBloque(WS, NEG, 'recibo_caja_upme', PDF, NOMBRE, undefined, HISTORIAL, 'emitido_en_siigo', false, true)

    expect(abiertos).toEqual([])
    vi.restoreAllMocks()
  })

  it('sin carpeta de Drive, la referencia es la misma que guarda el bloque', async () => {
    carpetaDeDrive = null

    const r = await archivarPdfEnBloque(WS, NEG, 'recibo_caja_upme', PDF, NOMBRE, undefined, HISTORIAL, 'emitido_en_siigo', false, true)

    expect(r.url).toBe(`one://ve-documentos/${RUTA}`)
    expect(r.referenciaCliente).toBe(r.url)
    expect(borradosDeStorage).toEqual([])
  })
})

describe('sin copia para el cliente: la FACTURA no cambia', () => {
  it('la copia de Storage se borra, como siempre', async () => {
    // ⚠️ `archivarPdfEnBloque` lo comparten recibo y factura. El default apagado es lo
    // que deja intacta a la factura, que sí llega abierta al cliente por otra vía.
    await archivarPdfEnBloque(WS, NEG, 'factura_emitida', PDF, NOMBRE, undefined, HISTORIAL)

    expect(borradosDeStorage).toEqual([RUTA])
  })

  it('no devuelve referencia y la entrada del historial NO lleva `ref`', async () => {
    const r = await archivarPdfEnBloque(WS, NEG, 'factura_emitida', PDF, NOMBRE, undefined, HISTORIAL)

    expect(r.referenciaCliente).toBeNull()
    expect(entradaDelHistorial()).not.toHaveProperty('ref')
  })
})
