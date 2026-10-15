import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * H4 (verificación D de Vera, 2026-10-14) · el texto para el cliente en «Revisar», con la forma por
 * pasos:
 *  · D5: el párrafo viejo se marca («Habla de SATENA, que ya no va…») y cada párrafo ofrece
 *    «Actualizar con ONE», que propone el texto nuevo en el formulario SIN guardarlo;
 *  · D3: «Redactar con ONE» ya no usa `confirm()` (lo único que confirma es «Enviar al cliente»).
 * Con la pantalla de siempre, Redactar sigue preguntando como hoy.
 */

const ventana = new Window({ url: 'https://agencia.metrikone.co/negocios/neg-1' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })
const confirmar = vi.hoisted(() => vi.fn(() => true))
Object.defineProperty(globalThis, 'confirm', { configurable: true, writable: true, value: confirmar })

const acciones = vi.hoisted(() => ({
  redactar: vi.fn(),
  guardar: vi.fn(),
  parrafo: vi.fn(async () => ({ success: true, zona: 'intro', texto: 'Cinco noches en San Andrés y Providencia.' })),
}))
vi.mock('@/app/(app)/negocios/documento-cliente-actions', () => ({
  redactarDocumentoCliente: acciones.redactar,
  guardarDocumentoCliente: acciones.guardar,
  actualizarParrafoConOne: acciones.parrafo,
}))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {} }) }))

type ReactMod = typeof import('react')
let React: ReactMod
let act: typeof import('react').act
let createRoot: typeof import('react-dom/client').createRoot
let Panel: typeof import('./documento-cliente-panel').default

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  Panel = (await import('./documento-cliente-panel')).default
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
beforeEach(() => {
  confirmar.mockClear()
  acciones.redactar.mockReset()
  acciones.parrafo.mockClear()
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  act(() => root?.unmount())
  contenedor.remove()
})

const DOCUMENTO = {
  titular: 'San Andrés y Providencia', intro: 'Llegan con Avianca y saltan a Providencia en SATENA.', incluye: [],
  antes_de_viajar: ['Lleven la tarjeta de turismo.', 'El vuelo de SATENA permite 10 kg de mano.'],
  origen: 'ia' as const, modelo: 'm', redactado_en: null, fuente_hash: 'viejo', revisado_por: 's', revisado_por_nombre: 'Asesora',
  revisado_en: '2026-10-14T00:00:00Z', incluye_origen: 'one' as const, fuente_nombres: ['Avianca', 'SATENA'],
}
const PANEL = {
  columnaPresente: true, desactualizado: true, hayViaje: true, editable: true, terminos: null, terminosBase: null, documento: DOCUMENTO,
  parrafosViejos: [
    { zona: 'intro' as const, indice: null, nombres: ['SATENA'] },
    { zona: 'antes' as const, indice: 1, nombres: ['SATENA'] },
  ],
}

const montar = async (porPasos: boolean) => {
  await act(async () => root!.render(React.createElement(Panel, {
    cotizacionId: 'cot-1', inicial: PANEL as never, ...(porPasos ? { incluyeDeOne: ['Tiquetes aéreos con Avianca'] } : {}),
  })))
}
const botones = (texto: string) => [...contenedor.querySelectorAll('button')].filter(b => b.textContent?.includes(texto)) as HTMLButtonElement[]

describe('H4 · D5 · el párrafo viejo, marcado, y «Actualizar con ONE» por párrafo', () => {
  it('marca la presentación y el renglón que nombran SATENA, y nada más', async () => {
    await montar(true)
    const marcados = [...contenedor.querySelectorAll('[data-parrafo-viejo]')].map(n => n.textContent)
    expect(marcados).toEqual(['Habla de SATENA, que ya no va en la cotización.', 'Habla de SATENA, que ya no va en la cotización.'])
    expect(contenedor.querySelector('[data-parrafo="intro"] [data-parrafo-viejo]')).not.toBeNull()
    expect(contenedor.querySelector('[data-parrafo="titular"] [data-parrafo-viejo]')).toBeNull()
    expect(contenedor.querySelector('[data-parrafo-viejo-renglon="1"]')).not.toBeNull()
    expect(contenedor.querySelectorAll('[data-actualizar-parrafo]').length).toBe(3)
  })

  it('«Actualizar con ONE» de la presentación la reemplaza en el formulario, sin guardar', async () => {
    await montar(true)
    const enIntro = contenedor.querySelector('[data-parrafo="intro"] [data-actualizar-parrafo]') as HTMLButtonElement
    await act(async () => enIntro.click())
    expect(acciones.parrafo).toHaveBeenCalledWith('cot-1', 'intro')
    expect((contenedor.querySelector('#intro-cot-1') as HTMLTextAreaElement).value).toBe('Cinco noches en San Andrés y Providencia.')
    expect(acciones.guardar).not.toHaveBeenCalled()
    expect(contenedor.textContent).toContain('Cambios sin guardar')
  })

  it('con la pantalla de siempre no hay marcas ni «Actualizar con ONE»', async () => {
    await montar(false)
    expect(contenedor.querySelectorAll('[data-parrafo-viejo]').length).toBe(0)
    expect(contenedor.querySelectorAll('[data-actualizar-parrafo]').length).toBe(0)
  })
})

describe('H4 · D3 · «Redactar con ONE» sin confirm()', () => {
  it('por pasos: redacta sin preguntar, reemplazando el texto revisado', async () => {
    acciones.redactar.mockResolvedValue({ success: true, panel: { ...PANEL, desactualizado: false, parrafosViejos: [] } })
    await montar(true)
    await act(async () => botones('Redactar con ONE')[0].click())
    expect(confirmar).not.toHaveBeenCalled()
    expect(acciones.redactar).toHaveBeenCalledWith('cot-1', { reemplazarRevisado: true, porPasos: true })
  })

  it('con la pantalla de siempre sigue preguntando, como hoy', async () => {
    confirmar.mockReturnValueOnce(false)
    await montar(false)
    await act(async () => botones('Redactar con ONE')[0].click())
    expect(confirmar).toHaveBeenCalledTimes(1)
    expect(acciones.redactar).not.toHaveBeenCalled()
  })
})
