import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * EL PEGADO EN UNA COTIZACIÓN DE BLOQUEO (QA estricto del 2026-10-29), con la bandeja montada en React
 * de verdad sobre happy-dom.
 *
 * Tatiana pegó con Ctrl+V el vuelo sin precio de COT-2026-0007 y la bandeja lo mandó al lector
 * genérico, que lo rechazó (RX4). Aquí:
 *  · con un paquete abierto, el Ctrl+V de la ventana va al paquete (a la casilla vacía) y NO sale
 *    ningún pedido a la lectura genérica;
 *  · sin paquete abierto, la bandeja pregunta «¿A qué paquete va?»;
 *  · «Es paquete de bloqueo» de una fila manda la imagen al paquete, no a la ranura genérica.
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
let Registro: typeof import('@/lib/cotizaciones/bloqueo-pegado').RegistroDePaquetes

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  Bandeja = (await import('./bandeja-capturas')).default
  Registro = (await import('@/lib/cotizaciones/bloqueo-pegado')).RegistroDePaquetes
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
const envios: string[] = []

beforeEach(() => {
  envios.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    envios.push(String(url))
    // La detección genérica no reconoce el pantallazo: la fila ofrece «Es …».
    return new Response(JSON.stringify({ ok: false, codigo: 'SIN_TIPO', mensaje: 'No se reconoce si es un vuelo, un hotel…' }), { status: 200 })
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

/** Ctrl+V de un pantallazo con el foco fuera de toda casilla (en el cuerpo de la página). */
async function pegar() {
  const archivo = new ventana.File([Buffer.from(PNG, 'base64')], 'vuelo.png', { type: 'image/png' })
  const e = new ventana.Event('paste', { bubbles: true, cancelable: true }) as unknown as Event
  Object.defineProperty(e, 'clipboardData', { value: { files: [archivo], items: [{ kind: 'file', type: 'image/png', getAsFile: () => archivo }] } })
  await act(async () => { document.body.dispatchEvent(e as never) })
  await esperar()
}

async function montar(registro: InstanceType<typeof Registro>, extra: { abrir?: (id: string) => void } = {}) {
  await act(async () => {
    root!.render(React.createElement(Bandeja, {
      cotizacionId: 'cot-7', items: [], composicion: { adultos: 2, ninos: 0, infantes: 0 }, porPasos: true,
      bloqueo: {
        registro,
        paquetes: [{ itemId: 'pq-1', titulo: 'Hotel Ficticio Playa' }],
        abrir: extra.abrir ?? (() => {}),
        crearPaquete: async () => ({ ok: true as const, itemId: 'pq-nuevo' }),
      },
    }))
  })
}

describe('pegado global en una cotización de bloqueo', () => {
  it('con el paquete abierto y su hotel ya pegado, el vuelo (sin precio) va a la casilla del VUELO; la lectura genérica no se llama', async () => {
    const registro = new Registro()
    const recibidos: { dataUrl: string; casilla: string | null }[] = []
    registro.registrar('pq-1', {
      estado: () => ({ itemId: 'pq-1', abierto: true, hotelLleno: true, vueloLleno: false }),
      recibir: (dataUrl, casilla) => recibidos.push({ dataUrl, casilla }),
    })
    await montar(registro)
    await pegar()
    expect(recibidos).toHaveLength(1)
    expect(recibidos[0].casilla).toBe('vuelo')
    expect(recibidos[0].dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(envios).toEqual([])
    expect(contenedor.querySelectorAll('[data-captura]')).toHaveLength(0)
  })

  it('sin paquete abierto, pregunta a qué paquete va; al elegirlo, lo abre y se lo entrega', async () => {
    const registro = new Registro()
    const abiertos: string[] = []
    await montar(registro, { abrir: id => abiertos.push(id) })
    await pegar()
    expect(envios).toEqual([])
    const pregunta = contenedor.querySelector('[data-pegado-bloqueo]')
    expect(textoDe(pregunta)).toContain('¿A qué paquete va este pantallazo?')
    await clic(pregunta!.querySelector('[data-ubicar-en="pq-1"]')!)
    expect(abiertos).toEqual(['pq-1'])
    // La tarjeta todavía no estaba montada: lo recibe al montarse, del buzón.
    const recibir = vi.fn()
    registro.registrar('pq-1', { estado: () => ({ itemId: 'pq-1', abierto: true, hotelLleno: false, vueloLleno: false }), recibir })
    expect(recibir).toHaveBeenCalledTimes(1)
    expect(recibir.mock.calls[0][1]).toBeNull()
  })

  it('«Es paquete de bloqueo» de una fila lleva la imagen al paquete, no a la ranura genérica', async () => {
    const registro = new Registro()
    const recibidos: (string | null)[] = []
    await montar(registro)
    await pegar()
    // «Otro servicio»: la lectura de siempre, que no reconoce el pantallazo.
    await clic(contenedor.querySelector('[data-ubicar-otro]')!)
    await esperar(80)
    expect(envios.some(u => u.includes('detectar-captura'))).toBe(true)
    const fila = contenedor.querySelector('[data-captura]')!
    const boton = [...fila.querySelectorAll('button')].find(b => textoDe(b) === 'Es paquete de bloqueo')
    expect(boton).toBeTruthy()
    // Ahora hay un paquete abierto: el botón se lo entrega a él.
    registro.registrar('pq-1', { estado: () => ({ itemId: 'pq-1', abierto: true, hotelLleno: true, vueloLleno: false }), recibir: (_d, c) => recibidos.push(c) })
    const antes = envios.length
    await clic(boton!)
    await esperar()
    expect(recibidos).toEqual(['vuelo'])
    expect(envios.length).toBe(antes)
    expect(envios.some(u => u.includes('leer-captura'))).toBe(false)
  })
})
