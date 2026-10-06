import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { Window } from 'happy-dom'

/**
 * Una escritura larga cuya respuesta se pierde: la pantalla dice que NO se confirmó, relee el
 * estado real y solo ofrece «Reintentar» si la acción lo declara seguro.
 *
 * El hook montado con React de verdad sobre happy-dom (como `negocios-adoptar-vista-e2e`).
 *
 * VISTO FALLAR (2026-10-05): sin llamar a `releer` → 2 rojas; ofreciendo «Reintentar» sin
 * que la acción lo declare → 1 roja; con el aviso viejo («Intenta de nuevo») → 1 roja.
 */

const ventana = new Window({ url: 'https://soena.metrikone.co/conciliacion' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })

const toasts: Array<{ mensaje: string; opciones?: { action?: { label: string } } }> = []
vi.mock('sonner', () => ({
  toast: { error: (mensaje: string, opciones?: { action?: { label: string } }) => { toasts.push({ mensaje, opciones }) } },
}))

type ReactMod = typeof import('react')
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let useTransitionTolerante: typeof import('./use-transition-tolerante').useTransitionTolerante

beforeAll(async () => {
  React = await import('react')
  createRoot = (await import('react-dom/client')).createRoot
  useTransitionTolerante = (await import('./use-transition-tolerante')).useTransitionTolerante
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
const releer = vi.fn()
const reintentar = vi.fn()

/** Un botón que llama a una server action que se corta (`Failed to fetch`). */
function Boton({ opciones }: { opciones?: Parameters<typeof useTransitionTolerante>[0] }) {
  const [, start] = useTransitionTolerante(opciones)
  return React.createElement('button', {
    onClick: () => start(async () => { throw new TypeError('Failed to fetch') }),
  }, 'Emitir')
}

async function asentar() {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r))
}

async function pulsar(opciones?: Parameters<typeof useTransitionTolerante>[0]) {
  root!.render(React.createElement(Boton, { opciones }))
  await asentar()
  ;(contenedor.querySelector('button') as HTMLElement).click()
  await asentar()
}

beforeEach(() => {
  toasts.length = 0
  releer.mockClear()
  reintentar.mockClear()
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  root?.unmount()
  root = null
  contenedor.remove()
})

describe('useTransitionTolerante — una escritura que no se confirmó', () => {
  it('dice que no se confirmó y relee el estado real, sin ofrecer repetirla', async () => {
    await pulsar({ releer })
    expect(toasts).toHaveLength(1)
    expect(toasts[0].mensaje).toContain('No se confirmó')
    expect(toasts[0].mensaje).not.toContain('Intenta de nuevo')
    expect(toasts[0].opciones?.action).toBeUndefined()
    expect(releer).toHaveBeenCalledTimes(1)
  })

  it('ofrece «Reintentar» solo cuando la acción declara que repetir es seguro', async () => {
    await pulsar({ releer, reintentar })
    expect(toasts[0].opciones?.action?.label).toBe('Reintentar')
    expect(releer).toHaveBeenCalledTimes(1)
    expect(reintentar).not.toHaveBeenCalled() // lo decide la persona
  })

  it('sin opciones, el aviso de red de siempre', async () => {
    await pulsar()
    expect(toasts[0].mensaje).toContain('Intenta de nuevo')
    expect(releer).not.toHaveBeenCalled()
  })
})
