import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * C5 · LA BANDEJA DE LA FORMA POR PASOS montada con React de verdad sobre happy-dom:
 *
 *  · cada fila dice a dónde va (la frase), con su razón, y la frase se toca para cambiarla (M3:
 *    el menú solo ofrece servicios del mismo tipo);
 *  · un servicio nuevo de actividad marcado opcional llega «Opcional» y lo dice (P11);
 *  · «Aceptar los N» manda UN envío a la ruta del lote, en el orden en que se pegaron, con lo
 *    que dice cada frase (V4);
 *  · «o ✎ Escríbelo a mano» reemplaza a «Ingresar a mano» SOLO con la forma por pasos, y lo
 *    escrito lleva su marca «✎ a mano».
 */

const ventana = new Window({ url: 'https://agencia.metrikone.co/negocios/n/cotizacion/c' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'MutationObserver', 'KeyboardEvent', 'FileReader'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })
for (const k of ['addEventListener', 'removeEventListener'] as const) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: ventana[k].bind(ventana) })
}
Object.defineProperty(globalThis, 'innerHeight', { configurable: true, writable: true, value: 900 })

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }) }))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {}, dismiss: () => {} }) }))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({ quitarHabitacion: async () => ({ success: true }) }))
vi.mock('@/app/(app)/negocios/adicional-actions', () => ({}))
vi.mock('@/app/(app)/negocios/ranura-actions', () => ({}))

type ReactMod = typeof import('react')
let React: ReactMod
let createRoot: typeof import('react-dom/client').createRoot
let act: typeof import('react').act
let Bandeja: typeof import('./bandeja-capturas').default
let once: typeof import('../../../../test/caso-once-pantallazos')

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  Bandeja = (await import('./bandeja-capturas')).default
  once = await import('../../../../test/caso-once-pantallazos')
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
const envios: { url: string; cuerpo: Record<string, unknown> }[] = []

beforeEach(() => {
  envios.length = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const cuerpo = JSON.parse(String(init.body)) as Record<string, unknown>
    envios.push({ url, cuerpo })
    const filas = (cuerpo.filas ?? []) as { id: string }[]
    return new Response(JSON.stringify({
      ok: true, tarifas: null, valorTotal: 1,
      resultados: filas.map((f, i) => ({ id: f.id, resultado: { ok: true, itemId: `item-${i}`, donde: 'Hotel en San Andrés · Opción 1', pendiente: null, como: 'nueva', bloque: 'Hotel en San Andrés', opcion: 1 } })),
    }), { status: 200 })
  }))
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  contenedor.remove()
  vi.unstubAllGlobals()
})

type Receptor = import('./bandeja-capturas').ReceptorDeBandeja

async function montar(porPasos: boolean, items: unknown[] = []) {
  const receptor = React.createRef<Receptor>()
  await act(async () => {
    root!.render(React.createElement(Bandeja, {
      cotizacionId: 'cot-1', items: items as never, composicion: { adultos: 6, ninos: 1, infantes: 1 }, porPasos, receptor,
      destinoViaje: 'San Andrés y Providencia',
    }))
  })
  return receptor
}

/** Mete a la bandeja lecturas ya firmadas, como las que vuelven de una opción eliminada. */
async function meter(receptor: { current: Receptor | null }, pantallazos: import('../../../../test/caso-once-pantallazos').Pantallazo[]) {
  await act(async () => {
    receptor.current!.recibir({
      clave: `k-${Math.random()}`, itemId: 'ninguno',
      lecturas: pantallazos.map(p => ({ tipo: p.tipo, lecturaJson: JSON.stringify(p.lectura), firma: 'firma', pistas: p.pistas, imagen: null, huella: null })),
    })
  })
}

const clic = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const textoDe = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('C5 · la frase de cada fila', () => {
  it('dice a dónde va, con su razón; el menú solo ofrece servicios del mismo tipo', async () => {
    const r = await montar(true)
    const casos = once.onceDelCasoFijo()
    await meter(r, [casos[4], casos[8], casos[9]])
    const frases = [...contenedor.querySelectorAll('[data-frase-destino]')].map(b => textoDe(b))
    expect(frases).toContain('Suma aparte: Hotel en San Andrés ▾')
    // La lancha privada: la persona la vuelve «Otra opción de» la compartida, que sigue en la bandeja.
    const filaPrivada = [...contenedor.querySelectorAll('[data-captura]')].find(li => textoDe(li).includes('lancha privada'))!
    await clic(filaPrivada.querySelector('[data-frase-destino]')!)
    const menu = [...filaPrivada.querySelectorAll('[data-menu-frase] button')].map(b => textoDe(b))
    expect(menu[0]).toBe('Suma aparte (servicio nuevo)')
    expect(menu.some(m => /Cayo Cangrejo · lancha compartida \(en la bandeja\)/.test(m))).toBe(true)
    expect(menu.some(m => /Verde Mar|Hotel/.test(m))).toBe(false)
    await clic([...filaPrivada.querySelectorAll('[data-menu-frase] button')].find(b => /compartida/.test(textoDe(b)))!)
    const despues = [...contenedor.querySelectorAll('[data-captura]')].find(li => textoDe(li).includes('lancha privada'))!
    expect(textoDe(despues.querySelector('[data-frase-destino]'))).toMatch(/^Otra opción de: .*lancha compartida/)
    expect(textoDe(despues.querySelector('[data-razon-destino]'))).toBe('Lo cambiaste tú.')
  })

  it('P11 · la actividad marcada opcional llega «Opcional» y lo dice antes de aceptar', async () => {
    const r = await montar(true)
    await meter(r, [once.onceDelCasoFijo({ buceoOpcional: true })[10]])
    const sel = contenedor.querySelector('[data-estado-al-aceptar]') as HTMLSelectElement
    expect(sel.value).toBe('opcional')
    expect(textoDe(contenedor.querySelector('[data-motivo-opcional]'))).toMatch(/Es opcional: el cliente decide/)
    // Lo escrito a mano lleva su marca.
    expect(contenedor.querySelector('[data-marca-a-mano]')).not.toBeNull()
  })
})

describe('C5 · V4 · «Aceptar los N»', () => {
  it('manda UN envío a la ruta del lote, en el orden en que se pegaron, con lo que dice cada frase', async () => {
    const r = await montar(true)
    const casos = once.onceDelCasoFijo({ buceoOpcional: true })
    await meter(r, [casos[8]])
    await meter(r, [casos[9]])
    await meter(r, [casos[10]])
    const boton = contenedor.querySelector('[data-boton-aceptar-lote]')!
    expect(textoDe(boton)).toBe('Aceptar los 3')
    // La privada, como opción de la compartida que está en la bandeja.
    const filaPrivada = [...contenedor.querySelectorAll('[data-captura]')].find(li => textoDe(li).includes('lancha privada'))!
    await clic(filaPrivada.querySelector('[data-frase-destino]')!)
    await clic([...filaPrivada.querySelectorAll('[data-menu-frase] button')].find(b => /compartida/.test(textoDe(b)))!)
    await clic(contenedor.querySelector('[data-boton-aceptar-lote]')!)
    await act(async () => { await new Promise(res => setTimeout(res, 0)) })
    expect(envios.map(e => e.url)).toEqual(['/api/cotizaciones/cot-1/aceptar-lote'])
    const filas = envios[0].cuerpo.filas as { id: string; borrador: { decision: string; destinoId: string | null; tipo: string }; estado?: string; destinoCaptura?: string }[]
    expect(filas.map(f => f.borrador.tipo)).toEqual(['actividad', 'actividad', 'actividad'])
    const [compartida, privada, buceo] = filas
    expect(compartida.borrador.decision).toBe('auto')
    expect(privada).toMatchObject({ borrador: { decision: 'hermana' }, destinoCaptura: compartida.id })
    expect(buceo.estado).toBe('opcional')
    // Las tres quedan aceptadas en su fila.
    expect(contenedor.querySelectorAll('[data-frase-destino]')).toHaveLength(0)
  })
})

describe('C5 · «✎ Escríbelo a mano» solo con la forma por pasos', () => {
  it('con la forma por pasos reemplaza a «Ingresar a mano» y abre los cuatro tipos', async () => {
    await montar(true)
    expect(contenedor.querySelector('[data-abrir-ingreso-manual]')).toBeNull()
    await clic(contenedor.querySelector('[data-abrir-escrito-a-mano]')!)
    const tipos = [...contenedor.querySelectorAll('[data-tipo-a-mano]')].map(b => textoDe(b))
    expect(tipos).toEqual(['Vuelo', 'Hotel', 'Traslado', 'Actividad'])
    expect(textoDe(contenedor.querySelector('[data-escrito-a-mano]'))).toContain('Solo lo marcado con * es obligatorio.')
  })

  it('apagada, la bandeja es la de siempre: «Ingresar a mano», sin frase ni «Aceptar los N»', async () => {
    const r = await montar(false)
    expect(contenedor.querySelector('[data-abrir-ingreso-manual]')).not.toBeNull()
    expect(contenedor.querySelector('[data-abrir-escrito-a-mano]')).toBeNull()
    const casos = once.onceDelCasoFijo()
    await meter(r, [casos[4], casos[8]])
    expect(contenedor.querySelector('[data-frase-destino]')).toBeNull()
    expect(contenedor.querySelector('[data-aceptar-lote]')).toBeNull()
    expect(contenedor.querySelector('[data-marca-a-mano]')).toBeNull()
  })
})
