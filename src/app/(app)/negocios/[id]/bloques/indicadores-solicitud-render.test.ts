/**
 * Las dos barras se pintan con lo que falta en forma de pregunta, y un bloque sin la
 * config nueva no pinta nada. Prueba de RENDER: la función pura puede estar bien y el JSX
 * olvidar la lista de preguntas, que es lo único que le sirve a quien escribe la solicitud.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import IndicadoresSolicitud from './indicadores-solicitud'
import type { CampoConNivel } from '@/lib/negocios/niveles-solicitud'

const pintar = (fields: CampoConNivel[], valores: Record<string, unknown>) =>
  renderToStaticMarkup(React.createElement(IndicadoresSolicitud, { fields, valores }))

describe('IndicadoresSolicitud', () => {
  it('un bloque sin nivel no pinta nada', () => {
    expect(pintar([{ slug: 'destino', tipo: 'texto', required: true }], {})).toBe('')
  })

  it('pinta «N de M» y las preguntas de lo que falta', () => {
    const html = pintar([
      { slug: 'destino', tipo: 'texto', nivel: 'minimo', pregunta: '¿A dónde quieren viajar?' },
      { slug: 'fecha_salida', tipo: 'fecha', nivel: 'minimo', pregunta: '¿Qué día salen?' },
      { slug: 'equipaje', tipo: 'select', nivel: 'deseable', pregunta: '¿Qué equipaje llevan?' },
    ], { destino: 'Punta Cana' })
    expect(html).toContain('Mínimo para cotizar')
    expect(html).toContain('1 de 2')
    expect(html).toContain('¿Qué día salen?')
    expect(html).not.toContain('¿A dónde quieren viajar?')
    expect(html).toContain('Para la cotización final')
    expect(html).toContain('0 de 1')
    expect(html).toContain('¿Qué equipaje llevan?')
  })

  it('una barra completa no lista preguntas', () => {
    const html = pintar([{ slug: 'destino', tipo: 'texto', nivel: 'minimo', pregunta: '¿A dónde?' }], { destino: 'Madrid' })
    expect(html).toContain('1 de 1')
    expect(html).not.toContain('¿A dónde?')
    expect(html).not.toContain('Para la cotización final')
  })
})
