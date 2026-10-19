import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * El modal de reparto del comercial montado con React de verdad sobre happy-dom.
 *
 * El caso es la ref 389928481 (V0587/V0589, 15-oct): el pago de $2.653.451 se repartió en
 * mitades iguales cuando cada negocio debía distinto, y la financiera lo movió 4 veces.
 * Lo que fija esta prueba:
 *   · cada negocio llega con lo que debe, y así el reparto cuadra solo;
 *   · si no cuadra, «Enviar a financiera» no llama al servidor;
 *   · «Enviar a financiera» abre el resumen y NADA se crea hasta «Confirmar envío».
 */

const ventana = new Window({ url: 'https://soena.metrikone.co/negocios/n' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })

const V0587 = 'neg-v0587'
const V0589 = 'neg-v0589'

const repartirPagoComercial = vi.fn(async (..._a: unknown[]) => ({ success: true as const, split_id: 's' }))
const editarRepartoComercial = vi.fn(async (..._a: unknown[]) => ({ success: true as const, split_id: 's' }))
vi.mock('@/lib/actions/conciliacion-actions', () => ({
  repartirPagoComercial: (...a: unknown[]) => repartirPagoComercial(...a),
  editarRepartoComercial: (...a: unknown[]) => editarRepartoComercial(...a),
  prepararRepartoComercial: async (input: { negocioIds: string[] }) => ({
    ok: true,
    negocios: input.negocioIds.map((id) => ({
      negocio_id: id,
      codigo: id === V0587 ? 'V0587' : 'V0589',
      nombre: null,
      empresa: id === V0587 ? 'Cliente A' : 'Cliente B',
      debe: id === V0587 ? 1_316_062 : 1_337_389,
    })),
    sugeridos: [],
  }),
}))
vi.mock('@/lib/actions/fab-pago-actions', () => ({
  getNegociosParaPagoFab: async () => ({ negocios: [], cobraPorEpayco: true, workspaceId: 'ws' }),
}))
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }))
vi.mock('@/hooks/use-intencion', () => ({ useIntencion: () => ({ clave: () => 'k', cerrar: () => {} }) }))
vi.mock('@/hooks/use-transition-tolerante', () => ({
  useTransitionTolerante: () => [false, (fn: () => Promise<void>) => { void fn() }],
}))

type ReactMod = typeof import('react')
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let act: typeof import('react').act
let Modal: typeof import('./distribuir-pago-modal').default

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  React = await import('react')
  act = React.act
  createRoot = (await import('react-dom/client')).createRoot
  Modal = (await import('./distribuir-pago-modal')).default
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null

async function asentar() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r))
  })
}

function boton(texto: string): HTMLButtonElement {
  const b = [...contenedor.querySelectorAll('button')].find((x) => x.textContent?.includes(texto))
  if (!b) throw new Error(`no hay botón «${texto}»`)
  return b as HTMLButtonElement
}

function montos(): string[] {
  return [...contenedor.querySelectorAll('input[aria-label^="Monto para"]')].map((i) => (i as HTMLInputElement).value)
}

async function montar() {
  await act(async () => {
    root!.render(React.createElement(Modal, {
      onClose: () => {},
      onDone: () => {},
      negocioFijado: { negocio_id: V0587, codigo: 'V0587', nombre: null },
      referenciaInicial: '389928481',
      totalInicial: 2_653_451,
      contextoEpayco: true,
      sugeridosIniciales: [V0589],
    }))
  })
  await asentar()
}

beforeEach(() => {
  repartirPagoComercial.mockClear()
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  contenedor.remove()
})

describe('reparto del comercial', () => {
  it('cada negocio llega con lo que debe y el reparto cuadra con el pago', async () => {
    await montar()
    expect(montos()).toEqual(['1316062', '1337389'])
    expect(contenedor.textContent).toContain('Cuadra')
    expect(boton('Enviar a financiera').disabled).toBe(false)
  })

  it('nada se crea antes de «Confirmar envío»', async () => {
    await montar()
    await act(async () => boton('Enviar a financiera').click())
    await asentar()
    expect(repartirPagoComercial).not.toHaveBeenCalled()
    expect(contenedor.textContent).toContain('Confirma el envío')
    expect(contenedor.textContent).toContain('Hasta que confirmes no se registra nada')

    await act(async () => boton('Confirmar envío').click())
    await asentar()
    expect(repartirPagoComercial).toHaveBeenCalledTimes(1)
    const input = repartirPagoComercial.mock.calls[0][0] as { porciones: unknown[]; monto_total: number }
    expect(input.monto_total).toBe(2_653_451)
    expect(input.porciones).toEqual([
      { negocio_id: V0587, monto: 1_316_062 },
      { negocio_id: V0589, monto: 1_337_389 },
    ])
  })

  it('«Volver a editar» regresa sin enviar', async () => {
    await montar()
    await act(async () => boton('Enviar a financiera').click())
    await act(async () => boton('Volver a editar').click())
    await asentar()
    expect(repartirPagoComercial).not.toHaveBeenCalled()
    expect(montos()).toEqual(['1316062', '1337389'])
  })

  it('si no cuadra no se puede enviar', async () => {
    await montar()
    // Las mitades iguales menos un peso de redondeo de más: ya no cuadra.
    const campo = contenedor.querySelector('input[aria-label="Monto para V0589"]') as HTMLInputElement
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(campo), 'value')!.set!
    await act(async () => {
      set.call(campo, '1000000')
      campo.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await asentar()
    expect(contenedor.textContent).toContain('Faltan $337.389')
    const enviar = boton('Enviar a financiera')
    expect(enviar.disabled).toBe(true)
    await act(async () => enviar.click())
    expect(repartirPagoComercial).not.toHaveBeenCalled()
  })
})
