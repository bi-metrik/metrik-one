import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * «Lo que suma» se puede ocultar (brief del 2026-10-16, Trappvel). LA PANTALLA POR PASOS montada
 * con React de verdad sobre happy-dom, dentro de un marco con su encabezado (como lo pinta
 * `NegocioDetailClient` con la cotización en el centro), con el caso fijo de San Andrés.
 *
 *  · Sin elección, la columna se rige por el ancho EN CSS: cerrada por debajo de 1500 px, abierta
 *    desde ahí; la rejilla cambia con ella (si no, la cotización caería en la columna de 260 px).
 *  · Cerrada, la pastilla «Total $X · margen Y %» va al ENCABEZADO del negocio, con la cifra de
 *    «Lo que suma», y un punto rojo con el mismo conteo de rojos de la barra (H7).
 *  · La pastilla abre «Lo que suma» como panel encima (dentro del encabezado, fuera de la rejilla):
 *    se cierra con ✕, con Esc y con un clic afuera; con teclado, el foco entra y vuelve.
 *  · «Ocultar» y «Fijar a la izquierda» se guardan en `localStorage`; si no se puede leer, manda
 *    el ancho.
 *  · Celular: la barra de abajo no cambia.
 */

const ventana = new Window({ url: 'https://agencia.metrikone.co/negocios/n/cotizacion/c' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver', 'KeyboardEvent', 'PointerEvent', 'localStorage'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })
Object.defineProperty(globalThis, 'scrollTo', { configurable: true, writable: true, value: () => {} })
for (const k of ['addEventListener', 'removeEventListener'] as const) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: ventana[k].bind(ventana) })
}

vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }))
vi.mock('@/app/(app)/negocios/por-pasos-actions', () => ({
  elegirOpcionEnTarifa: vi.fn(), deshacerPorPasos: vi.fn(), enviarPorPasos: vi.fn(), mandarTarifa: vi.fn(),
  margenPorPasos: vi.fn(), estadoDeServicioPorPasos: vi.fn(), juntarServicioPorPasos: vi.fn(),
  moverOpcionPorPasos: vi.fn(), separarOpcionPorPasos: vi.fn(), agregarOpcionPorPasos: vi.fn(),
  pedirAutorizacionPorPasos: vi.fn(), retirarAutorizacionPorPasos: vi.fn(),
}))
vi.mock('@/app/(app)/negocios/por-pasos-borrar-actions', () => ({
  borrarOpcionesPorPasos: vi.fn(), reponerOpcionesPorPasos: vi.fn(), soltarImagenesPorPasos: vi.fn(),
}))
vi.mock('@/app/(app)/negocios/margen-salida-actions', () => ({ autorizarBajoElMinimo: vi.fn() }))
vi.mock('@/app/(app)/negocios/itinerario-actions', () => ({
  eliminarItinerario: vi.fn(), guardarMotivoDeTarifa: vi.fn(), renombrarItinerario: vi.fn(),
}))

type ReactMod = typeof import('react')
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let act: typeof import('react').act
let VistaPorPasos: typeof import('./por-pasos/vista-por-pasos').default
let Marco: typeof import('./marco-cotizacion-contexto').MarcoCotizacionContexto
let CLAVE: string
let caso: typeof import('../../../../test/caso-san-andres')

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  VistaPorPasos = (await import('./por-pasos/vista-por-pasos')).default
  Marco = (await import('./marco-cotizacion-contexto')).MarcoCotizacionContexto
  CLAVE = (await import('./por-pasos/lo-que-suma')).CLAVE_LO_QUE_SUMA
  caso = await import('../../../../test/caso-san-andres')
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
beforeEach(() => {
  localStorage.clear()
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  contenedor.remove()
  vi.restoreAllMocks()
})

const asentar = async () => { await act(async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)) }) }
const q = (sel: string) => contenedor.querySelector(sel)
const clases = (sel: string) => (q(sel)?.getAttribute('class') ?? '').split(/\s+/)
const rejilla = () => (q('[data-lo-que-suma]')?.parentElement?.getAttribute('class') ?? '').split(/\s+/)
const encabezado = () => q('[data-encabezado-prueba]')!
const pastilla = () => encabezado().querySelector('[data-pastilla-suma] button') as HTMLElement | null

function props(extra: { rojos?: number; pantallazos?: number } = {}) {
  const filas = caso.LINEAS_CASO_FIJO.map(l => ({ ...structuredClone(l.item), rubros: [structuredClone(l.rubro)] }))
  return {
    cotizacionId: caso.COT_SAN_ANDRES,
    editable: true,
    enviada: false,
    filas: filas as never,
    adicionalesPorItem: {},
    tarifasDelServidor: caso.TARIFAS_CASO_FIJO.map(t => ({ id: t.fila.id as string, nombre: t.fila.nombre as string, orden: t.fila.orden as number, vaEnPropuesta: t.fila.va_en_propuesta as boolean, seleccion: t.seleccion })),
    params: { administrativosPct: 0, margenPct: 15, descuentoComercialPct: 0, convencionMargen: 'sobre_venta' as const },
    margenPct: 15,
    umbrales: { pisoPct: 5, avisoPct: 10 },
    composicionViaje: caso.COMPOSICION,
    fechasViaje: caso.FECHAS,
    destinoViaje: caso.DESTINO,
    salida: null,
    pedido: null,
    texto: 'ok' as const,
    pantallazosPorAceptar: extra.pantallazos ?? 0,
    leyendo: 0,
    pasoInicial: 1 as const,
    motivoBotonEnviar: null,
    conteoLista: { rojos: extra.rojos ?? 0, ambar: 0 },
    bandeja: React.createElement('div', { 'data-bandeja': '' }, 'BANDEJA'),
    agregarSinPantallazo: null,
    tarjetaDeOpcion: (id: string) => React.createElement('div', { 'data-opcion-stub': id }, id),
    revisarLista: React.createElement('p', null, 'LISTA'),
    revisarDocumento: React.createElement('p', null, 'DOCUMENTO'),
    verElCalculo: React.createElement('div', null, 'CASCADA'),
    rastro: null,
    onDescargar: () => {},
    onAceptarTodos: () => {},
    onPegar: () => {},
    onAbrirOpcion: () => {},
    onRecibirEnBandeja: () => {},
    refrescar: () => {},
  }
}

/** La página: el encabezado fijo del negocio y, en el centro, la cotización (como el marco real). */
function Pagina(p: ReturnType<typeof props>) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [marco] = React.useState(() => ({ activo: true as const, encabezado: ref }))
  return React.createElement(React.Fragment, null,
    React.createElement('div', { ref, 'data-encabezado-prueba': '', className: 'sticky top-0' }, React.createElement('h1', null, 'E2 26 1')),
    React.createElement(Marco.Provider, { value: marco }, React.createElement(VistaPorPasos, p)),
  )
}

async function montar(extra: Parameters<typeof props>[0] = {}) {
  await act(async () => { root!.render(React.createElement(Pagina, props(extra))) })
  await asentar()
}
const clic = async (el: Element | null | undefined) => {
  expect(el, 'no está en la pantalla').toBeTruthy()
  await act(async () => { (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await asentar()
}

describe('Sin elección: manda el ancho de la ventana', () => {
  it('cerrada por debajo de 1500 px y abierta desde ahí, con la rejilla a la par', async () => {
    await montar()
    const columna = clases('[data-lo-que-suma]')
    expect(columna).toContain('hidden')
    expect(columna).toContain('min-[1500px]:flex')
    expect(columna).not.toContain('lg:flex')
    expect(rejilla()).toContain('min-[1500px]:grid-cols-[260px_minmax(0,1fr)]')
    expect(rejilla()).not.toContain('lg:grid-cols-[260px_minmax(0,1fr)]')
    // La pastilla: en el encabezado, solo en pantalla ancha y solo mientras la columna no se ve.
    const caja = encabezado().querySelector('[data-pastilla-suma]')!
    expect(caja.getAttribute('class')!.split(/\s+/)).toEqual(expect.arrayContaining(['hidden', 'lg:block', 'min-[1500px]:hidden']))
    // No queda otra pastilla dentro de la cotización.
    expect(q('[data-cotizacion-por-pasos] [data-pastilla-suma]')).toBeNull()
  })

  it('la pastilla dice el total y el margen de «Lo que suma»', async () => {
    await montar()
    const total = q('[data-total-suma] b')!.textContent!
    expect(total).toMatch(/^\$\d/)
    expect(pastilla()!.textContent).toMatch(new RegExp(`^Total ${total.replace(/[$.]/g, '\\$&')} · margen \\d+(,\\d)? %$`))
  })
})

describe('El punto rojo de la pastilla', () => {
  it('sin nada en rojo, no hay punto', async () => {
    await montar()
    expect(pastilla()!.querySelector('[data-punto-rojo]')).toBeNull()
  })

  it('con rojos, el punto y el MISMO conteo que la barra de pasos (H7)', async () => {
    await montar({ rojos: 2 })
    expect(pastilla()!.querySelector('[data-punto-rojo]')).not.toBeNull()
    const barra = q('[data-paso="3"] [data-estado-paso]')!.textContent
    expect(barra).toBe('2 cosas impiden enviar')
    expect(pastilla()!.textContent).toContain(barra)
  })

  it('con pantallazos sin aceptar, también', async () => {
    await montar({ pantallazos: 1 })
    expect(pastilla()!.querySelector('[data-punto-rojo]')).not.toBeNull()
    expect(pastilla()!.textContent).toContain('1 pantallazo sin aceptar')
  })
})

describe('La pastilla abre «Lo que suma» encima de la cotización', () => {
  it('abre como panel en el encabezado (no en la rejilla), y ✕ la cierra y devuelve el foco', async () => {
    await montar()
    await clic(pastilla())
    const panel = encabezado().querySelector('[data-panel-suma]')!
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(panel.getAttribute('class')).toContain('absolute')
    expect(pastilla()!.getAttribute('aria-expanded')).toBe('true')
    expect(panel.querySelector('[data-total-suma]')).not.toBeNull()
    // El foco entra al panel, en su ✕.
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Cerrar')
    await clic(panel.querySelector('[aria-label="Cerrar"]'))
    expect(encabezado().querySelector('[data-panel-suma]')).toBeNull()
    expect(document.activeElement).toBe(pastilla())
  })

  it('Esc la cierra y el foco vuelve a la pastilla', async () => {
    await montar()
    await clic(pastilla())
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(encabezado().querySelector('[data-panel-suma]')).toBeNull()
    expect(document.activeElement).toBe(pastilla())
  })

  it('un clic afuera la cierra; uno adentro no', async () => {
    await montar()
    await clic(pastilla())
    const adentro = encabezado().querySelector('[data-total-suma]')!
    await act(async () => { adentro.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
    expect(encabezado().querySelector('[data-panel-suma]')).not.toBeNull()
    await act(async () => { q('[data-bandeja]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
    expect(encabezado().querySelector('[data-panel-suma]')).toBeNull()
  })
})

describe('La elección de cada persona', () => {
  it('«Ocultar» la cierra en todo ancho y se guarda; «Fijar a la izquierda» la abre y se guarda', async () => {
    await montar()
    await clic(q('[data-ocultar-suma]'))
    expect(localStorage.getItem(CLAVE)).toBe('cerrada')
    expect(clases('[data-lo-que-suma]').filter(c => c.endsWith(':flex'))).toEqual([])
    expect(rejilla().some(c => c.includes('grid-cols-[260px'))).toBe(false)
    expect(encabezado().querySelector('[data-pastilla-suma]')!.getAttribute('class')!.split(/\s+/)).toEqual(expect.arrayContaining(['hidden', 'lg:block']))
    expect(encabezado().querySelector('[data-pastilla-suma]')!.getAttribute('class')).not.toContain('min-[1500px]:hidden')

    await clic(pastilla())
    await clic(encabezado().querySelector('[data-fijar-suma]'))
    expect(localStorage.getItem(CLAVE)).toBe('abierta')
    expect(clases('[data-lo-que-suma]')).toContain('lg:flex')
    expect(rejilla()).toContain('lg:grid-cols-[260px_minmax(0,1fr)]')
    expect(encabezado().querySelector('[data-panel-suma]')).toBeNull()
    expect(encabezado().querySelector('[data-pastilla-suma]')!.getAttribute('class')!.split(/\s+/)).toContain('hidden')
    expect(encabezado().querySelector('[data-pastilla-suma]')!.getAttribute('class')).not.toContain('lg:block')
  })

  it('al volver, lo guardado manda sobre el ancho', async () => {
    localStorage.setItem(CLAVE, 'cerrada')
    await montar()
    expect(clases('[data-lo-que-suma]').filter(c => c.endsWith(':flex'))).toEqual([])
    localStorage.setItem(CLAVE, 'abierta')
    act(() => root?.unmount())
    root = createRoot(contenedor)
    await montar()
    expect(clases('[data-lo-que-suma]')).toContain('lg:flex')
  })

  it('si el almacenamiento no se puede leer ni escribir, manda el ancho y nada se rompe', async () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    await montar()
    expect(clases('[data-lo-que-suma]')).toContain('min-[1500px]:flex')
    await clic(q('[data-ocultar-suma]'))
    expect(clases('[data-lo-que-suma]').filter(c => c.endsWith(':flex'))).toEqual([])
  })
})

describe('Celular', () => {
  it('sigue la barra de abajo con el total, y la pastilla no se ve por debajo de 1024 px', async () => {
    await montar()
    const barra = q('[data-barra-suma]')!
    expect(barra.getAttribute('class')!.split(/\s+/)).toContain('lg:hidden')
    expect(barra.textContent).toContain(q('[data-total-suma] b')!.textContent)
    expect(encabezado().querySelector('[data-pastilla-suma]')!.getAttribute('class')!.split(/\s+/)[0]).not.toBe('lg:block')
    expect(encabezado().querySelector('[data-pastilla-suma]')!.getAttribute('class')!.split(/\s+/)).toContain('hidden')
  })
})
