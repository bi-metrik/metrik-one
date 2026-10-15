import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * V2 (re-verificación D de Vera, 2026-10-14) · «Aceptar» UNO: del clic al bloque visible.
 *
 * Vera midió p50 2.066 ms en `trappvel-pruebas`: el bloque esperaba a que el servidor aceptara
 * (1.236 ms) y a que la página se refrescara. La meta es < 1 s. Aquí se monta la forma por pasos
 * con React de verdad (la vista, la bandeja y el estado de las provisionales, cableados como en el
 * editor) y el servidor NO responde hasta que la prueba lo suelta:
 *
 *  · el bloque del servicio nuevo está en la pantalla ANTES de que el servidor conteste, con
 *    «Guardando…» en el precio y sin mover el total;
 *  · cuando el servidor acepta, el bloque se queda hasta que la página trae la opción de verdad, y
 *    entonces queda UNO solo, con su precio;
 *  · D1 · si el servidor falla, el bloque se quita y se dice por qué.
 */

const ventana = new Window({ url: 'https://agencia.metrikone.co/negocios/n/cotizacion/c' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver', 'KeyboardEvent', 'FileReader'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })
Object.defineProperty(globalThis, 'scrollTo', { configurable: true, writable: true, value: () => {} })
for (const k of ['addEventListener', 'removeEventListener'] as const) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: ventana[k].bind(ventana) })
}
Object.defineProperty(globalThis, 'innerHeight', { configurable: true, writable: true, value: 900 })

const avisos = vi.hoisted(() => ({ error: [] as string[] }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }) }))
vi.mock('sonner', () => ({
  toast: Object.assign(() => {}, { success: () => {}, error: (m: string) => { avisos.error.push(m) }, warning: () => {}, dismiss: () => {} }),
}))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({ quitarHabitacion: async () => ({ success: true }) }))
vi.mock('@/app/(app)/negocios/adicional-actions', () => ({}))
vi.mock('@/app/(app)/negocios/ranura-actions', () => ({}))
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
let Bandeja: typeof import('./bandeja-capturas').default
let optimista: typeof import('@/lib/cotizaciones/aceptar-optimista')
let caso: typeof import('../../../../test/caso-san-andres')
let once: typeof import('../../../../test/caso-once-pantallazos')

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  VistaPorPasos = (await import('./por-pasos/vista-por-pasos')).default
  Bandeja = (await import('./bandeja-capturas')).default
  optimista = await import('@/lib/cotizaciones/aceptar-optimista')
  caso = await import('../../../../test/caso-san-andres')
  once = await import('../../../../test/caso-once-pantallazos')
})

/** El servidor de «Aceptar»: no contesta hasta que la prueba lo suelta. */
let soltar: ((r: Response) => void) | null = null
let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null

beforeEach(() => {
  avisos.error.length = 0
  soltar = null
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(res => { soltar = res })))
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  contenedor.remove()
  vi.unstubAllGlobals()
})

const asentar = async () => { await act(async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)) }) }
const texto = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const precios = () => [...contenedor.querySelectorAll('[data-precio-servicio]')].map(e => texto(e))
const total = () => texto(contenedor.querySelector('[data-total-suma] b'))

type Fila = Record<string, unknown>
type Receptor = import('./bandeja-capturas').ReceptorDeBandeja

/** El editor, en lo que toca a V2: las filas de la página, la bandeja y las provisionales. */
function arnes(filasIniciales: Fila[], receptor: { current: Receptor | null }, ponerFilas: { current: ((f: Fila[]) => void) | null }) {
  return function Arnes() {
    const [filas, setFilas] = React.useState(filasIniciales)
    ponerFilas.current = setFilas
    const [provisionales, setProvisionales] = React.useState<import('@/lib/cotizaciones/aceptar-optimista').Provisional[]>([])
    const vivos = React.useRef<import('@/lib/cotizaciones/aceptar-optimista').Provisional[]>([])
    const recibir = (e: import('@/lib/cotizaciones/aceptar-optimista').EventoProvisional) => {
      const r = optimista.aplicarEvento(vivos.current, e, filas as never)
      vivos.current = r.provisionales
      setProvisionales(r.provisionales)
      if (r.aviso) avisos.error.push(r.aviso)
    }
    return React.createElement(VistaPorPasos, {
      cotizacionId: caso.COT_SAN_ANDRES, editable: true, enviada: false, filas: filas as never, adicionalesPorItem: {},
      tarifasDelServidor: caso.TARIFAS_CASO_FIJO.map(t => ({ id: t.fila.id as string, nombre: t.fila.nombre as string, orden: t.fila.orden as number, vaEnPropuesta: t.fila.va_en_propuesta as boolean, seleccion: t.seleccion })),
      params: { administrativosPct: 0, margenPct: 15, descuentoComercialPct: 0, convencionMargen: 'sobre_venta' as const },
      margenPct: 15, umbrales: { pisoPct: 5, avisoPct: 10 }, composicionViaje: caso.COMPOSICION, fechasViaje: caso.FECHAS,
      destinoViaje: caso.DESTINO, salida: null, pedido: null, texto: 'ok' as const, pantallazosPorAceptar: 0, leyendo: 0,
      pasoInicial: 1, motivoBotonEnviar: null, conteoLista: { rojos: 0, ambar: 0 },
      bandeja: React.createElement(Bandeja, {
        cotizacionId: caso.COT_SAN_ANDRES, items: filas as never, composicion: caso.COMPOSICION, porPasos: true, receptor: receptor as never,
        destinoViaje: caso.DESTINO, onProvisional: recibir, onCambio: () => {},
      }),
      agregarSinPantallazo: null,
      tarjetaDeOpcion: (id: string) => React.createElement('div', { 'data-opcion-stub': id }, id),
      revisarLista: null, revisarDocumento: null, verElCalculo: null, rastro: null,
      onDescargar: () => {}, onAceptarTodos: () => {}, onPegar: () => {}, onAbrirOpcion: () => {}, onRecibirEnBandeja: () => {},
      refrescar: () => {}, provisionales,
    })
  }
}

/** El caso fijo SIN el buceo; el buceo entra por la bandeja como servicio nuevo. */
async function montar() {
  const filas = caso.LINEAS_CASO_FIJO
    .map(l => ({ ...structuredClone(l.item), rubros: [structuredClone(l.rubro)] }))
    .filter(f => f.id !== 'a-buceo') as Fila[]
  const receptor = React.createRef<Receptor>()
  const ponerFilas: { current: ((f: Fila[]) => void) | null } = { current: null }
  await act(async () => { root!.render(React.createElement(arnes(filas, receptor, ponerFilas))) })
  const buceo = once.onceDelCasoFijo()[10]
  await act(async () => {
    receptor.current!.recibir({
      clave: 'k-buceo', itemId: 'ninguno',
      lecturas: [{ tipo: buceo.tipo, lecturaJson: JSON.stringify(buceo.lectura), firma: 'firma', pistas: buceo.pistas, imagen: null, huella: null }],
    })
  })
  await asentar()
  const fila = [...contenedor.querySelectorAll('[data-captura]')].find(li => /Buceo/i.test(texto(li)))!
  expect(texto(fila.querySelector('[data-frase-destino]'))).toMatch(/^Suma aparte/)
  const aceptar = [...fila.querySelectorAll('button')].find(b => texto(b) === 'Aceptar')!
  const buceoReal = { ...structuredClone(caso.LINEAS_CASO_FIJO.find(l => l.item.id === 'a-buceo')!.item), rubros: [structuredClone(caso.LINEAS_CASO_FIJO.find(l => l.item.id === 'a-buceo')!.rubro)] }
  return { filas, aceptar, ponerFilas, buceoReal: { ...buceoReal, id: 'item-buceo-nuevo' } as Fila }
}

describe('V2 · aceptar uno: el bloque se pinta antes de que el servidor conteste', () => {
  it('bloque visible en el acto, «Guardando…» y el total quieto; aceptado, un solo bloque con su precio', async () => {
    const { filas, aceptar, ponerFilas, buceoReal } = await montar()
    const antes = precios()
    const totalAntes = total()
    const t0 = performance.now()
    await act(async () => { aceptar.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const ms = performance.now() - t0
    // El servidor todavía no contestó: el bloque ya está.
    expect(soltar).not.toBeNull()
    expect(precios()).toHaveLength(antes.length + 1)
    expect(precios()).toContain('Guardando…')
    const bloque = contenedor.querySelector('[data-provisional]')!
    expect(texto(bloque)).toMatch(/Actividad/)
    expect(texto(bloque)).toMatch(/Buceo/i)
    expect(total()).toBe(totalAntes)
    console.info(`[V2] del clic al bloque visible, en el navegador de prueba: ${ms.toFixed(1)} ms (servidor sin contestar)`)
    expect(ms).toBeLessThan(1000)

    // El servidor acepta: el bloque provisional se queda hasta que la página trae la opción.
    await act(async () => {
      soltar!(new Response(JSON.stringify({ ok: true, itemId: 'item-buceo-nuevo', donde: 'Actividad en San Andrés', pendiente: null, como: 'nueva', bloque: 'Actividad en San Andrés', opcion: null }), { status: 200 }))
    })
    await asentar()
    expect(precios()).toContain('Guardando…')
    // La página se refresca con la opción de verdad: un solo bloque, con precio.
    await act(async () => { ponerFilas.current!([...filas, buceoReal]) })
    await asentar()
    expect(contenedor.querySelector('[data-provisional]')).toBeNull()
    expect(precios()).toHaveLength(antes.length + 1)
    expect(precios()).not.toContain('Guardando…')
    expect(total()).not.toBe(totalAntes)
    expect(avisos.error).toEqual([])
  })

  it('D1 · si el servidor falla, el bloque se quita y se dice por qué', async () => {
    const { aceptar } = await montar()
    const antes = precios()
    await act(async () => { aceptar.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(precios()).toHaveLength(antes.length + 1)
    await act(async () => {
      soltar!(new Response(JSON.stringify({ ok: false, codigo: 'POR_PASOS', mensaje: 'La cotización por pasos no está encendida en este workspace. Recarga la página para ver la de siempre.' }), { status: 200 }))
    })
    await asentar()
    expect(contenedor.querySelector('[data-provisional]')).toBeNull()
    expect(precios()).toEqual(antes)
    expect(avisos.error).toHaveLength(1)
    expect(avisos.error[0]).toMatch(/^Actividad en San Andrés no se guardó: La cotización por pasos no está encendida.*\. Sigue en la bandeja\.$/)
    // La captura sigue en la bandeja, con su «Aceptar».
    const fila = [...contenedor.querySelectorAll('[data-captura]')].find(li => /Buceo/i.test(texto(li)))!
    expect([...fila.querySelectorAll('button')].some(b => texto(b) === 'Aceptar')).toBe(true)
  })
})
