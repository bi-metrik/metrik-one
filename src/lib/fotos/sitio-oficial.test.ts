/**
 * Fotos de la página oficial: qué imágenes se toman de una página, que el servidor solo baje
 * lo público y cómo se propone la página desde Wikidata sin adivinar.
 */
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'

import { bajarFotoDeSitio, imagenesDePagina, ipPrivada, mayorDeSrcset, opcionesDeSitioOficial, paginaConfiable, traerSeguro, urlPublica, type Resolver } from './sitio-oficial'

const publico: Resolver = async () => ['93.184.216.34']
const privado: Resolver = async () => ['10.0.0.5']

describe('solo lo público', () => {
  it('IPs privadas, locales y reservadas', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', 'no-es-ip']) {
      expect(ipPrivada(ip), ip).toBe(true)
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) expect(ipPrivada(ip), ip).toBe(false)
  })

  it('https al 443 que resuelve a IPs públicas; nada más', async () => {
    expect(await urlPublica('https://hotel.example/galeria', publico)).not.toBeNull()
    expect(await urlPublica('http://hotel.example/galeria', publico)).toBeNull()
    expect(await urlPublica('https://hotel.example:8443/', publico)).toBeNull()
    expect(await urlPublica('https://user:pw@hotel.example/', publico)).toBeNull()
    expect(await urlPublica('https://localhost/', publico)).toBeNull()
    expect(await urlPublica('https://169.254.169.254/latest/meta-data', publico)).toBeNull()
    expect(await urlPublica('https://interno.example/', privado)).toBeNull()
    expect(await urlPublica('no es url', publico)).toBeNull()
  })

  it('una redirección hacia la red interna se corta', async () => {
    const resolver: Resolver = async (h) => (h === 'interno.example' ? ['192.168.0.10'] : ['93.184.216.34'])
    const pedidas: string[] = []
    const f = (async (url: string) => {
      pedidas.push(url)
      return new Response(null, { status: 302, headers: { location: 'https://interno.example/admin' } })
    }) as unknown as typeof fetch
    expect(await traerSeguro('https://hotel.example/', { fetch: f, resolver, maxBytes: 1000, tipo: /^text\/html$/ })).toBeNull()
    expect(pedidas).toEqual(['https://hotel.example/'])
  })

  it('una respuesta más grande que el tope no se lee entera', async () => {
    const f = (async () => new Response('x'.repeat(5000), { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch
    expect(await traerSeguro('https://hotel.example/', { fetch: f, resolver: publico, maxBytes: 1000, tipo: /^text\/html$/ })).toBeNull()
  })
})

describe('las imágenes de una página', () => {
  const html = `<html><head>
    <meta property="og:image" content="https://cdn.hotel.example/fachada.jpg?w=1600&amp;q=80">
    <meta name="twitter:image" content="/img/lobby.jpg">
    <script type="application/ld+json">{"@type":"Hotel","name":"H","image":["https://cdn.hotel.example/habitacion.jpg",{"@type":"ImageObject","url":"https://cdn.hotel.example/terraza.webp"}]}</script>
    </head><body>
    <img src="/static/logo.png"><img src="https://cdn.hotel.example/icons/wifi.svg">
    <img src="http://inseguro.example/piscina.jpg">
    <img data-src="/gal/1.jpg" srcset="/gal/1-400.jpg 400w, /gal/1-1600.jpg 1600w">
    <picture><source srcset="/gal/2.webp 2x"><img src="/gal/2.jpg"></picture>
    <img src="https://cdn.hotel.example/fachada.jpg?w=1600&q=80">
    </body></html>`

  it('primero las que la página declara suyas, luego la galería; absolutas, https y sin logos ni SVG', () => {
    expect(imagenesDePagina(html, 'https://www.hotel.example/es/galeria')).toEqual([
      'https://cdn.hotel.example/fachada.jpg?w=1600&q=80',
      'https://www.hotel.example/img/lobby.jpg',
      'https://cdn.hotel.example/habitacion.jpg',
      'https://cdn.hotel.example/terraza.webp',
      'https://www.hotel.example/gal/1-1600.jpg',
      'https://www.hotel.example/gal/2.webp',
      'https://www.hotel.example/gal/2.jpg',
    ])
  })

  it('srcset: la más ancha', () => {
    expect(mayorDeSrcset('a.jpg 400w, b.jpg 1600w, c.jpg 800w')).toBe('b.jpg')
    expect(mayorDeSrcset('a.jpg 1x, b.jpg 2x')).toBe('b.jpg')
  })
})

describe('las opciones y la foto elegida', () => {
  async function jpeg(ancho: number, alto: number) {
    return sharp({ create: { width: ancho, height: alto, channels: 3, background: { r: 10, g: 90, b: 160 } } }).jpeg().toBuffer()
  }

  it('solo las fotos de verdad (tamaño mínimo); nada se guarda; la elegida tiene que estar en la página', { timeout: 20_000 }, async () => {
    const grande = await jpeg(1200, 800)
    const chica = await jpeg(200, 200)
    const pagina = '<meta property="og:image" content="https://hotel.example/a.jpg"><img src="https://hotel.example/b.jpg"><img src="https://hotel.example/c.jpg">'
    const f = (async (url: string) => {
      if (url === 'https://hotel.example/galeria') return new Response(pagina, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      if (url.endsWith('/b.jpg')) return new Response(new Uint8Array(chica), { headers: { 'content-type': 'image/jpeg' } })
      if (url.endsWith('.jpg')) return new Response(new Uint8Array(grande), { headers: { 'content-type': 'image/jpeg' } })
      return new Response('no', { status: 404 })
    }) as unknown as typeof fetch
    const r = await opcionesDeSitioOficial('https://hotel.example/galeria', { fetch: f, resolver: publico })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.candidatas.map((c) => c.imagen)).toEqual(['https://hotel.example/a.jpg', 'https://hotel.example/c.jpg'])
    expect(r.candidatas[0].miniatura).toMatch(/^data:image\/jpeg;base64,/)
    expect(r.siguiente).toBeNull()

    expect((await bajarFotoDeSitio('https://hotel.example/galeria', 'https://hotel.example/a.jpg', { fetch: f, resolver: publico })).ok).toBe(true)
    // Una URL que no está en la página no entra como «del sitio oficial».
    expect(await bajarFotoDeSitio('https://hotel.example/galeria', 'https://otro.example/x.jpg', { fetch: f, resolver: publico })).toEqual({ ok: false, error: expect.stringContaining('ya no está') })
  })
})

describe('la página oficial desde Wikidata', () => {
  const entidad = (id: string, nombre: string, desc: string, web: string | null, lugar?: string) => ({
    id,
    labels: { es: { value: nombre } },
    descriptions: { es: { value: desc } },
    claims: {
      ...(web ? { P856: [{ mainsnak: { datavalue: { value: web } } }] } : {}),
      ...(lugar ? { P131: [{ mainsnak: { datavalue: { value: { id: lugar } } } }] } : {}),
    },
  })

  it('mismo nombre y misma ciudad, con sitio https: esa', () => {
    const r = paginaConfiable(
      { nombre: 'Hotel Catalonia Puerta del Sol', ciudad: 'Madrid' },
      [entidad('Q1', 'Catalonia Puerta del Sol', 'hotel en Madrid, España', 'https://www.cataloniahotels.com/es/hotel/catalonia-puerta-del-sol')],
      {},
    )
    expect(r).toEqual({ url: 'https://www.cataloniahotels.com/es/hotel/catalonia-puerta-del-sol', entidad: 'Q1' })
  })

  it('la ciudad también vale por el lugar administrativo (P131)', () => {
    const r = paginaConfiable({ nombre: 'Park Güell', ciudad: 'Barcelona' }, [entidad('Q2', 'Park Güell', 'parque público', 'https://parkguell.barcelona', 'Q1492')], { Q1492: ['Barcelona'] })
    expect(r?.url).toBe('https://parkguell.barcelona')
  })

  it('no adivina: otra ciudad, otro nombre, sin sitio, sitio http o dos sitios distintos → null', () => {
    const o = { nombre: 'Hotel Plaza', ciudad: 'Madrid' }
    expect(paginaConfiable(o, [entidad('Q3', 'Hotel Plaza', 'hotel en Nueva York', 'https://plaza.example')], {})).toBeNull()
    expect(paginaConfiable(o, [entidad('Q4', 'Plaza Mayor', 'plaza en Madrid', 'https://plazamayor.example')], {})).toBeNull()
    expect(paginaConfiable(o, [entidad('Q5', 'Hotel Plaza', 'hotel en Madrid', null)], {})).toBeNull()
    expect(paginaConfiable(o, [entidad('Q6', 'Hotel Plaza', 'hotel en Madrid', 'http://plaza.example')], {})).toBeNull()
    expect(paginaConfiable(o, [entidad('Q7', 'Hotel Plaza', 'hotel en Madrid', 'https://a.example'), entidad('Q8', 'Hotel Plaza', 'hotel de Madrid', 'https://b.example')], {})).toBeNull()
  })
})
