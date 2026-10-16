/**
 * El selector de fotos de un HOTEL por categoría (Mauricio, 2026-10-16), sobre el doble de
 * Supabase y con Commons, Wikidata y el modelo falsos:
 *   · precisión: lo que no nombra el hotel, y lo que el modelo dice que «no es un hotel», no sale;
 *   · cada opción va a su pestaña; sin modelo, solo lo que nombra el hotel, «sin clasificar»;
 *   · al marcar, la foto queda con su categoría; se marcan hasta 3 de CUALQUIER categoría (galería,
 *     Mauricio 2026-10-16): dos habitaciones valen, la cuarta no entra;
 *   · subir o pegar exige la casilla de autorización y guarda quién, cuándo y de dónde (Emilio);
 *   · un enlace de Booking, Expedia, Despegar u otra agencia en línea se rechaza;
 *   · las fotos de antes se clasifican UNA vez y la categoría queda en la fila.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

import { base, clienteFalso, type Fila } from '../../../../test/cotizacion-pdf-doble'

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: clienteFalso(), workspaceId: WS, staffId: 's-1', userId: USUARIO, role: 'operator', error: null }),
}))
vi.mock('@/lib/fotos/catalogo-almacen', async (original) => ({
  ...(await original<typeof import('@/lib/fotos/catalogo-almacen')>()),
  guardarEnCatalogo: async (ws: string, tipo: string) => `one://fotos-catalogo/${ws}/${tipo}/${Math.random().toString(16).slice(2).padEnd(16, '0')}.jpg`,
  enlacesDeCatalogo: async () => new Map(),
  borrarDeCatalogo: async () => {},
  bytesDeCatalogo: async () => Buffer.from('foto vieja: lobby del hotel'),
}))

const WS = '11111111-2222-3333-4444-555555555555'
const USUARIO = '99999999-8888-7777-6666-555555555555'
const AUTORIZADA = { autorizada: true, procedencia: null }

import { olvidarClasificaciones } from '@/lib/fotos/opciones-hotel'
import { MENSAJE_AGENCIA } from '@/lib/fotos/agencias'
import { MENSAJE_SIN_AUTORIZACION } from '@/lib/fotos/autorizacion'
import { MENSAJE_TOPE } from '@/lib/fotos/catalogo'
import { elegirFoto, fotosDelHotel, marcarFotoPrincipal, opcionesDeFoto, opcionesDeHotel, quitarFotoDeBiblioteca, subirFotoABiblioteca } from './actions'

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

describe('al marcar: hasta 3, de cualquier categoría', () => {
  it('dos fachadas y una habitación entran; la cuarta no; la primera es la principal y se puede cambiar', { timeout: 30_000 }, async () => {
    const a = await elegirFoto(HOTEL, { fuente: 'wikimedia', titulo: 'File:Pullman Eiffel Tower Hotel Paris France 1.jpg' }, null, 'fachada')
    expect(a.ok).toBe(true)
    // Otra fachada YA NO reemplaza la primera: se suma.
    const b = await elegirFoto(HOTEL, { fuente: 'wikimedia', titulo: 'File:Pullman Eiffel Tower Hotel Paris France 2.jpg' }, null, 'fachada')
    expect(b.ok).toBe(true)
    expect((await subirFotoABiblioteca(HOTEL, await dataUrl(), null, 'habitacion', AUTORIZADA)).ok).toBe(true)
    const filas = base.tablas.fotos_catalogo as Fila[]
    expect(filas.map((f) => [f.categoria, f.posicion, f.principal])).toEqual([['fachada', 1, true], ['fachada', 2, false], ['habitacion', 3, false]])
    // La galería reconoce cada una entre las opciones por su título.
    if (b.ok) expect(b.elemento?.fotos.map((f) => f.fuenteId)).toEqual(['File:Pullman Eiffel Tower Hotel Paris France 1.jpg', 'File:Pullman Eiffel Tower Hotel Paris France 2.jpg'])

    const cuarta = await elegirFoto(HOTEL, { fuente: 'wikimedia', titulo: 'File:Pullman Paris Tour Eiffel chambre.jpg' }, null, 'habitacion')
    expect(cuarta).toEqual({ ok: false, error: MENSAJE_TOPE })
    expect(base.tablas.fotos_catalogo).toHaveLength(3)

    // «Hacer principal» sobre la habitación: pasa a ser la 1.
    const hab = filas.find((f) => f.categoria === 'habitacion') as Fila
    const p = await marcarFotoPrincipal(hab.id as string)
    expect(p.ok && p.elemento?.fotos[0].id).toBe(hab.id)

    // Desmarcar la quita y libera el puesto: ahora sí entra la habitación.
    expect((await quitarFotoDeBiblioteca(filas.find((f) => f.posicion === 2)?.id as string)).ok).toBe(true)
    const otra = await elegirFoto(HOTEL, { fuente: 'wikimedia', titulo: 'File:Pullman Paris Tour Eiffel chambre.jpg' }, null, 'habitacion')
    expect(otra.ok && otra.elemento?.fotos.map((f) => f.categoria)).toEqual(['habitacion', 'fachada', 'habitacion'])
  })

  it('una categoría que no existe se ignora (entra sin categoría, como antes)', async () => {
    expect((await subirFotoABiblioteca(HOTEL, await dataUrl(), null, 'no_es_hotel', AUTORIZADA)).ok).toBe(true)
    expect((base.tablas.fotos_catalogo as Fila[])[0].categoria).toBeNull()
  })
})

describe('subir o pegar: la casilla de autorización (Emilio)', () => {
  it('sin la casilla no se guarda nada', async () => {
    for (const permiso of [undefined, { autorizada: false }, { autorizada: 'sí' }]) {
      expect(await subirFotoABiblioteca(HOTEL, await dataUrl(), null, 'fachada', permiso)).toEqual({ ok: false, error: MENSAJE_SIN_AUTORIZACION })
    }
    expect(base.tablas.fotos_catalogo).toHaveLength(0)
  })

  it('con la casilla: guarda quién (el usuario de la sesión, no lo que mande el navegador), cuándo y de dónde', async () => {
    const r = await subirFotoABiblioteca(HOTEL, await dataUrl(), null, 'fachada', { autorizada: true, procedencia: ' kit de medios del hotel ', userId: 'otro' })
    expect(r.ok).toBe(true)
    const [f] = base.tablas.fotos_catalogo as Fila[]
    expect(f).toMatchObject({ origen: 'asesora', autorizada_por: USUARIO, procedencia: 'kit de medios del hotel' })
    expect(Date.now() - Date.parse(f.autorizada_at as string)).toBeLessThan(60_000)
  })

  it('una de Commons no lleva autorización (su fuente es el autor y la licencia), ni hereda la de la foto que reemplaza', { timeout: 30_000 }, async () => {
    await subirFotoABiblioteca(HOTEL, await dataUrl(), null, 'fachada', { autorizada: true, procedencia: 'mayorista X' })
    const vieja = (base.tablas.fotos_catalogo as Fila[])[0]
    const r = await elegirFoto(HOTEL, { fuente: 'wikimedia', titulo: 'File:Pullman Eiffel Tower Hotel Paris France 1.jpg' }, vieja.id as string, 'fachada')
    expect(r.ok).toBe(true)
    expect((base.tablas.fotos_catalogo as Fila[])[0]).toMatchObject({ origen: 'wikimedia', autorizada_por: null, autorizada_at: null, procedencia: null, autor: 'Autora', licencia: 'CC BY-SA 4.0' })
  })
})

describe('agencias en línea: nunca son fuente', () => {
  it('un enlace de Booking, Expedia o Despegar se rechaza aunque la página oficial esté encendida', async () => {
    base.tablas.workspaces = [{ id: WS, cotizacion_template_slug: 'trappvel', config_extra: { documento_viaje: { fotos_sitio_oficial: true } } }]
    for (const url of ['https://www.booking.com/hotel/fr/pullman-paris-tour-eiffel.html', 'https://www.expedia.com/Paris-Hotels-Pullman.h1.Hotel-Information', 'https://www.despegar.com.co/hoteles/h-1']) {
      expect(await opcionesDeHotel(HOTEL, url)).toEqual({ ok: false, error: MENSAJE_AGENCIA })
      expect(await opcionesDeFoto(HOTEL, 'sitio_oficial', null, url)).toEqual({ ok: false, error: MENSAJE_AGENCIA })
    }
    const r = await elegirFoto(HOTEL, { fuente: 'sitio_oficial', pagina: 'https://www.pullman.example/', imagen: 'https://cf.bstatic.com/xdata/images/hotel/1.jpg' }, null, 'fachada')
    expect(r).toEqual({ ok: false, error: MENSAJE_AGENCIA })
    expect(base.tablas.fotos_catalogo).toHaveLength(0)
  })

  it('también con la página oficial apagada (el mensaje dice por qué)', async () => {
    expect(await opcionesDeHotel(HOTEL, 'https://www.booking.com/hotel/x.html')).toEqual({ ok: false, error: MENSAJE_AGENCIA })
  })

  it('la procedencia de una subida tampoco puede ser una agencia', async () => {
    expect(await subirFotoABiblioteca(HOTEL, await dataUrl(), null, 'fachada', { autorizada: true, procedencia: 'https://www.booking.com/hotel/x' })).toEqual({ ok: false, error: MENSAJE_AGENCIA })
  })
})

describe('las fotos de antes', () => {
  it('se clasifican una vez y la categoría queda en la fila', async () => {
    expect((await subirFotoABiblioteca(HOTEL, await dataUrl(), null, null, AUTORIZADA)).ok).toBe(true)
    expect((base.tablas.fotos_catalogo as Fila[])[0].categoria).toBeNull()
    const r = await fotosDelHotel(HOTEL)
    expect(r.ok && r.elemento?.fotos[0].categoria).toBe('zonas_comunes')
    expect((base.tablas.fotos_catalogo as Fila[])[0].categoria).toBe('zonas_comunes')
    const antes = llamadasModelo
    await fotosDelHotel(HOTEL)
    expect(llamadasModelo).toBe(antes)
  })
})
