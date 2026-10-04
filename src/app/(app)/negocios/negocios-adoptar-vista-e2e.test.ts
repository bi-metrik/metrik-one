import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { Window } from 'happy-dom'

/**
 * Tras asignar o marcar desde la lista, el servidor manda una vista nueva por props
 * (`revalidatePath`). Antes la lista se encogía a la primera página (30 tarjetas) y volvía
 * a crecer cuando llegaban las demás: el scroll saltaba. Ahora conserva lo cargado, refresca
 * el comienzo ya y reemplaza todo cuando vuelve la relectura `desde=0&cuantos=<cargadas>`.
 *
 * `NegociosClient` montado con React de verdad sobre happy-dom (registrado a mano, sin `act`,
 * como `auto-recarga-boundaries.test.ts`). La ruta `/api/negocios/lista` es un `fetch` falso
 * que arma la vista con la MISMA función que el servidor (`armarVistaLista`).
 */

const ventana = new Window({ url: 'https://soena.metrikone.co/negocios' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })
Object.defineProperty(globalThis, 'location', { configurable: true, writable: true, value: ventana.location })
Object.defineProperty(globalThis, 'history', { configurable: true, writable: true, value: ventana.history })

vi.mock('./negocio-card', async () => {
  const React = await import('react')
  return {
    default: ({ negocio }: { negocio: { codigo: string | null } }) =>
      React.createElement('div', { 'data-tarjeta': negocio.codigo }, negocio.codigo),
  }
})
vi.mock('./descargar-excel-button', () => ({ default: () => null }))
vi.mock('./subir-a-drive-button', () => ({ default: () => null }))

type ReactMod = typeof import('react')
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let NegociosClient: (p: unknown) => unknown
let armarVistaLista: typeof import('@/lib/negocios/vista-lista').armarVistaLista

beforeAll(async () => {
  React = await import('react')
  createRoot = (await import('react-dom/client')).createRoot
  NegociosClient = (await import('./negocios-client')).default as never
  armarVistaLista = (await import('@/lib/negocios/vista-lista')).armarVistaLista
})

const abierto = (n: number, sufijo = '') =>
  ({
    id: `id-${n}`,
    codigo: `V${String(n).padStart(4, '0')}${sufijo}`,
    nombre: `Negocio ${n}`,
    precio_estimado: null,
    precio_aprobado: null,
    carpeta_url: null,
    stage_actual: 'venta',
    estado: 'abierto',
    created_at: new Date(Date.UTC(2026, 8, 1) + n * 60_000).toISOString(),
    linea_nombre: null,
    linea_numero: null,
    etapa_nombre: 'Venta',
    etapa_numero: 1,
    etapa_stage: 'venta',
    empresa_nombre: null,
    contacto_nombre: null,
    contacto_telefono: null,
    costos_ejecutados: 0,
    pausado: false,
    pausado_hasta: null,
    motivo_pausa: null,
    closed_at: null,
    razon_cierre: null,
    vehiculo_label: null,
    seccional_label: null,
    ciudad_label: null,
    cedula: null,
    radicado: null,
    numero_factura: null,
    fecha_cita: null,
    cita_pendiente: false,
    atencion_cita: null,
    servicio: null,
    servicio_label: null,
    responsables: [],
    es_meta_lead: false,
    reproceso: null,
    desenlaces: [],
    origen: null,
    aliado_nombre: null,
    marcas: [],
    etapa_cambiada_at: '2026-09-01T12:00:00Z',
    etapa_sla_horas: null,
    horas_habiles_en_etapa: null,
    sla_exceso_horas: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

/**
 * El universo del "servidor", en el orden en que lo entrega `getNegociosV2` (`created_at`
 * desc): cambia cuando la prueba simula una asignación.
 */
let universo = Array.from({ length: 70 }, (_, i) => abierto(70 - i))

function vistaDe(pagina: { desde?: number; cuantos?: number } = {}) {
  return armarVistaLista(
    { abiertos: universo, cerrados: [], etapas: [], defaultStage: 'todos', hoyISO: '2026-10-03' },
    {},
    pagina,
  ).vista
}

/** Peticiones a la ruta: cada una queda abierta hasta que la prueba la entrega. */
const pedidos: { url: URL; entregar: () => void; fallar: () => void }[] = []
const fetchFalso = vi.fn((entrada: string) => {
  const url = new URL(entrada, 'https://soena.metrikone.co')
  return new Promise<Response>((resolve) => {
    pedidos.push({
      url,
      entregar: () => {
        const sp = url.searchParams
        const v = vistaDe({ desde: Number(sp.get('desde') ?? 0), cuantos: sp.has('cuantos') ? Number(sp.get('cuantos')) : undefined })
        resolve(new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } }))
      },
      fallar: () =>
        resolve(new Response(JSON.stringify({ error: 'No se pudo leer la lista' }), { status: 500, headers: { 'content-type': 'application/json' } })),
    })
  })
})
Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetchFalso })

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null

const props = (vista: unknown) => ({ vista, stagesActivos: ['venta', 'ejecucion', 'cobro'] })
const codigos = () => [...contenedor.querySelectorAll('[data-tarjeta]')].map((n) => n.getAttribute('data-tarjeta'))

async function asentar() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r))
}

beforeEach(async () => {
  universo = Array.from({ length: 70 }, (_, i) => abierto(70 - i))
  pedidos.length = 0
  fetchFalso.mockClear()
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
  root.render(React.createElement(NegociosClient as never, props(vistaDe())))
  await asentar()
})

afterEach(() => {
  root?.unmount()
  root = null
  contenedor.remove()
})

async function verMas() {
  ;(contenedor.querySelector('[data-ver-mas]') as HTMLElement).click()
  await asentar()
  pedidos.at(-1)!.entregar()
  await asentar()
}

describe('/negocios · adoptar una vista refrescada', () => {
  it('con dos páginas cargadas, la lista no se encoge a 30 mientras vuelve la relectura', async () => {
    expect(codigos()).toHaveLength(30)
    await verMas()
    expect(codigos()).toHaveLength(60)

    // Alguien asigna desde la lista: el servidor manda la vista nueva (primera página).
    universo = universo.map((n) => (n.id === 'id-70' ? abierto(70, '*') : n.id === 'id-20' ? abierto(20, '*') : n))
    root!.render(React.createElement(NegociosClient as never, props(vistaDe())))
    await asentar()

    // Siguen las 60, y el comienzo ya está fresco.
    expect(codigos()).toHaveLength(60)
    expect(codigos()[0]).toBe('V0070*')
    // La cola sigue con lo que había hasta que vuelva la relectura.
    expect(codigos()).toContain('V0020')

    const relectura = pedidos.at(-1)!
    expect(relectura.url.searchParams.get('desde')).toBe('0')
    expect(relectura.url.searchParams.get('cuantos')).toBe('60')

    relectura.entregar()
    await asentar()
    expect(codigos()).toHaveLength(60)
    expect(codigos()).toContain('V0020*')
    expect(codigos()).not.toContain('V0020')
    expect(new Set(codigos()).size).toBe(60)
  })

  it('con una sola página, la vista nueva reemplaza sin pedir nada', async () => {
    universo = universo.map((n) => (n.id === 'id-70' ? abierto(70, '*') : n))
    root!.render(React.createElement(NegociosClient as never, props(vistaDe())))
    await asentar()
    expect(codigos()).toHaveLength(30)
    expect(codigos()[0]).toBe('V0070*')
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('«Ver más» no repite una tarjeta que ya estaba (la lista se movió entre páginas)', async () => {
    // Llega un negocio nuevo antes de pedir la página 2: todo corre un lugar y la tarjeta
    // 41 (la última de la página 1) vuelve a venir al comienzo de la página 2.
    universo = [abierto(71), ...universo]
    await verMas()
    expect(codigos()).toHaveLength(59)
    expect(new Set(codigos()).size).toBe(codigos().length)
  })

  it('«Reintentar» tras un «Ver más» fallido pide ESA página, no la primera', async () => {
    ;(contenedor.querySelector('[data-ver-mas]') as HTMLElement).click()
    await asentar()
    pedidos.at(-1)!.fallar()
    await asentar()
    const alerta = contenedor.querySelector('[role="alert"]')
    expect(alerta).not.toBeNull()
    expect(codigos()).toHaveLength(30)

    ;(alerta!.querySelector('button') as HTMLElement).click()
    await asentar()
    const reintento = pedidos.at(-1)!
    expect(reintento.url.searchParams.get('desde')).toBe('30')
    reintento.entregar()
    await asentar()
    expect(codigos()).toHaveLength(60)
    expect(contenedor.querySelector('[role="alert"]')).toBeNull()
  })

  it('el aviso de error se limpia al adoptar una vista nueva', async () => {
    ;(contenedor.querySelector('[data-ver-mas]') as HTMLElement).click()
    await asentar()
    pedidos.at(-1)!.fallar()
    await asentar()
    expect(contenedor.querySelector('[role="alert"]')).not.toBeNull()

    root!.render(React.createElement(NegociosClient as never, props(vistaDe())))
    await asentar()
    expect(contenedor.querySelector('[role="alert"]')).toBeNull()
  })
})
