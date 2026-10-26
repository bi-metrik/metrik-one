/**
 * «Mis pendientes» con los servicios próximos (2026-10-21): por fecha, con el ícono y el color
 * del tipo de la cotización, y «Falta la fecha» cuando no la hay. Datos ficticios.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ServicioProximo } from '@/lib/viaje/mis-pendientes'

vi.mock('./servicios-viaje-actions', () => ({ decidirAprobacionServicio: vi.fn() }))
vi.mock('./confirmacion-viaje-actions', () => ({ decidirAprobacionPlan: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { default: MisPendientes } = await import('./mis-pendientes')

const servicios: ServicioProximo[] = [
  { id: 'v', negocioId: 'n1', viaje: 'P 26 1 — Viaje de prueba', tipo: 'vuelo', nombre: 'Vuelo BOG-ADZ', fecha: '2026-11-03', hora: '06:10', momento: 'Ida' },
  { id: 'h', negocioId: 'n1', viaje: 'P 26 1 — Viaje de prueba', tipo: 'hotel', nombre: 'Hotel de prueba', fecha: '2026-11-03', hora: null, momento: 'Check-in' },
  { id: 't', negocioId: 'n1', viaje: 'P 26 1 — Viaje de prueba', tipo: 'actividad', nombre: 'Tour de prueba', fecha: null, hora: null, momento: null },
]

const html = (s: ServicioProximo[]) =>
  renderToStaticMarkup(React.createElement(MisPendientes, { pendientes: [], servicios: s, hoy: '2026-11-02', proximo: null, tablero: null }))

describe('Mis pendientes: servicios próximos', () => {
  it('lista los servicios en orden, con su momento, su color de tipo y «Falta la fecha»', () => {
    const h = html(servicios)
    expect(h).toContain('Tus servicios próximos · 3')
    expect(h.indexOf('Vuelo BOG-ADZ')).toBeLessThan(h.indexOf('Hotel de prueba'))
    expect(h.indexOf('Hotel de prueba')).toBeLessThan(h.indexOf('Tour de prueba'))
    expect(h).toContain('Vuelo · Ida')
    expect(h).toContain('Hotel · Check-in')
    expect(h).toContain('mar 3 nov')
    expect(h).toContain('06:10')
    expect(h).toContain('Falta la fecha')
    expect(h).toContain('var(--tipo-vuelo)')
    expect(h).toContain('var(--tipo-hotel)')
    expect(h).toContain('min-h-11')
    // El vacío de los pendientes sigue diciendo lo suyo.
    expect(h).toContain('Nada pendiente hoy.')
  })

  it('sin servicios no pinta la sección', () => {
    expect(html([])).not.toContain('Tus servicios próximos')
  })
})
