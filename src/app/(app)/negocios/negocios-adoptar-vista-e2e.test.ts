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

function vistaDe(pagina: { desde?: number; cuantos?: number } = {}, sp: Record<string, string> = {}) {
  return armarVistaLista(
    { abiertos: universo, cerrados: [], etapas: [], defaultStage: 'todos', hoyISO: '2026-10-03' },
    sp,
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
        const filtros = Object.fromEntries([...sp.entries()].filter(([k]) => k !== 'desde' && k !== 'cuantos'))
        const v = vistaDe({ desde: Number(sp.get('desde') ?? 0), cuantos: sp.has('cuantos') ? Number(sp.get('cuantos')) : undefined }, filtros)
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
  history.replaceState(null, '', '/negocios')
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

describe('/negocios · asignar con filtros puestos', () => {
  /**
   * El router de Next no se entera de los filtros (se escriben con `replaceState` sobre su
   * propio estado), así que tras una server action el servidor manda la vista SIN filtros.
   * Antes se adoptaba y la lista volvía a «todos» con cada asignación.
   */
  it('la vista que llega con la URL vieja no borra los filtros: se relee con ellos', async () => {
    // La persona busca «V006» desde la lista (la URL lo refleja, el router no).
    const buscador = contenedor.querySelector('input') as HTMLInputElement
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(buscador), 'value')!.set!
    set.call(buscador, 'V006')
    buscador.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 400))
    await asentar()
    pedidos.at(-1)!.entregar()
    await asentar()
    expect(location.search).toContain('q=V006')
    const filtradas = codigos()
    expect(filtradas.length).toBeGreaterThan(0)
    expect(filtradas.every((c) => c!.startsWith('V006'))).toBe(true)

    // Asigna en V0065: `revalidatePath` pinta la página con la URL de la carga, sin filtros.
    universo = universo.map((n) => (n.id === 'id-65' ? abierto(65, '*') : n))
    fetchFalso.mockClear()
    root!.render(React.createElement(NegociosClient as never, props(vistaDe())))
    await asentar()

    // Siguen los filtros y la lista filtrada, no las 30 de «todos».
    expect(location.search).toContain('q=V006')
    expect((contenedor.querySelector('input') as HTMLInputElement).value).toBe('V006')
    expect(codigos()).toEqual(filtradas)

    // Y se relee con los filtros puestos, que trae la asignación.
    const relectura = pedidos.at(-1)!
    expect(fetchFalso).toHaveBeenCalledTimes(1)
    expect(relectura.url.searchParams.get('q')).toBe('V006')
    relectura.entregar()
    await asentar()
    expect(codigos()).toContain('V0065*')
    expect(codigos().every((c) => c!.startsWith('V006'))).toBe(true)
  })

  it('una navegación de verdad a otros filtros sí se adopta', async () => {
    history.replaceState(null, '', '/negocios?q=V005')
    root!.render(React.createElement(NegociosClient as never, props(vistaDe({}, { q: 'V005' }))))
    await asentar()
    expect(fetchFalso).not.toHaveBeenCalled()
    expect(codigos().length).toBeGreaterThan(0)
    expect(codigos().every((c) => c!.startsWith('V005'))).toBe(true)
  })
})
