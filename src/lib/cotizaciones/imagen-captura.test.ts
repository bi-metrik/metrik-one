import { beforeEach, describe, expect, it, vi } from 'vitest'

const subidas: { negocioId: string; subcarpeta: string; nombre: string; mime: string; bytes: number }[] = []
const borradas: string[] = []
let externo: 'si' | 'drive' | 'falla' = 'si'

vi.mock('@/lib/almacenamiento/supabase-externo', () => ({
  almacenamientoExternoDe: async () => {
    if (externo === 'drive') return null
    return {
      subirArchivo: async (a: { negocioId: string; subcarpeta: string; nombre: string; mime: string; buffer: Buffer }) => {
        if (externo === 'falla') throw new Error('storage caído')
        subidas.push({ negocioId: a.negocioId, subcarpeta: a.subcarpeta, nombre: a.nombre, mime: a.mime, bytes: a.buffer.length })
        return { referencia: `sbext://one-documentos/negocios/${a.negocioId}/${a.subcarpeta}/${a.nombre}`, path: '', bytes: 0, sha256: '' }
      },
      borrar: async (r: string) => { borradas.push(r) },
    }
  },
}))

const { borrarImagenesDeCaptura, bytesDeDataUrl, guardarImagenDeCaptura, imagenesAlBorrarOpcion, imagenesDeTarifa } = await import('./imagen-captura')
const { huellaDeImagen } = await import('./captura-repetida')

const DATA_URL = `data:image/png;base64,${Buffer.from('pantallazo de prueba').toString('base64')}`
const NEGOCIO = '11111111-1111-4111-8111-111111111111'

beforeEach(() => { subidas.length = 0; borradas.length = 0; externo = 'si' })

async function guardar(huella: string | undefined, dataUrl = DATA_URL) {
  return guardarImagenDeCaptura({ workspaceId: 'ws', negocioId: NEGOCIO, cotizacionId: 'cot-1', dataUrl, lectura: { huellaImagen: huella } })
}

describe('guardar el pantallazo de una captura aceptada', () => {
  it('sube la imagen leída a capturas/<cotización>/<huella>.png y devuelve su referencia', async () => {
    const huella = (await huellaDeImagen(DATA_URL))!
    const ref = await guardar(huella)
    expect(ref).toBe(`sbext://one-documentos/negocios/${NEGOCIO}/capturas/cot-1/${huella}.png`)
    expect(subidas).toEqual([{ negocioId: NEGOCIO, subcarpeta: 'capturas/cot-1', nombre: `${huella}.png`, mime: 'image/png', bytes: 20 }])
  })

  it('otra imagen que no es la que se leyó no se guarda', async () => {
    expect(await guardar('otra-huella')).toBeNull()
    expect(subidas).toHaveLength(0)
  })

  it('una lectura sin huella no se guarda (no hay con qué comparar)', async () => {
    expect(await guardar(undefined)).toBeNull()
  })

  it('un workspace en Drive no guarda la imagen', async () => {
    externo = 'drive'
    expect(await guardar((await huellaDeImagen(DATA_URL))!)).toBeNull()
  })

  it('si el almacenamiento falla, devuelve null y no lanza', async () => {
    externo = 'falla'
    expect(await guardar((await huellaDeImagen(DATA_URL))!)).toBeNull()
  })

  it('sin negocio no hay dónde guardarla', async () => {
    const huella = (await huellaDeImagen(DATA_URL))!
    expect(await guardarImagenDeCaptura({ workspaceId: 'ws', negocioId: null, cotizacionId: 'c', dataUrl: DATA_URL, lectura: { huellaImagen: huella } })).toBeNull()
  })
})

describe('bytes y referencias', () => {
  it('solo acepta imágenes en base64', () => {
    expect(bytesDeDataUrl('data:application/pdf;base64,AAAA')).toBeNull()
    expect(bytesDeDataUrl('nada')).toBeNull()
    expect(bytesDeDataUrl('data:image/jpeg;base64,AAAA')?.ext).toBe('jpg')
  })

  it('reúne las imágenes de las casillas y de las habitaciones, sin repetir', () => {
    const l = (ref: string | null) => ({ imagenRef: ref }) as never
    const refs = imagenesDeTarifa({
      casillas: { grupo_completo: l('sbext://a') },
      habitaciones: [{ id: 'h1', lectura: l('sbext://a') }, { id: 'h2', lectura: l('sbext://b') }, { id: 'h3', lectura: l(null) }],
    })
    expect(refs.sort()).toEqual(['sbext://a', 'sbext://b'])
  })

  it('borrar solo toca referencias del almacenamiento externo', async () => {
    await borrarImagenesDeCaptura('ws', ['sbext://a', 'https://drive.google.com/x', null])
    expect(borradas).toEqual(['sbext://a'])
  })
})

describe('al borrar una opción, la foto del hotel se va siempre', () => {
  const FOTO = 'sbext://one-documentos/negocios/n/fotos-hotel/c/i-1.jpg'
  const CAPTURA = 'sbext://one-documentos/negocios/n/capturas/c/h.png'
  const tarifa = { casillas: { grupo_completo: { imagenRef: CAPTURA } }, fotoHotel: { ref: FOTO, proporcion: 1.5 } } as never

  it('borrada del todo: pantallazos y foto', () => {
    expect(imagenesAlBorrarOpcion(tarifa)).toEqual([CAPTURA, FOTO])
  })
  it('devuelta a la bandeja: los pantallazos se quedan, la foto no', () => {
    expect(imagenesAlBorrarOpcion(tarifa, { conservarImagenes: true })).toEqual([FOTO])
  })
})
