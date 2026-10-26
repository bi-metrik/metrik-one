import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * C4 · LA PANTALLA POR PASOS montada con React de verdad sobre happy-dom (mismo registro que
 * `pasos-cotizacion-dom.test.ts`), con el caso fijo de San Andrés y las acciones del servidor
 * simuladas. Lo que se mide aquí es la PANTALLA:
 *
 *  · V3 · cambiar la opción de una tarifa cambia su total en el acto, ANTES de que el servidor
 *    conteste (no pide nada para pintar).
 *  · D1 · la acción deja «Deshacer (8)», y «Deshacer» manda la reversión condicionada.
 *  · D3 · solo «Enviar al cliente» pide confirmación, con el monto.
 *  · P2 · «Lo que suma» y la barra de envío dicen la misma cifra.
 *  · N12 · en el «⋯» de cada tarifa siguen Renombrar, Por qué esta combinación y Eliminar; y
 *    «Ver el cálculo» trae la cascada.
 *  · El orden del viaje: Vuelos, Providencia, San Andrés.
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

const servidor = vi.hoisted(() => ({
  elegir: vi.fn(),
  deshacer: vi.fn(),
  enviar: vi.fn(),
  mandar: vi.fn(),
  margen: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }))
vi.mock('@/app/(app)/negocios/por-pasos-actions', () => ({
  elegirOpcionEnTarifa: servidor.elegir,
  deshacerPorPasos: servidor.deshacer,
  enviarPorPasos: servidor.enviar,
  mandarTarifa: servidor.mandar,
  margenPorPasos: servidor.margen,
  estadoDeServicioPorPasos: vi.fn(),
  juntarServicioPorPasos: vi.fn(),
  moverOpcionPorPasos: vi.fn(),
  separarOpcionPorPasos: vi.fn(),
  agregarOpcionPorPasos: vi.fn(),
  pedirAutorizacionPorPasos: vi.fn(),
  retirarAutorizacionPorPasos: vi.fn(),
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
  for (const f of Object.values(servidor)) f.mockReset()
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  contenedor.remove()
})

const asentar = async () => { await act(async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)) }) }
const clic = async (el: Element | null | undefined) => {
  expect(el, 'no está en la pantalla').toBeTruthy()
  await act(async () => { (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await asentar()
}
const texto = (sel: string) => contenedor.querySelector(sel)?.textContent ?? ''
const botonCon = (t: string) => [...contenedor.querySelectorAll('button')].find(b => b.textContent?.includes(t)) ?? null

function props(paso: 1 | 2 | 3 = 1) {
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
    pantallazosPorAceptar: 0,
    leyendo: 0,
    pasoInicial: paso,
    motivoBotonEnviar: null,
    conteoLista: { rojos: 0, ambar: 0 },
    bandeja: React.createElement('div', { 'data-bandeja': '' }, 'BANDEJA'),
    agregarSinPantallazo: null,
    tarjetaDeOpcion: (id: string) => React.createElement('div', { 'data-opcion-stub': id }, id),
    revisarLista: React.createElement('p', null, 'LISTA'),
    revisarDocumento: React.createElement('p', null, 'DOCUMENTO'),
    verElCalculo: React.createElement('div', { 'data-cascada': '' }, 'CASCADA'),
    rastro: null,
    onDescargar: () => {},
    onAceptarTodos: () => {},
    onPegar: () => {},
    onAbrirOpcion: () => {},
    onRecibirEnBandeja: () => {},
    refrescar: () => {},
  }
}

async function montar(paso: 1 | 2 | 3 = 1) {
  await act(async () => { root!.render(React.createElement(VistaPorPasos, props(paso))) })
  await asentar()
}

describe('C4 · paso 1: el viaje en orden', () => {
  it('Vuelos, luego Providencia y San Andrés; cada servicio con su estado bajo el precio', async () => {
    await montar(1)
    const tramos = [...contenedor.querySelectorAll('[data-tramo] h4')].map(h => h.textContent)
    expect(tramos).toEqual(['Vuelos', 'Providencia', 'San Andrés'])
    expect(contenedor.querySelectorAll('[data-servicio]')).toHaveLength(8)
    expect(contenedor.querySelectorAll('[data-estado-select]')).toHaveLength(8)
    // Un vuelo o un hotel no ofrece «Opcional».
    const vuelo = contenedor.querySelector('[data-servicio="vuelo: Vuelo Bogotá ⇄ San Andrés"] [data-estado-select]')!
    expect([...vuelo.querySelectorAll('option')].map(o => o.textContent)).toEqual(['Incluido', 'No va'])
    // Abrir un servicio muestra sus opciones (la tarjeta de siempre).
    await clic(contenedor.querySelector('[data-servicio="hotel: Hotel en Providencia"] [role="button"]'))
    expect([...contenedor.querySelectorAll('[data-opcion-stub]')].map(o => o.textContent)).toEqual(['h-posada', 'h-agua-dulce'])
  })
})

describe('C4 · paso 2: Tarifas calculada en el navegador', () => {
  it('V3 · tocar otra opción cambia el total de la tarifa en el acto, antes de que conteste el servidor', async () => {
    servidor.elegir.mockReturnValue(new Promise(() => {})) // el servidor no contesta nunca
    await montar(2)
    await clic(contenedor.querySelector('[data-tab-tarifa="tf-premium"]'))
    const antes = texto('[data-tab-tarifa="tf-premium"] b')
    await clic(contenedor.querySelector('[data-servicio-tarifa="actividad: Cayo Cangrejo"] [data-opcion-tarifa="a-cayo-compartida"]'))
    const despues = texto('[data-tab-tarifa="tf-premium"] b')
    expect(despues).not.toBe(antes)
    expect(servidor.elegir).toHaveBeenCalledWith('tf-premium', 'actividad: Cayo Cangrejo', 'a-cayo-compartida')
    expect(contenedor.querySelector('[data-opcion-tarifa="a-cayo-compartida"]')?.getAttribute('aria-checked')).toBe('true')
  })

  it('D1 · la acción deja «Deshacer (8)», y deshacer manda la reversión condicionada', async () => {
    servidor.elegir.mockResolvedValue({ success: true, anterior: 'a-cayo-privada', valorTotal: 1 })
    servidor.deshacer.mockResolvedValue({ success: true, valorTotal: 1 })
    await montar(2)
    await clic(contenedor.querySelector('[data-tab-tarifa="tf-premium"]'))
    await clic(contenedor.querySelector('[data-opcion-tarifa="a-cayo-compartida"]'))
    const aviso = contenedor.querySelector('[data-aviso-deshacer]')
    expect(aviso?.textContent).toContain('Deshacer (8)')
    await clic(botonCon('Deshacer ('))
    expect(servidor.deshacer).toHaveBeenCalledWith({
      tipo: 'eleccion', cotizacionId: caso.COT_SAN_ANDRES, itinerarioId: 'tf-premium',
      grupo: 'actividad: Cayo Cangrejo', escrita: 'a-cayo-compartida', anterior: 'a-cayo-privada',
    })
  })

  it('la Económica igual a la Recomendada no se manda y lo dice; la Recomendada siempre va', async () => {
    await montar(2)
    expect(texto('[data-tab-tarifa="tf-economica"]')).toContain('no se manda')
    expect(texto('[data-tab-tarifa="tf-recomendada"]')).toContain('siempre se manda')
    await clic(contenedor.querySelector('[data-tab-tarifa="tf-economica"]'))
    expect(texto('[data-total-tarifa]')).toContain('Quedó igual a la Recomendada: no se manda')
  })

  it('N12 · el «⋯» de la tarifa trae Renombrar, Por qué esta combinación y Eliminar; «Ver el cálculo» trae la cascada', async () => {
    await montar(2)
    await clic(contenedor.querySelector('[data-tab-tarifa="tf-premium"]'))
    await clic(contenedor.querySelector('[aria-label="Más de la tarifa Premium"]'))
    const menu = texto('[role="menu"]')
    expect(menu).toContain('Renombrar')
    expect(menu).toContain('Por qué esta combinación')
    expect(menu).toContain('Eliminar esta tarifa')
    expect(contenedor.querySelector('[data-cascada]')).toBeNull()
    await clic(botonCon('Ver el cálculo'))
    expect(contenedor.querySelector('[data-cascada]')).toBeTruthy()
  })

  it('el margen es uno para las tres y dice el margen real de cada tarifa que va', async () => {
    await montar(2)
    expect(texto('[data-margen-unico]')).toContain('uno para las tres tarifas')
    expect(texto('[data-margenes-reales]')).toMatch(/Recomendada .*Premium/)
  })
})

describe('C4 · paso 3 y la misma cifra', () => {
  it('P2 · «Lo que suma» y la barra de envío dicen la misma cifra', async () => {
    await montar(3)
    const suma = texto('[data-total-suma] b')
    const barra = texto('[data-barra-envio] b')
    expect(suma).toBe(barra)
    expect(suma).toMatch(/\$/)
  })

  it('D3 · «Enviar al cliente» pide confirmación con el monto; solo «Sí, enviar» envía', async () => {
    servidor.enviar.mockResolvedValue({ success: true })
    await montar(3)
    await clic(contenedor.querySelector('[data-enviar]'))
    expect(servidor.enviar).not.toHaveBeenCalled()
    const confirma = texto('[data-confirmar-envio]')
    expect(confirma).toContain('¿Enviar al cliente la cotización por')
    expect(confirma).toContain(texto('[data-barra-envio] b'))
    await clic(botonCon('Sí, enviar'))
    expect(servidor.enviar).toHaveBeenCalledWith(caso.COT_SAN_ANDRES)
  })
})

describe('H5 · D2 · deshacer un borrado no pinta una cifra que no existe', () => {
  /** La vista con una tarjeta que se puede eliminar (la de siempre es un stub sin botones). */
  const conEliminar = (base: ReturnType<typeof props>) => ({
    ...base,
    tarjetaDeOpcion: (id: string, pp: { onEliminar: () => void }) =>
      React.createElement('button', { 'data-eliminar-stub': id, onClick: pp.onEliminar }, `Eliminar ${id}`),
  })
  const premium = () => texto('[data-tab-tarifa="tf-premium"] b')

  it('borrar Agua Dulce (escogida en la Premium) y deshacer: la Premium vuelve a su cifra, sin pasar por otra', async () => {
    const borrarMod = await import('@/app/(app)/negocios/por-pasos-borrar-actions')
    vi.mocked(borrarMod.borrarOpcionesPorPasos).mockResolvedValue({
      success: true, devueltas: {}, fotos: [{ item: { id: 'h-agua-dulce', cotizacion_id: caso.COT_SAN_ANDRES } }], marcas: [],
    } as never)
    vi.mocked(borrarMod.reponerOpcionesPorPasos).mockResolvedValue({ success: true, valorTotal: 1 } as never)

    const A = conEliminar(props(1))
    // Lo que trae el servidor después de borrar: sin Agua Dulce, y la Premium con Posada Enilda.
    const B = {
      ...A,
      filas: (A.filas as unknown as { id: string }[]).filter(f => f.id !== 'h-agua-dulce') as never,
      tarifasDelServidor: A.tarifasDelServidor.map(t => (t.id === 'tf-premium' ? { ...t, seleccion: ['h-posada', 'h-lord-pierre', 'a-cayo-privada'] } : t)),
    }
    const pintar = async (pp: typeof A) => {
      await act(async () => { root!.render(React.createElement(VistaPorPasos, pp)) })
      await asentar()
    }
    const irA = async (n: 1 | 2) => clic(contenedor.querySelector(`[data-barra-pasos] [data-paso="${n}"]`))

    await pintar(A)
    await irA(2)
    const antes = premium()
    expect(antes).toMatch(/\$/)
    await irA(1)
    await clic(contenedor.querySelector('[data-servicio="hotel: Hotel en Providencia"] [role="button"]'))
    await clic(contenedor.querySelector('[data-eliminar-stub="h-agua-dulce"]'))
    await pintar(B)
    await clic(botonCon('Deshacer ('))
    expect(borrarMod.reponerOpcionesPorPasos).toHaveBeenCalled()
    // Recién deshecho, con el servidor todavía en B: la Premium ya es la de antes.
    await irA(2)
    expect(premium()).toBe(antes)
    // Llegan las líneas (la vista fresca) antes que las tarifas: sigue siendo la de antes.
    await pintar({ ...B, filas: A.filas })
    expect(premium()).toBe(antes)
    // Y con todo el servidor al día, igual.
    await pintar(A)
    expect(premium()).toBe(antes)
  })
})
