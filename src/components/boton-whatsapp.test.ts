/**
 * El botón de WhatsApp de la campana: con `metadata.wa_url` aparece y abre la URL EXACTA que
 * dejó el motor (`enlaceWhatsApp`); sin ella no pinta nada; sin teléfono abre solo con el texto
 * y avisa. Y nunca abre algo que no sea wa.me o api.whatsapp.com (metadata es jsonb libre).
 * Datos ficticios.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { BotonWhatsApp, leerEnlaceWhatsApp } from './boton-whatsapp'
import { enlaceWhatsApp } from '@/lib/viaje/confirmacion'

const pintar = (metadata: unknown) => renderToStaticMarkup(React.createElement(BotonWhatsApp, { metadata }))
const escaparHref = (u: string) => u.replace(/&/g, '&amp;')

describe('BotonWhatsApp', () => {
  it('con wa_url pinta el botón con el href exacto, en pestaña nueva y sin opener', () => {
    const url = enlaceWhatsApp('300 123 4567', 'Hola Ana, ¿cómo te fue en el viaje? & cuéntanos')
    const html = pintar({ regla_id: 'r-1', wa_url: url })
    expect(html).toContain('Abrir WhatsApp con el mensaje')
    expect(html).toContain(`href="${escaparHref(url)}"`)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('min-h-11')
    expect(html).not.toContain('Sin teléfono')
  })

  it('sin wa_url no pinta nada', () => {
    expect(pintar({ regla_id: 'r-1' })).toBe('')
    expect(pintar({})).toBe('')
    expect(pintar(null)).toBe('')
    expect(pintar({ wa_url: 42 })).toBe('')
  })

  it('sin teléfono abre solo con el texto y muestra el aviso', () => {
    const url = enlaceWhatsApp(null, 'Hola, ¿cómo te fue?')
    expect(url.startsWith('https://wa.me/?text=')).toBe(true)
    const html = pintar({ wa_url: url })
    expect(html).toContain(`href="${escaparHref(url)}"`)
    expect(html).toContain('Sin teléfono: elige el chat en WhatsApp')
  })

  it('api.whatsapp.com: con phone no avisa, sin phone avisa', () => {
    expect(leerEnlaceWhatsApp({ wa_url: 'https://api.whatsapp.com/send?phone=573001234567&text=hola' }))
      .toEqual({ url: 'https://api.whatsapp.com/send?phone=573001234567&text=hola', sinTelefono: false })
    expect(leerEnlaceWhatsApp({ wa_url: 'https://api.whatsapp.com/send?text=hola' })?.sinTelefono).toBe(true)
  })

  it('no abre nada fuera de wa.me o api.whatsapp.com', () => {
    for (const wa_url of [
      'javascript:alert(1)',
      'http://wa.me/573001234567',
      'https://wa.me.otro.com/573001234567',
      'https://wa.me@otro.com/573001234567',
      'https://otro.com/?u=https://wa.me/',
      ' https://wa.me/573001234567',
      'https://WA.ME/573001234567',
      'https://www.whatsapp.com/',
      'https://wa.me:8443/573001234567',
    ]) {
      expect(leerEnlaceWhatsApp({ wa_url }), wa_url).toBeNull()
      expect(pintar({ wa_url }), wa_url).toBe('')
    }
  })
})
