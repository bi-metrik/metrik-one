import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * Barrido ámbar (2026-10-22), A2 + A3: el diálogo de «Cerrar negocio» montado con React de verdad.
 *
 *   · A2: en un viaje con IVA sobre el ingreso propio, el «Resumen financiero» muestra el MISMO
 *     margen que el panel de Cierre económico (`calcularCierre` → `pesosCierre(margenReal)`), no
 *     `totalCobrado − costosEjecutados`. Sin `cierreViaje` (SOENA/AFI/Termotech) sigue como hoy.
 *   · A3: copy neutro («Cerrar negocio», sin «proyecto») y la postventa que falta se dice en el
 *     paso 1 y deshabilita seguir; el servidor sigue frenando igual.
 *
 * VISTO FALLAR (2026-10-22), una mutación a la vez:
 *   · el margen de siempre también en viaje → cae «muestra el margen del panel»;
 *   · sin `|| !!faltaPostventa` en «Ver resumen» → cae «la postventa que falta…».
 *
 * Datos inventados.
 */

const ventana = new Window({ url: 'https://viajes.metrikone.co/negocios/n' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })

const completarNegocio = vi.fn(async (..._a: unknown[]) => ({ error: null }))
vi.mock('../negocio-v2-actions', () => ({
  completarNegocio: (...a: unknown[]) => completarNegocio(...a),
  perderNegocio: async () => ({ error: null }),
  cancelarNegocio: async () => ({ error: null }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }))
vi.mock('@/hooks/use-transition-tolerante', () => ({
  useTransitionTolerante: () => [false, (fn: () => Promise<void>) => { void fn() }],
}))

import { calcularCierre, cierreParaCerrar, pesosCierre } from '@/lib/viaje/cierre-viaje'

type ReactMod = typeof import('react')
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let act: typeof import('react').act
let CompletarForm: typeof import('./cierre-negocio-dialog').CompletarForm

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  React = await import('react')
  act = React.act
  createRoot = (await import('react-dom/client')).createRoot
  CompletarForm = (await import('./cierre-negocio-dialog')).CompletarForm
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null

beforeEach(() => {
  completarNegocio.mockClear()
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  contenedor.remove()
})

function boton(texto: string): HTMLButtonElement {
  const b = [...contenedor.querySelectorAll('button')].find((x) => x.textContent?.includes(texto))
  if (!b) throw new Error(`no hay botón «${texto}»`)
  return b as HTMLButtonElement
}

// Un viaje con IVA aparte: cobró $1.840.000, IVA sobre el ingreso propio $45.000, gastos $1.557.729.
const CIERRE = calcularCierre({
  precioAprobado: 1_840_000,
  cobrado: 1_840_000,
  iva: 45_000,
  recargo: 0,
  servicios: [],
  gastos: [{ monto: 1_557_729, servicio_id: null, categoria: 'hotel', descripcion: null }],
})
// Lo que la pantalla de siempre calcula: cobrado − costos ejecutados (sin IVA, con horas).
const RESUMEN = { totalCobrado: 1_840_000, porCobrar: 0, costosEjecutados: 1_557_729 - 20_000 }

async function montar(cierreViaje: ReturnType<typeof cierreParaCerrar> | null) {
  await act(async () => {
    root!.render(React.createElement(CompletarForm, {
      negocioId: 'neg-1',
      resumenFinanciero: RESUMEN,
      precioAprobado: 1_840_000,
      permiteCierreNoFacturable: false,
      cierreViaje,
      onClose: () => {},
    }))
  })
}

async function verResumen() {
  await act(async () => { boton('Ver resumen').click() })
}

const margenDelModal = () => contenedor.querySelector('[data-margen]')?.getAttribute('data-margen') ?? ''

describe('Cerrar negocio · viaje (cierre_viaje activo)', () => {
  it('muestra el margen del panel de Cierre económico, no cobrado − costos ejecutados', async () => {
    await montar(cierreParaCerrar(CIERRE, null))
    await verResumen()
    const delPanel = pesosCierre(CIERRE.margenReal)
    expect(CIERRE.margenReal).toBe(1_840_000 - 45_000 - 1_557_729)
    expect(margenDelModal().startsWith(delPanel)).toBe(true)
    expect(contenedor.textContent).toContain('Margen real')
    expect(contenedor.textContent).toContain('IVA sobre el ingreso propio')
  })

  it('la postventa que falta se dice en el paso 1 y no deja seguir', async () => {
    await montar(cierreParaCerrar(CIERRE, 'Falta la calificación del cliente'))
    expect(contenedor.querySelector('[data-falta-postventa]')?.textContent).toContain('Falta la calificación del cliente')
    expect(boton('Ver resumen').disabled).toBe(true)
  })

  it('copy neutro: «Cerrar negocio», sin «proyecto»', async () => {
    await montar(cierreParaCerrar(CIERRE, null))
    expect(contenedor.textContent).toContain('Cerrar negocio')
    expect(contenedor.innerHTML.toLowerCase()).not.toContain('proyecto')
  })
})

describe('Cerrar negocio · otras líneas (sin cierreViaje)', () => {
  it('el margen sigue siendo cobrado − costos ejecutados', async () => {
    await montar(null)
    expect(contenedor.querySelector('[data-falta-postventa]')).toBeNull()
    expect(boton('Ver resumen').disabled).toBe(false)
    await verResumen()
    const esperado = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
      .format(RESUMEN.totalCobrado - RESUMEN.costosEjecutados)
    expect(margenDelModal()).toBe(`+${esperado}`)
    expect(contenedor.textContent).toContain('Costos ejecutados')
  })
})
