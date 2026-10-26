import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import MarcaSugerido from './marca-sugerido'

describe('MarcaSugerido', () => {
  it('muestra la frase del mensaje y el botón de confirmar', () => {
    const html = renderToStaticMarkup(React.createElement(MarcaSugerido, { marca: { fuente: 'whatsapp', frase: 'dos personas' }, onConfirmar: () => {} }))
    expect(html).toContain('Sugerido desde WhatsApp: «dos personas»')
    expect(html).toContain('Confirmar')
  })

  it('en solo lectura, la marca sin botón', () => {
    const html = renderToStaticMarkup(React.createElement(MarcaSugerido, { marca: { fuente: 'whatsapp', frase: 'x' } }))
    expect(html).toContain('Sugerido')
    expect(html).not.toContain('Confirmar')
  })

  it('sin frase muestra la deducción, y si reemplazó otro sugerido dice qué había', () => {
    const html = renderToStaticMarkup(React.createElement(MarcaSugerido, {
      marca: { fuente: 'whatsapp', frase: '', deduccion: 'Edades 9, 4: ninguno de los 2 niños es menor de 2 años', anterior: 2 },
    }))
    expect(html).toContain('Sugerido desde WhatsApp (deducido): Edades 9, 4: ninguno de los 2 niños es menor de 2 años')
    expect(html).toContain('Antes decía 2; nadie lo había confirmado.')
  })
})
