/**
 * C6 · en pantalla: la lista única (dos grupos, «Ir», el verde cuando no hay nada) y el
 * «Incluye · Lo arma ONE» del texto para el cliente, solo con la forma por pasos.
 *
 * Se queda en `.ts` por el `include` de vitest.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {} }) }))
vi.mock('@/app/(app)/negocios/documento-cliente-actions', () => ({ guardarDocumentoCliente: vi.fn(), redactarDocumentoCliente: vi.fn() }))

const { ListaUnicaPorPasos } = await import('./por-pasos/lista-unica-por-pasos')
const { default: DocumentoClientePanel } = await import('./documento-cliente-panel')
const { listaUnica } = await import('@/lib/cotizaciones/lista-unica')

const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const VACIA = {
  sinPrecio: [], capturas: null, tarifas: [], salida: null, pantallazosPorAceptar: 0, texto: 'ok' as const,
  noVan: [], faltaDia: null, margenBajoAviso: null, recargo: null, viaje: null, ivaSinCalcular: null,
}

describe('C6 · la lista única en pantalla', () => {
  it('sin nada: el verde de Noor', () => {
    const html = renderToStaticMarkup(React.createElement(ListaUnicaPorPasos, { lista: listaUnica(VACIA), onIr: () => {} }))
    expect(texto(html)).toBe('Nada impide enviar y no hay nada por revisar.')
  })

  it('dos grupos, en rojo lo que impide y en ámbar lo que no, cada uno con su «Ir»', () => {
    const lista = listaUnica({
      ...VACIA,
      sinPrecio: [{ id: 'v-satena', nombre: 'SATENA', tipos: ['nino'] }],
      pantallazosPorAceptar: 2,
      noVan: [{ itemId: 'v-avianca', nombre: 'Vuelo' }],
    })
    const html = renderToStaticMarkup(React.createElement(ListaUnicaPorPasos, { lista, onIr: () => {} }))
    expect(html).toContain('data-grupo-impide')
    expect(html).toContain('data-grupo-revisar')
    expect(texto(html)).toContain('Impide enviar Falta el precio por pasajero de SATENA (niño)')
    expect(texto(html)).toContain('Revisa antes de enviar (no bloquea) 2 pantallazos sin aceptar')
    expect((html.match(/data-ir=/g) ?? []).length).toBe(3)
  })
})

describe('C6 · «Incluye · Lo arma ONE» en el texto para el cliente', () => {
  const panel = {
    columnaPresente: true, desactualizado: false, hayViaje: true, editable: true, terminos: null, terminosBase: null,
    documento: {
      titular: 'T', intro: null, incluye: ['Lo que escribió el modelo'], antes_de_viajar: [], origen: 'ia' as const, modelo: 'm',
      redactado_en: null, fuente_hash: null, revisado_por: null, revisado_por_nombre: null, revisado_en: '2026-10-12T14:00:00Z',
    },
  }

  it('con la forma por pasos: lo de ONE a la vista y sin editar; lo del modelo no aparece; pide guardar para marcar', () => {
    const html = renderToStaticMarkup(React.createElement(DocumentoClientePanel, {
      cotizacionId: 'c1', inicial: panel as never, incluyeDeOne: ['Tiquetes aéreos Bogotá – San Andrés con Avianca', '3 noches en Verde Mar'],
    }))
    expect(texto(html)).toContain('Incluye · Lo arma ONE con lo que se cobra')
    expect(texto(html)).toContain('Tiquetes aéreos Bogotá – San Andrés con Avianca')
    expect(html).not.toContain('Lo que escribió el modelo')
    expect(html).toContain('data-incluye-sin-guardar')
  })

  it('sin la forma por pasos, el panel de siempre', () => {
    const html = renderToStaticMarkup(React.createElement(DocumentoClientePanel, { cotizacionId: 'c1', inicial: panel as never }))
    expect(html).not.toContain('data-incluye-por-one')
    expect(html).toContain('Lo que escribió el modelo')
  })
})
