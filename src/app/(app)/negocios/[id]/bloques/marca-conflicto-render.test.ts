import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import MarcaConflicto, { valorLegibleCampo } from './marca-conflicto'

const marca = { fuente: 'whatsapp' as const, valor: '2026-11-20', frase: 'el 20 de noviembre', en: '2026-09-30T15:00:00Z', origen: 'audio' as const }

describe('MarcaConflicto', () => {
  it('dice qué dijo el cliente y ofrece usarlo o dejar el actual', () => {
    const html = renderToStaticMarkup(React.createElement(MarcaConflicto, {
      marca, legible: valorLegibleCampo({ tipo: 'fecha' }, marca.valor), onUsar: () => {}, onDejar: () => {},
    }))
    expect(html).toContain('El cliente dijo 20 nov en el audio del 30-sep')
    expect(html).toContain('«el 20 de noviembre»')
    expect(html).toContain('Usar')
    expect(html).toContain('Dejar el actual')
  })

  it('en solo lectura, el aviso sin botones', () => {
    const html = renderToStaticMarkup(React.createElement(MarcaConflicto, { marca, legible: 'x' }))
    expect(html).not.toContain('Usar')
  })

  it('las opciones se leen por su etiqueta', () => {
    expect(valorLegibleCampo({ tipo: 'select', opciones: [{ value: 'cinco', label: '5 estrellas' }] }, 'cinco')).toBe('5 estrellas')
  })
})
