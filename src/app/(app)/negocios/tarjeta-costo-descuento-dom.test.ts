import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * «Ajustar» de una opción con descuento al cliente (Vera sobre el PR #1324, 2026-10-29). La casilla
 * «Margen de esta opción» es el margen ANTES del descuento, el que se guarda; el real va aparte, en
 * texto. Que nadie vea 12, escriba 13 y termine en 10. Las cifras salen de la cascada real del caso
 * ficticio de reglas de margen (hotel al 15 % con 3 de descuento).
 */

const ventana = new Window({ url: 'https://agencia.metrikone.co/negocios/neg-1' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'FocusEvent', 'KeyboardEvent', 'InputEvent', 'MutationObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })

const ajustar = vi.hoisted(() => vi.fn(async () => ({ success: true })))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {} }) }))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({
  ajustarOpcion: ajustar,
  elegirMonedaDeTarifa: async () => ({ success: true }),
  confirmarTarifaPorPasajero: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/adicional-actions', () => ({
  agregarAdicional: async () => ({ success: true }),
  actualizarAdicional: async () => ({ success: true }),
  eliminarAdicional: async () => ({ success: true }),
}))

type ReactMod = typeof import('react')
let React: ReactMod
let act: typeof import('react').act
let createRoot: typeof import('react-dom/client').createRoot
let TarjetaCosto: typeof import('./tarjeta-costo').default
let caso: typeof import('../../../../test/caso-reglas-margen')
let cascada: typeof import('@/lib/cotizaciones/totales')
let reglasMargen: typeof import('@/lib/cotizaciones/reglas-margen')

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  TarjetaCosto = (await import('./tarjeta-costo')).default
  caso = await import('../../../../test/caso-reglas-margen')
  cascada = await import('@/lib/cotizaciones/totales')
  reglasMargen = await import('@/lib/cotizaciones/reglas-margen')
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
beforeEach(() => {
  ajustar.mockClear()
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  act(() => root?.unmount())
  contenedor.remove()
})

const texto = () => (contenedor.textContent ?? '').replace(/\s+/g, ' ')

async function montar() {
  const lineas = caso.lineasDelCaso(3)
  const params = caso.paramsDelCaso()
  const l = cascada.calcularCascada(lineas, reglasMargen.paramsPorOpcion(params)).lineas.find(x => x.id === 'h-rec')!
  const item = lineas.find(x => x.id === 'h-rec')!
  const tarifa = item.tarifa_pax as { descuentoCliente?: never }
  expect(l.margenAplicado).toBeCloseTo(12, 6)
  expect(l.reglas?.descuento?.margenAntes).toBe(15)
  await act(async () => {
    root!.render(React.createElement(TarjetaCosto, {
      itemId: 'h-rec', editable: true, confirmada: null, preciosAMano: undefined,
      precioLinea: l.precioLinea, costoLinea: l.costoLinea, margenAplicado: l.margenAplicado,
      convencion: 'sobre_venta', administrativosPct: 0, pisoPct: 10,
      adicionales: [], adicionalesDisponible: true, margenCotizacion: { margenPct: 15, convencion: 'sobre_venta' },
      moneda: { moneda: 'COP', asumida: false, origen: 'captura', leida: 'COP', decision: null } as never,
      onCambio: () => {}, apilable: true, tipoTarifa: 'neta',
      reglas: { linea: l.reglas!, descuento: tarifa.descuentoCliente ?? null, comisionPct: null },
    }))
  })
  const abrir = [...contenedor.querySelectorAll('button')].find(b => b.textContent === 'Ajustar')!
  await act(async () => { abrir.click() })
  return contenedor.querySelector('input[aria-label="Margen de esta opción"]') as HTMLInputElement
}

describe('«Ajustar» con descuento al cliente', () => {
  it('la casilla muestra el margen ANTES del descuento (15) y el real va aparte (12)', async () => {
    const input = await montar()
    expect(input.value).toBe('15')
    expect(texto()).toContain('Margen real con el descuento: 12 %')
  })

  it('escribir 16 guarda 16 (el de antes) y el real en vivo dice 13: no se resta el descuento dos veces', async () => {
    const input = await montar()
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!
    await act(async () => {
      setter.call(input, '16')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(texto()).toContain('Margen real con el descuento: 13 %')
    await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(ajustar).toHaveBeenCalledWith('h-rec', { margenPct: 16 })
  })

  it('salir sin cambiar no guarda nada (antes, 12 ≠ 15 guardaba 12 y el descuento lo bajaba a 9)', async () => {
    const input = await montar()
    await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!
    await act(async () => {
      setter.call(input, '15')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(ajustar).not.toHaveBeenCalled()
  })
})
