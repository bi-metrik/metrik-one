/**
 * Por qué una página oficial no dio fotos: la página bloquea, no trae fotos o la red falló
 * (Mauricio, 2026-10-16). HTML sintético: ninguna página real se baja en las pruebas.
 */
import { describe, expect, it } from 'vitest'

import { CONSEJO_FALLA, esPaginaDeDesafio, fallaPorEstado, mensajeDeFalla, motivoVisible, TITULO_FALLA } from './falla-pagina'

describe('el estado HTTP', () => {
  it('401, 403 y 429 son una página que bloquea', () => {
    for (const s of [401, 403, 429]) expect(fallaPorEstado(s), String(s)).toBe('bloqueada')
  })

  it('un 503 de un muro anti-bots también; un 503 a secas es la red', () => {
    expect(fallaPorEstado(503, new Headers({ 'cf-mitigated': 'challenge' }))).toBe('bloqueada')
    expect(fallaPorEstado(503, new Headers({ server: 'cloudflare' }))).toBe('bloqueada')
    expect(fallaPorEstado(503, new Headers({ server: 'AkamaiGHost' }))).toBe('bloqueada')
    expect(fallaPorEstado(503, new Headers({ server: 'nginx' }))).toBe('red')
    expect(fallaPorEstado(503)).toBe('red')
  })

  it('404, 410 y 5xx son la red (intentar de nuevo o pegar la foto)', () => {
    for (const s of [404, 410, 500, 502, 504]) expect(fallaPorEstado(s), String(s)).toBe('red')
  })
})

describe('la página de desafío que llega con 200', () => {
  it('Cloudflare, DataDome, PerimeterX, Incapsula y Akamai', () => {
    expect(esPaginaDeDesafio('<html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>')).toBe(true)
    expect(esPaginaDeDesafio('<title>Attention Required! | Cloudflare</title>')).toBe(true)
    expect(esPaginaDeDesafio('<html><script src="https://ct.captcha-delivery.com/c.js"></script></html>')).toBe(true)
    expect(esPaginaDeDesafio('<div id="px-captcha"></div>')).toBe(true)
    expect(esPaginaDeDesafio('<iframe src="/_Incapsula_Resource?SWUDNSAI=31"></iframe>')).toBe(true)
    expect(esPaginaDeDesafio('<title>Access Denied</title><p>Reference https://errors.edgesuite.net/18.1</p>')).toBe(true)
  })

  it('una página corta que pide demostrar que eres humano, sin imágenes', () => {
    expect(esPaginaDeDesafio('<html><body><h1>Verify you are human</h1><div class="captcha"></div></body></html>')).toBe(true)
  })

  it('la página de un hotel con el reCAPTCHA de su formulario NO es un desafío', () => {
    const hotel = `<html><head><title>Hotel Mar Azul</title></head><body>
      <img src="/fotos/fachada.jpg" width="1200"><form><div class="g-recaptcha"></div></form>
      <script src="https://www.google.com/recaptcha/api.js"></script></body></html>`
    expect(esPaginaDeDesafio(hotel)).toBe(false)
    expect(esPaginaDeDesafio('<html><body><h1>Habitaciones</h1></body></html>')).toBe(false)
  })
})

describe('lo que ve la persona', () => {
  it('los tres avisos dicen qué pasó y qué hacer', () => {
    expect(mensajeDeFalla('bloqueada')).toBe('Esa página no deja leer sus fotos. Ábrela, haz clic derecho sobre la foto › Copiar imagen y pégala aquí (Ctrl+V).')
    expect(TITULO_FALLA.sin_fotos).toBe('No encontramos fotos en esa página.')
    expect(CONSEJO_FALLA.sin_fotos).toBe(CONSEJO_FALLA.bloqueada)
    expect(mensajeDeFalla('red')).toBe('No pudimos abrir esa página. Intenta de nuevo o pega la foto aquí (Ctrl+V).')
  })

  it('una URL inválida no es un aviso (tiene su mensaje); lo que no es HTML cuenta como «sin fotos»', () => {
    expect(motivoVisible('invalida')).toBeNull()
    expect(motivoVisible('no_es_pagina')).toBe('sin_fotos')
    expect(motivoVisible('bloqueada')).toBe('bloqueada')
    expect(motivoVisible('red')).toBe('red')
  })
})
