import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Window } from 'happy-dom'

/**
 * C4 · dos criterios de Vera sobre la pantalla:
 *
 *  · N13 (decisión J) · con la cotización por pasos encendida, «Enviar» del bloque Cotización del
 *    negocio NO envía: lleva a «Revisar y enviar» de esa cotización. Apagada, envía como hoy.
 *  · P7 · el nombre de quien autoriza sale de la configuración (el dueño del workspace): en
 *    ninguna pantalla de la cotización, ni en el flujo de siempre, queda «Edgar» escrito fijo.
 */

const ventana = new Window({ url: 'https://agencia.metrikone.co/negocios/neg-1' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
const navegacion = vi.hoisted(() => ({ a: [] as string[] }))
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })
Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: { assign: (u: string) => navegacion.a.push(u) } })

const enviar = vi.hoisted(() => vi.fn(async () => ({ success: true })))
vi.mock('./[id]/cotizacion/actions', () => ({
  enviarCotizacionNegocio: enviar,
  aceptarCotizacionNegocio: async () => ({ success: true }),
  rechazarCotizacionNegocio: async () => ({ success: true }),
  duplicarCotizacionNegocio: async () => ({ success: true }),
  eliminarCotizacionBorrador: async () => ({ success: true }),
  corregirCotizacionAceptada: async () => ({ success: true }),
  opcionesDeAprobacion: async () => ({ success: true, tarifas: [], preseleccion: null }),
}))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }))
vi.mock('next/link', async () => {
  const R = await import('react')
  return { default: ({ children }: { children: unknown }) => R.createElement('a', null, children as never) }
})

type ReactMod = typeof import('react')
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let BloqueCotizacion: typeof import('./[id]/bloques/BloqueCotizacion').default

beforeAll(async () => {
  React = await import('react')
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  BloqueCotizacion = (await import('./[id]/bloques/BloqueCotizacion')).default
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
beforeEach(() => {
  enviar.mockClear()
  navegacion.a.length = 0
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  React.act(() => root?.unmount())
  root = null
  contenedor.remove()
})

const COT = { id: 'cot-1', consecutivo: 'COT-2026-0901', modo: 'detallada', estado: 'borrador', valor_total: 1000, created_at: '2026-10-12T10:00:00Z', descripcion: 'San Andrés' }

async function enviarDesdeElNegocio(porPasos: boolean) {
  await React.act(async () => {
    root!.render(React.createElement(BloqueCotizacion, { negocioId: 'neg-1', modo: 'editable', cotizaciones: [COT] as never, porPasos }))
  })
  const boton = [...contenedor.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Enviar')
  expect(boton, 'el bloque no ofrece «Enviar»').toBeTruthy()
  await React.act(async () => { boton!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

describe('N13 · «Enviar» del bloque del negocio', () => {
  it('con la forma por pasos lleva a «Revisar y enviar» de esa cotización y no envía', async () => {
    await enviarDesdeElNegocio(true)
    expect(navegacion.a).toEqual(['/negocios/neg-1/cotizacion/cot-1?paso=revisar'])
    expect(enviar).not.toHaveBeenCalled()
  })

  it('apagada, envía como hoy', async () => {
    await enviarDesdeElNegocio(false)
    expect(enviar).toHaveBeenCalledWith('cot-1', 'neg-1')
    expect(navegacion.a).toEqual([])
  })
})

describe('P7 · «Edgar» no queda escrito en ninguna pantalla de la cotización', () => {
  const RAIZ = path.resolve(__dirname)
  const ARCHIVOS = [
    'tarjeta-costo.tsx', 'tarjeta-opcion.tsx', 'cotizacion-editor.tsx', 'tabla-combinaciones.tsx', 'panel-margen-salida.tsx',
    'por-pasos-actions.ts', 'margen-salida-actions.ts',
    ...readdirSync(path.join(RAIZ, 'por-pasos')).map(f => `por-pasos/${f}`),
  ]
  /** El código sin comentarios: un comentario puede nombrar a quien decidió algo. */
  const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  for (const f of ARCHIVOS) {
    it(f, () => {
      expect(sinComentarios(readFileSync(path.join(RAIZ, f), 'utf8'))).not.toMatch(/Edgar/)
    })
  }
})
