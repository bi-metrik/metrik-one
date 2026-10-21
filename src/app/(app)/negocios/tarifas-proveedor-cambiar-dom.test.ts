import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * «Cambiar el costo por una tarifa del proveedor» con React de verdad (brief del 2026-10-21,
 * punto 1). En una línea confirmada que salió de una fila, esa fila venía MARCADA: marcar otra
 * dejaba dos y salía «Viajan 2 adultos y eligiste tarifa para 4: quita una». Ahora la de hoy se
 * señala («La que usas hoy») sin marcarse, y cambiar de tarifa es un clic más el botón.
 *
 * Datos ficticios: un proveedor inventado con dos tours por persona.
 */

const ventana = new Window({ url: 'https://agencia.metrikone.co/negocios/n/cotizacion/c' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver', 'KeyboardEvent'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })

const llamadas = vi.hoisted(() => ({ elegir: [] as unknown[][] }))
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }))
vi.mock('@/app/(app)/negocios/tarifas-proveedor-actions', () => ({
  buscarFichasParaLinea: async () => ({ ok: true, fichas: [] }),
  elegirTarifasDeLinea: async (...args: unknown[]) => {
    llamadas.elegir.push(args)
    return { ok: true, confirmada: true, pendiente: null, moneda: 'COP', total: 0, aPagarAgencia: null }
  },
  fijarProveedorDeLinea: async () => ({ ok: true }),
  tarifasDeLinea: async () => ({ ok: false, error: 'no en la prueba' }),
}))

type ReactMod = typeof import('react')
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let act: typeof import('react').act
let TarifasProveedorLinea: typeof import('./tarifas-proveedor-linea').default
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
  TarifasProveedorLinea = (await import('./tarifas-proveedor-linea')).default
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
    ajustes: ajustesPorDefecto({ ficha: { tarifaCanal: null, ivaIncluido: null }, tarifario: TOURS }),
    ivaDeclarado: false,
    elegida: ELEGIDA_BAHIA,
    conHabitaciones: false,
  }
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
beforeEach(() => {
  llamadas.elegir.length = 0
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  contenedor.remove()
})

const asentar = async () => { await act(async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)) }) }
const texto = () => (contenedor.textContent ?? '').replace(/\s+/g, ' ')
const casilla = (i: number) => contenedor.querySelector<HTMLInputElement>(`[data-opcion-tarifa="${i}"] input[type="checkbox"]`)!
const marcadas = () => [...contenedor.querySelectorAll<HTMLInputElement>('[data-opciones-tarifa] input[type="checkbox"]')].filter(c => c.checked).length

async function montar(costoActual: number | null) {
  await act(async () => {
    root!.render(React.createElement(TarifasProveedorLinea, {
      itemId: 'i1', onCambio: () => {}, inicial: vista, titulo: 'Cambiar el costo por una tarifa del proveedor', costoActual,
    }))
  })
}

describe('cambiar el costo por otra tarifa del proveedor', () => {
  it('la fila de hoy viene señalada, no marcada', async () => {
    await montar(210000)
    expect(contenedor.querySelector('[data-opcion-tarifa="0"] [data-tarifa-actual]')?.textContent).toBe('La que usas hoy')
    expect(contenedor.querySelector('[data-opcion-tarifa="1"] [data-tarifa-actual]')).toBeNull()
    expect(marcadas()).toBe(0)
    expect(contenedor.querySelector('[data-usar-tarifa]')).toBeNull()
  })

  it('elegir otra deja UNA marcada, sin aviso de pax de más, y el botón la usa', async () => {
    await montar(210000)
    await act(async () => { casilla(1).click() })
    expect(marcadas()).toBe(1)
    expect(casilla(1).checked).toBe(true)
    expect(contenedor.querySelector('[data-error-calculo]')).toBeNull()
    expect(texto()).not.toContain('quita una')
    // El costo de hoy y el nuevo, antes de tocar el botón.
    const comparacion = contenedor.querySelector('[data-costo-actual-y-nuevo]')?.textContent?.replace(/\s+/g, ' ') ?? ''
    expect(comparacion).toContain('Costo actual de la línea: $210.000')
    expect(comparacion).toContain('$300.000')
    expect(comparacion).toContain('Nada cambia hasta que toques el botón.')
    const usar = contenedor.querySelector<HTMLButtonElement>('[data-usar-tarifa]')!
    expect(usar.textContent).toContain('Usar esta tarifa y reemplazar el costo')
    expect(usar.disabled).toBe(false)
    await act(async () => { usar.click() })
    await asentar()
    expect(llamadas.elegir).toHaveLength(1)
    const eleccion = llamadas.elegir[0][1] as { filas: { indice: number }[] }
    expect(eleccion.filas.map(f => f.indice)).toEqual([1])
  })

  it('volver a marcar la de hoy también es una sola', async () => {
    await montar(210000)
    await act(async () => { casilla(0).click() })
    expect(marcadas()).toBe(1)
    expect(contenedor.querySelector('[data-error-calculo]')).toBeNull()
  })

  it('sin costo confirmado (faltó la tasa), la elección de antes sí vuelve marcada', async () => {
    await montar(null)
    expect(casilla(0).checked).toBe(true)
    expect(contenedor.querySelector('[data-tarifa-actual]')).toBeNull()
  })

  it('el texto de dónde salió el costo queda fuera de la lista con scroll', async () => {
    await montar(210000)
    const origen = contenedor.querySelector('[data-tarifa-elegida]')!
    const area = contenedor.querySelector('[data-lista-tarifas]')!
    expect(area.className).toContain('overflow-y-auto')
    expect(area.contains(contenedor.querySelector('[data-opciones-tarifa]'))).toBe(true)
    expect(area.contains(origen)).toBe(false)
    expect(origen.compareDocumentPosition(area) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
