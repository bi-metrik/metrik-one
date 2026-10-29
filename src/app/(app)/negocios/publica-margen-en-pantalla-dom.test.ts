import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * El margen de la tarifa Pública en pantalla (brief del 2026-10-29, seguimiento de #1342). La prueba
 * de Mauricio en `trappvel` (COT-2026-0023, ya borrada), con datos inventados: un hotel Público de
 * $2.000.000 y una actividad Neta de $1.000.000 al 0 %, con la casilla de la cotización en 15 %.
 *
 *  · Falla 1: la fila «Tarifa Neta | Pública · Margen X %» decía «Margen 0 %» con la comisión escrita.
 *  · Falla 2: «Ver el cálculo» decía costo $3.000.000, «Margen general» 15 % y margen real 0,0 %,
 *    con el encabezado en 13,3 %.
 *  · Menor: al pasar la comisión de $ a %, la ayuda seguía diciendo «menos $300.000».
 */

const ventana = new Window({ url: 'https://agencia.metrikone.co/negocios/neg-1' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'FocusEvent', 'KeyboardEvent', 'InputEvent', 'MutationObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }),
}))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {} }) }))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({
  ajustarOpcion: async () => ({ success: true }),
  elegirMonedaDeTarifa: async () => ({ success: true }),
  confirmarTarifaPorPasajero: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/adicional-actions', () => ({
  agregarAdicional: async () => ({ success: true }),
  actualizarAdicional: async () => ({ success: true }),
  eliminarAdicional: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/cotizacion-actions', () => ({
  updateCotizacion: async () => ({ success: true }),
  enviarCotizacion: async () => ({ success: true }),
  duplicarCotizacion: async () => ({ success: true }),
  addItem: async () => ({ success: true }),
  updateItem: async () => ({ success: true }),
  deleteItem: async () => ({ success: true }),
  addRubro: async () => ({ success: true }),
  updateRubro: async () => ({ success: true }),
  deleteRubro: async () => ({ success: true }),
  recalcularTotales: async () => ({ success: true }),
  addItemFromServicio: async () => ({ success: true }),
  aplicarAIU: async () => ({ success: true }),
  getRastroDeMargen: async () => ({ ok: true, entradas: [], alcance: 'negocio' }),
}))
vi.mock('@/app/(app)/config/servicios-actions', () => ({ getServiciosActivos: async () => [] }))
vi.mock('@/app/(app)/negocios/cotizacion-pdf-actions', () => ({
  generateCotizacionPDF: async () => ({ success: true }),
}))

type ReactMod = typeof import('react')
let React: ReactMod
let act: typeof import('react').act
let createRoot: typeof import('react-dom/client').createRoot
let TarjetaCosto: typeof import('./tarjeta-costo').default
let editor: typeof import('./cotizacion-editor')
let CampoComision: typeof import('./por-pasos/reglas-de-opcion').CampoComision
let totales: typeof import('@/lib/cotizaciones/totales')
let reglasMargen: typeof import('@/lib/cotizaciones/reglas-margen')

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  TarjetaCosto = (await import('./tarjeta-costo')).default
  editor = await import('./cotizacion-editor')
  CampoComision = (await import('./por-pasos/reglas-de-opcion')).CampoComision
  totales = await import('@/lib/cotizaciones/totales')
  reglasMargen = await import('@/lib/cotizaciones/reglas-margen')
}, 60_000)

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
beforeEach(() => {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  act(() => root?.unmount())
  contenedor.remove()
})

const texto = () => (contenedor.textContent ?? '').replace(/\s+/g, ' ')
const EN = '2026-10-29T15:00:00.000Z'
type Comision = { tipo: 'pct' | 'monto'; valor: number }

function caso(comision: Comision) {
  const tipoTarifa = {
    tipo: 'publica', origen: 'persona', por: 'Asesora', en: EN,
    ...(comision.tipo === 'pct' ? { comisionPct: comision.valor } : { comisionMonto: comision.valor }),
  }
  const base = { cantidad: 1, numeroDeRubros: 0, margen_porcentaje: null, precio_venta: 0, precio_manual: false }
  const lineas = [
    { ...base, id: 'h-pub', grupo: 'hotel', nombre: 'Hotel Ficticio Arena', subtotal: 2_000_000, tarifa_pax: { tipoTarifa } },
    { ...base, id: 'act', grupo: 'actividad', nombre: 'Paseo ficticio', subtotal: 1_000_000 },
  ]
  const params = {
    administrativosPct: 0, margenPct: 15, descuentoComercialPct: 0, convencionMargen: 'sobre_venta' as const,
    reglas: { politica: reglasMargen.POLITICA_REGLAS_POR_DEFECTO, puntosExtra: 0, descuentos: [] },
  }
  return { lineas, params }
}

async function montarTarjeta(comision: Comision) {
  const { lineas, params } = caso(comision)
  const l = totales.calcularCascada(lineas, reglasMargen.paramsPorOpcion(params)).lineas.find(x => x.id === 'h-pub')!
  await act(async () => {
    root!.render(React.createElement(TarjetaCosto, {
      itemId: 'h-pub', editable: true, confirmada: null, preciosAMano: undefined,
      precioLinea: l.precioLinea, costoLinea: l.costoLinea, margenAplicado: l.margenAplicado,
      convencion: 'sobre_venta', administrativosPct: 0, pisoPct: 10,
      adicionales: [], adicionalesDisponible: true, margenCotizacion: { margenPct: 15, convencion: 'sobre_venta' },
      moneda: { moneda: 'COP', asumida: false, origen: 'captura', leida: 'COP', decision: null } as never,
      onCambio: () => {}, apilable: true, tipoTarifa: 'publica',
      reglas: { linea: l.reglas!, descuento: null },
      comision,
    }))
  })
}

async function montarCalculo(comision: Comision) {
  const { lineas, params } = caso(comision)
  const cascada = totales.calcularCascada(lineas, params)
  await act(async () => {
    root!.render(React.createElement(editor.TotalesMargen, {
      cascada, margenPct: 15, convencionMargen: 'sobre_venta', descuentoPct: 0, editable: true,
      aiuAdminPct: null, aiuImprevPct: null, umbrales: { pisoPct: 12, avisoPct: 15 },
      ofrecerAdministrativos: false,
      onMargenChange: () => {}, onAIUChange: () => {}, onDescuentoChange: () => {},
    }))
  })
  return cascada
}

describe('falla 1 · la fila de la Pública dice su margen real', () => {
  it('con $300.000 de comisión: «Margen 15 %», no 0 %', async () => {
    await montarTarjeta({ tipo: 'monto', valor: 300_000 })
    expect(texto()).toMatch(/Margen 15( ,|,)?0? ?%/)
    expect(texto()).not.toMatch(/Margen 0( ,|,)?0? ?%/)
  })

  it('con 20 %: «Margen 20 %»', async () => {
    await montarTarjeta({ tipo: 'pct', valor: 20 })
    expect(texto()).toMatch(/Margen 20( ,|,)?0? ?%/)
  })
})

describe('falla 2 · «Ver el cálculo» cuadra con el encabezado', () => {
  it('con 20 %: costo $2.600.000 y margen real 13,3 %', async () => {
    const cascada = await montarCalculo({ tipo: 'pct', valor: 20 })
    const t = texto()
    expect(t).toContain('Comisión de tarifas públicas')
    expect(t).toMatch(/Costo de venta.*2\.600\.000/)
    expect(t).toMatch(/Margen real del viaje ?13,3%/)
    expect(t).not.toContain('0,0%')
    // El dinero no cambia: el precio es el de la cascada.
    expect(cascada.precioVenta).toBe(3_000_000)
    expect(t).toMatch(/Precio de venta.*3\.000\.000/)
  })

  it('la casilla de 15 % no se muestra como aplicada: no la toma ninguna línea', async () => {
    await montarCalculo({ tipo: 'pct', valor: 20 })
    const t = texto()
    expect(t).not.toContain('Margen general')
    // Solo queda la casilla del descuento comercial: la del margen no está.
    expect(contenedor.querySelectorAll('input[type="number"]').length).toBe(1)
    const fila = contenedor.querySelector('[data-margen-de-hoteles]')
    expect(fila?.textContent).toContain('no lo toma ninguna opción')
    expect(fila?.textContent).not.toContain('15')
  })
})

describe('menor · la ayuda de la comisión sigue a la casilla', () => {
  it('de $ a %: la casilla queda vacía y la ayuda ya no dice «menos $300.000»', async () => {
    await act(async () => {
      root!.render(React.createElement(CampoComision, {
        comision: { tipo: 'monto', valor: 300_000 }, editable: true, ocupado: false, onComision: () => {},
      }))
    })
    expect(texto()).toContain('300.000')
    const aPct = contenedor.querySelector('[data-comision-tipo="pct"]') as HTMLButtonElement
    await act(async () => { aPct.click() })
    const casilla = contenedor.querySelector('input') as HTMLInputElement
    expect(casilla.value).toBe('')
    expect(texto()).not.toContain('300.000')
    expect(texto()).toContain('Escribe la comisión en %')
  })
})
