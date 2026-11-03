/**
 * Barrido ámbar (2026-10-22), A4: una fila de actividad sin `campo_modificado` pero con
 * `contenido` pinta el contenido, no «cambio — → —».
 *
 * Las escriben la confirmación del viaje, las etapas por fecha, el cierre del viaje, servicios,
 * entrega y facturación. Solo cambia el render: una fila vieja se ve bien al pintarse.
 *
 * VISTO FALLAR (2026-10-22): sin la rama nueva → cae «pinta el contenido…».
 *
 * Se queda en `.ts`: `vitest.config.ts` solo recoge `*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('@/app/(app)/activity-actions', () => ({
  getActivityLog: async () => [],
  addComment: async () => ({}),
  deleteActivity: async () => ({}),
}))

const { ChangeEntry } = await import('./activity-log')

const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const base = {
  id: 'a-1',
  tipo: 'cambio',
  contenido: null as string | null,
  campo_modificado: null as string | null,
  valor_anterior: null,
  valor_nuevo: null,
  link_url: null,
  created_at: null,
  autor: { id: 's-1', full_name: 'Ana Prueba' },
  mencion: null,
}

describe('ChangeEntry · fila sin campo', () => {
  it('pinta el contenido y no el genérico «cambio — → —»', () => {
    const html = renderToStaticMarkup(React.createElement(ChangeEntry, {
      entry: { ...base, contenido: 'El cliente confirmó por $ 1.000.000. Plan de pagos v1 con 2 cuotas.' },
    }))
    expect(html).toContain('data-cambio-contenido')
    expect(texto(html)).toContain('El cliente confirmó por $ 1.000.000. Plan de pagos v1 con 2 cuotas.')
    expect(texto(html)).not.toContain('—')
    expect(texto(html)).not.toMatch(/\bcambio\b/)
  })

  it('con campo sigue el render de siempre (anterior → nuevo)', () => {
    const html = renderToStaticMarkup(React.createElement(ChangeEntry, {
      entry: { ...base, campo_modificado: 'responsable', valor_anterior: 'Ana', valor_nuevo: 'Luis', contenido: 'x' },
    }))
    expect(html).not.toContain('data-cambio-contenido')
    expect(texto(html)).toContain('cambio')
    expect(texto(html)).toContain('Luis')
  })

  it('sin campo y sin contenido queda el genérico (no hay nada mejor que mostrar)', () => {
    const html = renderToStaticMarkup(React.createElement(ChangeEntry, { entry: { ...base } }))
    expect(html).not.toContain('data-cambio-contenido')
  })
})
