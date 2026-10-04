import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { Window } from 'happy-dom'

/**
 * Tocar una tarjeta responde al instante, sin esperar a la red (2026-10-03).
 *
 * `CardLink` + `NavegacionPendienteProvider` montados con React DE VERDAD. El `router.push`
 * falso hace lo mismo que el de Next: programa una actualizacion de estado dentro de la
 * transicion, y la pagina destino SUSPENDE hasta que "llega del servidor" (una promesa que
 * la prueba resuelve a mano). Asi `isPending` se comporta como en produccion: queda en
 * `true` mientras la ficha no llega y vuelve a `false` cuando React la pinta.
 *
 * DOM `happy-dom` registrado a mano y sin `act`, igual que `auto-recarga-boundaries.test.ts`.
 */

const ventana = new Window({ url: 'https://soena.metrikone.co/negocios' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })

/** La seleccion de texto que ve `CardLink`; `null` = no hay nada seleccionado. */
let seleccion: { isCollapsed: boolean; toString: () => string; anchorNode: Node | null } | null = null
Object.defineProperty(globalThis, 'getSelection', { configurable: true, writable: true, value: () => seleccion })

// Lo que un <Link> del menu reportaria con `useLinkStatus`.
let enlacePendiente = false
vi.mock('next/link', () => ({ useLinkStatus: () => ({ pending: enlacePendiente }) }))

type ReactMod = typeof import('react')
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let CardLink: (p: { href: string; children: React.ReactNode }) => unknown
let Provider: (p: { children: React.ReactNode }) => unknown
let Capa: () => unknown
let Senal: () => unknown

/** La ruta "actual" y la llegada del servidor que la prueba controla. */
const control: { irA: ((href: string) => void) | null } = { irA: null }
let llegada: { promesa: Promise<void>; resolver: () => void }
function nuevaLlegada() {
  let resolver!: () => void
  const promesa = new Promise<void>((r) => (resolver = r))
  llegada = { promesa, resolver }
}

const push = vi.fn((href: string) => control.irA?.(href))
const prefetch = vi.fn()
const router = { push, prefetch, refresh: vi.fn(), replace: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/negocios' }))

beforeAll(async () => {
  React = await import('react')
  createRoot = (await import('react-dom/client')).createRoot
  CardLink = (await import('./card-link')).CardLink as never
  const mod = await import('./navegacion-pendiente')
  Provider = mod.NavegacionPendienteProvider as never
  Capa = mod.CapaNavegacionPendiente as never
  Senal = mod.SenalDeEnlace as never
})

function Ficha() {
  React.use(llegada.promesa)
  return React.createElement('p', { 'data-ficha': '' }, 'ficha del negocio')
}

/** La lista con una tarjeta; al navegar, la ficha (que suspende hasta que "llega"). */
function Rutas() {
  const [ruta, setRuta] = React.useState('/negocios')
  React.useEffect(() => {
    control.irA = setRuta
  }, [])
  if (ruta !== '/negocios') return React.createElement(Ficha)
  return React.createElement(
    CardLink as never,
    { href: '/negocios/n1' },
    React.createElement('span', { 'data-texto': '' }, 'S1 26 3 · Instalación'),
  )
}

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null

function arbol({ conProveedor = true, conSenal = false } = {}) {
  const contenido = React.createElement(
    React.Fragment,
    null,
    React.createElement(React.Suspense, { fallback: null }, React.createElement(Rutas)),
    conProveedor ? React.createElement(Capa as never) : null,
    conSenal ? React.createElement(Senal as never) : null,
  )
  return conProveedor ? React.createElement(Provider as never, null, contenido) : contenido
}

async function montar(opciones?: { conProveedor?: boolean; conSenal?: boolean }) {
  root = createRoot(contenedor)
  root.render(arbol(opciones))
  await asentar()
}

/** Deja correr al scheduler de React (setImmediate en Node). */
async function asentar() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
}

const tarjeta = () => contenedor.querySelector('[role="link"]') as HTMLElement | null
const animando = () => contenedor.querySelector('[data-animacion-marca="liviana"]') !== null
const fichaPintada = () => contenedor.querySelector('[data-ficha]') !== null

beforeEach(() => {
  push.mockClear()
  prefetch.mockClear()
  seleccion = null
  enlacePendiente = false
  control.irA = null
  nuevaLlegada()
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
})

afterEach(() => {
  root?.unmount()
  root = null
  contenedor.remove()
})

describe('tocar una tarjeta', () => {
  it('la marca como ocupada y pinta la animacion de marca sin esperar a la red', async () => {
    await montar()
    expect(tarjeta()?.getAttribute('aria-busy')).toBeNull()
    expect(animando()).toBe(false)

    tarjeta()!.click()
    await asentar()

    expect(push).toHaveBeenCalledWith('/negocios/n1')
    // La ficha no llego: sigue la lista, con la tarjeta ocupada y la animacion encima.
    expect(fichaPintada()).toBe(false)
    expect(tarjeta()?.getAttribute('aria-busy')).toBe('true')
    expect(tarjeta()?.className).toContain('opacity-60')
    expect(animando()).toBe(true)
  })

  it('el estado pendiente se limpia cuando la pagina destino se pinta', async () => {
    await montar()
    tarjeta()!.click()
    await asentar()
    expect(animando()).toBe(true)

    llegada.resolver()
    await asentar()

    expect(fichaPintada()).toBe(true)
    expect(animando()).toBe(false)
    expect(contenedor.querySelector('[aria-busy]')).toBeNull()
  })

  it('un doble toque navega una sola vez', async () => {
    await montar()
    const t = tarjeta()!
    t.click()
    t.click()
    await asentar()
    tarjeta()!.click()
    await asentar()
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('Enter tambien queda pendiente y no se repite', async () => {
    await montar()
    const t = tarjeta()!
    const enter = () => t.dispatchEvent(new ventana.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) as never)
    enter()
    enter()
    await asentar()
    expect(push).toHaveBeenCalledTimes(1)
    expect(animando()).toBe(true)
  })

  it('soltar el mouse tras seleccionar texto NO navega ni marca nada', async () => {
    await montar()
    const nodoTexto = contenedor.querySelector('[data-texto]')!.firstChild
    seleccion = { isCollapsed: false, toString: () => 'S1 26 3', anchorNode: nodoTexto }
    tarjeta()!.click()
    await asentar()
    expect(push).not.toHaveBeenCalled()
    expect(tarjeta()?.getAttribute('aria-busy')).toBeNull()
    expect(animando()).toBe(false)
  })

  it('Cmd/Ctrl click abre en pestaña nueva y no deja estado pendiente', async () => {
    await montar()
    const abrir = vi.fn()
    Object.defineProperty(globalThis, 'open', { configurable: true, writable: true, value: abrir })
    tarjeta()!.dispatchEvent(new ventana.MouseEvent('click', { bubbles: true, metaKey: true }) as never)
    await asentar()
    expect(abrir).toHaveBeenCalledWith('/negocios/n1', '_blank', 'noopener,noreferrer')
    expect(push).not.toHaveBeenCalled()
    expect(animando()).toBe(false)
  })

  it('apoyar el dedo ya precarga el destino (en el celular no hay hover)', async () => {
    await montar()
    tarjeta()!.dispatchEvent(new ventana.PointerEvent('pointerdown', { bubbles: true }) as never)
    await asentar()
    expect(prefetch).toHaveBeenCalledWith('/negocios/n1')
  })

  it('despues de llegar, la misma tarjeta vuelve a navegar (la guarda no queda pegada)', async () => {
    await montar()
    tarjeta()!.click()
    await asentar()
    llegada.resolver()
    await asentar()
    expect(push).toHaveBeenCalledTimes(1)

    // Vuelta a la lista (otra carga) y nuevo toque a la misma tarjeta.
    nuevaLlegada()
    control.irA!('/negocios')
    await asentar()
    tarjeta()!.click()
    await asentar()
    expect(push).toHaveBeenCalledTimes(2)
  })
})

describe('fuera del shell (sin proveedor)', () => {
  it('la tarjeta igual se marca ocupada y frena el doble toque', async () => {
    await montar({ conProveedor: false })
    const t = tarjeta()!
    t.click()
    t.click()
    await asentar()
    expect(push).toHaveBeenCalledTimes(1)
    expect(tarjeta()?.getAttribute('aria-busy')).toBe('true')

    llegada.resolver()
    await asentar()
    expect(fichaPintada()).toBe(true)
  })
})

describe('enlaces del menu (useLinkStatus)', () => {
  it('un <Link> navegando pinta la misma animacion y la suelta al terminar', async () => {
    enlacePendiente = true
    await montar({ conSenal: true })
    expect(animando()).toBe(true)

    enlacePendiente = false
    root!.render(arbol({ conSenal: true }))
    await asentar()
    expect(animando()).toBe(false)
  })

  it('si el enlace se desmonta a media navegacion, la animacion no queda pegada', async () => {
    enlacePendiente = true
    await montar({ conSenal: true })
    expect(animando()).toBe(true)

    root!.render(arbol({ conSenal: false }))
    await asentar()
    expect(animando()).toBe(false)
  })
})

describe('con recarga pendiente (techo de 8 h o epoca nueva)', () => {
  // La navegacion por codigo no pasa por un <a>: sin este gancho, la recarga pendiente
  // nunca encontraria su momento al tocar una tarjeta.
  let assign: ReturnType<typeof vi.fn>
  let pendiente: typeof import('@/lib/version/recarga-pendiente')
  let TECHO: number

  beforeEach(async () => {
    pendiente = await import('@/lib/version/recarga-pendiente')
    TECHO = (await import('@/lib/version/decidir')).TECHO_EDAD_MS
    assign = vi.fn()
    Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: { assign } })
  })

  afterEach(() => {
    pendiente.olvidarPestana()
    Reflect.deleteProperty(navigator, 'onLine')
  })

  it('pasado el techo, la tarjeta carga el destino completo en vez de navegar suave', async () => {
    pendiente.registrarPestana(1, Date.now() - TECHO - 1)
    await montar()
    tarjeta()!.click()
    await asentar()
    expect(assign).toHaveBeenCalledWith('/negocios/n1')
    expect(push).not.toHaveBeenCalled()
  })

  it('tambien fuera del shell (sin proveedor)', async () => {
    pendiente.registrarPestana(1, Date.now() - TECHO - 1)
    await montar({ conProveedor: false })
    tarjeta()!.click()
    await asentar()
    expect(assign).toHaveBeenCalledWith('/negocios/n1')
    expect(push).not.toHaveBeenCalled()
  })

  it('con una epoca viva mayor, igual', async () => {
    pendiente.registrarPestana(1, Date.now())
    pendiente.anotarEpocaViva(2)
    await montar()
    tarjeta()!.click()
    await asentar()
    expect(assign).toHaveBeenCalledWith('/negocios/n1')
    expect(push).not.toHaveBeenCalled()
  })

  it('sin motivo (solo hubo deploys), navega suave como siempre', async () => {
    pendiente.registrarPestana(1, Date.now())
    pendiente.anotarEpocaViva(1)
    await montar()
    tarjeta()!.click()
    await asentar()
    expect(assign).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith('/negocios/n1')
  })

  it('sin red, navega suave: una carga completa sin red deja la pantalla en blanco', async () => {
    pendiente.registrarPestana(1, Date.now() - TECHO - 1)
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    await montar()
    tarjeta()!.click()
    await asentar()
    expect(assign).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith('/negocios/n1')
  })
})
