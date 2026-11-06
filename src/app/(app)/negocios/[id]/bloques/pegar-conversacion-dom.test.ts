import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * N-H4-2 (QA de Trappvel del 2026-11-05): con «Lo que entendí» abierto, lo que se escribía en los campos de texto
 * de la solicitud no se guardaba y nada avisaba. El resumen era un cuadro `fixed inset-0` sobre toda la página: los
 * campos se veían debajo, pero un clic caía en el fondo del cuadro y no en la casilla. Ahora el resumen queda dentro
 * del bloque y los campos se escriben y se guardan con él a la vista. `BloqueDatos` montado con React de verdad sobre
 * happy-dom (mismo registro que `pasos-cotizacion-dom.test.ts`).
 */

const ventana = new Window({ url: 'https://trappvel.metrikone.co/negocios/n1' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'FocusEvent', 'MutationObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })

const guardados: Record<string, unknown>[] = []
vi.mock('../../negocio-v2-actions', () => ({
  actualizarBloqueData: async (_id: string, data: Record<string, unknown>) => { guardados.push(data); return { error: null } },
  // Sin campos obligatorios el bloque está «completo»: el guardado va por aquí.
  marcarBloqueCompleto: async (_id: string, data: Record<string, unknown>) => { guardados.push(data); return { error: null } },
  consultarRetornoDeCorreccion: async () => ({ aviso: null, etapa: null }),
  confirmarSugerido: async () => ({ error: null }),
  descartarConflicto: async () => ({ error: null }),
}))
vi.mock('@/lib/actions/documento-actions', () => ({
  extraerCampoDesdeImagen: async () => ({ ok: true }),
  subirImagenClipboard: async () => ({ ok: true }),
}))
vi.mock('@/lib/actions/epayco-actions', () => ({ consultarEpayco: async () => ({ success: false }) }))
vi.mock('@/lib/negocios/pegar-conversacion-servidor', () => ({
  pegarConversacion: async () => ({
    error: null,
    valores: { destino: 'SAN ANDRÉS' },
    resumen: {
      llenados: ['Destino: SAN ANDRÉS'], reemplazados: [], conflictos: [], quitados: [],
      dudas: ['Ciudad de salida'], otros: [], faltaMinimo: [], hayMinimo: false, mensajes: 10, recortado: false,
    },
  }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, message: () => {} } }))

type ReactMod = typeof import('react')
let React: ReactMod
let act: ReactMod['act']
let createRoot: typeof import('react-dom/client').createRoot
let BloqueDatos: typeof import('./BloqueDatos').default

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  BloqueDatos = (await import('./BloqueDatos')).default
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
beforeEach(() => {
  guardados.length = 0
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  contenedor.remove()
})

async function asentar() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setImmediate(r)) })
}

/** Lo que hace el navegador al teclear: el valor nuevo por el setter nativo y el evento `input`. */
function escribir(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const proto = Object.getPrototypeOf(el) as object
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, valor)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function clic(el: Element | null) {
  if (!el) throw new Error('no está el botón')
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

const SOLICITUD = [
  { slug: 'destino', label: 'Destino', tipo: 'texto', nivel: 'minimo', pregunta: '¿A dónde viajan?' },
  { slug: 'requisitos', label: 'Requisitos especiales', tipo: 'texto', nivel: 'deseable', pregunta: '¿Algo especial?' },
] as const

describe('N-H4-2 · «Lo que entendí» no tapa los campos de la solicitud', () => {
  it('el resumen queda en el bloque, sin cuadro encima, y lo escrito en un campo de texto se guarda', async () => {
    await act(async () => {
      root!.render(React.createElement(BloqueDatos, { negocioBloqueId: 'nb1', instancia: null, modo: 'editable', fields: SOLICITUD as never }))
    })
    await act(async () => { clic(contenedor.querySelector('[data-boton-pegar-conversacion]')) })
    await asentar()
    // Mientras se pega la conversación, sí hay cuadro.
    expect(document.querySelector('[aria-modal="true"]')).not.toBeNull()
    await act(async () => { escribir(contenedor.querySelector('[data-texto-chat]') as HTMLTextAreaElement, 'Hola, queremos ir a San Andrés') })
    const llenar = [...contenedor.querySelectorAll('button')].find(b => b.textContent === 'Llenar el viaje') ?? null
    await act(async () => { clic(llenar) })
    await asentar()

    // «Lo que entendí» está a la vista, DENTRO del bloque, y nada cubre la página.
    expect(contenedor.textContent).toContain('Lo que entendí')
    expect(contenedor.textContent).toContain('Destino: SAN ANDRÉS')
    expect(document.querySelector('[aria-modal="true"]')).toBeNull()
    expect(document.querySelector('.fixed.inset-0')).toBeNull()

    // La asesora corrige un campo de texto con el resumen abierto: se guarda al salir del campo.
    const campos = [...contenedor.querySelectorAll('input[type="text"]')] as HTMLInputElement[]
    const requisitos = campos[1]
    await act(async () => { escribir(requisitos, 'CUNA PARA EL BEBÉ') })
    await act(async () => { requisitos.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    await asentar()
    expect(guardados.at(-1)?.requisitos).toBe('CUNA PARA EL BEBÉ')
    // Y el resumen sigue ahí.
    expect(contenedor.textContent).toContain('Lo que entendí')
  })
})
