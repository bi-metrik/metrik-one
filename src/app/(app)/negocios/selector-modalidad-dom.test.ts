import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * «Modalidad: A medida | Bloqueo» en la cotización (2026-11-03), montado en React real sobre happy-dom.
 */

const ventana = new Window({ url: 'https://agencia.metrikone.co/negocios/n/cotizacion/c' })
for (const k of ['document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver'] as const) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })

const errores: string[] = []
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: (m: string) => { errores.push(m) }, success: () => {} }) }))
vi.mock('@/app/(app)/negocios/modalidad-actions', () => ({ cambiarModalidadDelViaje: async () => ({ success: true }) }))

let React: typeof import('react')
let createRoot: typeof import('react-dom/client').createRoot
let act: typeof import('react').act
let Selector: typeof import('./por-pasos/selector-modalidad').SelectorModalidad

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  Selector = (await import('./por-pasos/selector-modalidad')).SelectorModalidad
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
beforeEach(() => {
  errores.length = 0
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  contenedor.remove()
})

const esperar = async (ms = 20) => { await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }
const clic = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const marcado = () => contenedor.querySelector('[aria-checked="true"]')?.getAttribute('data-modalidad')

async function montar(p: { valor: '' | 'a_medida' | 'bloqueo'; editable?: boolean; cambiar: (c: string, v: 'a_medida' | 'bloqueo') => Promise<{ success: true } | { success: false; error: string }>; onCambio?: () => void }) {
  await act(async () => {
    root!.render(React.createElement(Selector, { cotizacionId: 'cot-1', valor: p.valor, editable: p.editable ?? true, onCambio: p.onCambio ?? (() => {}), cambiar: p.cambiar as never }))
  })
}

describe('SelectorModalidad', () => {
  it('vacío se lee A medida; elegir Bloqueo escribe y refresca', async () => {
    const llamadas: [string, string][] = []
    let refrescos = 0
    await montar({ valor: '', cambiar: async (c, v) => { llamadas.push([c, v]); return { success: true } }, onCambio: () => { refrescos += 1 } })
    expect(marcado()).toBe('a_medida')
    await clic(contenedor.querySelector('[data-modalidad="bloqueo"]')!)
    await esperar()
    expect(llamadas).toEqual([['cot-1', 'bloqueo']])
    expect(refrescos).toBe(1)
    expect(marcado()).toBe('bloqueo')
  })

  it('si la escritura falla, vuelve al valor previo y lo dice', async () => {
    await montar({ valor: 'bloqueo', cambiar: async () => ({ success: false, error: 'Sin permiso' }) })
    await clic(contenedor.querySelector('[data-modalidad="a_medida"]')!)
    await esperar()
    expect(marcado()).toBe('bloqueo')
    expect(errores).toEqual(['Sin permiso'])
  })

  it('no editable: no escribe', async () => {
    const llamadas: string[] = []
    await montar({ valor: 'a_medida', editable: false, cambiar: async (_c, v) => { llamadas.push(v); return { success: true } } })
    await clic(contenedor.querySelector('[data-modalidad="bloqueo"]')!)
    await esperar()
    expect(llamadas).toEqual([])
    expect(marcado()).toBe('a_medida')
  })
})
