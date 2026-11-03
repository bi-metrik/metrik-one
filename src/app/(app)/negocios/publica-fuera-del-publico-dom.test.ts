import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * QA Trappvel del 2026-10-29, G6 · M7: en una tarifa Pública, «Ajustar» dejaba escribir un «Precio
 * c/u» por debajo del público sin aviso (2.200.000 con el público en 2.240.000). Ahora pregunta
 * «¿Estás seguro? …» con la cifra (decisión de Mauricio: valores fuera de lo pactado) y, si la
 * persona dice que no, no guarda. Cifras del viaje 04: Ecohabs, 4 adultos, neto 1.971.200 c/u leído
 * del pantallazo con 12 % de comisión → público 2.240.000 c/u.
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

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  TarjetaCosto = (await import('./tarjeta-costo')).default
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

const confirmar = vi.fn(() => false)
beforeEach(() => {
  confirmar.mockReset()
  Object.defineProperty(globalThis, 'confirm', { configurable: true, writable: true, value: confirmar })
})

async function montar() {
  await act(async () => {
    root!.render(React.createElement(TarjetaCosto, {
      itemId: 'eco', editable: true,
      confirmada: {
        composicion: { adultos: 4, ninos: 0, infantes: 0 },
        costos: [{ tipo: 'adulto', cantidad: 4, unitarioCOP: 1_971_200, totalCOP: 7_884_800 }],
        costoTotalCOP: 7_884_800, moneda: 'COP', tasa: null, confirmadaEn: '2026-10-29T10:00:00Z',
        margenProveedor: { precioCliente: 8_960_000, costoAgencia: 7_884_800, moneda: 'COP', margenPct: 12 },
      },
      preciosAMano: undefined,
      precioLinea: 8_960_000, costoLinea: 7_884_800, margenAplicado: 12,
      convencion: 'sobre_venta', administrativosPct: 0, pisoPct: 10,
      adicionales: [], adicionalesDisponible: true, margenCotizacion: { margenPct: 15, convencion: 'sobre_venta' },
      moneda: { moneda: 'COP', asumida: false, origen: 'captura', leida: 'COP', decision: null } as never,
      onCambio: () => {}, apilable: true, tipoTarifa: 'publica', tipoPropuesto: 'pantallazo',
      comision: { tipo: 'pct', valor: 12 },
    }))
  })
  const abrir = [...contenedor.querySelectorAll('button')].find(b => b.textContent === 'Ajustar')!
  await act(async () => { abrir.click() })
}

async function escribir(input: HTMLInputElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!
  await act(async () => {
    setter.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
}

const precioAdulto = () => contenedor.querySelector('[data-ajuste-fila="adulto"] input[inputmode="numeric"]:not([readonly])') as HTMLInputElement

describe('M7 · «Precio c/u» de una Pública por fuera del público', () => {
  it('la tarjeta dice la comisión leída como margen (12 %) y que la propuso el pantallazo', async () => {
    await montar()
    const t = (contenedor.textContent ?? '').replace(/\s+/g, ' ')
    expect(t).toMatch(/Margen 12( ,|,)?0? ?%/)
    expect(t).toContain('según el pantallazo')
  })

  it('2.200.000 por adulto pregunta «¿Estás seguro?» con la cifra y, si dice que no, no guarda', async () => {
    await montar()
    await escribir(precioAdulto(), '2200000')
    expect(confirmar).toHaveBeenCalledWith(
      '¿Estás seguro? Esto está por fuera de la tarifa pública: el precio por adulto queda en $2.200.000 y la tarifa pública es $2.240.000 ($40.000 menos).',
    )
    expect(ajustar).not.toHaveBeenCalled()
  })

  it('si confirma, guarda el precio escrito', async () => {
    confirmar.mockReturnValue(true)
    await montar()
    await escribir(precioAdulto(), '2200000')
    expect(ajustar).toHaveBeenCalledWith('eco', { precios: { adulto: 2_200_000 } })
  })

  it('el precio público no pregunta nada', async () => {
    await montar()
    await escribir(precioAdulto(), '2240000')
    expect(confirmar).not.toHaveBeenCalled()
    expect(ajustar).toHaveBeenCalledWith('eco', { precios: { adulto: 2_240_000 } })
  })

  it('un margen que sube el precio sobre el público también pregunta', async () => {
    await montar()
    await escribir(contenedor.querySelector('input[aria-label="Margen de esta opción"]') as HTMLInputElement, '17')
    expect(confirmar).toHaveBeenCalledTimes(1)
    expect(String((confirmar.mock.calls[0] as unknown[])[0])).toContain('más)')
    expect(ajustar).not.toHaveBeenCalled()
  })
})
