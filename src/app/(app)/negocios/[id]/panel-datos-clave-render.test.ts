/**
 * La tarjeta de datos clave pinta lo que el servidor resolvió, sin esconder nada.
 *
 * Prueba de RENDER a propósito: el defecto que la tarjeta cierra es que un dato que falta
 * no se veía. Un «Sin definir» que el JSX olvidara pintar, o una contradicción que no
 * saliera en rojo, pasarían todas las pruebas de `datos-clave.ts` y `cruces.ts`.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import PanelDatosClave from './panel-datos-clave'
import type { VistaDatosClave } from '@/lib/negocios/datos-clave'

const VISTA: VistaDatosClave = {
  titulo: 'Datos clave',
  campos: [
    { label: 'Servicio', valor: { estado: 'sin_definir' }, detalle: [] },
    { label: 'Titularidad', valor: { estado: 'ok', texto: 'Único', nota: null }, detalle: ['ALVARADO BARRUETO LADY MARLENE'] },
    { label: 'Tarifa UPME', valor: { estado: 'ok', texto: '$701.812', nota: 'cotizada' }, detalle: [] },
    { label: 'Cita DIAN', valor: { estado: 'no_aplica' }, detalle: [] },
  ],
  contradicciones: [
    { slug: 'factura', mensaje: 'La factura trae 2 compradores y la titularidad dice «Un solo solicitante».', bloquea: false },
    { slug: 'certificado', mensaje: 'El certificado UPME trae 1 solicitante y la titularidad dice «Copropiedad».', bloquea: true },
  ],
}

const html = (v: VistaDatosClave | null) => renderToStaticMarkup(React.createElement(PanelDatosClave, { vista: v }))

describe('PanelDatosClave', () => {
  it('pinta el valor, su nota, el detalle, «Sin definir» y «No aplica»', () => {
    const h = html(VISTA)
    expect(h).toContain('Único')
    expect(h).toContain('ALVARADO BARRUETO LADY MARLENE')
    expect(h).toContain('$701.812')
    expect(h).toContain('(cotizada)')
    expect(h).toContain('Sin definir')
    expect(h).toContain('No aplica')
    expect(h).toMatch(/amber[^"]*"[^>]*>\s*Sin definir/)
  })

  it('las contradicciones van en rojo y dicen cuándo frenan el avance', () => {
    const h = html(VISTA)
    expect(h).toContain('La factura trae 2 compradores y la titularidad dice «Un solo solicitante».')
    expect(h).toMatch(/bg-red-50/)
    expect(h.match(/Frena el avance en esta etapa/g)).toHaveLength(1)
  })

  it('sin configuración ni contradicciones no pinta nada', () => {
    expect(html(null)).toBe('')
    expect(html({ titulo: 'x', campos: [], contradicciones: [] })).toBe('')
  })
})
