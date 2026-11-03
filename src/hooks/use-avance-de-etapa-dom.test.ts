import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { Window } from 'happy-dom'

import { LISTO, siguienteFaseAvance } from './use-avance-de-etapa'

/**
 * Prueba del #1229, punto a: «Avanzar de etapa» se quedaba en «Cambiando…» hasta recargar aunque
 * la etapa sí avanzó. Se reproduce con React de verdad: la acción contesta, pero el repintado de
 * la ficha (lo que hace `revalidatePath`) queda suspendido para siempre, así que el `isPending`
 * de la transición nunca vuelve a `false`. El botón tiene que salir de «Cambiando…» igual.
 */

const ventana = new Window({ url: 'https://trappvel.metrikone.co/negocios/n1' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })

type ReactMod = typeof import('react')
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let act: ReactMod['act']
let useAvanceDeEtapa: typeof import('./use-avance-de-etapa').useAvanceDeEtapa

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  useAvanceDeEtapa = (await import('./use-avance-de-etapa')).useAvanceDeEtapa
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
beforeEach(() => {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  contenedor.remove()
  vi.useRealTimers()
})

const nunca = new Promise<never>(() => {})
function Colgada(): null {
  // El repintado de la ficha que nunca llega.
  React.use(nunca)
  return null
}

function Barra({ etapa, movio, pedirFicha }: { etapa: string; movio: boolean; pedirFicha: () => void }) {
  const [isPending, startTransition] = React.useTransition()
  const [colgar, setColgar] = React.useState(false)
  const avance = useAvanceDeEtapa(etapa, pedirFicha)
  function lanzar() {
    avance.empezar()
    let m = false
    startTransition(async () => {
      try {
        await Promise.resolve()
        // La acción contesta y su revalidación deja la ficha suspendida (dentro de la transición).
        startTransition(() => setColgar(true))
        m = movio
      } finally {
        avance.terminar(m)
      }
    })
  }
  return React.createElement(
    'div',
    null,
    React.createElement('button', { 'data-avanzar': true, disabled: avance.ocupado, onClick: lanzar }, avance.fase === 'enviando' ? 'Cambiando...' : avance.fase === 'actualizando' ? 'Avanzado, actualizando...' : avance.fase === 'atascado' ? 'Avanzado · Recargar' : 'Avanzar de etapa'),
    React.createElement('span', { 'data-pendiente': String(isPending) }),
    React.createElement(React.Suspense, { fallback: null }, colgar ? React.createElement(Colgada) : null),
  )
}

const boton = () => contenedor.querySelector<HTMLButtonElement>('[data-avanzar]')!
const asentar = async () => { await act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) }) }

describe('el botón de avanzar sigue la respuesta, no la transición', () => {
  it('con la ficha colgada: sale de «Cambiando…» y, al llegar la etapa nueva, vuelve a «Avanzar de etapa»', async () => {
    const pedir = vi.fn()
    await act(async () => { root!.render(React.createElement(Barra, { etapa: 'E1', movio: true, pedirFicha: pedir })) })
    await act(async () => { boton().click() })
    await asentar()
    // La transición sigue pendiente (la ficha no llegó) …
    expect(contenedor.querySelector('[data-pendiente]')?.getAttribute('data-pendiente')).toBe('true')
    // … pero el botón ya no dice «Cambiando…» y no deja avanzar otra vez desde la etapa vieja.
    expect(boton().textContent).toBe('Avanzado, actualizando...')
    expect(boton().disabled).toBe(true)
    // Llega la etapa nueva: el botón vuelve.
    await act(async () => { root!.render(React.createElement(Barra, { etapa: 'E2', movio: true, pedirFicha: pedir })) })
    expect(boton().textContent).toBe('Avanzar de etapa')
    expect(boton().disabled).toBe(false)
  })

  it('si el servidor no movió el caso (un gate), vuelve de una', async () => {
    await act(async () => { root!.render(React.createElement(Barra, { etapa: 'E1', movio: false, pedirFicha: () => {} })) })
    await act(async () => { boton().click() })
    await asentar()
    expect(boton().textContent).toBe('Avanzar de etapa')
    expect(boton().disabled).toBe(false)
  })
})

describe('las fases (puro)', () => {
  it('enviando → actualizando → listo con la etapa nueva; a los 15 s, atascado (ofrece recargar)', () => {
    let e = siguienteFaseAvance(LISTO, { tipo: 'empezar', etapa: 'E1' })
    expect(e).toEqual({ fase: 'enviando', desde: 'E1' })
    e = siguienteFaseAvance(e, { tipo: 'terminar', movio: true })
    expect(e.fase).toBe('actualizando')
    expect(siguienteFaseAvance(e, { tipo: 'etapa', etapa: 'E1' }).fase).toBe('actualizando')
    expect(siguienteFaseAvance(e, { tipo: 'etapa', etapa: 'E2' })).toEqual(LISTO)
    const atascado = siguienteFaseAvance(e, { tipo: 'vencio' })
    expect(atascado.fase).toBe('atascado')
    expect(siguienteFaseAvance(atascado, { tipo: 'etapa', etapa: 'E2' })).toEqual(LISTO)
  })

  it('un «terminar» fuera de tiempo no cambia nada', () => {
    expect(siguienteFaseAvance(LISTO, { tipo: 'terminar', movio: true })).toEqual(LISTO)
  })
})
