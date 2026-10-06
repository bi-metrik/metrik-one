import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { Window } from 'happy-dom'

/**
 * Las pantallas de error (`(app)/error.tsx`, `global-error.tsx`) montadas con React DE
 * VERDAD, no la escalera suelta: el bug del 2026-10-03 (#1002) no estaba en la guarda sino
 * en CUANDO se reclamaba. React renderiza el boundary dos veces cuando el error sale de un
 * render concurrente (lo descarta y lo reintenta en sincrono); reclamar en el render la
 * gastaba en el render descartado.
 *
 * El DOM es `happy-dom` registrado a mano (no con `@vitest-environment`): asi el archivo corre
 * igual con el React de desarrollo y con el de produccion (`NODE_ENV=production npx vitest
 * run <archivo>`). Por lo mismo no se usa `act` (no existe en produccion).
 *
 * Temporizadores falsos SOLO para `setTimeout`/`Date`: el scheduler de React en Node usa
 * `setImmediate`, que queda real, asi que React sigue trabajando y las esperas de la
 * escalera (2 s, 5 s, 15 s, 30 s) se avanzan a mano.
 */

// El `Event` de Node, antes de que lo tape el de happy-dom: el EventTarget de abajo es de Node.
const EventoNode = globalThis.Event
const ventana = new Window({ url: 'https://soena.metrikone.co/negocios' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Text', 'Event', 'MutationObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })
// `window.addEventListener('online')`: en Node `globalThis` no es un EventTarget.
const eventos = new EventTarget()
Object.assign(globalThis, {
  addEventListener: eventos.addEventListener.bind(eventos),
  removeEventListener: eventos.removeEventListener.bind(eventos),
  dispatchEvent: eventos.dispatchEvent.bind(eventos),
})
let enLinea = true
Object.defineProperty(ventana.navigator, 'onLine', { configurable: true, get: () => enLinea })

interface Beacon {
  autoRecarga: boolean
  accion?: string
  intento?: number
  enLinea?: boolean
}
const beacons: Beacon[] = []
const recuperados: { accion: string; intento: number }[] = []
/** Cada aparicion del aviso "No pudimos conectar con ONE" (`reportarAvisoConexion`). */
const avisos: string[] = []
vi.mock('@/lib/errores-cliente/enviar', () => ({
  reportarErrorCliente: (_e: unknown, _o: unknown, autoRecarga: boolean, d: Omit<Beacon, 'autoRecarga'> = {}) => {
    beacons.push({ autoRecarga, ...d })
  },
  reportarRecuperacion: (p: { accion: string; intento: number }) => {
    recuperados.push({ accion: p.accion, intento: p.intento })
  },
  reportarAvisoConexion: (causa: string) => {
    avisos.push(causa)
  },
  iniciarColaDeReenvio: () => () => {},
}))

const refresh = vi.fn(() => {
  if (refrescoCura) rota = false
})
const router = { refresh }
vi.mock('next/navigation', () => ({ useRouter: () => router }))

type ReactMod = typeof import('react')
type Pantalla = (p: { error: Error; reset: () => void }) => unknown
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let AppError: Pantalla
let GlobalError: Pantalla
let Vigia: () => unknown
let olvidarCargaDeLaPagina: () => void

beforeAll(async () => {
  React = await import('react')
  createRoot = (await import('react-dom/client')).createRoot
  AppError = (await import('./(app)/error')).default as never
  GlobalError = (await import('./global-error')).default as never
  Vigia = (await import('@/components/red/vigia-recuperacion')).default as never
  olvidarCargaDeLaPagina = (await import('@/lib/red/auto-recarga')).olvidarCargaDeLaPagina
})

/**
 * La pagina: lanza mientras `rota`, como un chunk o un stream RSC que no bajo. Con
 * `refrescoCura`, el `router.refresh()` del reintento suave la arregla (el payload bajo).
 */
let rota = false
let refrescoCura = false
let errorDePagina: Error
function Pagina() {
  if (rota) throw errorDePagina
  return React.createElement('p', null, 'contenido de la página')
}

/** Como el ErrorBoundary de Next: pinta la pantalla de error; `reset` vuelve a los hijos. */
function crearBoundary(P: Pantalla) {
  return class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null }
    static getDerivedStateFromError(error: Error) {
      return { error }
    }
    reset = () => this.setState({ error: null })
    render() {
      if (this.state.error) return React.createElement(P as never, { error: this.state.error, reset: this.reset })
      return this.props.children
    }
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

/** Deja correr a React (setImmediate real) y a los temporizadores falsos ya vencidos. */
async function asentar() {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setImmediate(r))
    await vi.advanceTimersByTimeAsync(0)
  }
}

async function avanzar(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
  await asentar()
}

/** Una carga de la pagina: la memoria del modulo arranca de cero, `sessionStorage` no. */
async function cargar(P: Pantalla, { estricto = false } = {}) {
  desmontar?.()
  olvidarCargaDeLaPagina()
  const Boundary = crearBoundary(P)
  let arbol: React.ReactNode = React.createElement(
    React.Fragment,
    null,
    React.createElement(Boundary, null, React.createElement(Pagina)),
    React.createElement(Vigia as never),
  )
  if (estricto) arbol = React.createElement(React.StrictMode, null, arbol)
  const root = createRoot(contenedor)
  root.render(arbol)
  desmontar = () => root.unmount()
  await asentar()
}

const texto = () => contenedor.textContent ?? ''
const animando = () => contenedor.querySelector('[data-animacion-marca="liviana"]') !== null

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-10-03T15:00:00-05:00'))
  beacons.length = 0
  recuperados.length = 0
  avisos.length = 0
  refresh.mockClear()
  enLinea = true
  rota = true
  refrescoCura = false
  errorDePagina = new TypeError('Failed to fetch')
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
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const chunk = () => Object.assign(new Error('Failed to load chunk /_next/static/chunks/a.js'), { name: 'ChunkLoadError' })
// Mientras se reintenta solo, la pantalla no habla de conexion: solo la animacion.
const PROHIBIDAS = /conexi[oó]n|desconect|señal/i
// El aviso final (2026-10-06) si nombra la conexion ("puede ser"), pero nunca "proceso" ni "señal".
const AVISO = 'No pudimos conectar con ONE'
const PROHIBIDAS_AVISO = /proceso|señal/i

describe.each([
  ['(app)/error.tsx', () => AppError],
  ['global-error.tsx', () => GlobalError],
])('%s: recuperacion de un error de red', (_n, pantalla) => {
  it('primero se ve la animacion de carga, sin hablar de conexion, y un reintento suave la cura', async () => {
    refrescoCura = true
    await cargar(pantalla())
    // El reintento suave (refresh + reset) ya corrio y la pagina volvio.
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(texto()).toContain('contenido de la página')
    expect(texto()).not.toMatch(PROHIBIDAS)
    expect(reload).not.toHaveBeenCalled()
    expect(beacons).toEqual([{ autoRecarga: true, accion: 'suave', intento: 0, enLinea: true }])
    // Pasados 5 s sin otro error en la ruta: el episodio se cierra como recuperado.
    await avanzar(5_000)
    expect(recuperados).toEqual([{ accion: 'suave', intento: 0 }])
  })

  it('mientras espera la recarga se ve la animacion de marca (no un aviso)', async () => {
        await cargar(pantalla())
    expect(animando()).toBe(true)
    expect(texto()).not.toMatch(PROHIBIDAS)
    expect(texto()).not.toMatch(/Recargar|Reintentar/)
  })

  it('back-off: suave, luego recargas a 2, 5, 15 y 30 s; agotado el tope, el aviso con Reintentar', async () => {
        await cargar(pantalla())
    expect(refresh).toHaveBeenCalledTimes(1)
    for (const espera of [2_000, 5_000, 15_000, 30_000]) {
      await avanzar(espera - 1)
      expect(reload).not.toHaveBeenCalled()
      await avanzar(1)
      expect(reload).toHaveBeenCalledTimes(1)
      reload.mockClear()
      // "Recarga": la pagina vuelve a cargar y vuelve a fallar. Sin otro suave (uno por episodio).
      await cargar(pantalla())
      expect(refresh).toHaveBeenCalledTimes(1)
    }
    // Cuatro recargas en menos de 3 min: no hay quinta.
    await avanzar(120_000)
    expect(reload).not.toHaveBeenCalled()
    expect(texto()).toContain(AVISO)
    expect(texto()).toContain('otra red o con los datos del celular')
    expect(texto()).toContain('Reintentar')
    expect(texto()).not.toContain('Recargar')
    expect(texto()).not.toMatch(PROHIBIDAS_AVISO)
    expect(beacons.map((b) => `${b.accion}:${b.intento}`)).toEqual([
      'suave:0', 'recarga:0', 'recarga:1', 'recarga:2', 'recarga:3', 'agotado:4',
    ])
    expect(beacons.at(-1)?.autoRecarga).toBe(false)
    // Un reporte del aviso por aparicion: solo la ultima carga lo mostro.
    expect(avisos).toEqual(['agotado'])
  })

  it('ChunkLoadError: tambien entra a la escalera', async () => {
    errorDePagina = chunk()
        await cargar(pantalla())
    expect(refresh).toHaveBeenCalledTimes(1)
    await avanzar(2_000)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('el tope es por ruta: otra ruta empieza la escalera de cero', async () => {
    const t = Date.now()
    sessionStorage.setItem('metrik:auto-recarga:/negocios', JSON.stringify({ r: [t - 4, t - 3, t - 2, t - 1], s: t - 5 }))
        await cargar(pantalla())
    expect(refresh).not.toHaveBeenCalled()
    expect(texto()).toContain(AVISO)

    location.pathname = '/tableros'
    beacons.length = 0
    await cargar(pantalla())
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(beacons[0]).toMatchObject({ accion: 'suave', intento: 0 })
  })

  it('sin internet: no recarga a ciegas, lo dice, y reintenta en cuanto vuelve la red', async () => {
    enLinea = false
    refrescoCura = true
    await cargar(pantalla())
    expect(animando()).toBe(true)
    expect(texto()).toContain('Sin internet. Seguimos apenas vuelva.')
    await avanzar(60_000)
    expect(refresh).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(beacons).toEqual([{ autoRecarga: true, accion: 'esperar-red', intento: 0, enLinea: false }])

    enLinea = true
    dispatchEvent(new EventoNode('online'))
    await asentar()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(texto()).toContain('contenido de la página')
    expect(beacons.at(-1)).toMatchObject({ accion: 'suave', enLinea: true })
  })

  it('si se cae la red durante la espera de una recarga, espera el online en vez de recargar', async () => {
        await cargar(pantalla())
    enLinea = false
    await avanzar(2_000)
    expect(reload).not.toHaveBeenCalled()
    expect(texto()).toContain('Sin internet')
    enLinea = true
    dispatchEvent(new EventoNode('online'))
    await asentar()
    await avanzar(2_000)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('un error que no es de red nunca recarga ni deja marca, y conserva su pantalla', async () => {
    errorDePagina = new Error('Negocio no encontrado')
        await cargar(pantalla())
    await avanzar(180_000)
    expect(reload).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
    expect(beacons).toEqual([{ autoRecarga: false, accion: 'ninguna' }])
    expect(avisos).toEqual([])
    expect(texto()).toMatch(/Algo se rompió en esta pantalla|MéTRIK one no pudo cargar/)
    expect(texto()).toContain('Reintentar')
    expect(animando()).toBe(false)
  })

  it('StrictMode (efecto doble en dev): un solo reclamo, un solo beacon, una sola recarga', async () => {
        await cargar(pantalla(), { estricto: true })
    expect(refresh).toHaveBeenCalledTimes(1)
    await avanzar(2_000)
    expect(reload).toHaveBeenCalledTimes(1)
    await avanzar(60_000)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(beacons.map((b) => b.accion)).toEqual(['suave', 'recarga'])
    const estado = JSON.parse(sessionStorage.getItem('metrik:auto-recarga:/negocios') ?? '{}')
    expect(estado.r).toHaveLength(1)
  })

  it('si sessionStorage no guarda: nada automatico, pantalla tranquila', async () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      writable: true,
      value: { ...almacenEnMemoria(), getItem: () => null, setItem: () => {} },
    })
        await cargar(pantalla())
    await avanzar(60_000)
    expect(refresh).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(texto()).toContain(AVISO)
    expect(texto()).not.toMatch(PROHIBIDAS_AVISO)
    expect(beacons.at(-1)).toMatchObject({ accion: 'agotado', autoRecarga: false })
    expect(avisos).toEqual(['agotado'])
  })

  it('si leer sessionStorage lanza: nada automatico', async () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new Error('SecurityError')
      },
    })
        await cargar(pantalla())
    await avanzar(60_000)
    expect(refresh).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(beacons).toEqual([{ autoRecarga: false, accion: 'agotado', intento: 0, enLinea: true }])
    expect(avisos).toEqual(['agotado'])
  })

  it('el boton Reintentar de la pantalla agotada recarga y borra el historial de la ruta', async () => {
    const t = Date.now()
    sessionStorage.setItem('metrik:auto-recarga:/negocios', JSON.stringify({ r: [t - 4, t - 3, t - 2, t - 1], s: t - 5 }))
        await cargar(pantalla())
    const boton = [...contenedor.querySelectorAll('button')].find((b) => b.textContent?.includes('Reintentar'))
    boton?.dispatchEvent(new (ventana as never as { MouseEvent: typeof MouseEvent }).MouseEvent('click', { bubbles: true }))
    await asentar()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(JSON.parse(sessionStorage.getItem('metrik:auto-recarga:/negocios') ?? '{}')).toEqual({ r: [] })
  })
})

describe('vigia: cierre del episodio tras una recarga', () => {
  it('si la carga que sigue a una recarga no falla en 5 s, reporta recuperado con el intento', async () => {
        await cargar(AppError)
    await avanzar(2_000)
    expect(reload).toHaveBeenCalledTimes(1)
    // La recarga sale bien.
    rota = false
    await cargar(AppError)
    expect(texto()).toContain('contenido de la página')
    await avanzar(4_999)
    expect(recuperados).toEqual([])
    await avanzar(1)
    expect(recuperados).toEqual([{ accion: 'recarga', intento: 1 }])
  })

  it('si la carga vuelve a fallar, no reporta recuperado', async () => {
        await cargar(AppError)
    await avanzar(2_000)
    await cargar(AppError)
    await avanzar(6_000)
    expect(recuperados).toEqual([])
  })
})
