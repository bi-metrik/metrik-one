import { describe, expect, it } from 'vitest'

import { esDeAgenciaDeViajes, MENSAJE_AGENCIA, nombreRegistrable } from './agencias'
import { MENSAJE_SIN_AUTORIZACION, revisarAutorizacion } from './autorizacion'

describe('agencias en línea: nunca son fuente de fotos', () => {
  it.each([
    'https://www.booking.com/hotel/co/bahia-sardina.es.html',
    'booking.com/hotel/co/bahia-sardina.html',
    'https://secure.booking.com/x',
    'https://www.expedia.com/San-Andres-Hotels-Hotel-Bahia.h123.Hotel-Information',
    'https://www.expedia.co/Hotel',
    'https://www.despegar.com.co/hoteles/h-123',
    'https://www.despegar.com.ar/hoteles',
    'https://www.decolar.com/hoteis',
    'https://www.tripadvisor.co.uk/Hotel_Review',
    'https://www.hotels.com/ho123',
    'https://www.trivago.com.co/',
    'https://www.agoda.com/es-es/hotel',
    'https://www.airbnb.com.co/rooms/1',
    'mira esta: https://www.booking.com/hotel/x.html',
  ])('rechaza %s', (url) => {
    expect(esDeAgenciaDeViajes(url)).toBe(true)
  })

  it.each([
    'https://www.hotelbahiasardina.com/galeria',
    'https://hotels.marriott.com/x',
    'https://www.bookingsantamarta.example/', // otro nombre registrable
    'https://commons.wikimedia.org/wiki/File:Booking.jpg',
    'kit de medios del hotel',
    'mayorista Aviatur',
    '',
  ])('deja pasar %s', (texto) => {
    expect(esDeAgenciaDeViajes(texto)).toBe(false)
  })

  it('el nombre registrable salta el segundo nivel de un ccTLD', () => {
    expect(nombreRegistrable('www.despegar.com.co')).toBe('despegar')
    expect(nombreRegistrable('www.tripadvisor.co.uk')).toBe('tripadvisor')
    expect(nombreRegistrable('hotels.marriott.com')).toBe('marriott')
    expect(nombreRegistrable('localhost')).toBeNull()
  })

  it('el mensaje es el que pidió Mauricio', () => {
    expect(MENSAJE_AGENCIA).toBe('Esa página no nos deja usar sus fotos: pide el kit de medios al hotel o súbela.')
  })
})

describe('la casilla «Tengo autorización para usar esta foto»', () => {
  it('sin la casilla (o con algo que no es `true`) no se guarda', () => {
    for (const p of [undefined, null, {}, { autorizada: false }, { autorizada: 'true' }, { autorizada: 1 }]) {
      expect(revisarAutorizacion(p)).toEqual({ ok: false, error: MENSAJE_SIN_AUTORIZACION })
    }
  })

  it('con la casilla: la procedencia es opcional, se limpia y tiene tope', () => {
    expect(revisarAutorizacion({ autorizada: true })).toEqual({ ok: true, procedencia: null })
    expect(revisarAutorizacion({ autorizada: true, procedencia: '   ' })).toEqual({ ok: true, procedencia: null })
    expect(revisarAutorizacion({ autorizada: true, procedencia: '  kit de medios   del hotel ' })).toEqual({ ok: true, procedencia: 'kit de medios del hotel' })
    expect(revisarAutorizacion({ autorizada: true, procedencia: 'x'.repeat(201) })).toMatchObject({ ok: false })
    expect(revisarAutorizacion({ autorizada: true, procedencia: 42 })).toMatchObject({ ok: false })
  })

  it('una procedencia que es un enlace de agencia se rechaza', () => {
    expect(revisarAutorizacion({ autorizada: true, procedencia: 'https://www.booking.com/hotel/x' })).toEqual({ ok: false, error: MENSAJE_AGENCIA })
  })
})
