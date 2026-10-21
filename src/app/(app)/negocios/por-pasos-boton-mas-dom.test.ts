import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Window } from 'happy-dom'

/**
 * En el celular el «+» del shell no tapa «Lo que suma» (brief del 2026-10-16, punto 2). La barra
 * de «Lo que suma» pinta una regla de CSS que sube el «+» y sus menús, que encuentra por sus clases
 * (`SELECTOR_BOTON_MAS`). Esta prueba fija ese contrato con el FAB REAL: si alguien le cambia las
 * clases al «+», falla aquí y no en el celular de la asesora. La medida en Chromium (dónde queda cada
 * uno y que los dos se pueden tocar) es `scripts/boton-mas-barra.e2e.mjs`.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => '/negocios/00000000-0000-4000-8000-000000000001/cotizacion/c',
}))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }) }))
vi.mock('@/app/(app)/timer-actions', () => ({ startTimer: vi.fn(), stopTimer: vi.fn(), getDestinosParaTimer: vi.fn() }))

const { default: FAB } = await import('../fab')
const { LoQueSuma, SELECTOR_BOTON_MAS, reglaBotonMas } = await import('./por-pasos/lo-que-suma')

const datos = {
  renglones: [], nombreDeOpcion: (id: string) => id, faltaPrecio: () => null, total: 22448922, costo: 19081584,
  margenPct: 15, otrasQueVan: [], pantallazosEnBandeja: 0, incompleto: false, rojos: 0,
}

describe('el «+» sube sobre la barra de «Lo que suma»', () => {
  it('el selector de la regla encuentra el «+» real del shell (y nada más de la pantalla)', () => {
    const ventana = new Window()
    ventana.document.body.innerHTML = renderToStaticMarkup(React.createElement(FAB, { role: 'owner', timerActivo: null }))
    const encontrados = [...ventana.document.querySelectorAll(SELECTOR_BOTON_MAS)]
    expect(encontrados).toHaveLength(1)
    expect(encontrados[0].tagName).toBe('BUTTON')
    expect(encontrados[0].className.split(/\s+/)).toEqual(expect.arrayContaining(['fixed', 'bottom-20', 'right-6', 'h-14', 'w-14']))
  })

  it('la barra pinta la regla, solo por debajo de 1024 px, con su alto', () => {
    const html = renderToStaticMarkup(React.createElement(LoQueSuma, { datos }))
    expect(html).toContain('data-boton-mas-sobre-barra')
    expect(html).toContain(reglaBotonMas(65))
    expect(reglaBotonMas(65)).toBe('@media (width < 64rem) { .fixed.right-6.z-50 { translate: 0 calc(5rem - 3.5rem - 65px - 0.75rem); } }')
  })
})
