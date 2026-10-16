/**
 * La página oficial que no deja leer sus fotos, que no las trae o que no responde, y la extracción
 * mejorada para webs comunes (fondos en línea, lazy-load, tamaños declarados, páginas de galería).
 * Todo con HTML y redes falsas: ninguna página real se baja en las pruebas.
 */
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'

import { MENSAJE_AGENCIA } from './agencias'
import { MENSAJE_URL_INVALIDA, mensajeDeFalla } from './falla-pagina'
import { bajarFotoDeSitio, imagenesDePagina, imagenPegadaPorUrl, leerPagina, MAX_SUBPAGINAS, opcionesDeSitioOficial, paginasDeGaleria, traerConMotivo, type Resolver } from './sitio-oficial'

const publico: Resolver = async () => ['93.184.216.34']
const html = (cuerpo: string, init: ResponseInit = {}) => new Response(cuerpo, { ...init, headers: { 'content-type': 'text/html; charset=utf-8', ...(init.headers ?? {}) } })
const falso = (responder: (url: string) => Response | Promise<Response>) => {
  const pedidas: string[] = []
  const f = (async (url: string) => {
    pedidas.push(url)
    return responder(url)
  }) as unknown as typeof fetch
  return { f, pedidas }
}
async function jpeg(ancho: number, alto: number) {
  return new Uint8Array(await sharp({ create: { width: ancho, height: alto, channels: 3, background: { r: 30, g: 120, b: 90 } } }).jpeg().toBuffer())
}

describe('por qué no se pudo leer la página', () => {
  const URL_HOTEL = 'https://www.hotel.example/en/hotels/cartagena/'

  it('403 (como Hilton con un navegador automático): «bloqueada», con la página para abrirla', async () => {
    const { f } = falso(() => html('<h1>Access Denied</h1>', { status: 403, headers: { server: 'AkamaiGHost' } }))
    expect(await opcionesDeSitioOficial(URL_HOTEL, { fetch: f, resolver: publico })).toEqual({
      ok: false,
      motivo: 'bloqueada',
      pagina: URL_HOTEL,
      error: mensajeDeFalla('bloqueada'),
    })
  })

  it('429 y 401 también bloquean; un 503 de Cloudflare también', async () => {
    for (const r of [() => html('', { status: 429 }), () => html('', { status: 401 }), () => html('', { status: 503, headers: { 'cf-mitigated': 'challenge' } })]) {
      const { f } = falso(r)
      expect(await opcionesDeSitioOficial(URL_HOTEL, { fetch: f, resolver: publico })).toMatchObject({ ok: false, motivo: 'bloqueada' })
    }
  })

  it('un desafío de Cloudflare servido con 200 cuenta como bloqueada (y no se prueban galerías)', async () => {
    const { f, pedidas } = falso(() => html('<html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt={}</script></body></html>'))
    expect(await opcionesDeSitioOficial(URL_HOTEL, { fetch: f, resolver: publico })).toMatchObject({ ok: false, motivo: 'bloqueada' })
    expect(pedidas).toEqual([URL_HOTEL])
  })

  it('timeout o conexión cortada: «red»', async () => {
    const { f } = falso(() => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    expect(await opcionesDeSitioOficial(URL_HOTEL, { fetch: f, resolver: publico })).toEqual({ ok: false, motivo: 'red', pagina: URL_HOTEL, error: mensajeDeFalla('red') })
  })

  it('el DNS no responde: «red»; un 404 o un 500: «red»', async () => {
    const { f } = falso(() => html('nada', { status: 404 }))
    const sinDns: Resolver = async () => {
      throw new Error('ENOTFOUND')
    }
    expect(await opcionesDeSitioOficial(URL_HOTEL, { fetch: f, resolver: sinDns })).toMatchObject({ ok: false, motivo: 'red' })
    expect(await opcionesDeSitioOficial(URL_HOTEL, { fetch: f, resolver: publico })).toMatchObject({ ok: false, motivo: 'red' })
    const { f: f500 } = falso(() => html('caído', { status: 500 }))
    expect(await opcionesDeSitioOficial(URL_HOTEL, { fetch: f500, resolver: publico })).toMatchObject({ ok: false, motivo: 'red' })
  })

  it('una URL http, privada o rota no es un aviso: su propio mensaje, sin motivo', async () => {
    const { f, pedidas } = falso(() => html(''))
    expect(await opcionesDeSitioOficial('http://www.hotel.example/', { fetch: f, resolver: publico })).toEqual({ ok: false, error: MENSAJE_URL_INVALIDA })
    expect(await opcionesDeSitioOficial('https://interno.example/', { fetch: f, resolver: async () => ['10.0.0.8'] })).toEqual({ ok: false, error: MENSAJE_URL_INVALIDA })
    expect(pedidas).toEqual([])
  })

  it('la página carga pero sin fotos (galería con JavaScript): ok y vacía, y prueba como mucho 2 galerías', async () => {
    const { f, pedidas } = falso((url) => (url === URL_HOTEL ? html('<html lang="en"><body><div id="root"></div><script src="/app.js"></script></body></html>') : html('', { status: 404 })))
    const r = await opcionesDeSitioOficial(URL_HOTEL, { fetch: f, resolver: publico })
    expect(r).toEqual({ ok: true, pagina: URL_HOTEL, candidatas: [], siguiente: null })
    expect(pedidas).toEqual([URL_HOTEL, `${URL_HOTEL}gallery`, `${URL_HOTEL}galeria`])
    expect(pedidas.length - 1).toBeLessThanOrEqual(MAX_SUBPAGINAS)
  })

  it('la página abre pero el sitio niega TODAS sus fotos al servidor: también bloqueada', async () => {
    const pagina = '<meta property="og:image" content="https://cdn.hotel.example/a.jpg"><img src="https://cdn.hotel.example/b.jpg">'
    const { f } = falso((url) => (url === URL_HOTEL ? html(pagina) : url.startsWith('https://cdn.') ? new Response('no', { status: 403 }) : html('', { status: 404 })))
    expect(await opcionesDeSitioOficial(URL_HOTEL, { fetch: f, resolver: publico })).toMatchObject({ ok: false, motivo: 'bloqueada' })
  })

  it('una página que no es HTML: «sin fotos»', async () => {
    const { f } = falso(() => new Response('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } }))
    expect(await traerConMotivo(URL_HOTEL, { fetch: f, resolver: publico, maxBytes: 1000, tipo: /^text\/html$/ })).toEqual({ ok: false, falla: 'no_es_pagina' })
    expect(await opcionesDeSitioOficial(URL_HOTEL, { fetch: f, resolver: publico })).toMatchObject({ ok: false, motivo: 'sin_fotos' })
  })

  it('el bloqueo de agencias en línea se respeta antes de cualquier lectura', async () => {
    const { f, pedidas } = falso(() => html(''))
    expect(await opcionesDeSitioOficial('https://www.booking.com/hotel/co/x.html', { fetch: f, resolver: publico })).toEqual({ ok: false, error: MENSAJE_AGENCIA })
    expect(pedidas).toEqual([])
  })
})

describe('qué imágenes se toman de una web común', () => {
  const BASE = 'https://www.hotel.example/es/'

  it('fondos en línea (style y data-bg), lazy-load y JSON-LD', () => {
    const pagina = `
      <script type="application/ld+json">{"@type":"Hotel","image":{"@type":"ImageObject","contentUrl":"https://cdn.hotel.example/ld.jpg"}}</script>
      <div class="hero" style="background-image: url('/img/hero.jpg'); height: 600px"></div>
      <section style="background:#000 url(&quot;https://cdn.hotel.example/piscina.webp&quot;) center/cover no-repeat"></section>
      <div class="slide" data-bg="/img/slide-2.jpg"></div>
      <img data-lazy-src="/img/spa.jpg" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
      <img loading="lazy" data-src="/img/bar.jpg" src="/img/placeholder.png">
      <span style="background-color: red"></span>`
    expect(imagenesDePagina(pagina, BASE)).toEqual([
      'https://cdn.hotel.example/ld.jpg',
      'https://www.hotel.example/img/hero.jpg',
      'https://cdn.hotel.example/piscina.webp',
      'https://www.hotel.example/img/slide-2.jpg',
      'https://www.hotel.example/img/spa.jpg',
      'https://www.hotel.example/img/bar.jpg',
    ])
  })

  it('fuera logos, íconos, sprites y lo que declara menos de 400 px', () => {
    const pagina = `
      <img src="/img/marca.png" alt="Logo Hotel Mar Azul">
      <img src="/assets/sprites/ui.png">
      <img src="/img/wifi.png" width="48" height="48">
      <img src="/img/miniatura.jpg" width="320">
      <img src="/img/franja.jpg" width="1200" height="90">
      <img srcset="/img/chica-200.jpg 200w, /img/chica-380.jpg 380w">
      <img src="/img/habitacion.jpg" width="1600" height="1067" alt="Habitación doble">
      <img srcset="/img/terraza-480.jpg 480w, /img/terraza-1920.jpg 1920w" width="100">
      <img src="/img/lobby.jpg" width="100%">`
    expect(imagenesDePagina(pagina, BASE)).toEqual([
      'https://www.hotel.example/img/habitacion.jpg',
      'https://www.hotel.example/img/terraza-1920.jpg',
      'https://www.hotel.example/img/lobby.jpg',
    ])
  })
})

describe('las páginas de galería', () => {
  it('primero los enlaces de la propia página a su galería (mismo host), luego las adivinadas; máx 2', () => {
    const pagina = `<html lang="es"><a href="/es/galeria/">Galería</a><a href="https://otro.example/gallery">otro</a><a href="/es/fotos#top">Fotos</a><a href="/es/habitaciones">Hab</a></html>`
    expect(paginasDeGaleria(pagina, 'https://www.hotel.example/es/')).toEqual(['https://www.hotel.example/es/galeria/', 'https://www.hotel.example/es/fotos'])
  })

  it('adivinadas colgando de la ruta pegada, por el idioma de la página', () => {
    expect(paginasDeGaleria('<html lang="en"></html>', 'https://www.hotel.example/en/hotels/ctghihh-cartagena/')).toEqual([
      'https://www.hotel.example/en/hotels/ctghihh-cartagena/gallery',
      'https://www.hotel.example/en/hotels/ctghihh-cartagena/galeria',
    ])
    expect(paginasDeGaleria('<html lang="es-CO"></html>', 'https://hotel.example/index.html')).toEqual(['https://hotel.example/galeria', 'https://hotel.example/fotos'])
  })

  it('si lo pegado ya es la galería, no se inventan más (solo enlaces reales)', () => {
    expect(paginasDeGaleria('<html></html>', 'https://hotel.example/galeria')).toEqual([])
  })

  it('una portada con pocas fotos suma las de su galería; la elegida de la galería se puede bajar', { timeout: 20_000 }, async () => {
    const grande = await jpeg(1200, 800)
    const PORTADA = 'https://hotel.example/es/'
    const { f, pedidas } = falso((url) => {
      if (url === PORTADA) return html('<html lang="es"><meta property="og:image" content="https://hotel.example/img/fachada.jpg"><a href="/es/galeria">Galería</a></html>')
      if (url === 'https://hotel.example/es/galeria') return html('<img src="/img/hab-1.jpg"><img src="/img/hab-2.jpg"><img src="/img/piscina.jpg">')
      if (url.endsWith('.jpg')) return new Response(grande, { headers: { 'content-type': 'image/jpeg' } })
      return html('', { status: 404 })
    })
    const leida = await leerPagina(PORTADA, { fetch: f, resolver: publico })
    expect(leida).toEqual({
      ok: true,
      pagina: PORTADA,
      imagenes: ['https://hotel.example/img/fachada.jpg', 'https://hotel.example/img/hab-1.jpg', 'https://hotel.example/img/hab-2.jpg', 'https://hotel.example/img/piscina.jpg'],
    })
    // La portada y, como mucho, dos galerías.
    expect(pedidas.filter((u) => !u.endsWith('.jpg')).length).toBeLessThanOrEqual(1 + MAX_SUBPAGINAS)
    const r = await opcionesDeSitioOficial(PORTADA, { fetch: f, resolver: publico })
    expect(r.ok && r.candidatas.map((c) => c.imagen)).toHaveLength(4)
    expect((await bajarFotoDeSitio(PORTADA, 'https://hotel.example/img/hab-2.jpg', { fetch: f, resolver: publico })).ok).toBe(true)
  })

  it('una galería bloqueada o caída se ignora: quedan las de la portada', async () => {
    const PORTADA = 'https://hotel.example/'
    const { f } = falso((url) => (url === PORTADA ? html('<html lang="en"><img src="/img/a.jpg"></html>') : html('', { status: 403 })))
    expect(await leerPagina(PORTADA, { fetch: f, resolver: publico })).toEqual({ ok: true, pagina: PORTADA, imagenes: ['https://hotel.example/img/a.jpg'] })
  })
})

describe('la imagen pegada que llegó solo como <img src>', () => {
  it('se baja por la vía segura y vuelve como JPEG (no se guarda)', { timeout: 20_000 }, async () => {
    const { f } = falso(async () => new Response(await jpeg(3000, 2000), { headers: { 'content-type': 'image/jpeg' } }))
    const r = await imagenPegadaPorUrl('https://cdn.hotel.example/hab.jpg', { fetch: f, resolver: publico })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.dataUrl).toMatch(/^data:image\/jpeg;base64,/)
    const meta = await sharp(Buffer.from(r.dataUrl.split(',')[1], 'base64')).metadata()
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(2400)
  })

  it('una agencia en línea, una imagen negada o algo que no es foto: dice qué hacer', async () => {
    const { f, pedidas } = falso(() => new Response('no', { status: 403 }))
    expect(await imagenPegadaPorUrl('https://cf.bstatic.com/xdata/images/hotel/1.jpg', { fetch: f, resolver: publico })).toEqual({ ok: false, error: MENSAJE_AGENCIA })
    expect(pedidas).toEqual([])
    expect(await imagenPegadaPorUrl('https://cdn.hotel.example/a.jpg', { fetch: f, resolver: publico })).toEqual({ ok: false, error: expect.stringContaining('Subir la mía') })
    const { f: fHtml } = falso(() => html('<p>hola</p>'))
    expect(await imagenPegadaPorUrl('https://cdn.hotel.example/a.jpg', { fetch: fHtml, resolver: publico })).toEqual({ ok: false, error: expect.stringContaining('no es una foto') })
    expect(await imagenPegadaPorUrl('https://interno.example/a.jpg', { fetch: f, resolver: async () => ['127.0.0.1'] })).toMatchObject({ ok: false })
  })
})
