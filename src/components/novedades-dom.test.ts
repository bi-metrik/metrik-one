import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Window } from 'happy-dom'

/**
 * El numerito de Novedades montado con React de verdad sobre happy-dom: lee el «visto» del
 * navegador, se apaga al abrir y, si el navegador no deja leer, no aparece.
 */

const ventana = new Window({ url: 'https://cda.metrikone.co/valida' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: ventana })

type ReactMod = typeof import('react')
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let act: typeof import('react').act
let mod: typeof import('./novedades')
let vistas: typeof import('@/lib/novedades/vistas')

const LISTA = [
  { id: 'a', fecha: '2999-01-02', titulo: 'A', texto: 'a' },
  { id: 'b', fecha: '2999-01-01', titulo: 'B', texto: 'b' },
]

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  React = await import('react')
  act = React.act
  createRoot = (await import('react-dom/client')).createRoot
  mod = await import('./novedades')
  vistas = await import('@/lib/novedades/vistas')
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
const LLAVE = 'metrik-one:novedades-vistas:u-1'

function Arnes() {
  const cuenta = mod.useNovedadesNoVistas(LLAVE, LISTA)
  return React.createElement(mod.BotonNovedades, {
    cuenta,
    onAbrir: () => vistas.marcarVistas(LLAVE, LISTA.map((n) => n.id)),
  })
}

async function montar() {
  await act(async () => root!.render(React.createElement(Arnes)))
}

const numerito = () => contenedor.querySelector('[data-numerito-novedades]')?.textContent ?? null

beforeEach(() => {
  ventana.localStorage.clear()
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  contenedor.remove()
})

describe('numerito de Novedades', () => {
  it('quien nunca abrió el tablero ve cuántas hay; al abrirlo se apaga y queda guardado', async () => {
    await montar()
    expect(numerito()).toBe('2')
    await act(async () => (contenedor.querySelector('button') as HTMLButtonElement).click())
    expect(numerito()).toBeNull()
    expect(JSON.parse(ventana.localStorage.getItem(LLAVE)!)).toEqual(['a', 'b'])
  })

  it('cuenta solo las que no vio', async () => {
    ventana.localStorage.setItem(LLAVE, JSON.stringify(['a']))
    await montar()
    expect(numerito()).toBe('1')
  })

  it('el visto es por persona', async () => {
    ventana.localStorage.setItem('metrik-one:novedades-vistas:otra', JSON.stringify(['a', 'b']))
    await montar()
    expect(numerito()).toBe('2')
  })

  it('si el navegador no deja leer, no hay numerito ni error', async () => {
    // Safari con almacenamiento bloqueado: tocar `window.localStorage` ya lanza.
    const almacen = ventana.localStorage
    Object.defineProperty(ventana, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('SecurityError')
      },
    })
    try {
      await montar()
      expect(numerito()).toBeNull()
      expect(contenedor.querySelector('button')).not.toBeNull()
    } finally {
      Object.defineProperty(ventana, 'localStorage', { configurable: true, value: almacen })
    }
  })
})
