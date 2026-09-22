/**
 * Lo que el panel «Texto para el cliente» PROMETE, renderizado.
 *
 * Las reglas puras (`documento-cliente.ts`) pueden estar bien y el JSX pintar otra cosa.
 * Aquí se fija lo que ve quien cotiza:
 *
 *   - un borrador de ONE lleva la marca «Borrador de ONE, revisar» hasta que alguien lo
 *     guarde, y el revisado dice quién lo revisó;
 *   - si las líneas cambiaron después de escribirlo, lo avisa;
 *   - una cotización que ya no es borrador no ofrece redactar ni guardar;
 *   - sin la migración aplicada, lo dice en vez de pintar un formulario que va a fallar.
 *
 * Se queda en `.ts`: `vitest.config.ts` solo recoge `*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

import type { DocumentoCliente, PanelTextoCliente } from '@/lib/cotizaciones/documento-cliente'

vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, warning: () => {} } }))
// Las acciones arrastran `server-only` y el cliente de Supabase; el panel solo necesita sus
// referencias para los botones.
vi.mock('@/app/(app)/negocios/documento-cliente-actions', () => ({
  redactarDocumentoCliente: async () => ({ success: false, error: 'x' }),
  guardarDocumentoCliente: async () => ({ success: false, error: 'x' }),
}))

const { default: DocumentoClientePanel } = await import('./documento-cliente-panel')

function texto(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

const DOC: DocumentoCliente = {
  titular: 'San Andrés y Providencia',
  intro: 'Seis días frente al Caribe.',
  incluye: ['Tiquetes con Avianca'],
  antes_de_viajar: ['Tarjeta de turismo'],
  origen: 'ia',
  modelo: 'gemini-2.5-flash',
  redactado_en: '2026-09-22T20:00:00.000Z',
  fuente_hash: 'abc',
  revisado_por: null,
  revisado_por_nombre: null,
  revisado_en: null,
}

const panel = (over: Partial<PanelTextoCliente> = {}): PanelTextoCliente => ({
  columnaPresente: true,
  documento: DOC,
  desactualizado: false,
  hayViaje: true,
  editable: true,
  ...over,
})

const pintar = (p: PanelTextoCliente) =>
  texto(renderToStaticMarkup(React.createElement(DocumentoClientePanel, { cotizacionId: 'c1', inicial: p })))

describe('el panel del texto para el cliente', () => {
  it('⚠️ un borrador de ONE lleva su marca y avisa que el PDF no lo imprime', () => {
    const t = pintar(panel())
    expect(t).toContain('Borrador de ONE, revisar')
    expect(t).toContain('El PDF solo imprime el texto guardado')
    expect(t).toContain('Redactar con ONE')
    expect(t).toContain('Guardar texto revisado')
  })

  it('el revisado deja de ser borrador y dice quién lo revisó', () => {
    const t = pintar(panel({ documento: { ...DOC, revisado_en: '2026-09-22T21:00:00.000Z', revisado_por: 's1', revisado_por_nombre: 'Edgar Alarcón' } }))
    expect(t).not.toContain('Borrador de ONE, revisar')
    expect(t).toContain('Revisado por Edgar Alarcón')
  })

  it('si las líneas cambiaron después de escribirlo, lo avisa', () => {
    expect(pintar(panel({ desactualizado: true }))).toContain('Las líneas de la cotización cambiaron')
    expect(pintar(panel())).not.toContain('Las líneas de la cotización cambiaron')
  })

  it('una cotización que ya no es borrador no ofrece redactar ni guardar', () => {
    const t = pintar(panel({ editable: false }))
    expect(t).not.toContain('Redactar con ONE')
    expect(t).not.toContain('Guardar texto revisado')
    expect(t).toContain('ya no es un borrador')
    // El texto se sigue leyendo.
    expect(t).toContain('Tiquetes con Avianca')
  })

  it('sin la migración aplicada lo dice, y no pinta el formulario', () => {
    const t = pintar(panel({ columnaPresente: false, documento: null }))
    expect(t).toContain('falta aplicar la migración')
    expect(t).not.toContain('Redactar con ONE')
  })

  it('sin viaje que describir, lo explica en vez de dejar un botón mudo', () => {
    const t = pintar(panel({ documento: null, hayViaje: false }))
    expect(t).toContain('hace falta el destino del viaje')
  })
})
