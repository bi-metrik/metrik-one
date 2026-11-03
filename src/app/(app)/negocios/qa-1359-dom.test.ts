import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * Prueba real en navegador del #1359 (2026-10-29, Trappvel, bloqueo con tres paquetes): los puntos de
 * pantalla. Se monta la vista por pasos DE VERDAD en el Paso 2 (Tarifas) con el caso fijo; para el
 * bloqueo, los hoteles del caso pasan a ser paquetes («paquete de bloqueo»). Datos ficticios.
 *
 *  4 · la barra «Sigue» no tapa las pestañas: su alto real queda en `--alto-barra-pasos` y las pestañas
 *      se pegan debajo (antes, un alto fijo de 118 px).
 *  5 · el texto de arriba nombra las tarifas como las pestañas («Opción 2», no «Premium»).
 *  7 · al escoger otro paquete en la Recomendada, la pestaña que lo tenía no muestra su precio viejo.
 */

const ventana = new Window({ url: 'https://agencia.metrikone.co/negocios/n/cotizacion/c' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'FocusEvent', 'MutationObserver', 'KeyboardEvent', 'FileReader', 'CustomEvent', 'requestAnimationFrame', 'ResizeObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })
Object.defineProperty(globalThis, 'scrollTo', { configurable: true, writable: true, value: () => {} })
for (const k of ['addEventListener', 'removeEventListener', 'dispatchEvent'] as const) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never as Record<string, (...a: unknown[]) => unknown>)[k].bind(ventana) })
}

const servidor = vi.hoisted(() => ({ elegir: [] as unknown[][] }))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {}, dismiss: () => {} }) }))
vi.mock('@/app/(app)/negocios/por-pasos-actions', () => ({
  // El servidor no contesta mientras se mira la pantalla: lo que se ve es lo optimista.
  elegirOpcionEnTarifa: vi.fn((...a: unknown[]) => { servidor.elegir.push(a); return new Promise(() => {}) }),
  deshacerPorPasos: vi.fn(), enviarPorPasos: vi.fn(), mandarTarifa: vi.fn(), margenPorPasos: vi.fn(),
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
vi.mock('@/app/(app)/negocios/bloqueo-actions', () => ({
  leerPantallazoBloqueo: async () => ({ ok: false, mensaje: 'x' }),
  crearPaqueteBloqueo: async () => ({ success: true, itemId: 'x' }),
  guardarPaqueteBloqueo: async () => ({ success: true, paquete: null, costo: null, falta: [] }),
  ajustarReglasDelPaquete: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({}))

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
  servidor.elegir.length = 0
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  contenedor.remove()
})

const PAQUETES = ['h-verde-mar', 'h-lord-pierre', 'h-posada']

/**
 * El caso fijo como la vista lo recibe. `bloqueo`: tres hoteles del caso son los tres paquetes, una
 * tarifa por paquete (la primera, la Recomendada; las otras sin nombre: «Opción 2», «Opción 3»).
 */
function props(bloqueo: boolean) {
  const filas = caso.LINEAS_CASO_FIJO.map(l => {
    const f = { ...structuredClone(l.item), rubros: [structuredClone(l.rubro)] } as Record<string, unknown>
    if (bloqueo && PAQUETES.includes(f.id as string)) f.grupo = 'paquete de bloqueo'
    return f
  })
  const tarifas = bloqueo
    ? PAQUETES.map((id, i) => ({ id: `tf-${i + 1}`, nombre: i === 0 ? 'Recomendada' : null, orden: i + 1, vaEnPropuesta: true, seleccion: [id, 'a-cayo-compartida'] }))
    : caso.TARIFAS_CASO_FIJO.map(t => ({ id: t.fila.id as string, nombre: t.fila.nombre as string, orden: t.fila.orden as number, vaEnPropuesta: t.fila.va_en_propuesta as boolean, seleccion: t.seleccion }))
  return {
    cotizacionId: caso.COT_SAN_ANDRES, editable: true, enviada: false, filas: filas as never, adicionalesPorItem: {},
    tarifasDelServidor: tarifas,
    params: { administrativosPct: 0, margenPct: 15, descuentoComercialPct: 0, convencionMargen: 'sobre_venta' as const },
    margenPct: 15, umbrales: { pisoPct: 5, avisoPct: 10 }, composicionViaje: caso.COMPOSICION, fechasViaje: caso.FECHAS,
    destinoViaje: caso.DESTINO, salida: null, pedido: null, texto: 'ok' as const, pantallazosPorAceptar: 0, leyendo: 0,
    pasoInicial: 2 as const, motivoBotonEnviar: null,
    conteoLista: { rojos: 0, ambar: 0 },
    bandeja: null, agregarSinPantallazo: null, tarjetaDeOpcion: () => null,
    revisarLista: null, listaUnica: { impide: [], revisar: [] }, revisarDocumento: null, verElCalculo: null, rastro: null,
    onDescargar: () => {}, onAceptarTodos: () => {}, onPegar: () => {}, onAbrirOpcion: () => {}, onRecibirEnBandeja: () => {}, refrescar: () => {},
  }
}

async function montar(bloqueo: boolean) {
  await act(async () => { root!.render(React.createElement(VistaPorPasos, props(bloqueo) as never)) })
}

const pestanas = () => [...contenedor.querySelectorAll('[role="tablist"][aria-label="Tarifas"] [data-tab-tarifa]')] as HTMLElement[]
const precioDe = (tab: HTMLElement) => tab.querySelector('b')?.textContent ?? ''

describe('QA del #1359 · Tarifas en un bloqueo de tres paquetes', () => {
  it('4 · las pestañas se pegan DEBAJO de la barra «Sigue», con el alto real de la barra', async () => {
    // La barra crece (un «Sigue» largo, el celular): 190 px, no los 118 fijos de antes.
    const original = (globalThis.HTMLElement as unknown as { prototype: HTMLElement }).prototype.getBoundingClientRect
    ;(globalThis.HTMLElement as unknown as { prototype: HTMLElement }).prototype.getBoundingClientRect = function (this: HTMLElement) {
      const r = original.call(this)
      return this.hasAttribute('data-barra-pasos') ? { ...r, height: 190, top: 0, bottom: 190 } as DOMRect : r
    }
    try {
      await montar(true)
    } finally {
      ;(globalThis.HTMLElement as unknown as { prototype: HTMLElement }).prototype.getBoundingClientRect = original
    }
    const vista = contenedor.querySelector('[data-cotizacion-por-pasos]') as HTMLElement
    expect(vista.style.getPropertyValue('--alto-barra-pasos')).toBe('190px')
    const lista = contenedor.querySelector('[data-pestanas-tarifas]') as HTMLElement
    // happy-dom no interpreta `calc(var(…))`: se lee el atributo tal como lo escribe React.
    const estilo = lista.getAttribute('style') ?? ''
    expect(estilo).toMatch(/top:\s*calc\(var\(--alto-barra-pasos, 118px\) \+ 8px\)/)
    expect(lista.className).not.toMatch(/top-\[118px\]/)
  })

  it('5 · el texto nombra las tarifas como las pestañas: «Recomendada, Opción 2 y Opción 3»', async () => {
    await montar(true)
    const nombres = pestanas().map(t => t.querySelector('span')?.textContent?.replace(' · el total', ''))
    expect(nombres).toEqual(['Recomendada', 'Opción 2', 'Opción 3'])
    const texto = contenedor.querySelector('[data-paso-tarifas]')!.textContent ?? ''
    expect(texto).toContain('Recomendada, Opción 2 y Opción 3')
    expect(texto).not.toContain('Económica, Recomendada y Premium')
  })

  it('5 · sin bloqueo, las de siempre siguen diciéndose igual', async () => {
    await montar(false)
    const texto = contenedor.querySelector('[data-paso-tarifas]')!.textContent ?? ''
    expect(texto).toContain('El cliente recibe hasta tres maneras de hacer el mismo viaje: Económica, Recomendada y Premium.')
  })

  it('7 · escoger en la Recomendada el paquete de la Opción 2: la Opción 2 pasa en el acto al que quedó libre', async () => {
    await montar(true)
    const [rec, op2] = pestanas()
    const precioRec = precioDe(rec)
    const precioOp2 = precioDe(op2)
    expect(precioRec).not.toBe(precioOp2)
    const lord = contenedor.querySelector('[data-servicio-tarifa="paquete de bloqueo"] [data-opcion-tarifa="h-lord-pierre"]') as HTMLButtonElement
    expect(lord).not.toBeNull()
    await act(async () => { lord.click() })
    expect(servidor.elegir).toHaveLength(1)
    // El servidor no ha contestado: la pantalla ya muestra lo que va a quedar.
    const [rec2, op2b] = pestanas()
    expect(precioDe(rec2)).toBe(precioOp2)
    // Antes la Opción 2 seguía con Lord Pierre (el precio de la Recomendada nueva) hasta el refresco.
    expect(precioDe(op2b)).toBe(precioRec)
    expect(precioDe(op2b)).not.toBe(precioDe(rec2))
  })
})
