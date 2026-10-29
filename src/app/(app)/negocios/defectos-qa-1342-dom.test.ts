import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'

/**
 * Los defectos de la prueba real en navegador del #1342 (2026-10-29, Trappvel: bloqueo con tres
 * paquetes, uno Público), con las cifras que veía la asesora. Lo que pasa por las acciones del
 * servidor está en la batería (`bateria-cotizaciones-e2e.test.ts`, «QA del #1342»); aquí lo que se
 * pinta: la tarjeta del paquete con React de verdad sobre happy-dom, y «Tarifas», «Lo que suma»,
 * Revisar y la Confirmación renderizados.
 */

const ventana = new Window({ url: 'https://agencia.metrikone.co/negocios/n/cotizacion/c' })
const GLOBALES = ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Node', 'Element', 'Text', 'Event', 'MouseEvent', 'FocusEvent', 'MutationObserver', 'KeyboardEvent', 'FileReader', 'CustomEvent'] as const
for (const k of GLOBALES) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never)[k] })
}
Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: globalThis })
// Los eventos de la ventana («Ir» a la comisión), sobre la ventana de happy-dom.
for (const k of ['addEventListener', 'removeEventListener', 'dispatchEvent'] as const) {
  Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (ventana as never as Record<string, (...a: unknown[]) => unknown>)[k].bind(ventana) })
}

const ajustar = vi.hoisted(() => vi.fn(async (_id: string, _cambios: unknown) => ({ success: true })))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {}, dismiss: () => {} }) }))
vi.mock('@/app/(app)/negocios/bloqueo-actions', () => ({
  leerPantallazoBloqueo: async () => ({ ok: false, mensaje: 'x' }),
  crearPaqueteBloqueo: async () => ({ success: true, itemId: 'x' }),
  guardarPaqueteBloqueo: async (_id: string, entrada: { paquete: unknown }) => ({ success: true, paquete: entrada.paquete, costo: null, falta: [] }),
  ajustarReglasDelPaquete: ajustar,
}))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({}))
vi.mock('@/app/(app)/negocios/confirmacion-viaje-actions', () => ({
  aplicarPrerreservaSiVencio: async () => ({ ok: true, aplicada: false }),
  confirmarClienteViaje: async () => ({ ok: true }),
  decidirAprobacionPlan: async () => ({ ok: true }),
  marcarConfirmacionEnviada: async () => ({ ok: true }),
  pedirAprobacionPlan: async () => ({ ok: true }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

type ReactMod = typeof import('react')
let React: ReactMod
let act: typeof import('react').act
let createRoot: typeof import('react-dom/client').createRoot
let renderToStaticMarkup: typeof import('react-dom/server').renderToStaticMarkup
let Tarjeta: typeof import('./por-pasos/paquete-bloqueo').TarjetaPaqueteBloqueo
let paqueteVacio: typeof import('@/lib/cotizaciones/bloqueo-paquete').paqueteVacio

beforeAll(async () => {
  React = await import('react')
  act = React.act
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  createRoot = (await import('react-dom/client')).createRoot
  renderToStaticMarkup = (await import('react-dom/server')).renderToStaticMarkup
  Tarjeta = (await import('./por-pasos/paquete-bloqueo')).TarjetaPaqueteBloqueo
  paqueteVacio = (await import('@/lib/cotizaciones/bloqueo-paquete')).paqueteVacio
})

let contenedor: HTMLElement
let root: ReturnType<typeof createRoot> | null = null
beforeEach(() => {
  ajustar.mockClear()
  contenedor = document.createElement('div')
  document.body.appendChild(contenedor)
  root = createRoot(contenedor)
})
afterEach(() => {
  act(() => root?.unmount())
  contenedor.remove()
})

const texto = (el: Element = contenedor) => (el.textContent ?? '').replace(/\s+/g, ' ')
const textoHtml = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ').trim()
const clic = async (el: Element) => { await act(async () => { (el as HTMLElement).click() }) }
async function escribir(input: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!
  await act(async () => {
    setter.call(input, valor)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
}

/** El paquete Público de la prueba real: $4.300.000 de precio público (2 personas × $2.150.000). */
function paquetePublico(comision: { comisionPct?: number; comisionMonto?: number } | null) {
  const p = paqueteVacio('Aliados Travel')
  p.hotel.hotel = 'Hotel QA Mar Azul'
  p.hotel.precios = [{ acomodacion: 'doble', precioPorPersona: 2_150_000 }]
  p.distribucion = { habitaciones: { doble: 1 }, ninos: 0, infantes: 0, edadesNinos: [] }
  return { bloqueo: p, tipoTarifa: { tipo: 'publica', origen: 'persona', por: null, en: '', ...(comision ?? {}) } }
}

async function montar(tarifaPax: unknown, extra: Record<string, unknown> = {}) {
  await act(async () => {
    root!.render(React.createElement(Tarjeta, {
      cotizacionId: 'cot-1', itemId: 'pq-1', tarifaPax, precioVenta: 4_300_000, editable: true, operador: 'Aliados Travel',
      pasajeros: null, vueloSugerido: null, onCambio: () => {}, onEliminar: () => {}, registro: null, margenAplicado: 0,
      ...extra,
    }))
  })
}
const abrir = async () => {
  const b = [...contenedor.querySelectorAll('button')].find(x => x.textContent === 'Ver y editar el paquete')
  if (b) await clic(b)
}

// ── 1 y 2 · la tarjeta del paquete ─────────────────────────────────────────────

describe('defectos 1 y 2 · la tarjeta del paquete Público', () => {
  it('sin comisión: «Margen: falta la comisión», nunca «Margen 0 %»; el costo de la agencia no se sabe', async () => {
    await montar(paquetePublico(null))
    expect(contenedor.querySelector('[data-margen-paquete]')?.textContent).toBe('Margen: falta la comisión')
    expect(texto()).not.toContain('Margen 0 %')
    expect(contenedor.querySelector('[data-costo-agencia]')?.textContent).toContain('falta la comisión')
  })

  it('con $250.000 de comisión: el costo de la agencia es $4.050.000 y el margen su 5,8 %', async () => {
    await montar(paquetePublico({ comisionMonto: 250_000 }))
    expect(texto(contenedor.querySelector('[data-costo-agencia]')!)).toBe('Costo de la agencia $ 4.050.000')
    expect(contenedor.querySelector('[data-margen-paquete]')?.textContent).toBe('Margen 5,8 % (comisión)')
  })

  it('una Neta sigue diciendo su costo como siempre', async () => {
    const p = paquetePublico(null)
    await montar({ bloqueo: p.bloqueo, tipoTarifa: { tipo: 'neta', origen: 'persona', por: null, en: '' } }, { margenAplicado: 15 })
    expect(contenedor.querySelector('[data-costo-agencia]')).toBeNull()
    expect(texto()).toContain('Costo $ 4.300.000')
    expect(contenedor.querySelector('[data-margen-paquete]')?.textContent).toBe('Margen 15 %')
  })
})

// ── 8 · la comisión se guarda al salir de la casilla, y lo dice ─────────────────

describe('defecto 8 · la comisión del paquete se guarda cuando el texto dice', () => {
  it('paquete ya guardado como Pública: al salir de la casilla se guarda (sin «Guardar paquete»)', async () => {
    await montar(paquetePublico(null))
    await abrir()
    expect(texto(contenedor.querySelector('[data-comision-nota]')!)).toBe('Se guarda al salir de la casilla.')
    await escribir(contenedor.querySelector('input[aria-label="Comisión de la agencia en %"]') as HTMLInputElement, '15')
    expect(ajustar).toHaveBeenCalledWith('pq-1', { comisionPct: 15 })
  })

  it('en pesos, igual', async () => {
    await montar(paquetePublico(null))
    await abrir()
    await clic(contenedor.querySelector('[data-comision-tipo="monto"]')!)
    await escribir(contenedor.querySelector('input[aria-label="Comisión de la agencia en pesos"]') as HTMLInputElement, '250.000')
    expect(ajustar).toHaveBeenCalledWith('pq-1', { comisionMonto: 250_000 })
  })

  it('paquete nuevo: no se guarda sola y la casilla lo dice («Guardar paquete»)', async () => {
    await montar(null)
    const radio = [...contenedor.querySelectorAll('label')].find(l => l.textContent?.includes('Pública'))!.querySelector('input')!
    await clic(radio)
    expect(texto(contenedor.querySelector('[data-comision-nota]')!)).toBe('Se guarda con «Guardar paquete».')
    await escribir(contenedor.querySelector('input[aria-label="Comisión de la agencia en %"]') as HTMLInputElement, '15')
    expect(ajustar).not.toHaveBeenCalled()
  })
})

// ── 6 · «Va en la propuesta»: el cambio se ve en el acto ────────────────────────

describe('defecto 6 · «Va en la propuesta» responde en el acto y dice «Guardando…»', () => {
  const casilla = () => contenedor.querySelector('[data-paquete-en-propuesta] input') as HTMLInputElement

  it('se desmarca al tocarla, dice «Guardando…» y, aunque el refresco tarde, no vuelve atrás', async () => {
    let terminar!: (ok: boolean) => void
    const onEnPropuesta = vi.fn(() => new Promise<boolean>(r => { terminar = r }))
    await montar(paquetePublico({ comisionPct: 10 }), { enPropuesta: true, onEnPropuesta })
    await clic(casilla())
    expect(onEnPropuesta).toHaveBeenCalledWith(false)
    expect(casilla().checked).toBe(false)
    expect(contenedor.querySelector('[data-guardando-propuesta]')?.textContent).toContain('Guardando…')
    expect(casilla().disabled).toBe(true)
    await act(async () => { terminar(true) })
    expect(contenedor.querySelector('[data-guardando-propuesta]')).toBeNull()
    expect(casilla().checked).toBe(false)
    // Llega lo del servidor: manda.
    await montar(paquetePublico({ comisionPct: 10 }), { enPropuesta: false, onEnPropuesta })
    expect(casilla().checked).toBe(false)
  })

  it('si no se pudo, vuelve a como estaba', async () => {
    let terminar!: (ok: boolean) => void
    await montar(paquetePublico({ comisionPct: 10 }), { enPropuesta: true, onEnPropuesta: () => new Promise<boolean>(r => { terminar = r }) })
    await clic(casilla())
    expect(casilla().checked).toBe(false)
    await act(async () => { terminar(false) })
    expect(casilla().checked).toBe(true)
  })

  it('si el refresco trae el mismo valor de antes del clic, sigue lo guardado; si trae otro (la tarifa cambió), manda el servidor', async () => {
    let terminar!: (ok: boolean) => void
    const onEnPropuesta = () => new Promise<boolean>(r => { terminar = r })
    await montar(paquetePublico({ comisionPct: 10 }), { enPropuesta: true, onEnPropuesta })
    await clic(casilla())
    await act(async () => { terminar(true) })
    // Un refresco que todavía no trae lo nuevo (el de antes del clic): no vuelve atrás.
    await montar(paquetePublico({ comisionPct: 10 }), { enPropuesta: true, onEnPropuesta })
    expect(casilla().checked).toBe(false)
    // Al quitar la Recomendada su paquete pasa a otra tarifa: llega otro valor y manda ese.
    await montar(paquetePublico({ comisionPct: 10 }), { enPropuesta: false, onEnPropuesta })
    expect(casilla().checked).toBe(false)
    await montar(paquetePublico({ comisionPct: 10 }), { enPropuesta: true, onEnPropuesta })
    expect(casilla().checked).toBe(true)
  })
})

// ── 9 · «Ir» abre la tarjeta y enfoca la comisión ───────────────────────────────

describe('defecto 9 · «Ir» desde «Falta la comisión» abre la tarjeta y enfoca la casilla', () => {
  it('la tarjeta cerrada se abre en Pública y el foco queda en la comisión', async () => {
    const { pedirFocoEnComision } = await import('@/lib/cotizaciones/enfocar-comision')
    await montar(paquetePublico(null))
    expect(contenedor.querySelector('[data-comision-publica]')).toBeNull()
    // El evento abre la tarjeta (React pinta al cerrar `act`); la búsqueda de la casilla sigue después.
    let pedido!: Promise<boolean>
    await act(async () => { pedido = pedirFocoEnComision('pq-1', { intentos: 20, cadaMs: 5 }) })
    expect(await pedido).toBe(true)
    const input = contenedor.querySelector('[data-comision-publica] input') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(document.activeElement).toBe(input)
  })

  it('la lista única lleva el campo en el «Ir» de la comisión', async () => {
    const { listaUnica } = await import('@/lib/cotizaciones/lista-unica')
    const l = listaUnica({
      autorizacionDatos: null, sinPrecio: [], capturas: null, tarifas: [], salida: null, pantallazosPorAceptar: 0, texto: null,
      noVan: [], faltaDia: null, margenBajoAviso: null, recargo: null, viaje: null, ivaSinCalcular: null,
      publicasSinComision: [{ itemId: 'pq-1', nombre: 'Hotel QA Mar Azul' }],
    } as never)
    expect(l.impide.find(r => r.clave === 'comision-publica')!.ir).toEqual({ a: 'opcion', itemId: 'pq-1', campo: 'comision' })
  })
})

// ── 10 · Revisar: el paquete que va en una opción que no se manda ───────────────

describe('defecto 10 · Revisar dice dónde está el paquete que no sale', () => {
  it('en una opción que no se manda, lo dice así; en ninguna, como siempre', async () => {
    const { listaUnica, opcionesFueraDeLaPropuesta } = await import('@/lib/cotizaciones/lista-unica')
    const item = (id: string, orden: number) => ({ id, grupo: 'paquete de bloqueo: Paquete de bloqueo en San Andrés', opcion_de: null, es_ajuste: false, orden, dia_relativo: null, entra_al_precio: true, tarifa_pax: null })
    const items = [item('pq-a', 1), item('pq-b', 2), item('pq-c', 3)]
    const tarifas = [
      { id: 't1', nombre: 'Recomendada', orden: 1, vaEnPropuesta: true, seleccion: ['pq-a'] },
      { id: 't2', nombre: null, orden: 2, vaEnPropuesta: false, seleccion: ['pq-b'] },
    ]
    const fuera = opcionesFueraDeLaPropuesta(items as never, tarifas)
    const nombres: Record<string, string> = { 'pq-b': 'Hotel QA Mar Azul', 'pq-c': 'Hotel QA Brisa' }
    const l = listaUnica({
      autorizacionDatos: null, sinPrecio: [], capturas: null, tarifas, salida: null, pantallazosPorAceptar: 0, texto: null,
      noVan: [], faltaDia: null, margenBajoAviso: null, recargo: null, viaje: null, ivaSinCalcular: null,
      fueraDeLaPropuesta: fuera.map(o => ({ ...o, nombre: nombres[o.itemId] })),
    } as never)
    const textos = l.revisar.filter(r => r.clave.startsWith('fuera:')).map(r => r.texto)
    expect(textos).toEqual([
      'Hotel QA Mar Azul va en una opción que no se manda al cliente: no saldrá en la propuesta.',
      'Hotel QA Brisa no va en ninguna tarifa: no saldrá en la propuesta.',
    ])
  })
})

// ── 1, 2 y 5 · «Tarifas» y «Lo que suma» con la cascada real ────────────────────

describe('defectos 1, 2 y 5 · «Tarifas» y «Lo que suma» con un paquete Público', () => {
  const linea = (id: string, nombre: string, costo: number, orden: number, tarifaPax: unknown, margen: number | null) => ({
    id, nombre, grupo: 'paquete de bloqueo: Paquete de bloqueo en San Andrés', opcion_de: null, es_ajuste: false, orden, dia_relativo: null, entra_al_precio: true,
    cantidad: 1, subtotal: costo, numeroDeRubros: 0, costoDeRubros: 0, descuento_porcentaje: 0, margen_porcentaje: margen,
    precio_venta: 0, precio_manual: false, base_iva: null, pasajeros: null, tarifa_pax: tarifaPax, adicionales: [],
  })
  const publica = (c: { comisionMonto?: number } | null) => ({ tipoTarifa: { tipo: 'publica', origen: 'persona', por: null, en: '', ...(c ?? {}) } })
  const lineas = (c: { comisionMonto?: number } | null) => [
    linea('pq-a', 'Hotel QA Mar Azul', 4_300_000, 1, publica(c), 0),
    linea('pq-b', 'Hotel QA Brisa', 5_000_000, 2, null, 15),
    linea('pq-c', 'Hotel QA Coral', 6_000_000, 3, null, 15),
  ]
  const TARIFAS = [
    { id: 't1', nombre: 'Recomendada', orden: 1, vaEnPropuesta: true, seleccion: ['pq-a'] },
    { id: 't2', nombre: null, orden: 2, vaEnPropuesta: true, seleccion: ['pq-b'] },
    { id: 't3', nombre: null, orden: 3, vaEnPropuesta: true, seleccion: ['pq-c'] },
  ]

  async function pantalla(c: { comisionMonto?: number } | null) {
    const { TarifasPorPasos } = await import('./por-pasos/tarifas-por-pasos')
    const { LoQueSuma } = await import('./por-pasos/lo-que-suma')
    const vista = await import('@/lib/cotizaciones/por-pasos-vista')
    const { POLITICA_REGLAS_POR_DEFECTO } = await import('@/lib/cotizaciones/reglas-margen')
    const { costoDeAgencia, publicasSinComision } = await import('@/lib/cotizaciones/itinerarios')
    const params = { administrativosPct: 0, margenPct: 15, descuentoComercialPct: 0, convencionMargen: 'sobre_venta' as const, reglas: { politica: POLITICA_REGLAS_POR_DEFECTO, puntosExtra: 0, descuentos: [] } }
    const ls = lineas(c) as never
    const calculadas = vista.tarifasCalculadas(ls, params, TARIFAS)
    const total = vista.cascadaDelTotal(ls, params, TARIFAS)
    const margen = vista.margenDelEncabezado(total, params)
    const tarifas = renderToStaticMarkup(React.createElement(TarifasPorPasos, {
      tarifas: calculadas,
      servicios: [{ grupo: 'paquete de bloqueo: Paquete de bloqueo en San Andrés', tipo: 'paquete', nombre: 'Paquete de bloqueo', opciones: ['pq-a', 'pq-b', 'pq-c'], estado: 'incluido', lugar: null, fecha: null, candidatas: ['pq-a', 'pq-b', 'pq-c'] }] as never,
      iguales: [], opcionales: [], noVan: [],
      nombreDeOpcion: (id: string) => id, detalleDeOpcion: () => null, precioDeOpcion: () => 0,
      margenPct: 15, pisoPct: 5, avisoPct: 5, editable: true, ocupado: false, autorizacion: null,
      verElCalculo: null, rastro: null,
      onElegir: () => {}, onMandar: () => {}, onMargen: () => {}, onPedir: () => {}, onAutorizar: () => {}, onRetirar: () => {},
      onReponer: () => {}, onVerEnElViaje: () => {}, onRenombrar: () => {}, onEliminarTarifa: () => {}, onMotivo: () => {}, onSeguir: () => {},
      reglas: { puntosExtra: 0, puntosMax: 5, descuentos: [], pisoHotelPct: 0 },
      delTotal: { margenPct: margen, sinComision: publicasSinComision(total), hotelesBajoPiso: [] },
    }))
    const suma = renderToStaticMarkup(React.createElement(LoQueSuma, {
      datos: {
        renglones: [{ grupo: 'paquete de bloqueo: Paquete de bloqueo en San Andrés', nombre: 'Paquete de bloqueo', tipo: 'paquete', opcionId: 'pq-a', precio: total.precioVenta, noSuma: null, sinCosto: false, otras: [] }] as never,
        nombreDeOpcion: (id: string) => id, faltaPrecio: () => null,
        total: total.precioVenta, costo: costoDeAgencia(total), margenPct: margen, sinComision: publicasSinComision(total) > 0,
        otrasQueVan: calculadas.filter(t => !t.esPrincipal).map(t => ({ nombre: t.nombre ?? 'Tarifa', precio: t.precio })),
        pantallazosEnBandeja: 0, incompleto: false, rojos: 0,
      },
    }))
    return { tarifas: textoHtml(tarifas), suma: textoHtml(suma), margen }
  }

  it('defecto 1 · con $250.000 de comisión: «costo $4.050.000 · ganas $250.000 · margen global 5,8 %»', async () => {
    const { tarifas, suma } = await pantalla({ comisionMonto: 250_000 })
    expect(tarifas).toContain('costo $4.050.000 · ganas $250.000 · margen global 5,8 %')
    expect(tarifas).not.toMatch(/ganas \$ ?0\b/)
    expect(suma).toContain('Margen 5,8 % · costo $4.050.000')
  })

  it('defecto 2 · sin comisión: el encabezado y «Lo que suma» dicen que falta, no «margen 0 %»', async () => {
    const { tarifas, suma, margen } = await pantalla(null)
    expect(margen).toBeNull()
    expect(suma).toContain('Total $4.300.000 · margen falta la comisión')
    expect(suma).toContain('Margen y costo: falta la comisión de una tarifa Pública')
    expect(suma).not.toMatch(/margen 0 %|Margen 0 %/)
    expect(tarifas).toContain('costo y ganancia: falta la comisión')
    expect(tarifas).not.toMatch(/ganas \$ ?0\b/)
  })

  it('defecto 5 · las tarifas sin nombre son «Opción 2» y «Opción 3» en «Margen global» y en las pestañas', async () => {
    const { tarifas } = await pantalla({ comisionMonto: 250_000 })
    expect(tarifas).toMatch(/Margen global \(no se edita\): Recomendada 5,8 % · Opción 2 15 % · Opción 3 15 %/)
    expect(tarifas).not.toMatch(/\bTarifa\b(?! del| Pública)/)
  })
})

// ── 4 · el aviso del PDF de borrador caduca ─────────────────────────────────────

describe('defecto 4 · el aviso del PDF de borrador se va cuando la cotización cambia', () => {
  it('la huella cambia con la comisión, con un paquete nuevo y con lo que va; no con nada más', async () => {
    const { huellaDelAvisoDelPdf } = await import('@/lib/cotizaciones/aviso-pdf-borrador')
    const base = {
      items: [{ id: 'pq-a', subtotal: 4_300_000, precio_venta: 4_300_000, margen_porcentaje: 0 as number | null, cantidad: 1, tarifa_pax: paquetePublico({ comisionPct: 5.8 }) }],
      tarifas: [{ id: 't1', vaEnPropuesta: true, seleccion: ['pq-a'] }],
      cotizacion: { margen_porcentaje: 15, estado: 'borrador' },
    }
    const h = huellaDelAvisoDelPdf(base)
    expect(huellaDelAvisoDelPdf(structuredClone(base))).toBe(h)
    const conComision = structuredClone(base)
    ;(conComision.items[0].tarifa_pax.tipoTarifa as Record<string, unknown>).comisionPct = 15
    expect(huellaDelAvisoDelPdf(conComision)).not.toBe(h)
    const conPaquete = structuredClone(base)
    conPaquete.items.push({ id: 'pq-b', subtotal: 0, precio_venta: 0, margen_porcentaje: null, cantidad: 1, tarifa_pax: paquetePublico(null) })
    expect(huellaDelAvisoDelPdf(conPaquete)).not.toBe(h)
    const sinIr = structuredClone(base)
    sinIr.tarifas[0].vaEnPropuesta = false
    expect(huellaDelAvisoDelPdf(sinIr)).not.toBe(h)
  })
})

// ── 11 · la tarjeta de Confirmación no sale en un borrador ──────────────────────

describe('defecto 11 · «Confirmación · El cliente dijo sí» solo con algo que confirmar', () => {
  it('borrador sin confirmación: no sale; enviada: sale; con la confirmación registrada: sale siempre', async () => {
    const { default: Panel, cotizacionConfirmable } = await import('./[id]/confirmacion-viaje-panel')
    const { REGLA_POR_DEFECTO } = await import('@/lib/viaje/plan-pagos')
    expect(cotizacionConfirmable('borrador')).toBe(false)
    expect(cotizacionConfirmable('enviada')).toBe(true)
    expect(cotizacionConfirmable('aceptada')).toBe(true)
    const vista = (estado: string, confirmacion: unknown = null) => ({
      negocioId: 'n', workspaceId: 'w', cliente: { nombre: 'Ana', correo: null, telefono: null, contactoId: null },
      viaje: { destino: null, fechaSalida: null, fechaRegreso: null, composicion: null },
      regla: REGLA_POR_DEFECTO,
      cotizacion: { id: 'c', consecutivo: 'COT-1', estado, tarifaAceptadaId: null },
      tarifas: [], errorTarifas: null, plan: null, versiones: [], aprobacion: null, confirmacion, titular: null, prerreserva: null,
      estado: { confirmado: !!confirmacion, planVigente: false, anticipoConSoporte: false },
      gates: [], gateMensajes: {}, etapaConfirmacion: { id: 'e4', nombre: 'Confirmación', numero: 4 },
      etapaActual: { id: 'e2', nombre: 'Cotización', numero: 2, orden: 2 }, antesDeConfirmacion: true, enConfirmacion: false,
      terminosBase: null, agencia: 'Agencia', comercial: null, hayPago: false, aprobadores: [], prerreservaVencida: false,
    })
    const pintar = (v: unknown) => renderToStaticMarkup(React.createElement(Panel, { vista: v as never, puedeConfirmar: true, esDireccion: false }))
    expect(pintar(vista('borrador'))).toBe('')
    expect(textoHtml(pintar(vista('enviada')))).toContain('El cliente dijo sí')
    const conf = {
      fecha: '2026-10-29', total: 1, itinerario_id: null, tarifa_nombre: null, pantallazo: null, registrada_at: '2026-10-29T12:00:00Z',
      registrada_por: null, registrada_por_nombre: null, cotizacion_id: 'c', plan_id: 'p', mensaje: { enviado_at: null, enviado_por_nombre: null, texto: '' },
    }
    expect(textoHtml(pintar(vista('borrador', conf)))).toContain('El cliente confirmó el')
  })
})
