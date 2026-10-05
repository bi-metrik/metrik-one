import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { Window } from 'happy-dom'

/**
 * Lo que el navegador ya NO pide con una server action al montar (2026-10-05).
 *
 * Next pone las server actions en fila: una lectura al montar retrasaba la acción real que
 * la persona hacía después. Aquí se monta cada pieza con React de verdad y se comprueba
 * que no llama a su action de lectura, y que lo que necesita le llega por props, por el
 * anuncio de la ficha o por un GET.
 *
 * DOM de happy-dom registrado a mano, como `app/auto-recarga-boundaries.test.ts`.
 */

const ventana = new Window({ url: 'https://soena.metrikone.co/negocios' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Text', 'MutationObserver', 'MouseEvent', 'localStorage'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })
Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: { reload: vi.fn(), href: 'https://soena.metrikone.co/negocios' } })
let visibilidad: 'visible' | 'hidden' = 'visible'
Object.defineProperty(ventana.document, 'visibilityState', { configurable: true, get: () => visibilidad })

// ── Mocks ──────────────────────────────────────────────────────────────────
let ruta = '/negocios'
vi.mock('next/navigation', () => ({
  usePathname: () => ruta,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))

const acciones = vi.hoisted(() => ({
  getImpersonationOptions: vi.fn(),
  setImpersonation: vi.fn(),
  getActiveTimer: vi.fn(),
  getDestinosParaTimer: vi.fn(async () => ({ negocios: [{ id: 'n1', name: 'Negocio uno', code: 'S1 26 1' }], proyectos: [] })),
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  getNotificaciones: vi.fn(),
  marcarCompletada: vi.fn(),
  descartarNotificacion: vi.fn(),
  marcarTodasCompletadas: vi.fn(),
  getActivityLog: vi.fn(async () => []),
  addComment: vi.fn(),
  deleteActivity: vi.fn(),
}))
vi.mock('@/lib/actions/impersonation', () => ({
  getImpersonationOptions: acciones.getImpersonationOptions,
  setImpersonation: acciones.setImpersonation,
}))
vi.mock('./timer-actions', () => ({
  getActiveTimer: acciones.getActiveTimer,
  getDestinosParaTimer: acciones.getDestinosParaTimer,
  startTimer: acciones.startTimer,
  stopTimer: acciones.stopTimer,
}))
vi.mock('@/lib/actions/notificaciones', () => ({
  getNotificaciones: acciones.getNotificaciones,
  marcarCompletada: acciones.marcarCompletada,
  descartarNotificacion: acciones.descartarNotificacion,
  marcarTodasCompletadas: acciones.marcarTodasCompletadas,
}))
vi.mock('@/app/(app)/activity-actions', () => ({
  getActivityLog: acciones.getActivityLog,
  addComment: acciones.addComment,
  deleteActivity: acciones.deleteActivity,
}))
// El realtime de la campana: un canal que nunca conecta (no es lo que se prueba aquí).
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const canal = { on: () => canal, subscribe: () => canal }
    return { channel: () => canal, removeChannel: () => {} }
  },
}))

const fetchFalso = vi.fn(async (url: string) => {
  void url
  return new Response(JSON.stringify({ items: [], total: 0 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
})
vi.stubGlobal('fetch', fetchFalso)

// ── Montaje ────────────────────────────────────────────────────────────────
type ReactMod = typeof import('react')
let React: ReactMod
let raiz: import('react-dom/client').Root | null = null

async function asentar() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r))
}

async function montar(componente: unknown, props: Record<string, unknown>) {
  React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const contenedor = ventana.document.createElement('div')
  ventana.document.body.appendChild(contenedor)
  raiz = createRoot(contenedor as never)
  raiz.render(React.createElement(componente as never, props))
  await asentar()
  return contenedor
}

// Cargar el FAB (y lo que arrastra: modales de pago, venta) tarda segundos con la suite
// completa corriendo en paralelo: se hace una vez aquí, fuera del plazo de cada prueba.
beforeAll(async () => {
  await Promise.all([
    import('./fab'),
    import('./impersonation-bar'),
    import('@/components/notification-bell'),
    import('@/components/activity-log'),
    import('react-dom/client'),
  ])
}, 60_000)

beforeEach(() => {
  for (const f of Object.values(acciones)) f.mockClear()
  fetchFalso.mockClear()
  ruta = '/negocios'
  visibilidad = 'visible'
})
afterEach(async () => {
  raiz?.unmount()
  raiz = null
  await asentar()
  ventana.document.body.innerHTML = ''
  vi.useRealTimers()
})

// ── Pruebas ────────────────────────────────────────────────────────────────
describe('ImpersonationBar', () => {
  it('no llama a getImpersonationOptions: pinta lo que le pasa el layout', async () => {
    const Barra = (await import('./impersonation-bar')).default
    const c = await montar(Barra, {
      opciones: { ok: true, users: [{ id: 'u2', full_name: 'Ana Operadora', role: 'operator' }], current: 'u2' },
    })
    expect(acciones.getImpersonationOptions).not.toHaveBeenCalled()
    expect(c.textContent).toContain('Viendo como')
    expect(c.textContent).toContain('Ana Operadora')
  })

  it('sin opciones (no es platform_admin) no pinta nada y tampoco pregunta', async () => {
    const Barra = (await import('./impersonation-bar')).default
    const c = await montar(Barra, {})
    expect(c.textContent).toBe('')
    expect(acciones.getImpersonationOptions).not.toHaveBeenCalled()
  })
})

describe('FAB', () => {
  it('al montar no pide el timer ni los destinos; el timer corriendo llega del layout', async () => {
    const FAB = (await import('./fab')).default
    const c = await montar(FAB, {
      role: 'owner',
      timerActivo: {
        id: 't1',
        proyecto_id: null,
        negocio_id: 'n1',
        proyecto_nombre: 'Negocio uno',
        inicio: new Date().toISOString(),
        descripcion: null,
      },
    })
    expect(acciones.getActiveTimer).not.toHaveBeenCalled()
    expect(acciones.getDestinosParaTimer).not.toHaveBeenCalled()
    expect(c.textContent).toContain('Negocio uno')
  })

  it('los destinos se piden al abrir el panel del timer, una vez', async () => {
    const FAB = (await import('./fab')).default
    const c = await montar(FAB, { role: 'owner' })
    const abrirMenu = c.querySelector('button[aria-label]') ?? c.querySelectorAll('button')[c.querySelectorAll('button').length - 1]
    abrirMenu?.dispatchEvent(new ventana.MouseEvent('click', { bubbles: true }))
    await asentar()
    const iniciar = [...c.querySelectorAll('button')].find((b) => b.textContent?.includes('Iniciar timer'))
    expect(iniciar).toBeTruthy()
    iniciar?.dispatchEvent(new ventana.MouseEvent('click', { bubbles: true }))
    await asentar()
    expect(acciones.getDestinosParaTimer).toHaveBeenCalledTimes(1)
    expect(c.textContent).toContain('S1 26 1 · Negocio uno')
  })

  it('el negocio cerrado lo anuncia la ficha: el FAB no pregunta al servidor', async () => {
    const { anunciarNegocioEnPantalla, olvidarNegociosEnPantalla } = await import('@/lib/negocios/negocio-en-pantalla')
    olvidarNegociosEnPantalla()
    const id = '7f3c2a10-1b2c-4d5e-8f90-123456789abc'
    ruta = `/negocios/${id}`
    const FAB = (await import('./fab')).default
    const c = await montar(FAB, { role: 'owner', registrarPagoEnabled: true })
    anunciarNegocioEnPantalla(id, true)
    await asentar()
    const botones = c.querySelectorAll('button')
    botones[botones.length - 1]?.dispatchEvent(new ventana.MouseEvent('click', { bubbles: true }))
    await asentar()
    expect(c.textContent).toContain('Este negocio está cerrado')
    expect(fetchFalso).not.toHaveBeenCalled()
  })
})

describe('NotificationBell', () => {
  const ITEM = {
    id: 'n1',
    tipo: 'mencion',
    estado: 'pendiente',
    contenido: 'Te mencionaron',
    entidad_tipo: null,
    entidad_id: null,
    deep_link: null,
    metadata: null,
    created_at: new Date().toISOString(),
  }

  it('al montar no lee nada: el conteo llega del layout', async () => {
    const Campana = (await import('@/components/notification-bell')).default
    const c = await montar(Campana, { userId: 'u1', initialItems: [ITEM], initialTotal: 1 })
    expect(acciones.getNotificaciones).not.toHaveBeenCalled()
    expect(fetchFalso).not.toHaveBeenCalled()
    expect(c.textContent).toContain('1')
  })

  it('al volver a la pestaña lee por GET (no por action), y no mas de una vez por minuto', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const Campana = (await import('@/components/notification-bell')).default
    await montar(Campana, { userId: 'u1', initialItems: [ITEM], initialTotal: 1 })

    // Recién cargada: volver enseguida no pide nada.
    ventana.document.dispatchEvent(new ventana.Event('visibilitychange'))
    await asentar()
    expect(fetchFalso).not.toHaveBeenCalled()

    // Oculta: tampoco.
    vi.setSystemTime(Date.now() + 2 * 60_000)
    visibilidad = 'hidden'
    ventana.document.dispatchEvent(new ventana.Event('visibilitychange'))
    await asentar()
    expect(fetchFalso).not.toHaveBeenCalled()

    // Visible pasado el minuto: un GET con revalidación (ETag), nunca la action.
    visibilidad = 'visible'
    ventana.document.dispatchEvent(new ventana.Event('visibilitychange'))
    await asentar()
    expect(fetchFalso).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/notificaciones?desde=0')
    expect(init.cache).toBe('no-cache')
    expect(acciones.getNotificaciones).not.toHaveBeenCalled()

    // Y otra vuelta enseguida no repite.
    ventana.document.dispatchEvent(new ventana.Event('visibilitychange'))
    await asentar()
    expect(fetchFalso).toHaveBeenCalledTimes(1)
  })

  it('abrir el panel lee por GET', async () => {
    const Campana = (await import('@/components/notification-bell')).default
    const c = await montar(Campana, { userId: 'u1', initialItems: [ITEM], initialTotal: 1 })
    c.querySelector('button[aria-label="Notificaciones"]')?.dispatchEvent(new ventana.MouseEvent('click', { bubbles: true }))
    await asentar()
    expect(fetchFalso).toHaveBeenCalledWith('/api/notificaciones?desde=0', expect.objectContaining({ cache: 'no-cache' }))
    expect(acciones.getNotificaciones).not.toHaveBeenCalled()
  })
})

describe('ActivityLog', () => {
  const ENTRADA = {
    id: 'a1',
    tipo: 'comentario',
    contenido: 'Llamé al cliente',
    campo_modificado: null,
    valor_anterior: null,
    valor_nuevo: null,
    link_url: null,
    created_at: '2026-10-05T10:00:00Z',
    autor: { id: 's1', full_name: 'Ana' },
    mencion: null,
    puede_borrar: false,
  }

  it('con la actividad del servidor no llama a getActivityLog al montar', async () => {
    const ActivityLog = (await import('@/components/activity-log')).default
    const c = await montar(ActivityLog, {
      entidadTipo: 'negocio',
      entidadId: 'n1',
      staffList: [],
      entradasIniciales: [ENTRADA],
    })
    expect(acciones.getActivityLog).not.toHaveBeenCalled()
    expect(c.textContent).toContain('Llamé al cliente')
  })

  it('sin ella (360 del contacto) la pide como antes', async () => {
    const ActivityLog = (await import('@/components/activity-log')).default
    await montar(ActivityLog, { entidadTipo: 'contacto', entidadId: 'c1', staffList: [] })
    expect(acciones.getActivityLog).toHaveBeenCalledWith('contacto', 'c1', undefined)
  })
})
