import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import MarcaSugerido from './marca-sugerido'

describe('MarcaSugerido', () => {
  it('muestra la frase del mensaje y el botón de confirmar', () => {
    const html = renderToStaticMarkup(React.createElement(MarcaSugerido, { frase: 'dos personas', onConfirmar: () => {} }))
    expect(html).toContain('Sugerido desde WhatsApp: «dos personas»')
    expect(html).toContain('Confirmar')
  })

  it('en solo lectura, la marca sin botón', () => {
    const html = renderToStaticMarkup(React.createElement(MarcaSugerido, { frase: 'x' }))
    expect(html).toContain('Sugerido')
    expect(html).not.toContain('Confirmar')
  })
})
