import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { Window } from 'happy-dom'

/**
 * La tarjeta de un documento mientras la lectura corre en el servidor (después de responder).
 *
 * `BloqueDocumento` montado con React de verdad sobre happy-dom (registrado a mano, como
 * `negocios-adoptar-vista-e2e.test.ts`). La ruta `GET /api/negocios/<id>/lectura/<bloque>` es
 * un `fetch` falso al que la prueba le dice qué contestar en cada consulta.
 *
 * LO QUE FIJA:
 *  1. Abrir la ficha con una lectura en curso retoma la espera y pinta el resultado cuando
 *     termina, y refresca la ficha (nadie la revalidó: la lectura terminó tras responder).
 *  2. Una lectura que falla queda a la vista con «Reintentar», que relee el MISMO archivo.
 *  3. Sin red, la espera NO gira para siempre: termina con «Consultar de nuevo».
 *
 * VISTO FALLAR (2026-10-05, 1 roja cada una): sin el tope de la espera sin red; sin el corte
 * por `vencida`; sin `router.refresh()` al terminar; «Reintentar» sin volver a procesar.
 */

const ventana = new Window({ url: 'https://soena.metrikone.co/negocios/x' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })
Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: ventana.location })

const refresh = vi.fn()
const procesarDocumento = vi.fn()
const reprocesarDocumento = vi.fn()

vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, info: () => {} } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/lib/actions/documento-actions', () => ({
  procesarDocumento: (...a: unknown[]) => procesarDocumento(...a),
  reprocesarDocumento: (...a: unknown[]) => reprocesarDocumento(...a),
  actualizarCampoDocumento: async () => ({ success: true }),
}))
vi.mock('@/lib/actions/almacenamiento-actions', () => ({
  prepararSubidaExterna: async () => ({ ok: false, error: '' }),
  descartarSubidaExterna: async () => {},
}))
vi.mock('@/lib/actions/devolucion-actions', () => ({ devolverBloque: async () => ({ ok: true }) }))

type ReactMod = typeof import('react')
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let BloqueDocumento: (p: unknown) => unknown

beforeAll(async () => {
  React = await import('react')
  createRoot = (await import('react-dom/client')).createRoot
  BloqueDocumento = (await import('./BloqueDocumento')).default as never
})

const NEG = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const BLOQUE = '11111111-2222-4333-8444-555555555555'
const RUTA = `ws/negocios/${NEG}/${BLOQUE}/documento.pdf`

/** Lo que contesta la ruta en la siguiente consulta. `'red'` = el fetch falla. */
const respuestas: Array<unknown | 'red'> = []
const urls: string[] = []
const fetchFalso = vi.fn(async (url: string) => {
  urls.push(url)
  const r = respuestas.length > 1 ? respuestas.shift() : respuestas[0]
  if (r === 'red') throw new TypeError('Failed to fetch')
  return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } })
})
Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetchFalso })

const marca = (estado: string, extra: Record<string, unknown> = {}) => ({
  token: 't-1', estado, tipo: 'carga', iniciada_at: new Date().toISOString(),
  file_name: 'rut.pdf', storage_path: RUTA, ...extra,
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null

function montar(data: Record<string, unknown>) {
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
  root.render(React.createElement(BloqueDocumento as never, {
    negocioBloqueId: BLOQUE,
    negocioId: NEG,
    workspaceId: 'ws',
    instancia: { id: BLOQUE, estado: 'pendiente', data },
    modo: 'editable',
    userRole: 'owner',
    configExtra: { label: 'RUT', campos_extraccion: [{ slug: 'nit', label: 'NIT', tipo: 'texto', required: true, descripcion_ai: '' }] },
  }))
}

async function asentar() {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r))
}
async function avanzar(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
  await asentar()
}
const texto = () => contenedor.textContent ?? ''

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  respuestas.length = 0
  urls.length = 0
  fetchFalso.mockClear()
  refresh.mockClear()
  procesarDocumento.mockReset()
  reprocesarDocumento.mockReset()
})

afterEach(() => {
  root?.unmount()
  root = null
  contenedor?.remove()
  vi.useRealTimers()
})

describe('BloqueDocumento · lectura en segundo plano', () => {
  it('al abrir con una lectura en curso, espera por GET y pinta el resultado', async () => {
    respuestas.push(
      { marca: marca('leyendo') },
      {
        marca: marca('lista'),
        bloque: {
          estado: 'completo', drive_url: 'https://drive.google.com/file/d/nuevo/view', file_name: 'rut.pdf',
          campos: { nit: { value: '900831342', confidence: 0.95, manual: false } }, extraction_status: 'ok',
        },
      },
    )
    montar({ _lectura: marca('leyendo') })
    await asentar()
    await asentar()
    expect(texto()).toContain('puedes seguir trabajando')

    await avanzar(1_500)
    expect(urls[0]).toBe(`/api/negocios/${NEG}/lectura/${BLOQUE}`)
    expect(texto()).toContain('puedes seguir trabajando') // todavía leyendo

    await avanzar(2_000)
    expect(texto()).not.toContain('puedes seguir trabajando')
    expect(texto()).toContain('Ver en Drive')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('una lectura que falla queda con «Reintentar», que relee el mismo archivo', async () => {
    respuestas.push({ marca: marca('error', { error: 'Error: Gemini se cayó' }) })
    montar({ _lectura: marca('leyendo') })
    await asentar()
    await avanzar(1_500)

    const aviso = contenedor.querySelector('[data-aviso-lectura="error"]')
    expect(aviso?.textContent).toContain('Gemini se cayó')

    procesarDocumento.mockResolvedValue({ success: true, leyendo: true, lectura: { bloque_id: BLOQUE, token: 't-2' } })
    respuestas.length = 0
    respuestas.push({ marca: marca('leyendo', { token: 't-2' }) })
    ;(contenedor.querySelector('[data-accion="reintentar-lectura"]') as HTMLElement).click()
    await asentar()

    expect(procesarDocumento).toHaveBeenCalledTimes(1)
    expect(procesarDocumento.mock.calls[0].slice(0, 4)).toEqual([BLOQUE, NEG, RUTA, 'rut.pdf'])
    expect(contenedor.querySelector('[data-aviso-lectura]')).toBeNull()
    expect(texto()).toContain('puedes seguir trabajando')
  })

  it('sin red la espera termina con «Consultar de nuevo», no gira para siempre', async () => {
    respuestas.push('red')
    montar({ _lectura: marca('leyendo') })
    await asentar()
    // Mucho más que el plazo de la espera (90 s + 15 s).
    for (let i = 0; i < 40; i++) await avanzar(4_000)

    expect(texto()).not.toContain('puedes seguir trabajando')
    expect(contenedor.querySelector('[data-aviso-lectura="sin_confirmar"]')).not.toBeNull()
    expect(procesarDocumento).not.toHaveBeenCalled() // nada se repite solo

    // Vuelve la red: «Consultar de nuevo» pregunta otra vez, no relee el documento.
    respuestas.length = 0
    respuestas.push({ marca: marca('lista'), bloque: { estado: 'completo', drive_url: 'https://drive.google.com/file/d/n/view', file_name: 'rut.pdf', campos: {}, extraction_status: 'ok' } })
    ;(contenedor.querySelector('[data-accion="consultar-lectura"]') as HTMLElement).click()
    await asentar()
    await avanzar(1_500)
    expect(texto()).toContain('Ver en Drive')
    expect(procesarDocumento).not.toHaveBeenCalled()
  })

  it('una lectura vencida (según el servidor) es un error con salida', async () => {
    respuestas.push({ marca: marca('leyendo'), vencida: true })
    montar({ _lectura: marca('leyendo') })
    await asentar()
    await avanzar(1_500)
    const aviso = contenedor.querySelector('[data-aviso-lectura="vencida"]')
    expect(aviso?.textContent).toContain('no terminó')
    expect(contenedor.querySelector('[data-accion="reintentar-lectura"]')).not.toBeNull()
  })
})
