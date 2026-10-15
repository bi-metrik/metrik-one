import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * H7 · D8 (verificación D de Vera, 2026-10-14): la barra de pasos y la lista de Revisar cuentan
 * los rojos con UN solo conteo. La barra decía «2 cosas impiden enviar» con una sola en la lista
 * (y «3» en V7): sumaba la línea sin costo encima de lo que la lista ya contaba.
 */

const ventana = new Window({ url: 'https://agencia.metrikone.co/negocios/n/cotizacion/c' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver', 'KeyboardEvent'] as const
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
  elegirOpcionEnTarifa: vi.fn(), deshacerPorPasos: vi.fn(), enviarPorPasos: vi.fn(), mandarTarifa: vi.fn(), margenPorPasos: vi.fn(),
  estadoDeServicioPorPasos: vi.fn(), juntarServicioPorPasos: vi.fn(), moverOpcionPorPasos: vi.fn(), separarOpcionPorPasos: vi.fn(),
  agregarOpcionPorPasos: vi.fn(), pedirAutorizacionPorPasos: vi.fn(), retirarAutorizacionPorPasos: vi.fn(),
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
let caso: typeof import('../../../../test/caso-san-andres')

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  VistaPorPasos = (await import('./por-pasos/vista-por-pasos')).default
  caso = await import('../../../../test/caso-san-andres')
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
})

/** El caso fijo con el buceo SIN costo: una línea que suma y no tiene costo. */
function props(listaUnica: { impide: { clave: string; texto: string; ir: null }[]; revisar: never[] } | null) {
  const filas = caso.LINEAS_CASO_FIJO.map(l => {
    const f = { ...structuredClone(l.item), rubros: [structuredClone(l.rubro)] } as Record<string, unknown>
    if (f.id === 'a-buceo') return { ...f, subtotal: 0, rubros: [], tarifa_pax: null }
    return f
  })
  return {
    cotizacionId: caso.COT_SAN_ANDRES, editable: true, enviada: false, filas: filas as never, adicionalesPorItem: {},
    tarifasDelServidor: caso.TARIFAS_CASO_FIJO.map(t => ({ id: t.fila.id as string, nombre: t.fila.nombre as string, orden: t.fila.orden as number, vaEnPropuesta: t.fila.va_en_propuesta as boolean, seleccion: t.seleccion })),
    params: { administrativosPct: 0, margenPct: 15, descuentoComercialPct: 0, convencionMargen: 'sobre_venta' as const },
    margenPct: 15, umbrales: { pisoPct: 5, avisoPct: 10 }, composicionViaje: caso.COMPOSICION, fechasViaje: caso.FECHAS,
    destinoViaje: caso.DESTINO, salida: null, pedido: null, texto: 'ok' as const, pantallazosPorAceptar: 0, leyendo: 0,
    pasoInicial: 3 as const, motivoBotonEnviar: null,
    conteoLista: { rojos: listaUnica ? listaUnica.impide.length : 0, ambar: 0 },
    bandeja: null, agregarSinPantallazo: null, tarjetaDeOpcion: () => null, revisarLista: null,
    ...(listaUnica ? { listaUnica } : {}),
    revisarDocumento: null, verElCalculo: null, rastro: null,
    onDescargar: () => {}, onAceptarTodos: () => {}, onPegar: () => {}, onAbrirOpcion: () => {}, onRecibirEnBandeja: () => {}, refrescar: () => {},
  }
}

const textoDelPaso3 = () => contenedor.querySelector('[data-barra-pasos] [data-paso="3"]')?.textContent ?? ''

describe('H7 · D8 · un solo conteo de rojos', () => {
  it('con la lista única, la barra dice tantos rojos como renglones rojos tiene la lista', async () => {
    const lista = { impide: [{ clave: 'falta-costo', texto: 'Falta el costo de Buceo de bautismo.', ir: null }], revisar: [] as never[] }
    await act(async () => { root!.render(React.createElement(VistaPorPasos, props(lista) as never)) })
    expect(textoDelPaso3()).toContain('1 cosa impide enviar')
    // La lista, en el mismo paso, tiene ese mismo renglón rojo.
    expect(contenedor.querySelectorAll('[data-grupo-impide] [data-renglon-lista]')).toHaveLength(1)
  })

  it('sin la lista única (pieza apagada), la barra cuenta como siempre', async () => {
    await act(async () => { root!.render(React.createElement(VistaPorPasos, props(null) as never)) })
    expect(textoDelPaso3()).toContain('1 cosa impide enviar')
  })
})
