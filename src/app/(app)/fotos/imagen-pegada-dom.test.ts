import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * Ctrl+V de una imagen con el perfil de fotos abierto (Mauricio, 2026-10-16), con React DE VERDAD
 * sobre happy-dom (registrado a mano, sin `act`, como `card-link-navegacion-pendiente.test.ts`):
 *   · el pegado se oye en el documento aunque el foco esté FUERA del diálogo (el botón que lo abrió);
 *   · «Copiar imagen» (archivo image/png) y un <img> con data: URL terminan en la casilla;
 *   · un <img src="https://…"> ya no se baja en el servidor: se pide copiar la imagen misma;
 *   · el «pegar en cualquier parte» del riel de cobro de la ficha no recibe la misma foto;
 *   · un texto se deja pasar; con el perfil cerrado no se toma nada.
 */

const ventana = new Window({ url: 'https://trappvel.metrikone.co/negocios/n1' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })

const toasts: string[] = []
vi.mock('sonner', () => ({ toast: { error: (m: string) => toasts.push(m), message: (m: string) => toasts.push(m), success: (m: string) => toasts.push(m) } }))

type ReactMod = typeof import('react')
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let useImagenPegada: typeof import('./usar-imagen-pegada').useImagenPegada
let MENSAJE_COPIAR_IMAGEN: string

beforeAll(async () => {
  React = await import('react')
  createRoot = (await import('react-dom/client')).createRoot
  ;({ useImagenPegada, MENSAJE_COPIAR_IMAGEN } = await import('./usar-imagen-pegada'))
})

async function asentar() {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r))
}

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
let recibidas: Blob[]
let delRiel: number
const alRiel = () => delRiel++

beforeEach(() => {
  toasts.length = 0
  recibidas = []
  delRiel = 0
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  // El «pegar en cualquier parte» de la ficha del negocio (riel de cobro): burbuja en el documento.
  document.addEventListener('paste', alRiel)
})

afterEach(() => {
  root?.unmount()
  root = null
  contenedor.remove()
  document.removeEventListener('paste', alRiel)
})

function Selector(p: { abierto: boolean }) {
  useImagenPegada({ abierto: p.abierto, ocupado: false, onImagen: (b) => recibidas.push(b) })
  return React.createElement('button', { 'data-disparador': '' }, 'Cambiar foto')
}

async function montar(p: Parameters<typeof Selector>[0]) {
  root = createRoot(contenedor)
  root.render(React.createElement(Selector, p))
  await asentar()
}

/** Un pegado con lo que deja el navegador en `clipboardData`. */
function pegar(datos: { archivo?: Blob; texto?: Record<string, string> }) {
  const e = new ventana.Event('paste', { bubbles: true, cancelable: true }) as unknown as Event
  const archivos = datos.archivo ? [datos.archivo] : []
  Object.defineProperty(e, 'clipboardData', {
    value: {
      files: archivos,
      items: archivos.map((a) => ({ kind: 'file', type: a.type, getAsFile: () => a })),
      getData: (f: string) => datos.texto?.[f] ?? (f === 'text' ? datos.texto?.['text/plain'] ?? '' : ''),
    },
  })
  // El foco sigue en el botón que abrió el diálogo, fuera de su contenido.
  ;(contenedor.querySelector('[data-disparador]') as HTMLElement).dispatchEvent(e as never)
  return e
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

describe('pegar una imagen con el perfil abierto', () => {
  it('«Copiar imagen» (image/png): va a la casilla, aunque el foco esté fuera del diálogo, y el riel no la ve', async () => {
    await montar({ abierto: true })
    const png = new Blob([Buffer.from(PNG, 'base64')], { type: 'image/png' })
    const e = pegar({ archivo: png, texto: { 'text/html': '<img src="https://www.hotel.example/a.jpg">' } })
    await asentar()
    expect(recibidas).toEqual([png])
    expect(e.defaultPrevented).toBe(true)
    expect(delRiel).toBe(0)
  })

  it('un <img> con data: URL: la imagen tal cual va a la casilla', async () => {
    await montar({ abierto: true })
    pegar({ texto: { 'text/html': `<img src="data:image/png;base64,${PNG}">` } })
    await asentar()
    expect(recibidas).toHaveLength(1)
    expect(recibidas[0].type).toBe('image/png')
  })

  it('solo HTML con <img src="https://…">: no se baja de otra página, se pide copiar la imagen', async () => {
    await montar({ abierto: true })
    const e = pegar({ texto: { 'text/html': '<img src="https://www.hotel.example/im/hab.jpg">' } })
    await asentar()
    expect(recibidas).toEqual([])
    expect(toasts).toEqual([MENSAJE_COPIAR_IMAGEN])
    expect(e.defaultPrevented).toBe(true)
    expect(delRiel).toBe(0)
  })

  it('un texto (la URL de la página) se deja pegar y sigue su camino', async () => {
    await montar({ abierto: true })
    const e = pegar({ texto: { 'text/plain': 'https://www.hilton.com/en/hotels/ctghihh-hilton-cartagena/' } })
    await asentar()
    expect(recibidas).toEqual([])
    expect(e.defaultPrevented).toBe(false)
    expect(delRiel).toBe(1)
  })

  it('con el selector cerrado no toma nada', async () => {
    await montar({ abierto: false })
    pegar({ archivo: new Blob([Buffer.from(PNG, 'base64')], { type: 'image/png' }) })
    await asentar()
    expect(recibidas).toEqual([])
    expect(delRiel).toBe(1)
  })
})
