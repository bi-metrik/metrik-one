import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { Window } from 'happy-dom'

/**
 * Las pantallas de error (`(app)/error.tsx`, `global-error.tsx`) montadas con React DE
 * VERDAD, no la guarda suelta: el bug del 2026-10-03 no estaba en la guarda sino en CUANDO
 * se reclamaba. React renderiza el boundary dos veces cuando el error sale de un render
 * concurrente (lo descarta y lo reintenta en sincrono); reclamar la marca en el render la
 * gastaba en el render descartado y el que quedaba en pantalla nunca recargaba.
 *
 * El DOM es `happy-dom` registrado a mano (no con `@vitest-environment`): asi el archivo corre
 * igual con el React de desarrollo y con el de produccion (`NODE_ENV=production npx vitest
 * run <archivo>`), que es donde se vio la falla. Por lo mismo no se usa `act` (no existe en
 * produccion): se renderiza y se espera a que React termine.
 */

const ventana = new Window({ url: 'https://soena.metrikone.co/negocios' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Text', 'Event', 'MutationObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })

const beacons: boolean[] = []
vi.mock('@/lib/errores-cliente/enviar', () => ({
  reportarErrorCliente: (_e: unknown, _o: unknown, autoRecarga: boolean) => {
    beacons.push(autoRecarga)
  },
}))

type ReactMod = typeof import('react')
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let AppError: (p: { error: Error; reset: () => void }) => unknown
let GlobalError: (p: { error: Error; reset: () => void }) => unknown

beforeAll(async () => {
  React = await import('react')
  createRoot = (await import('react-dom/client')).createRoot
  AppError = (await import('./(app)/error')).default as never
  GlobalError = (await import('./global-error')).default as never
})

/** Como el ErrorBoundary de Next: pinta la pantalla de error con lo que capturo. */
function crearBoundary(Pantalla: (p: { error: Error; reset: () => void }) => unknown) {
  return class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null }
    static getDerivedStateFromError(error: Error) {
      return { error }
    }
    render() {
      if (this.state.error) return React.createElement(Pantalla as never, { error: this.state.error, reset: () => {} })
      return this.props.children
    }
  }
}

/** La pagina que rompe: lanza al renderizar, como un chunk o un stream RSC que no bajo. */
function rompeCon(error: Error) {
  return function Rompe(): never {
    throw error
  }
}

let reload: ReturnType<typeof vi.fn>
let contenedor: HTMLElement
let desmontar: (() => void) | null = null

function almacenEnMemoria(): Storage {
  const datos = new Map<string, string>()
  return {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
    removeItem: (k: string) => void datos.delete(k),
    clear: () => datos.clear(),
    key: () => null,
    get length() {
      return datos.size
    },
  }
}

async function montar(
  Pantalla: (p: { error: Error; reset: () => void }) => unknown,
  error: Error,
  { estricto = false } = {},
): Promise<void> {
  const Boundary = crearBoundary(Pantalla)
  let arbol: React.ReactNode = React.createElement(Boundary, null, React.createElement(rompeCon(error)))
  if (estricto) arbol = React.createElement(React.StrictMode, null, arbol)
  const root = createRoot(contenedor)
  root.render(arbol)
  desmontar = () => root.unmount()
  // Render concurrente + reintento sincrono + efectos: unos ticks bastan.
  await new Promise((r) => setTimeout(r, 50))
}

beforeEach(() => {
  beacons.length = 0
  reload = vi.fn()
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    writable: true,
    value: { pathname: '/negocios', host: 'soena.metrikone.co', reload },
  })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, writable: true, value: almacenEnMemoria() })
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  desmontar?.()
  desmontar = null
  contenedor.remove()
  vi.restoreAllMocks()
})

const redCortada = () => new TypeError('network error')
const chunk = () => Object.assign(new Error('Failed to load chunk /_next/static/chunks/a.js'), { name: 'ChunkLoadError' })

describe.each([
  ['(app)/error.tsx', () => AppError],
  ['global-error.tsx', () => GlobalError],
])('%s: auto-recarga', (_n, pantalla) => {
  it('error de red en un render concurrente: recarga UNA vez y el beacon dice true', async () => {
    await montar(pantalla(), redCortada())
    expect(reload).toHaveBeenCalledTimes(1)
    expect(beacons).toEqual([true])
    expect(contenedor.textContent).toContain('Recargando')
  })

  it('ChunkLoadError: tambien recarga', async () => {
    await montar(pantalla(), chunk())
    expect(reload).toHaveBeenCalledTimes(1)
    expect(beacons).toEqual([true])
  })

  it('StrictMode (efecto doble en dev): una sola recarga, un solo reclamo, sin bucle', async () => {
    await montar(pantalla(), redCortada(), { estricto: true })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(beacons).toEqual([true])
    expect(contenedor.textContent).toContain('Recargando')
  })

  it('segunda falla en la misma ruta dentro de 60 s: no recarga, pantalla normal', async () => {
    sessionStorage.setItem('metrik:auto-recarga:/negocios', String(Date.now() - 5_000))
    await montar(pantalla(), redCortada())
    expect(reload).not.toHaveBeenCalled()
    expect(beacons).toEqual([false])
    expect(contenedor.textContent).toContain('Se perdió la conexión')
    expect(contenedor.textContent).not.toContain('Recargando')
  })

  it('un error que no es de red nunca recarga ni deja marca', async () => {
    await montar(pantalla(), new Error('Negocio no encontrado'))
    expect(reload).not.toHaveBeenCalled()
    expect(beacons).toEqual([false])
    expect(sessionStorage.length).toBe(0)
    expect(contenedor.textContent).not.toContain('Recargando')
  })

  it('si sessionStorage no guarda: no recarga y queda la pantalla normal', async () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      writable: true,
      value: { ...almacenEnMemoria(), getItem: () => null, setItem: () => {} },
    })
    await montar(pantalla(), redCortada())
    expect(reload).not.toHaveBeenCalled()
    expect(beacons).toEqual([false])
    expect(contenedor.textContent).toContain('Se perdió la conexión')
    expect(contenedor.textContent).not.toContain('Recargando')
  })

  it('si leer sessionStorage lanza: no recarga', async () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new Error('SecurityError')
      },
    })
    await montar(pantalla(), redCortada())
    expect(reload).not.toHaveBeenCalled()
    expect(beacons).toEqual([false])
  })
})
