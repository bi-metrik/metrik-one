/**
 * La tarjeta «Solicitud» del panel del viaje (especificación de Noor, 2026-10-26), con datos ficticios armados por
 * `solicitudDesdeFilas`: las filas con valor, los textos libres en `FilaLarga` (recortados a 3 líneas y desplegables),
 * las edades debajo de los pasajeros, el «Bolsillo declarado» oculto cuando la solicitud trae presupuesto y el estado
 * vacío solo sin ninguna fila.
 *
 * Se queda en `.ts` por el `include` de vitest.
 */
import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import PanelViaje from './panel-viaje'
import { solicitudDesdeFilas, type MarcoDelNegocio } from '@/lib/cotizaciones/marco-negocio'

const VIAJE: MarcoDelNegocio['viaje'] = { destino: 'Isla Ficticia', fechas: { inicio: '2026-12-01', fin: '2026-12-08' }, composicion: { adultos: 2, ninos: 1, infantes: 0 } }
const PERFIL = { tipo: 'Leisure', conQuienViaja: null, bolsillo: 'Medio', preferencias: null, notas: null }

function marco(filas: Record<string, unknown>[], viaje = VIAJE): MarcoDelNegocio {
  return {
    negocioId: 'neg-1',
    viaje,
    iataDestino: null,
    solicitud: solicitudDesdeFilas(filas, viaje, [
      { slug: 'presupuesto', tipo: 'select', opciones: [{ value: '3m_5m', label: 'Entre $3 y $5 millones' }] },
    ]),
    perfil: PERFIL,
    cotizaciones: null,
    puedeCrearCotizacion: true,
  }
}

const tarjeta = (html: string) => html.slice(html.indexOf('data-panel-solicitud'), html.indexOf('data-panel-perfil'))
const render = (m: MarcoDelNegocio) => renderToStaticMarkup(React.createElement(PanelViaje, { viaje: m, cotActualId: null }))

describe('tarjeta Solicitud', () => {
  it('los textos libres van a lo ancho, recortados a 3 líneas y desplegables', () => {
    const html = tarjeta(render(marco([{ requisitos_especiales: 'Cuna para el bebé y habitación en piso bajo', edades_menores: '9' }])))
    expect(html).toContain('Requisitos')
    expect(html).toMatch(/line-clamp-3[^>]*>Cuna para el bebé y habitación en piso bajo</)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Edades: 9')
  })

  it('con presupuesto en la solicitud, el perfil no repite el bolsillo', () => {
    expect(render(marco([{ presupuesto: '3m_5m' }]))).not.toContain('Bolsillo declarado')
    expect(render(marco([{ presupuesto: '3m_5m' }]))).toContain('Entre $3 y $5 millones')
    expect(render(marco([{}]))).toContain('Bolsillo declarado')
  })

  it('el estado vacío solo aparece si no hay ninguna fila', () => {
    const vacio = { destino: null, fechas: { inicio: null, fin: null }, composicion: null }
    expect(tarjeta(render(marco([{ presentacion_destino: 'no entra' }], vacio)))).toContain('todavía no tiene la solicitud')
    expect(tarjeta(render(marco([{ equipaje: 'bodega' }], vacio)))).not.toContain('todavía no tiene la solicitud')
  })
})
