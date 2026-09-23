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
import { TERMINOS_BASE_TRAPPVEL } from '@/lib/cotizaciones/__fixtures__/terminos-base-trappvel'

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
  terminos: null,
  terminosBase: null,
  ...over,
})

const html = (p: PanelTextoCliente) =>
  renderToStaticMarkup(React.createElement(DocumentoClientePanel, { cotizacionId: 'c1', inicial: p }))
const pintar = (p: PanelTextoCliente) => texto(html(p))

/** El contenido del textarea de términos, tal como lo escapa React. */
function cuadroDeTerminos(h: string): string | null {
  const m = /<textarea id="terminos-c1"[^>]*>([\s\S]*?)<\/textarea>/.exec(h)
  if (!m) return null
  return m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
}

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

describe('dónde sale cada campo (C1)', () => {
  it('⚠️ cada campo dice, debajo del rótulo, dónde sale en el PDF y para qué', () => {
    const t = pintar(panel())
    expect(t).toContain('Titular Es el título de la portada. Si lo dejas vacío, sale el nombre del negocio.')
    expect(t).toContain('Presentación Sale debajo del título, en la primera página. Una o dos frases que presenten el viaje.')
    expect(t).toContain('Incluido en el plan Sale al final, en la lista de lo que incluye el precio.')
    expect(t).toContain('Antes de viajar Sale al final. Consejos para el viajero: documentos, clima, qué llevar.')
    expect(t).toContain('Términos y condiciones Sale al cierre del documento, antes de la firma. Las reglas de la reserva.')
  })

  it('términos es la ÚLTIMA sección, antes del único botón de guardar', () => {
    const t = pintar(panel())
    const i = t.indexOf('Términos y condiciones')
    expect(i).toBeGreaterThan(t.indexOf('Antes de viajar'))
    expect(t.indexOf('Guardar texto revisado')).toBeGreaterThan(i)
    expect(t.split('Guardar texto revisado').length - 1).toBe(1)
  })

  it('la miniatura del documento existe y se oculta en celular: queda la línea de ayuda', () => {
    const h = html(panel())
    expect(h).toContain('Portada · página 1')
    expect(h).toContain('Cierre')
    expect(h).toMatch(/class="hidden items-end gap-3 sm:flex" aria-hidden="true"/)
  })
})

describe('los términos en el panel (C2)', () => {
  it('⚠️⚠️ un borrador sin términos nace con el texto base de la línea, marcado como no guardado', () => {
    const h = html(panel({ terminos: null, terminosBase: TERMINOS_BASE_TRAPPVEL }))
    expect(cuadroDeTerminos(h)).toBe(TERMINOS_BASE_TRAPPVEL)
    const t = texto(h)
    expect(t).toContain('Propuestos con las condiciones de siempre de la línea')
    expect(t).toContain('Cambios sin guardar')
  })

  it('los términos guardados mandan sobre el texto base: son la copia de ESTA cotización', () => {
    const h = html(panel({ terminos: 'Tarifa válida por 3 días.', terminosBase: TERMINOS_BASE_TRAPPVEL }))
    expect(cuadroDeTerminos(h)).toBe('Tarifa válida por 3 días.')
    expect(texto(h)).not.toContain('Propuestos con las condiciones de siempre')
  })

  it('sin texto base, el cuadro queda vacío con un ejemplo en gris', () => {
    const h = html(panel({ terminos: null, terminosBase: null }))
    expect(cuadroDeTerminos(h)).toBe('')
    expect(h).toMatch(/placeholder="Condiciones generales/)
    expect(texto(h)).not.toContain('Cambios sin guardar')
  })

  it('una cotización que ya no es borrador muestra sus términos y no propone el base', () => {
    const t = pintar(panel({ editable: false, terminos: 'Tarifa válida por 3 días.', terminosBase: TERMINOS_BASE_TRAPPVEL }))
    expect(t).toContain('Tarifa válida por 3 días.')
    expect(t).not.toContain('Medios de pago')
    expect(pintar(panel({ editable: false, terminos: null, terminosBase: TERMINOS_BASE_TRAPPVEL }))).not.toContain('Medios de pago')
  })
})

describe('el estilo del borrador (C4)', () => {
  it('⚠️ un borrador con fórmulas de folleto lo dice, sin reescribirlo', () => {
    const t = pintar(panel({ documento: { ...DOC, titular: 'Descubra San Andrés', intro: 'Un rincón del Caribe.' } }))
    expect(t).toContain('Revisa el estilo antes de guardar')
    expect(t).toContain('«Descubra» (Titular): suena a folleto.')
    expect(t).toContain('«rincón» (Presentación): suena a folleto.')
  })

  it('un texto limpio no muestra el aviso', () => {
    expect(pintar(panel())).not.toContain('Revisa el estilo')
  })
})
