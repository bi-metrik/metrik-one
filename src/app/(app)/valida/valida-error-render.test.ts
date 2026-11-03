/**
 * El recuadro de error de /valida dice en llano qué pasó: nunca el código crudo del motor
 * (`busqueda_incompleta` se pintaba tal cual hasta el 2026-10-21). El código va aparte, pequeño.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }))
// Las acciones arrastran `server-only` y el cliente de Supabase; la pantalla solo necesita sus referencias.
vi.mock('@/lib/valida-api/acciones', () => ({ aprobarEntradaValidaApi: async () => ({ ok: true, yaEstaba: false }) }))
vi.mock('@/lib/valida-cda/acciones', () => ({ aprobarEntradaValidaCda: async () => ({ ok: true, yaEstaba: false }) }))
vi.mock('@/lib/actions/valida-consultas', () => ({
  consultarValida: async () => ({ ok: false, error: 'x' }),
  descargarPlantillaValida: async () => ({ ok: false, error: 'x' }),
  descargarPDFConsultaValida: async () => ({ ok: false, error: 'x' }),
  generarPDFLoteValida: async () => ({ ok: false, error: 'x' }),
  listarConsultasValida: async () => ({ ok: true, consultas: [] }),
  buscarNegociosParaValida: async () => ({ ok: true, negocios: [] }),
}))
vi.mock('@/lib/actions/valida-lotes', () => ({
  crearLoteValida: async () => ({ ok: false, error: 'x' }),
  progresoLoteValida: async () => ({ ok: false, error: 'x' }),
  loteVigenteValida: async () => ({ ok: true, lote: null }),
  reanudarLoteValida: async () => ({ ok: false, error: 'x' }),
  cancelarLoteValida: async () => ({ ok: false, error: 'x' }),
  pdfLoteValida: async () => ({ ok: false, error: 'x' }),
  resultadosLoteValida: async () => ({ ok: false, error: 'x' }),
}))
vi.mock('@/components/tutorial/TutorialTour', () => ({ default: () => null }))

const { ErrorBox } = await import('./valida-client')

function pintar(msg: string) {
  const html = renderToStaticMarkup(React.createElement(ErrorBox, { msg }))
  const principal = /<p>([^<]*)<\/p>/.exec(html)?.[1] ?? ''
  return { html, principal }
}

describe('el recuadro de error de Valida', () => {
  it('búsqueda incompleta: el mensaje aprobado, y el código solo como detalle técnico', () => {
    const { html, principal } = pintar('busqueda_incompleta')
    expect(principal).toBe(
      'No pudimos revisar todas las listas en este momento. La consulta no se registró ni se cobró; intenta de nuevo.',
    )
    expect(html).toContain('Detalle técnico: busqueda_incompleta')
  })

  it('un código desconocido no se muestra como mensaje', () => {
    const { principal } = pintar('codigo_raro')
    expect(principal).not.toContain('codigo_raro')
    expect(principal).toContain('No pudimos completar la consulta')
  })
})
