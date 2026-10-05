import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Window } from 'happy-dom'

/**
 * Brief del 2026-10-05, punto 16: marcar que una habitación no va dejaba «1. Componentes» completo
 * y la pantalla saltaba sola a «2. Tarifas». Nada se mueve solo: el paso abierto lo cambia la
 * persona. `PasosCotizacion` montado con React de verdad sobre happy-dom (mismo registro que
 * `negocios-adoptar-vista-e2e.test.ts`).
 */

const ventana = new Window({ url: 'https://trappvel.metrikone.co/negocios/n/cotizacion/c' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })

type ReactMod = typeof import('react')
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let PasosCotizacion: typeof import('./pasos-cotizacion').default

beforeAll(async () => {
  React = await import('react')
  createRoot = (await import('react-dom/client')).createRoot
  PasosCotizacion = (await import('./pasos-cotizacion')).default
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null

async function asentar() {
  for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r))
}

const pasos = (componentes: 'error' | 'hecho') => [
  { id: 'componentes', titulo: 'Componentes', estado: componentes, contenido: React.createElement('p', null, 'BLOQUES') },
  { id: 'tarifas', titulo: 'Tarifas', estado: 'pendiente' as const, contenido: React.createElement('p', null, 'TABLA') },
]
const abierto = () => contenedor.querySelector('section button[aria-expanded="true"]')?.textContent ?? null

beforeEach(() => {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  root?.unmount()
  root = null
  contenedor.remove()
})

describe('punto 16 · terminar un paso no abre el siguiente', () => {
  it('Componentes pasa a hecho mientras se trabaja en él: sigue abierto', async () => {
    root!.render(React.createElement(PasosCotizacion, { pasos: pasos('error') }))
    await asentar()
    expect(abierto()).toContain('1. Componentes')
    // «No va» en la habitación que sobraba: el paso queda hecho.
    root!.render(React.createElement(PasosCotizacion, { pasos: pasos('hecho') }))
    await asentar()
    expect(abierto()).toContain('1. Componentes')
  })

  it('el siguiente se abre con un clic', async () => {
    root!.render(React.createElement(PasosCotizacion, { pasos: pasos('error') }))
    await asentar()
    ;([...contenedor.querySelectorAll('section > button')].find(b => b.textContent?.includes('2. Tarifas')) as HTMLElement).click()
    await asentar()
    expect(abierto()).toContain('2. Tarifas')
  })
})
