/**
 * Lo que el editor muestra del margen mínimo en la salida.
 *
 * ⚠️ Prueba de RENDER: el servidor puede calcular bien `puedeAutorizar` y el JSX
 * dibujar el botón para cualquiera. Se queda en `.ts` (el `include` de vitest es
 * `src/**\/*.test.ts`).
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }))
vi.mock('@/app/(app)/negocios/margen-salida-actions', () => ({
  autorizarBajoElMinimo: async () => ({ success: true }),
}))

import PanelMargenSalida, { fechaCorta } from './panel-margen-salida'
import type { SalidaVista } from './margen-salida-actions'

const BASE: SalidaVista = {
  aplica: true,
  bajoPiso: true,
  bloquea: true,
  mensaje: 'La tarifa Económica deja un margen de 3 %, por debajo del mínimo de 5 %. Pídele a Edgar que la autorice o ajusta el precio.',
  pisoPct: 5,
  excepcion: null,
  perdida: null,
  puedeAutorizar: false,
  dueno: 'Edgar',
  excepcionesDisponibles: true,
}

const html = (salida: SalidaVista | null) =>
  renderToStaticMarkup(React.createElement(PanelMargenSalida, { cotizacionId: 'cot', salida }))

describe('el panel del margen mínimo', () => {
  it('bajo el piso dice por qué no sale y que el PDF es borrador', () => {
    const h = html(BASE)
    expect(h).toContain('Bajo el margen mínimo: no se puede enviar ni aprobar')
    expect(h).toContain('La tarifa Económica deja un margen de 3 %')
    expect(h).toContain('marca de agua')
  })

  it('a una operadora o a un admin NO le dibuja «Autorizar bajo el mínimo»', () => {
    expect(html(BASE)).not.toContain('Autorizar bajo el mínimo')
  })

  it('al dueño sí', () => {
    expect(html({ ...BASE, puedeAutorizar: true })).toContain('Autorizar bajo el mínimo')
  })

  it('con la excepción vigente: «Autorizada por Edgar el 22-sep: <motivo>»', () => {
    const h = html({
      ...BASE,
      bloquea: false,
      excepcion: { autorizadaPor: 'Edgar', autorizadaAt: '2026-09-22T15:00:00Z', motivo: 'Cliente recurrente' },
    })
    expect(h).toContain('Autorizada por Edgar el 22-sep:')
    expect(h).toContain('Cliente recurrente')
    expect(h).not.toContain('no se puede enviar')
  })

  it('cuenta la pérdida con su causa', () => {
    const h = html({
      ...BASE,
      perdida: { autorizadaPor: 'Edgar', autorizadaAt: '2026-09-22T15:00:00Z', causa: 'La tarifa Económica pasó de 3 % ($1.000) a 2 % ($990).' },
    })
    expect(h).toContain('La autorización de Edgar del 22-sep se')
    expect(h).toContain('La tarifa Económica pasó de 3 %')
  })

  it('en el piso o encima, o en una línea sin la regla, no dibuja nada', () => {
    expect(html({ ...BASE, bajoPiso: false, bloquea: false, mensaje: '' })).toBe('')
    expect(html({ ...BASE, aplica: false })).toBe('')
    expect(html(null)).toBe('')
  })

  it('la fecha va en hora de Bogotá', () => {
    // 02:00 UTC del 23 son las 21:00 del 22 en Bogotá.
    expect(fechaCorta('2026-09-23T02:00:00Z')).toBe('22-sep')
  })
})
