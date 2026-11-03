import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * Prueba corta en navegador del #1352 (2026-10-29, Trappvel, bloqueo con tres paquetes), defecto D1:
 * «Ir» desde «Impide enviar · Falta la comisión…» volvía al Paso 1 con la tarjeta cerrada y el foco
 * en BODY. Aquí se monta la vista por pasos DE VERDAD en el Paso 3: el clic cambia de paso, el Paso 1
 * se monta con el servicio plegado y la tarjeta del paquete nace cerrada. Nada se simula ya montado.
 */

const ventana = new Window({ url: 'https://agencia.metrikone.co/negocios/n/cotizacion/c' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'FocusEvent', 'MutationObserver', 'KeyboardEvent', 'FileReader', 'CustomEvent', 'requestAnimationFrame'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })
Object.defineProperty(globalThis, 'scrollTo', { configurable: true, writable: true, value: () => {} })
for (const k of ['addEventListener', 'removeEventListener', 'dispatchEvent'] as const) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never as Record<string, (...a: unknown[]) => unknown>)[k].bind(ventana) })
}

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {}, dismiss: () => {} }) }))
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
let Tarjeta: typeof import('./por-pasos/paquete-bloqueo').TarjetaPaqueteBloqueo
let paqueteVacio: typeof import('@/lib/cotizaciones/bloqueo-paquete').paqueteVacio
let tarjetaDeOpcionEn: typeof import('@/lib/cotizaciones/enfocar-comision').tarjetaDeOpcionEn
let caso: typeof import('../../../../test/caso-san-andres')

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  VistaPorPasos = (await import('./por-pasos/vista-por-pasos')).default
  Tarjeta = (await import('./por-pasos/paquete-bloqueo')).TarjetaPaqueteBloqueo
  paqueteVacio = (await import('@/lib/cotizaciones/bloqueo-paquete')).paqueteVacio
  tarjetaDeOpcionEn = (await import('@/lib/cotizaciones/enfocar-comision')).tarjetaDeOpcionEn
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

/** La opción que hace de paquete: una del caso fijo, dentro de su servicio (plegado al llegar). */
const PAQUETE = 'h-posada'

function tarifaDelPaquete(tipo: 'publica' | 'neta') {
  const p = paqueteVacio('Operador Ficticio')
  p.hotel.hotel = 'Hotel Coral QA'
  p.hotel.precios = [{ acomodacion: 'doble', precioPorPersona: 2_150_000 }]
  p.distribucion = { habitaciones: { doble: 1 }, ninos: 0, infantes: 0, edadesNinos: [] }
  return { bloqueo: p, ...(tipo === 'publica' ? { tipoTarifa: { tipo: 'publica', origen: 'persona', por: null, en: '' } } : {}) }
}

/** Como el editor: abre la opción y la trae a la vista, la línea o el paquete (`data-item-id`). */
const scrolls: string[] = []
function onAbrirOpcion(itemId: string) {
  let n = 0
  const buscar = () => {
    const el = tarjetaDeOpcionEn(document, itemId)
    if (el) { scrolls.push(itemId); return }
    if (++n < 20) setTimeout(buscar, 10)
  }
  setTimeout(buscar, 0)
}

function props(tipo: 'publica' | 'neta') {
  const filas = caso.LINEAS_CASO_FIJO.map(l => ({ ...structuredClone(l.item), rubros: [structuredClone(l.rubro)] }))
  const listaUnica = {
    impide: [{ clave: 'comision-publica', texto: 'Falta la comisión de la agencia en «Hotel Coral QA»: es tarifa Pública.', ir: { a: 'opcion', itemId: PAQUETE, campo: 'comision' } }],
    revisar: [] as never[],
  }
  return {
    cotizacionId: caso.COT_SAN_ANDRES, editable: true, enviada: false, filas: filas as never, adicionalesPorItem: {},
    tarifasDelServidor: caso.TARIFAS_CASO_FIJO.map(t => ({ id: t.fila.id as string, nombre: t.fila.nombre as string, orden: t.fila.orden as number, vaEnPropuesta: t.fila.va_en_propuesta as boolean, seleccion: t.seleccion })),
    params: { administrativosPct: 0, margenPct: 15, descuentoComercialPct: 0, convencionMargen: 'sobre_venta' as const },
    margenPct: 15, umbrales: { pisoPct: 5, avisoPct: 10 }, composicionViaje: caso.COMPOSICION, fechasViaje: caso.FECHAS,
    destinoViaje: caso.DESTINO, salida: null, pedido: null, texto: 'ok' as const, pantallazosPorAceptar: 0, leyendo: 0,
    pasoInicial: 3 as const, motivoBotonEnviar: null,
    conteoLista: { rojos: 1, ambar: 0 },
    bandeja: null, agregarSinPantallazo: null,
    // La tarjeta del paquete, la real, para la opción que hace de paquete.
    tarjetaDeOpcion: (id: string) => id === PAQUETE
      ? React.createElement(Tarjeta, {
        cotizacionId: caso.COT_SAN_ANDRES, itemId: PAQUETE, tarifaPax: tarifaDelPaquete(tipo), precioVenta: 4_300_000, editable: true,
        operador: 'Operador Ficticio', pasajeros: null, vueloSugerido: null, onCambio: () => {}, onEliminar: () => {}, registro: null, margenAplicado: 0,
      })
      : null,
    revisarLista: null, listaUnica, revisarDocumento: null, verElCalculo: null, rastro: null,
    onDescargar: () => {}, onAceptarTodos: () => {}, onPegar: () => {}, onAbrirOpcion, onRecibirEnBandeja: () => {}, refrescar: () => {},
  }
}

const esperar = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })

describe('D1 · «Ir» desde «Falta la comisión» lleva a la casilla (cambio de paso real)', () => {
  for (const tipo of ['publica', 'neta'] as const) {
    it(`paquete ${tipo === 'publica' ? 'Público' : 'guardado como Neto'}: Paso 1, servicio y tarjeta abiertos, Pública, foco en la comisión`, async () => {
      scrolls.length = 0
      await act(async () => { root!.render(React.createElement(VistaPorPasos, props(tipo) as never)) })
      // En el Paso 3 la tarjeta no existe: se monta con el cambio de paso.
      expect(contenedor.querySelector('[data-paso-revisar]')).not.toBeNull()
      expect(contenedor.querySelector(`[data-item-id="${PAQUETE}"]`)).toBeNull()

      const ir = contenedor.querySelector('[data-grupo-impide] button[data-ir="opcion"]') as HTMLButtonElement
      expect(ir).not.toBeNull()
      await act(async () => { ir.click() })
      // Lo que tarda el reintento (cada 150 ms): hasta 3 s.
      for (let i = 0; i < 20 && !(document.activeElement as Element | null)?.closest?.('[data-comision-publica]'); i++) await esperar(160)

      expect(contenedor.querySelector('[data-paso-armar]')).not.toBeNull()
      const tarjeta = contenedor.querySelector(`[data-item-id="${PAQUETE}"]`)
      expect(tarjeta, 'la tarjeta del paquete no se montó: el servicio quedó plegado').not.toBeNull()
      const publica = tarjeta!.querySelector(`input[type="radio"][name="comision-${PAQUETE}"]`) as HTMLInputElement
      expect(publica.checked).toBe(true)
      const casilla = tarjeta!.querySelector('[data-comision-publica] input') as HTMLInputElement
      expect(casilla).not.toBeNull()
      expect(document.activeElement).toBe(casilla)
      // Y la opción se trajo a la vista: el paquete se encuentra por `data-item-id`.
      expect(scrolls).toContain(PAQUETE)
    }, 10_000)
  }
})
