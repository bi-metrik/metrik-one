import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * «¿ESE PRECIO ES DE TODOS LOS PASAJEROS O DE UNO SOLO?» EN LA TARJETA DEL PANTALLAZO (Trappvel,
 * 2026-11-06), con la bandeja montada en React de verdad sobre happy-dom.
 *
 * Tatiana pega el vuelo del GDS (sin pasajeros): la fila pregunta con «Es el total» / «Es por
 * persona». Al tocar uno, la fila queda lista con la lectura FIRMADA de esa respuesta y «Aceptar» la
 * manda tal cual. La ruta de lectura (la que llama al modelo) se pide UNA sola vez.
 */

const ventana = new Window({ url: 'https://agencia.metrikone.co/negocios/n/cotizacion/c' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver', 'KeyboardEvent', 'FileReader'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })
for (const k of ['addEventListener', 'removeEventListener'] as const) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: ventana[k].bind(ventana) })
}
Object.defineProperty(globalThis, 'innerHeight', { configurable: true, writable: true, value: 900 })

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }) }))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {}, dismiss: () => {} }) }))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({ quitarHabitacion: async () => ({ success: true }) }))
vi.mock('@/app/(app)/negocios/adicional-actions', () => ({}))
vi.mock('@/app/(app)/negocios/ranura-actions', () => ({}))

type ReactMod = typeof import('react')
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let act: typeof import('react').act
let Bandeja: typeof import('./bandeja-capturas').default
let lp: typeof import('@/lib/cotizaciones/lectura-pantallazo')
let lc: typeof import('@/lib/cotizaciones/lectura-casilla')
let rp: typeof import('@/lib/cotizaciones/ranuras-pantallazo')

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  Bandeja = (await import('./bandeja-capturas')).default
  lp = await import('@/lib/cotizaciones/lectura-pantallazo')
  lc = await import('@/lib/cotizaciones/lectura-casilla')
  rp = await import('@/lib/cotizaciones/ranuras-pantallazo')
})

const COMPOSICION = { adultos: 3, ninos: 0, infantes: 0 }
const PRECIO = 4_666_438
const v = (valor: string | null, confianza = 0.95) => ({ value: valor, confidence: confianza })

/** Lo que devolvería la ruta: la misma lectura del GDS juzgada con cada respuesta (`leer-imagen-captura.ts`). */
function respuestaDeLaRuta() {
  const VUELO = rp.ranuraPorSlug('vuelo_detalle')!
  const cruda = {
    veredicto: 'detalle_unico' as const,
    observacion: null,
    campos: {
      aerolinea: v('AVIANCA'), origen: v('BOG'), destino: v('CTG'), fecha_salida: v('2026-12-12'), fecha_regreso: v('2026-12-18'),
      numero_vuelo: v('AV9590'), escalas: v('0'), pax: v(null, 0), moneda: v('COP'), precio_total: v(String(PRECIO)), base_precio: v(null, 0),
    },
    desglose: [],
  }
  const opciones = ['total', 'por_pax'].map(valor => {
    const r = lp.evaluarLectura(VUELO, cruda, { soloMinimosDeCosto: true, monedaSiFalta: 'COP', basePrecioElegido: valor })
    if (!r.ok) throw new Error(r.motivo)
    const lectura = lc.construirLecturaCasilla(VUELO, r, '2026-11-06T12:00:00Z', COMPOSICION)
    const lecturaJson = JSON.stringify(lectura)
    return { valor, etiqueta: lp.etiquetaDeBasePrecio(valor), lectura, lecturaJson, firma: `firma-${valor}`, alertas: lectura.alertas }
  })
  return {
    ok: false,
    codigo: 'RX2',
    mensaje: 'No se ve si el precio es por persona o de todas las personas. Sube una captura que lo incluya.',
    eleccionBase: { pregunta: lp.preguntaDeBasePrecio(VUELO), opciones },
  }
}

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
const envios: { url: string; cuerpo: Record<string, unknown> }[] = []

beforeEach(() => {
  envios.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const cuerpo = JSON.parse(String(init.body)) as Record<string, unknown>
    envios.push({ url: String(url), cuerpo })
    if (String(url).endsWith('/detectar-captura')) {
      return new Response(JSON.stringify({ ok: true, tipo: 'vuelo', lugar: null, origen: 'BOG', destino: 'CTG' }), { status: 200 })
    }
    if (String(url).endsWith('/leer-captura')) return new Response(JSON.stringify(respuestaDeLaRuta()), { status: 200 })
    return new Response(JSON.stringify({
      ok: true, itemId: 'item-1', donde: 'Vuelo Bogotá → Cartagena · Opción 1', pendiente: null, como: 'nueva', bloque: 'Vuelo Bogotá → Cartagena', opcion: 1,
    }), { status: 200 })
  }))
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

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const esperar = async (ms = 30) => { await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }
const textoDe = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const clic = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const rutas = () => envios.map(e => e.url.split('/').pop())

async function pegar() {
  const archivo = new ventana.File([Buffer.from(PNG, 'base64')], 'gds.png', { type: 'image/png' })
  const e = new ventana.Event('paste', { bubbles: true, cancelable: true }) as unknown as Event
  Object.defineProperty(e, 'clipboardData', { value: { files: [archivo], items: [{ kind: 'file', type: 'image/png', getAsFile: () => archivo }] } })
  await act(async () => { document.body.dispatchEvent(e as never) })
  await esperar(80)
}

async function montar() {
  await act(async () => {
    root!.render(React.createElement(Bandeja, { cotizacionId: 'cot-gds', items: [], composicion: COMPOSICION }))
  })
}

describe('la tarjeta del pantallazo pregunta si el precio es de todos o de uno', () => {
  it('muestra la pregunta con «Es el total» / «Es por persona», no el RX2', async () => {
    await montar()
    await pegar()
    expect(rutas()).toEqual(['detectar-captura', 'leer-captura'])
    const fila = contenedor.querySelector('[data-captura]')!
    expect(textoDe(fila)).toContain('¿Ese precio es de todos los pasajeros o de uno solo?')
    expect(textoDe(fila)).not.toContain('Sube una captura que lo incluya')
    const botones = [...fila.querySelectorAll('[data-elegir-base-precio] button')].map(b => textoDe(b))
    expect(botones).toEqual(['Es el total', 'Es por persona'])
  })

  it('«Es por persona»: la fila queda lista y «Aceptar» manda la lectura firmada de esa respuesta, sin volver a leer', async () => {
    await montar()
    await pegar()
    await clic(contenedor.querySelector('[data-base-precio="por_pax"]')!)
    await esperar()
    expect(rutas()).toEqual(['detectar-captura', 'leer-captura'])
    const fila = contenedor.querySelector('[data-captura]')!
    expect(fila.querySelector('[data-elegir-base-precio]')).toBeNull()
    const aceptar = [...fila.querySelectorAll('button')].find(b => textoDe(b) === 'Aceptar')
    expect(aceptar, textoDe(fila)).toBeDefined()
    await clic(aceptar!)
    await esperar()
    expect(rutas()).toEqual(['detectar-captura', 'leer-captura', 'aceptar-captura'])
    const enviado = envios[2].cuerpo
    expect(enviado.firma).toBe('firma-por_pax')
    const lectura = JSON.parse(String(enviado.lecturaJson)) as { total: number; basePrecioOrigen?: string }
    expect(lectura.total).toBe(PRECIO * 3)
    expect(lectura.basePrecioOrigen).toBe('elegido')
    expect(textoDe(contenedor.querySelector('[data-captura]'))).toContain('Agregada a un bloque nuevo')
  })

  it('«Es el total»: el precio tal cual', async () => {
    await montar()
    await pegar()
    await clic(contenedor.querySelector('[data-base-precio="total"]')!)
    await esperar()
    const aceptar = [...contenedor.querySelectorAll('[data-captura] button')].find(b => textoDe(b) === 'Aceptar')!
    await clic(aceptar)
    await esperar()
    const enviado = envios.find(e => e.url.endsWith('/aceptar-captura'))!.cuerpo
    expect(enviado.firma).toBe('firma-total')
    expect((JSON.parse(String(enviado.lecturaJson)) as { total: number }).total).toBe(PRECIO)
  })
})
