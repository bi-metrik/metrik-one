/**
 * El aviso de recaudo cambiado se VE, y sus botones solo los ve quien puede usarlos.
 *
 * Es una prueba de RENDER, no de lógica pura, y por eso vale la pena: el defecto que
 * este banner viene a cerrar era justamente que no había ninguna salida en pantalla, y
 * un banner que no se pinta (o que se pinta sin sus botones) es indistinguible de eso
 * desde cualquier prueba de servidor. Se renderiza con `renderToStaticMarkup`, que corre
 * en el entorno `node` de vitest sin DOM: alcanza para lo único que se afirma acá, que
 * es qué texto y qué acciones aparecen en el primer render.
 *
 * Se vieron fallar quitando el guard `puedeResolver` (2026-09-08): el comercial pasaba
 * a ver "Resolver" y "Devolver el caso", que la acción del servidor rechaza.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

// El banner importa server actions; acá solo se mide el primer render, no el envío.
vi.mock('@/lib/actions/conciliacion-actions', () => ({
  resolverAvisoRecaudo: async () => ({ ok: true }),
  proponerRetroceso: async () => ({ ok: true }),
  aplicarRetrocesoFinanciero: async () => ({ ok: true }),
}))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }))

import { RecaudoCambiadoBanner } from './recaudo-cambiado-banner'

/** El aviso real de V0442, con gates y destino sugerido para ejercitar las dos notas. */
const AVISO = {
  referencia: 'EXT-593279',
  motivo: 'porque el ingreso solo quedo en un cliente',
  etapaAlCambiar: 'Negociación',
  gatesReabiertos: 2,
  destinoSugerido: 'Precobro',
  creadoEn: '2026-09-07T19:17:00Z',
}

const pintar = (aviso: typeof AVISO | null, puedeResolver: boolean) =>
  renderToStaticMarkup(
    React.createElement(RecaudoCambiadoBanner, { negocioId: 'n-442', aviso, puedeResolver }),
  )

describe('RecaudoCambiadoBanner', () => {
  it('sin aviso no ocupa lugar en la ficha', () => {
    expect(pintar(null, true)).toBe('')
  })

  it('el área financiera ve el aviso completo y sus dos salidas', () => {
    const html = pintar(AVISO, true)
    expect(html).toContain('EXT-593279')
    expect(html).toContain('porque el ingreso solo quedo en un cliente')
    expect(html).toContain('Negociación')
    expect(html).toContain('Se reabrieron 2 gates')
    expect(html).toContain('Se sugirió devolverlo a Precobro')
    // Que el negocio no avanza mientras el aviso esté puesto es la mitad del mensaje:
    // sin eso, quien lo lee no sabe que su caso está frenado por esto.
    expect(html).toContain('no avanza de etapa')
    expect(html).toContain('Resolver')
    expect(html).toContain('Devolver el caso')
  })

  it('el comercial LO VE pero no puede cerrarlo', () => {
    const html = pintar(AVISO, false)
    expect(html).toContain('EXT-593279')
    expect(html).toContain('Lo resuelve el área financiera')
    expect(html).not.toContain('Devolver el caso')
  })
})
