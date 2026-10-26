import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * H3 (verificación D) · el precio por pasajero que falta se cierra desde la tarjeta: «Escribir a
 * mano» o «No paga en este proveedor» (regla P12 del 2026-10-12). Hasta ahora solo existía la acción
 * del servidor, sin botón.
 */

const ventana = new Window({ url: 'https://agencia.metrikone.co/negocios/neg-1' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'InputEvent', 'MutationObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })

const escribir = vi.hoisted(() => vi.fn(async () => ({ success: true })))
vi.mock('./tarifa-pax-actions', () => ({ escribirPrecioQueFalta: escribir }))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({ escribirPrecioQueFalta: escribir }))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, warning: () => {} } }))

type ReactMod = typeof import('react')
let React: ReactMod
let act: typeof import('react').act
let createRoot: typeof import('react-dom/client').createRoot
let Componente: typeof import('./por-pasos/precio-que-falta').PrecioQueFaltaPorPasos

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  Componente = (await import('./por-pasos/precio-que-falta')).PrecioQueFaltaPorPasos
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
beforeEach(() => {
  escribir.mockClear()
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  act(() => root?.unmount())
  contenedor.remove()
})

function boton(texto: string, tipo: string): HTMLButtonElement {
  const fila = contenedor.querySelector(`[data-precio-tipo="${tipo}"]`)!
  return [...fila.querySelectorAll('button')].find(b => b.textContent === texto) as HTMLButtonElement
}

describe('H3 · «Escribir a mano» y «No paga en este proveedor» en la tarjeta', () => {
  it('escribe el costo c/u del niño y avisa para refrescar', async () => {
    const onGuardado = vi.fn()
    await act(async () => root!.render(React.createElement(Componente, { itemId: 'item-lancha', nombre: 'Lancha compartida', tipos: ['nino'], moneda: 'COP', onGuardado })))
    expect(contenedor.textContent).toContain('Lancha compartida no trae el precio del niño')
    const input = contenedor.querySelector('[data-precio-tipo="nino"] input') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!
    await act(async () => {
      setter.call(input, '90.000')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => boton('Guardar', 'nino').click())
    expect(escribir).toHaveBeenCalledWith('item-lancha', 'nino', 90_000)
    expect(onGuardado).toHaveBeenCalledTimes(1)
  })

  it('«No paga en este proveedor» escribe 0', async () => {
    await act(async () => root!.render(React.createElement(Componente, { itemId: 'item-satena', nombre: 'SATENA', tipos: ['nino', 'infante'], moneda: 'COP', onGuardado: () => {} })))
    expect(boton('Guardar', 'infante').disabled).toBe(true)
    await act(async () => boton('No paga en este proveedor', 'infante').click())
    expect(escribir).toHaveBeenCalledWith('item-satena', 'infante', 0)
  })

  it('sin nada que falte no pinta nada', async () => {
    await act(async () => root!.render(React.createElement(Componente, { itemId: 'x', nombre: 'X', tipos: [], moneda: 'COP', onGuardado: () => {} })))
    expect(contenedor.innerHTML).toBe('')
  })
})
