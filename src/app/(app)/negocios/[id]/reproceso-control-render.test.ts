/**
 * La confirmación de un error sin retorno DICE que el caso no se mueve, antes de confirmar.
 *
 * Es el requisito de la pantalla (frente 3C, 2026-09-14): quien registra el error de V0388
 * no puede quedarse con la duda de si acaba de devolver el caso a Cita. Una prueba del
 * server action no fija eso; solo el render.
 *
 * ⚠️ Se queda en `.ts`: el `include` de `vitest.config.ts` es `src/**\/*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// El control importa las server actions: un `'use server'` real arrastra el runtime de Next.
vi.mock('@/lib/actions/reproceso-actions', () => ({
  reprocesarNegocio: vi.fn(),
  cerrarReproceso: vi.fn(),
  registrarErrorSinDevolver: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const { PanelErrorSinRetorno } = await import('./reproceso-control')

const html = (extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    React.createElement(PanelErrorSinRetorno, {
      etapaActual: 'Envío',
      etapaRetorno: 'Cita',
      tipoLabel: 'Devolución DIAN',
      causa: 'error_propio',
      detalle: 'No se envió la documentación antes de la cita del 8-sep.',
      pending: false,
      onVolver: () => {},
      onConfirmar: () => {},
      ...extra,
    }),
  )

describe('PanelErrorSinRetorno', () => {
  it('dice que el caso no se mueve y dónde se queda', () => {
    const h = html()
    expect(h).toContain('El caso no se mueve.')
    expect(h).toContain('Sigue en Envío.')
    expect(h).toContain('No se archiva nada ni se abre un reproceso')
  })

  it('explica por qué no hay retorno', () => {
    expect(html()).toContain('antes de <strong class="text-foreground">Cita</strong>: no hay un tramo que rehacer')
  })

  it('el botón nombra la acción completa, no "Confirmar"', () => {
    expect(html()).toContain('Registrar el error sin devolver el caso')
  })

  it('muestra lo que se va a registrar, con la causa en palabras', () => {
    const h = html()
    expect(h).toContain('Devolución DIAN')
    expect(h).toContain('Error propio — cuenta en el indicador')
    expect(h).toContain('No se envió la documentación antes de la cita del 8-sep.')
    expect(html({ causa: 'criterio_tercero' })).toContain('Criterio del funcionario — no cuenta')
  })

  it('mientras registra, los dos botones quedan deshabilitados', () => {
    const h = html({ pending: true })
    expect(h).toContain('Registrando…')
    expect((h.match(/disabled=""/g) ?? []).length).toBe(2)
  })
})
