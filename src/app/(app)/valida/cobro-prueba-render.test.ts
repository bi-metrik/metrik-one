/**
 * Lo que ve la cuenta de una prueba con tarjeta: la fecha y la hora del cobro (Condiciones 7.1) y el
 * botón con el nombre EXACTO que prometen las Condiciones (7.3, «Cancelar prueba»).
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('./cancelar-prueba-acciones', () => ({ cancelarPruebaValida: async () => ({ ok: true, texto: 'x' }) }))

import { CobroPrueba } from './cobro-prueba'
import { COBRO_TRAS_PRUEBA } from '@/lib/valida-registro/condiciones-cobro'
import { CONDICIONES_PRUEBA_CON_COBRO } from '@/lib/valida-registro/condiciones'

const base = {
  fechaYHora: 'martes, 20 de octubre de 2026, 3:00 p. m.',
  precio: COBRO_TRAS_PRUEBA.precio,
  boton: COBRO_TRAS_PRUEBA.botonCancelar,
}

describe('el bloque del cobro en /valida', () => {
  it('la persona dueña ve la fecha, el valor y el botón «Cancelar prueba»', () => {
    const html = renderToStaticMarkup(React.createElement(CobroPrueba, { ...base, estado: 'programado', puedeCancelar: true }))
    expect(html).toContain('martes, 20 de octubre de 2026, 3:00 p. m.')
    expect(html).toContain('$150.000')
    expect(html).toContain('>Cancelar prueba<')
    // El nombre del botón es el que dicen las Condiciones, no otro.
    expect(CONDICIONES_PRUEBA_CON_COBRO.texto).toContain(`"${COBRO_TRAS_PRUEBA.botonCancelar}"`)
  })

  it('quien no es la dueña (o «Ver como») ve la fecha, sin botón', () => {
    const html = renderToStaticMarkup(React.createElement(CobroPrueba, { ...base, estado: 'programado', puedeCancelar: false }))
    expect(html).toContain('3:00 p. m.')
    expect(html).not.toContain('Cancelar prueba')
  })

  it('cancelada: dice que no se cobra nada', () => {
    const html = renderToStaticMarkup(React.createElement(CobroPrueba, { ...base, estado: 'cancelado', puedeCancelar: false }))
    expect(html).toContain('no se cobrará nada')
  })

  it('ya cobrada no pinta nada', () => {
    expect(renderToStaticMarkup(React.createElement(CobroPrueba, { ...base, estado: 'cobrado', puedeCancelar: false }))).toBe('')
  })
})
