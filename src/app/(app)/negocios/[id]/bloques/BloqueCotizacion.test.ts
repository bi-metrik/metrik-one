/**
 * La lista de cotizaciones distingue una variante de otra por su NOMBRE.
 *
 * Es una prueba de RENDER y no de lógica pura, y por eso vale: el helper
 * `nombreMostrable` puede estar perfecto y el JSX seguir resolviendo el vacío con un
 * `??`, que no atrapa la cadena vacía. Con ese hueco la fila pinta "COT-2026-0003 · "
 * y se pierde la etiqueta genérica — el defecto es invisible para cualquier prueba
 * del helper, porque las dos salen verdes.
 *
 * Se vieron fallar devolviendo la línea a `cot.descripcion ?? (...)` (2026-09-12): el
 * caso de la cadena vacía pasa a pintar un nombre en blanco.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

// El bloque importa server actions; acá solo se mide el primer render, no el envío.
vi.mock('../cotizacion/actions', () => ({
  enviarCotizacionNegocio: async () => ({ success: true }),
  aceptarCotizacionNegocio: async () => ({ success: true }),
  rechazarCotizacionNegocio: async () => ({ success: true }),
  duplicarCotizacionNegocio: async () => ({ success: true }),
  eliminarCotizacionBorrador: async () => ({ success: true }),
  corregirCotizacionAceptada: async () => ({ success: true }),
}))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }))
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement('a', null, children),
}))

import BloqueCotizacion from './BloqueCotizacion'

function pintar(cotizaciones: Array<Record<string, unknown>>) {
  return renderToStaticMarkup(
    React.createElement(BloqueCotizacion, {
      negocioId: 'neg-1',
      modo: 'visible' as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cotizaciones: cotizaciones as any,
    }),
  )
}

const BASE = {
  id: 'c1',
  consecutivo: 'COT-2026-0003',
  modo: 'detallada',
  estado: 'borrador',
  valor_total: 1000,
  created_at: '2026-09-01T10:00:00Z',
}

describe('BloqueCotizacion — el nombre de la variante', () => {
  it('pinta el nombre cuando la cotización lo tiene', () => {
    const html = pintar([{ ...BASE, descripcion: 'España, 7 días' }])
    expect(html).toContain('España, 7 días')
    expect(html).not.toContain('Cotización detallada')
  })

  it('cae a la etiqueta genérica cuando el nombre es null', () => {
    const html = pintar([{ ...BASE, descripcion: null }])
    expect(html).toContain('Cotización detallada')
  })

  it('cae a la etiqueta genérica cuando el nombre es CADENA VACÍA', () => {
    // El caso que el `??` dejaba pasar. Un nombre en blanco deja la fila sin nada
    // que la identifique, que es peor que la etiqueta genérica que venía a reemplazar.
    const html = pintar([{ ...BASE, descripcion: '' }])
    expect(html).toContain('Cotización detallada')
  })

  it('cae a la etiqueta genérica cuando el nombre es solo espacios', () => {
    const html = pintar([{ ...BASE, descripcion: '   ' }])
    expect(html).toContain('Cotización detallada')
  })

  it('respeta el modo flash en la etiqueta genérica', () => {
    const html = pintar([{ ...BASE, modo: 'flash', descripcion: '' }])
    expect(html).toContain('Cotización rápida')
  })

  it('distingue dos variantes del mismo negocio', () => {
    // El encargo entero: que la comercial pueda decir cuál es cuál en la lista.
    const html = pintar([
      { ...BASE, id: 'c1', consecutivo: 'COT-1', descripcion: 'España, 7 días' },
      { ...BASE, id: 'c2', consecutivo: 'COT-2', descripcion: 'Portugal, 5 días' },
    ])
    expect(html).toContain('España, 7 días')
    expect(html).toContain('Portugal, 5 días')
  })
})
