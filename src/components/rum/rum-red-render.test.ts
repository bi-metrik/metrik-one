import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Window } from 'happy-dom'

/**
 * `RumRed` montado con React de verdad: que junte web vitals y navegaciones suaves y salga
 * UN beacon al ocultar la pestaña, con rutas normalizadas. DOM de happy-dom registrado a
 * mano, como `app/auto-recarga-boundaries.test.ts` (sin `act`, sin `@vitest-environment`).
 */

const ventana = new Window({ url: 'https://soena.metrikone.co/negocios' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Text', 'MutationObserver', 'MouseEvent'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })
Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: ventana.location })
const eventos = new EventTarget()
Object.assign(globalThis, {
  addEventListener: eventos.addEventListener.bind(eventos),
  removeEventListener: eventos.removeEventListener.bind(eventos),
  dispatchEvent: eventos.dispatchEvent.bind(eventos),
})
let visibilidad: 'visible' | 'hidden' = 'visible'
Object.defineProperty(ventana.document, 'visibilityState', { configurable: true, get: () => visibilidad })

const beacons: Array<{ url: string; cuerpo: Record<string, unknown> }> = []
const pendientes: Promise<void>[] = []
Object.defineProperty(ventana.navigator, 'sendBeacon', {
  configurable: true,
  value: (url: string, blob: Blob) => {
    pendientes.push(blob.text().then((t) => void beacons.push({ url, cuerpo: JSON.parse(t) })))
    return true
  },
})

let ruta = '/negocios'
let params: Record<string, string> = {}
vi.mock('next/navigation', () => ({
  usePathname: () => ruta,
  useParams: () => params,
}))
let reportarVital: ((m: { name: string; value: number; rating?: string }) => void) | null = null
vi.mock('next/web-vitals', () => ({
  useReportWebVitals: (fn: typeof reportarVital) => {
    reportarVital = fn
  },
}))

type ReactMod = typeof import('react')
let React: ReactMod
let raiz: import('react-dom/client').Root
let RumRed: () => unknown
let marcarInicioNavegacion: (tipo: 'tarjeta' | 'enlace' | 'historial', href?: string) => void

async function asentar() {
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r))
}

async function pintar() {
  raiz.render(React.createElement(RumRed as never))
  await asentar()
}

async function ocultar() {
  visibilidad = 'hidden'
  dispatchEvent(new Event('visibilitychange'))
  await Promise.all(pendientes)
}

beforeEach(async () => {
  vi.resetModules()
  ruta = '/negocios'
  params = {}
  visibilidad = 'visible'
  beacons.length = 0
  pendientes.length = 0
  React = await import('react')
  const { createRoot } = await import('react-dom/client')
  RumRed = (await import('./rum-red')).default as never
  marcarInicioNavegacion = (await import('@/lib/rum/navegacion')).marcarInicioNavegacion
  const contenedor = ventana.document.createElement('div')
  ventana.document.body.appendChild(contenedor)
  raiz = createRoot(contenedor as never)
  await pintar()
})

afterEach(async () => {
  raiz.unmount()
  await asentar()
  ventana.document.body.innerHTML = ''
})

describe('RumRed', () => {
  it('sin nada medido, ocultar la pestaña no gasta un viaje', async () => {
    await ocultar()
    expect(beacons).toHaveLength(0)
  })

  it('vitales + navegacion de tarjeta salen en UN beacon al ocultar, con rutas normalizadas', async () => {
    reportarVital?.({ name: 'LCP', value: 2100, rating: 'good' })
    reportarVital?.({ name: 'TTFB', value: 640 })

    marcarInicioNavegacion('tarjeta', '/negocios/7f3c2a10-1b2c-4d5e-8f90-123456789abc')
    ruta = '/negocios/7f3c2a10-1b2c-4d5e-8f90-123456789abc'
    params = { id: '7f3c2a10-1b2c-4d5e-8f90-123456789abc' }
    await pintar()

    await ocultar()
    expect(beacons).toHaveLength(1)
    const b = beacons[0]
    expect(b.url).toBe('/api/rum')
    expect(b.cuerpo).toMatchObject({ v: 1, ciclo: 1, entrada: '/negocios', ruta: '/negocios/[id]' })
    expect(b.cuerpo.vitales).toEqual([
      { n: 'LCP', v: 2100, r: 'good', ruta: '/negocios' },
      { n: 'TTFB', v: 640, ruta: '/negocios' },
    ])
    const navs = b.cuerpo.navs as Array<Record<string, unknown>>
    expect(navs).toHaveLength(1)
    expect(navs[0]).toMatchObject({ de: '/negocios', a: '/negocios/[id]', tipo: 'tarjeta' })
    expect(navs[0].ms).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(b.cuerpo)).not.toContain('7f3c2a10')

    // `pagehide` tras el ocultado: no hay nada nuevo, no sale otro.
    dispatchEvent(new Event('pagehide'))
    await Promise.all(pendientes)
    expect(beacons).toHaveLength(1)
  })

  it('un clic que solo cambia la query no deja una navegacion abierta', async () => {
    const a = ventana.document.createElement('a')
    a.setAttribute('href', '/negocios?pagina=2')
    ventana.document.body.appendChild(a)
    a.dispatchEvent(new ventana.MouseEvent('click', { bubbles: true, button: 0 }))
    // Si hubiera quedado abierta, este cambio de ruta (sin marca) la cerraria con un tiempo falso.
    ruta = '/tableros'
    await pintar()
    await ocultar()
    expect(beacons).toHaveLength(0)
  })

  it('un clic en un enlace interno mide la navegacion', async () => {
    const b2 = ventana.document.createElement('a')
    b2.setAttribute('href', '/tableros')
    ventana.document.body.appendChild(b2)
    b2.dispatchEvent(new ventana.MouseEvent('click', { bubbles: true, button: 0 }))
    ruta = '/tableros'
    await pintar()

    await ocultar()
    expect(beacons[0].cuerpo.navs).toEqual([expect.objectContaining({ de: '/negocios', a: '/tableros', tipo: 'enlace' })])
  })

  it('una navegacion que nadie marco (router.push suelto) no se anota', async () => {
    ruta = '/tableros'
    await pintar()
    await ocultar()
    expect(beacons).toHaveLength(0)
  })
})
