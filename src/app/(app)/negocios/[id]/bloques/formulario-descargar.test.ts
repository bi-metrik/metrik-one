/**
 * SOE-032 (garantía SOENA): los documentos que genera la plataforma — Formulario DIAN,
 * Declaración Juramentada, Relación de Facturas, Formulario 1668 — se pintan con
 * `BloqueFormulario`, en Generación y en Envío (la copia `genera_en_origen` editable usa el
 * mismo componente). Solo ofrecían «Ver PDF»; el PR #1232 resolvió «Descargar» en
 * BloqueDocumento y BloqueDatos y este bloque se quedó afuera.
 *
 * Qué se fija: junto a cada «Ver PDF…» (modo visible, modo editable y cada versión del
 * historial) hay un «Descargar» que apunta a `uc?export=download&id=<id>` del mismo archivo.
 *
 * ⚠️ `.test.ts` y no `.tsx`: el `include` de vitest es `src/**\/*.test.ts`. Se monta con
 * React de verdad sobre happy-dom porque el modo editable pinta «Cargando casillas…» hasta
 * que contesta la lectura de casillas (un efecto), que `renderToStaticMarkup` no corre.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { Window } from 'happy-dom'

const ventana = new Window({ url: 'https://soena.metrikone.co/negocios/n1' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })

const PDF_ACTUAL = 'https://drive.google.com/file/d/form1668v2/view'
const PDF_V1 = 'https://drive.google.com/file/d/form1668v1/view'
const DESCARGA_ACTUAL = 'https://drive.google.com/uc?export=download&id=form1668v2'
const DESCARGA_V1 = 'https://drive.google.com/uc?export=download&id=form1668v1'

vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, info: () => {} } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('@/lib/actions/formulario-actions', () => ({
  generarFormulario: async () => ({ success: true }),
  guardarFormularioOverrides: async () => ({ success: true }),
  guardarSeccional: async () => ({ success: true }),
  confirmarNitFormulario: async () => ({ ok: true }),
}))
vi.mock('@/lib/formularios/leer-para-edicion', () => ({
  leerFormularioParaEdicion: async () => ({
    casillas: [],
    versiones: [
      { version_n: 2, drive_url: 'https://drive.google.com/file/d/form1668v2/view', generated_at: '2026-10-20T15:00:00.000Z', autor: 'Ana' },
      { version_n: 1, drive_url: 'https://drive.google.com/file/d/form1668v1/view', generated_at: '2026-10-19T15:00:00.000Z', autor: 'Ana' },
    ],
  }),
}))

type ReactMod = typeof import('react')
let React: ReactMod
let act: ReactMod['act']
let createRoot: typeof import('react-dom/client').createRoot
let BloqueFormulario: typeof import('./BloqueFormulario').default

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  BloqueFormulario = (await import('./BloqueFormulario')).default
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
beforeEach(() => {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  contenedor.remove()
})

async function montar(modo: 'editable' | 'visible', data: Record<string, unknown>) {
  await act(async () => {
    root!.render(
      React.createElement(BloqueFormulario, {
        negocioBloqueId: 'nb-1668',
        negocioId: 'neg-1',
        instancia: { id: 'nb-1668', estado: 'completo', data } as unknown as Parameters<typeof BloqueFormulario>[0]['instancia'],
        modo,
        configExtra: { label: 'Formulario 1668', template: 'formulario-1668' },
      }),
    )
  })
}

function enlaces(texto: string): HTMLAnchorElement[] {
  return Array.from(contenedor.querySelectorAll('a')).filter((a) => a.textContent?.trim() === texto) as HTMLAnchorElement[]
}

const CON_PDF = { drive_url: PDF_ACTUAL, version_actual: 2 }

describe('BloqueFormulario: Descargar el PDF generado (SOE-032)', () => {
  it('modo visible: «Ver PDF» y «Descargar» sobre el mismo archivo', async () => {
    await montar('visible', CON_PDF)
    expect(enlaces('Ver PDF').map((a) => a.getAttribute('href'))).toEqual([PDF_ACTUAL])
    const bajar = enlaces('Descargar')
    expect(bajar.map((a) => a.getAttribute('href'))).toEqual([DESCARGA_ACTUAL])
    expect(bajar[0].hasAttribute('download')).toBe(true)
  })

  it('modo editable: «Ver PDF actual» y «Descargar» en el encabezado', async () => {
    await montar('editable', CON_PDF)
    expect(enlaces('Ver PDF actual').map((a) => a.getAttribute('href'))).toEqual([PDF_ACTUAL])
    expect(enlaces('Descargar').map((a) => a.getAttribute('href'))).toEqual([DESCARGA_ACTUAL])
  })

  it('historial de versiones: cada versión con PDF se puede descargar', async () => {
    await montar('editable', CON_PDF)
    const boton = Array.from(contenedor.querySelectorAll('button')).find((b) => /versi/.test(b.textContent ?? ''))
    expect(boton).toBeTruthy()
    await act(async () => { boton!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(enlaces('PDF').map((a) => a.getAttribute('href'))).toEqual([PDF_ACTUAL, PDF_V1])
    expect(enlaces('Descargar').map((a) => a.getAttribute('href'))).toEqual([DESCARGA_ACTUAL, DESCARGA_ACTUAL, DESCARGA_V1])
  })

  it('sin PDF generado no ofrece Ver ni Descargar', async () => {
    await montar('visible', {})
    expect(enlaces('Ver PDF')).toHaveLength(0)
    expect(enlaces('Descargar')).toHaveLength(0)
  })
})
