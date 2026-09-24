/**
 * El encabezado de un bloque de Trappvel (H5 del 2026-09-24): lo que le falta al bloque va SOLO
 * como ícono ⚠ — el tooltip dice de qué se trata, el detalle se abre al tocarlo y trae «Ver la
 * opción» cuando es una sola. Nunca una franja de texto («Requiere atención: …»).
 *
 * Se queda en `.ts` por el `include` de vitest.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { estadoDeBloque } from '@/lib/cotizaciones/bandeja-capturas'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }) }))
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }))
vi.mock('@/app/(app)/negocios/ranura-actions', () => ({}))
vi.mock('@/app/(app)/negocios/itinerario-actions', () => ({}))

const { default: BloqueRanura } = await import('./bloque-ranura')

function pintar(estado: ReturnType<typeof estadoDeBloque>) {
  return renderToStaticMarkup(React.createElement(BloqueRanura, {
    bloque: { grupo: 'hotel', etiqueta: 'Hotel en Providencia', tipo: 'hotel', opciones: 1 },
    cotizacionId: 'cot-1',
    editable: true,
    titulo: 'Hotel en Providencia',
    estado,
    onVerOpcion: () => {},
  } as unknown as React.ComponentProps<typeof BloqueRanura>, null))
}
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('el ⚠ del bloque', () => {
  it('sin confirmar: solo el ícono, con su tooltip; sin «Requiere atención» a la vista', () => {
    const e = estadoDeBloque({ grupo: 'hotel', etiqueta: 'Hotel' }, [
      { id: 'o1', nombre: 'CABAÑAS AGUA DULCE · AGUA DULCE / PROVIDENCIA', conCosto: true, sinConfirmar: true, alerta: null },
    ])
    const html = pintar(e)
    expect(html).toContain('data-alerta-decision')
    expect(texto(html)).toContain('Falta confirmar el costo')
    expect(texto(html)).not.toContain('Requiere atención')
    expect(texto(html)).not.toContain('CABAÑAS AGUA DULCE')
    expect(e.opcionId).toBe('o1')
    expect(e.explicacion).toContain('ONE leyó el pantallazo de CABAÑAS AGUA DULCE')
  })

  it('con varias opciones sin costo no ofrece una sola opción que abrir', () => {
    const e = estadoDeBloque({ grupo: 'hotel', etiqueta: 'Hotel' }, [
      { id: 'o1', nombre: 'A', conCosto: false, sinConfirmar: false, alerta: null },
      { id: 'o2', nombre: 'B', conCosto: false, sinConfirmar: false, alerta: null },
    ])
    expect(e.opcionId).toBeNull()
    expect(e.aviso).toBe('Falta el costo')
  })

  it('completo: el visto bueno de siempre, sin ⚠', () => {
    const e = estadoDeBloque({ grupo: 'hotel', etiqueta: 'Hotel' }, [{ id: 'o1', nombre: 'A', conCosto: true, sinConfirmar: false, alerta: null }])
    const html = pintar(e)
    expect(texto(html)).toContain('Completo')
    expect(html).not.toContain('data-alerta-decision')
  })
})
