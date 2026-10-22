import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * La hoja de tarifas del proveedor con React de verdad (briefs del 2026-10-21):
 *
 *   · «Usar tarifa de proveedor» (línea nueva): busco el proveedor → la tarifa viene marcada →
 *     «Usar · $total». Tres toques desde la cotización: abrir, el proveedor, Usar.
 *   · «Cambiar el costo»: la fila de hoy se señala («La que usas hoy») y no viene marcada; marcar
 *     otra REEMPLAZA la del mismo pasajero (nunca dos marcadas) y el pie dice el costo de hoy y el
 *     nuevo.
 *
 * Datos ficticios: un operador inventado con dos tours por persona y un hotel con dos habitaciones.
 */

const ventana = new Window({ url: 'https://agencia.metrikone.co/negocios/n/cotizacion/c' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver', 'KeyboardEvent'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })

const llamadas = vi.hoisted(() => ({ elegir: [] as unknown[][], crear: [] as unknown[][], buscar: [] as unknown[][], vistaNueva: null as unknown }))
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }))
vi.mock('@/app/(app)/negocios/tarifas-proveedor-actions', () => ({
  buscarFichasParaLinea: async () => ({ ok: true, fichas: [] }),
  buscarProveedoresParaCotizacion: async (...args: unknown[]) => {
    llamadas.buscar.push(args)
    return {
      ok: true,
      fichas: [
        { id: 'p1', nombre: 'Operador Ficticio', ciudad: 'Cartagena', tipoProveedor: 'operador', cubre: true, vigencia: { desde: '2027-01-01', hasta: '2027-12-31' }, porRevisar: false },
        { id: 'p2', nombre: 'Hotel Ficticio Vencido', ciudad: 'Cartagena', tipoProveedor: 'hotel', cubre: false, vigencia: { desde: '2026-01-01', hasta: '2026-12-31' }, porRevisar: false },
      ],
    }
  },
  crearLineaConTarifa: async (...args: unknown[]) => {
    llamadas.crear.push(args)
    return { ok: true, itemId: 'nuevo-1', donde: 'Actividad en Cartagena · Opción 1', confirmada: true, pendiente: null, moneda: 'COP', total: 210000, aPagarAgencia: null }
  },
  elegirTarifasDeLinea: async (...args: unknown[]) => {
    llamadas.elegir.push(args)
    return { ok: true, confirmada: true, pendiente: null, moneda: 'COP', total: 0, aPagarAgencia: null }
  },
  fijarProveedorDeLinea: async () => ({ ok: true }),
  tarifasDeLinea: async () => ({ ok: false, error: 'no en la prueba' }),
  tarifasParaLineaNueva: async () => ({ ok: true, ...(llamadas.vistaNueva as object) }),
}))

type ReactMod = typeof import('react')
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let act: typeof import('react').act
let mod: typeof import('./tarifas-proveedor-linea')
let vista: import('./tarifas-proveedor-actions').TarifasDeLinea

const TOURS = {
  temporadas: [{ id: 'A', nombre: 'Alta', rangos: [{ desde: '2027-11-01', hasta: '2027-11-30' }] }],
  tarifas: [
    { moneda: 'COP', establecimiento: null, archivo: 'Tarifas Ficticias 2027.pdf', fuente: { pagina: 2 }, categoria: 'Tour Ficticio de Bahía', temporada_id: 'A', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 105000 },
    { moneda: 'COP', establecimiento: null, archivo: 'Tarifas Ficticias 2027.pdf', fuente: { pagina: 2 }, categoria: 'Tour Ficticio de Islas', temporada_id: 'A', base_precio: 'por_persona', tipo_pasajero: 'adulto', precio: 150000 },
  ],
}
const COMPOSICION = { adultos: 2, ninos: 0, infantes: 0 }
/** La línea hoy: la fila 1 (Bahía) para los 2 adultos, confirmada en $210.000. */
const ELEGIDA_BAHIA = {
  extraccion_id: 'x', proveedor_id: 'p1', tarifario_de_id: null,
  filas: [{ indice_fila: 0, cantidad: 2, noches: null, tipo: 'adulto' as const }],
  noPagan: [], canal: 'neta' as const, comision_pct: null, iva_incluido: false, iva_pct: 19, moneda: 'COP',
  archivo: 'Tarifas Ficticias 2027.pdf', leidaEn: 't', por: 'Ana Ficticia', porId: null,
}

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  mod = await import('./tarifas-proveedor-linea')
  const { tarifasParaCotizar } = await import('@/lib/proveedores/tarifas-extraidas')
  const { ajustesPorDefecto, ofrecerTarifas } = await import('@/lib/proveedores/oferta-tarifas')
  const u = tarifasParaCotizar({ estado: 'revisada', vigenciaDesde: '2027-01-01', vigenciaHasta: '2027-12-31', tarifario: TOURS, monedas: null }, null)
  if (!u.ok) throw new Error(u.motivo)
  const o = ofrecerTarifas({ usables: u.tarifas, tarifario: TOURS, composicion: COMPOSICION, entrada: '2027-11-15', salida: null })
  vista = {
    editable: true,
    proveedor: { id: 'p1', nombre: 'Operador Ficticio', ciudad: 'Cartagena', enlace: '/proveedores/p1', por: 'linea' },
    motivo: null, aviso: null, nuevaPorRevisar: false,
    opciones: o.opciones, avisos: o.avisos, calendario: o.calendario,
    fechas: { entrada: '2027-11-15', salida: null, deLaLinea: true },
    composicion: COMPOSICION,
    ajustes: ajustesPorDefecto({ ficha: { tarifaCanal: null, ivaIncluido: null }, tarifario: { ...TOURS, canal: 'neta' } }),
    ivaDeclarado: false,
    elegida: ELEGIDA_BAHIA,
    conHabitaciones: false,
  }
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
beforeEach(() => {
  llamadas.elegir.length = 0
  llamadas.crear.length = 0
  llamadas.buscar.length = 0
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  contenedor.remove()
})

const asentar = async () => { await act(async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)) }) }
const texto = () => (contenedor.textContent ?? '').replace(/\s+/g, ' ')
const casilla = (i: number) => contenedor.querySelector<HTMLInputElement>(`[data-opcion-tarifa="${i}"] input[type="checkbox"]`)!
const marcadas = () => [...contenedor.querySelectorAll<HTMLInputElement>('[data-opciones-tarifa] input[type="checkbox"]')].filter(c => c.checked).length
const usar = () => contenedor.querySelector<HTMLButtonElement>('[data-usar-tarifa]')!

async function montarLinea(costoActual: number | null, v = vista) {
  await act(async () => {
    root!.render(React.createElement(mod.default, { itemId: 'i1', onCambio: () => {}, inicial: v, costoActual }))
  })
}

describe('«Usar tarifa de proveedor»: la línea nace con la tarifa en cuatro toques', () => {
  it('abrir → el proveedor (dos tours distintos: nada marcado) → la tarifa → «Usar · $210.000»', async () => {
    llamadas.vistaNueva = { ...vista, elegida: null, tipoNueva: 'actividad' }
    let creada: string | null = null
    await act(async () => {
      root!.render(React.createElement(mod.UsarTarifaDeProveedor, { cotizacionId: 'c1', onCreada: (id: string) => { creada = id } }))
    })
    let toques = 0
    // 1 · abrir la hoja: el buscador enfocado lista los proveedores citables.
    await act(async () => { contenedor.querySelector<HTMLButtonElement>('[data-usar-tarifa-proveedor]')!.click() })
    toques++
    await asentar()
    expect(document.activeElement?.getAttribute('data-buscar-proveedor')).not.toBeNull()
    expect(llamadas.buscar).toHaveLength(1)
    expect(contenedor.querySelector('[data-ficha="p1"]')).not.toBeNull()
    // La revisada vencida para el viaje sale en gris con «pide el tarifario nuevo», sin botón.
    const vencida = contenedor.querySelector('[data-ficha-vencida="p2"]')
    expect(vencida?.textContent).toContain('pide el tarifario nuevo')
    expect(vencida?.querySelector('button')).toBeNull()
    // 2 · el proveedor: dos tours DISTINTOS. ONE no elige por precio (prueba del #1229, punto 1):
    // nada marcado, el pie sin total, y se pide elegir.
    await act(async () => { contenedor.querySelector<HTMLButtonElement>('[data-ficha="p1"]')!.click() })
    toques++
    await asentar()
    expect(marcadas()).toBe(0)
    expect(contenedor.querySelector('[data-preseleccion="varios_servicios"]')?.textContent).toContain('2 servicios distintos')
    expect(usar().textContent).toBe('Elige una tarifa')
    expect(usar().textContent).not.toContain('$')
    // 3 · la tarifa.
    await act(async () => { casilla(0).click() })
    toques++
    expect(usar().textContent).toContain('Usar · $210.000')
    // 4 · Usar.
    await act(async () => { usar().click() })
    toques++
    await asentar()
    expect(toques).toBe(4)
    expect(llamadas.crear).toHaveLength(1)
    const [cotizacionId, proveedorId, eleccion, , tasa, opciones] = llamadas.crear[0] as [string, string, { filas: { indice: number; cantidad: number }[] }, unknown, number | null, { idAceptacion: string; medida: { segundos: number } }]
    expect([cotizacionId, proveedorId, tasa]).toEqual(['c1', 'p1', null])
    expect(eleccion.filas).toEqual([{ indice: 0, cantidad: 2, noches: null, tipo: 'adulto' }])
    expect(opciones.idAceptacion).toMatch(/^tarifa-/)
    expect(opciones.medida.segundos).toBeGreaterThanOrEqual(0)
    expect(creada).toBe('nuevo-1')
    expect(contenedor.querySelector('[data-hoja-tarifas]')).toBeNull()
  })

  it('cambiar la marcada por otra tarifa es un toque: reemplaza, nunca suma', async () => {
    llamadas.vistaNueva = { ...vista, elegida: null, tipoNueva: 'actividad' }
    await act(async () => {
      root!.render(React.createElement(mod.UsarTarifaDeProveedor, { cotizacionId: 'c1', onCreada: () => {} }))
    })
    await act(async () => { contenedor.querySelector<HTMLButtonElement>('[data-usar-tarifa-proveedor]')!.click() })
    await asentar()
    await act(async () => { contenedor.querySelector<HTMLButtonElement>('[data-ficha="p1"]')!.click() })
    await asentar()
    await act(async () => { casilla(0).click() })
    await act(async () => { casilla(1).click() })
    expect(marcadas()).toBe(1)
    expect(casilla(1).checked).toBe(true)
    expect(contenedor.querySelector('[data-error-calculo]')).toBeNull()
    expect(usar().textContent).toContain('Usar · $300.000')
  })
})

describe('«Cambiar el costo»: el mismo panel', () => {
  it('la fila de hoy viene señalada, no marcada', async () => {
    await montarLinea(210000)
    expect(contenedor.querySelector('[data-opcion-tarifa="0"] [data-tarifa-actual]')?.textContent).toBe('La que usas hoy')
    expect(contenedor.querySelector('[data-opcion-tarifa="1"] [data-tarifa-actual]')).toBeNull()
    expect(marcadas()).toBe(0)
    expect(usar().disabled).toBe(true)
    expect(usar().textContent).toContain('Elige una tarifa')
  })

  it('elegir otra deja UNA marcada, sin aviso de pax de más, con el costo de hoy y el nuevo, y el botón la usa', async () => {
    await montarLinea(210000)
    await act(async () => { casilla(1).click() })
    expect(marcadas()).toBe(1)
    expect(casilla(1).checked).toBe(true)
    expect(contenedor.querySelector('[data-error-calculo]')).toBeNull()
    expect(texto()).not.toContain('quita una')
    const comparacion = contenedor.querySelector('[data-costo-actual-y-nuevo]')?.textContent?.replace(/\s+/g, ' ') ?? ''
    expect(comparacion).toContain('Costo actual de la línea: $210.000')
    expect(comparacion).toContain('$300.000')
    expect(comparacion).toContain('Nada cambia hasta que toques el botón.')
    expect(usar().textContent).toContain('Usar y reemplazar · $300.000')
    expect(usar().disabled).toBe(false)
    await act(async () => { usar().click() })
    await asentar()
    expect(llamadas.elegir).toHaveLength(1)
    const eleccion = llamadas.elegir[0][1] as { filas: { indice: number }[] }
    expect(eleccion.filas.map(f => f.indice)).toEqual([1])
  })

  it('marcar una y luego otra: sigue habiendo UNA marcada (nunca dos para el mismo pasajero)', async () => {
    await montarLinea(210000)
    await act(async () => { casilla(0).click() })
    await act(async () => { casilla(1).click() })
    expect(marcadas()).toBe(1)
    expect(casilla(1).checked).toBe(true)
    await act(async () => { casilla(0).click() })
    expect(marcadas()).toBe(1)
    expect(casilla(0).checked).toBe(true)
    expect(contenedor.querySelector('[data-error-calculo]')).toBeNull()
  })

  it('sin costo confirmado (faltó la tasa), la elección de antes sí vuelve marcada', async () => {
    await montarLinea(null)
    expect(casilla(0).checked).toBe(true)
    expect(contenedor.querySelector('[data-tarifa-actual]')).toBeNull()
  })

  it('el texto de dónde salió el costo va arriba de las tarifas, en el mismo y único scroll de la hoja', async () => {
    await montarLinea(210000)
    const origen = contenedor.querySelector('[data-tarifa-elegida]')!
    const lista = contenedor.querySelector('[data-opciones-tarifa]')!
    expect(contenedor.querySelectorAll('.overflow-y-auto')).toHaveLength(1)
    expect(origen.compareDocumentPosition(lista) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
