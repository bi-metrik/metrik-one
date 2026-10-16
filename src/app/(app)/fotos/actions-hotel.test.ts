/**
 * El selector de fotos de un HOTEL por categoría (Mauricio, 2026-10-16), sobre el doble de
 * Supabase y con Commons, Wikidata y el modelo falsos:
 *   · precisión: lo que no nombra el hotel, y lo que el modelo dice que «no es un hotel», no sale;
 *   · cada opción va a su pestaña; sin modelo, solo lo que nombra el hotel, «sin clasificar»;
 *   · al elegir, la foto queda con su categoría y el reparto deja una por categoría;
 *   · las fotos de antes se clasifican UNA vez y la categoría queda en la fila.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

import { base, clienteFalso, type Fila } from '../../../../test/cotizacion-pdf-doble'

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: clienteFalso(), workspaceId: WS, staffId: 's-1', role: 'operator', error: null }),
}))
vi.mock('@/lib/fotos/catalogo-almacen', async (original) => ({
  ...(await original<typeof import('@/lib/fotos/catalogo-almacen')>()),
  guardarEnCatalogo: async (ws: string, tipo: string) => `one://fotos-catalogo/${ws}/${tipo}/${Math.random().toString(16).slice(2).padEnd(16, '0')}.jpg`,
  enlacesDeCatalogo: async () => new Map(),
  borrarDeCatalogo: async () => {},
  bytesDeCatalogo: async () => Buffer.from('foto vieja: lobby del hotel'),
}))

const WS = '11111111-2222-3333-4444-555555555555'

import { olvidarClasificaciones } from '@/lib/fotos/opciones-hotel'
import { elegirFoto, fotosDelHotel, opcionesDeHotel, subirFotoABiblioteca } from './actions'

const HOTEL = { tipo: 'hotel', nombre: 'Pullman Paris Tour Eiffel', ciudad: 'París' }

/** Un archivo de Commons con licencia imprimible; su miniatura «es» su título (el modelo falso la lee así). */
const archivo = (titulo: string, i: number) => ({
  title: titulo,
  index: i + 1,
  imageinfo: [{
    descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(titulo)}`,
    thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(titulo)}`,
    thumbwidth: 400, thumbheight: 266, width: 3000, height: 2000, mime: 'image/jpeg',
    extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: 'Autora' } },
  }],
})

const DE_LA_CATEGORIA = [
  'File:Pullman Eiffel Tower Hotel Paris France 1.jpg',
  'File:The Eiffel Tower (32767454980).jpg',
  'File:Summit @ Eiffel Tower @ Paris (34849700550).jpg',
  'File:Pullman Paris Tour Eiffel chambre.jpg',
  'File:Pullman Paris lobby bar.jpg',
]
// «Hotel Florida» es la fachada de OTRO hotel: el modelo diría «fachada», pero su título no nombra este.
const DE_LA_BUSQUEDA = ['File:Parc Can Dragó 001.jpg', 'File:Pullman Eiffel Tower Hotel Paris France 2.jpg', 'File:The Eiffel Tower.jpg', 'File:Hotel Florida Paris.jpg']

/** El modelo falso: lee el «título» de cada miniatura y responde por él. */
function clase(nombre: string): string {
  if (/lobby/i.test(nombre)) return 'zonas_comunes'
  if (/chambre/i.test(nombre)) return 'habitacion'
  if (/^(the eiffel|summit|parc)/i.test(nombre.replace(/^.*thumb\/File:/, ''))) return 'no_es_hotel'
  return 'fachada'
}

let llamadasModelo = 0
let wikidataCategoria: string | null = null

function red() {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = new URL(String(url))
    if (u.hostname === 'commons.wikimedia.org') {
      const p = u.searchParams
      if (p.get('list') === 'search') return Response.json({ query: { search: [{ title: 'Category:Eiffel Tower' }, { title: 'Category:Pullman Paris Tour Eiffel' }] } })
      if (p.get('generator') === 'categorymembers') {
        return Response.json({ query: { pages: p.get('gcmtitle') === 'Category:Pullman Paris Tour Eiffel' ? DE_LA_CATEGORIA.map(archivo) : [] } })
      }
      if (p.get('generator') === 'search') return Response.json({ query: { pages: DE_LA_BUSQUEDA.map(archivo) } })
      if (p.get('titles')) {
        // Al elegirla se baja grande (no la miniatura del selector).
        const a = archivo(p.get('titles') as string, 0)
        a.imageinfo[0].thumburl = 'https://upload.wikimedia.org/grande.jpg'
        return Response.json({ query: { pages: [a] } })
      }
    }
    if (u.hostname === 'upload.wikimedia.org') {
      if (u.pathname.startsWith('/thumb/')) return new Response(Buffer.from(decodeURIComponent(u.pathname)), { headers: { 'content-type': 'image/jpeg' } })
      const b = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 10, g: 120, b: 200 } } }).jpeg().toBuffer()
      return new Response(new Uint8Array(b), { headers: { 'content-type': 'image/jpeg' } })
    }
    if (u.hostname === 'www.wikidata.org') {
      if (u.searchParams.get('action') === 'wbsearchentities') return Response.json({ search: wikidataCategoria ? [{ id: 'Q1' }] : [] })
      return Response.json({
        entities: {
          Q1: {
            id: 'Q1',
            labels: { es: { value: 'Pullman Paris Tour Eiffel' } },
            descriptions: { es: { value: 'hotel en París' } },
            claims: { P373: [{ mainsnak: { datavalue: { value: wikidataCategoria } } }] },
          },
        },
      })
    }
    if (u.hostname === 'generativelanguage.googleapis.com') {
      llamadasModelo++
      const cuerpo = JSON.parse(String(init?.body)) as { contents: { parts: { text?: string; inline_data?: { data: string } }[] }[] }
      const fotos = cuerpo.contents[0].parts.filter((x) => x.inline_data).map((x) => Buffer.from(x.inline_data!.data, 'base64').toString())
      const texto = JSON.stringify({ fotos: fotos.map((n, i) => ({ n: i + 1, categoria: clase(n) })) })
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: texto }] } }] })
    }
    return new Response('no', { status: 404 })
  })
}

async function dataUrl(color = 90): Promise<string> {
  const b = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: color, g: 160, b: 190 } } }).jpeg().toBuffer()
  return `data:image/jpeg;base64,${b.toString('base64')}`
}

beforeEach(() => {
  base.secuencia = 0
  base.tablas = { workspaces: [{ id: WS, cotizacion_template_slug: 'trappvel', config_extra: {} }], fotos_catalogo: [] }
  llamadasModelo = 0
  wikidataCategoria = null
  olvidarClasificaciones()
  process.env.GEMINI_API_KEY = 'llave-de-prueba'
  red()
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.GEMINI_API_KEY
})

const titulos = (r: Awaited<ReturnType<typeof opcionesDeHotel>>, categoria: string | null) =>
  r.ok ? r.opciones.filter((o) => (o.categoria ?? null) === categoria).map((o) => o.titulo) : []

describe('precisión antes que cantidad', () => {
  it('cada opción va a su pestaña; la Torre Eiffel, el parque y lo que no nombra el hotel no salen', async () => {
    const r = await opcionesDeHotel(HOTEL)
    expect(r.ok).toBe(true)
    expect(titulos(r, 'fachada')).toEqual(['File:Pullman Eiffel Tower Hotel Paris France 1.jpg', 'File:Pullman Eiffel Tower Hotel Paris France 2.jpg'])
    expect(titulos(r, 'habitacion')).toEqual(['File:Pullman Paris Tour Eiffel chambre.jpg'])
    // De la categoría exacta, sin el nombre en el título: pasa porque el modelo la reconoce.
    expect(titulos(r, 'zonas_comunes')).toEqual(['File:Pullman Paris lobby bar.jpg'])
    const todas = r.ok ? r.opciones.map((o) => o.titulo).join(' ') : ''
    expect(todas).not.toMatch(/The Eiffel Tower|Summit|Parc Can Drag|Hotel Florida/)
    // Las candidatas NO se guardan.
    expect(base.tablas.fotos_catalogo).toHaveLength(0)
  })

  it('la categoría de Wikidata (P373) manda sobre la búsqueda de categorías', async () => {
    wikidataCategoria = 'Pullman Paris Tour Eiffel'
    const r = await opcionesDeHotel(HOTEL)
    expect(titulos(r, 'zonas_comunes')).toEqual(['File:Pullman Paris lobby bar.jpg'])
  })

  it('sin modelo: solo lo que nombra el hotel, «sin clasificar»; nada de la categoría que no lo nombre', async () => {
    delete process.env.GEMINI_API_KEY
    const r = await opcionesDeHotel(HOTEL)
    expect(r.ok && r.clasificadas).toBe(false)
    expect(titulos(r, null)).toEqual([
      'File:Pullman Eiffel Tower Hotel Paris France 1.jpg',
      'File:Pullman Paris Tour Eiffel chambre.jpg',
      'File:Pullman Eiffel Tower Hotel Paris France 2.jpg',
    ])
    expect(llamadasModelo).toBe(0)
  })

  it('lo que el modelo ya clasificó no se vuelve a preguntar', async () => {
    await opcionesDeHotel(HOTEL)
    const antes = llamadasModelo
    await opcionesDeHotel(HOTEL)
    expect(llamadasModelo).toBe(antes)
  })

  it('sin interruptor, la página oficial no se ofrece ni se lee', async () => {
    expect(await opcionesDeHotel(HOTEL, 'https://www.pullman.example/galeria')).toEqual({ ok: false, error: expect.stringContaining('no están encendidas') })
    const r = await opcionesDeHotel(HOTEL)
    expect(r.ok && r.paginaSugerida).toBeNull()
  })
})

describe('al elegir: la categoría queda en la fila, una por categoría', () => {
  it('Commons en Fachada, la propia en Habitaciones; otra fachada reemplaza la fachada', { timeout: 30_000 }, async () => {
    const a = await elegirFoto(HOTEL, { fuente: 'wikimedia', titulo: 'File:Pullman Eiffel Tower Hotel Paris France 1.jpg' }, null, 'fachada')
    expect(a.ok).toBe(true)
    expect((await subirFotoABiblioteca(HOTEL, await dataUrl(), null, 'habitacion')).ok).toBe(true)
    let filas = base.tablas.fotos_catalogo as Fila[]
    expect(filas.map((f) => [f.categoria, f.posicion, f.principal])).toEqual([['fachada', 1, true], ['habitacion', 2, false]])
    const b = await elegirFoto(HOTEL, { fuente: 'wikimedia', titulo: 'File:Pullman Eiffel Tower Hotel Paris France 2.jpg' }, null, 'fachada')
    expect(b.ok).toBe(true)
    filas = base.tablas.fotos_catalogo as Fila[]
    expect(filas).toHaveLength(2)
    expect(filas.find((f) => f.categoria === 'fachada')).toMatchObject({ titulo_fuente: 'File:Pullman Eiffel Tower Hotel Paris France 2.jpg', posicion: 1, principal: true })
    if (b.ok) expect(b.elemento?.fotos.map((f) => f.categoria)).toEqual(['fachada', 'habitacion'])
  })

  it('una categoría que no existe se ignora (entra sin categoría, como antes)', async () => {
    expect((await subirFotoABiblioteca(HOTEL, await dataUrl(), null, 'no_es_hotel')).ok).toBe(true)
    expect((base.tablas.fotos_catalogo as Fila[])[0].categoria).toBeNull()
  })
})

describe('las fotos de antes', () => {
  it('se clasifican una vez y la categoría queda en la fila', async () => {
    expect((await subirFotoABiblioteca(HOTEL, await dataUrl())).ok).toBe(true)
    expect((base.tablas.fotos_catalogo as Fila[])[0].categoria).toBeNull()
    const r = await fotosDelHotel(HOTEL)
    expect(r.ok && r.elemento?.fotos[0].categoria).toBe('zonas_comunes')
    expect((base.tablas.fotos_catalogo as Fila[])[0].categoria).toBe('zonas_comunes')
    const antes = llamadasModelo
    await fotosDelHotel(HOTEL)
    expect(llamadasModelo).toBe(antes)
  })
})
