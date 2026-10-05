/**
 * Brief del 2026-10-05, «última limpieza de la cotización de Trappvel antes de presentar»,
 * puntos 0 a 4 y 6, con el negocio de prueba P2 26 1 (Providencia, 9–13 nov, 2 adultos + 1
 * infante). Mismo arnés que `actividad-pantallazo-e2e.test.ts`: las acciones REALES (incluidas
 * `marcarActividadEnCotizacion` y `actualizarDiaDeItem`) sobre un doble de Supabase que persiste,
 * la ruta REAL del editor y el editor REAL pintado, sin recargar y recargando.
 *
 * Lo que NO se puede afirmar sin navegador: el clic en el check y en el desplegable del día, el
 * área de toque en el celular, y los tiempos contra Vercel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { Composicion, LecturaCasilla } from '@/lib/cotizaciones/tarifa-pasajero'
import type { SalidaVista } from './margen-salida-actions'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
const GRUPO: Composicion = { adultos: 2, ninos: 0, infantes: 1 }
const FECHAS = { inicio: '2026-11-09', fin: '2026-11-13' }
const DESTINO = 'Providencia'

/** Lo que devuelve la lectura del pantallazo (el modelo), en orden de llamada. */
const lecturas = vi.hoisted(() => ({ cola: [] as unknown[] }))
/** Con qué lugar se pidió abrir cada bloque nuevo. */
const bloquesPedidos = vi.hoisted(() => ({ lugares: [] as (string | null | undefined)[] }))
/** La tarjeta se pinta abierta salvo cuando la prueba mira la tarjeta CERRADA. */
const vista = vi.hoisted(() => ({ abierta: true }))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }),
  useParams: () => ({ id: 'neg-1', cotId: 'cot-20' }),
}))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {} }) }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: clienteFalso(), workspaceId: 'ws-trappvel', userId: 'p-mauricio', error: null }),
}))
vi.mock('@/lib/modulos/exigir-modulo', () => ({
  exigirModulo: async () => ({ ok: true }),
  MENSAJE_MODULO_NO_ACTIVO: 'sin módulo',
  REQUISITO: { clarity: 'clarity' },
}))
vi.mock('@/lib/server-keys', () => ({ getServerKey: () => 'llave-de-prueba' }))
vi.mock('@/lib/cotizaciones/viaje-negocio', () => ({
  leerViajeDelNegocio: async () => ({
    viaje: { composicion: GRUPO, fechas: FECHAS, destino: DESTINO },
    error: null,
  }),
}))
vi.mock('@/lib/cotizaciones/leer-imagen-captura', () => ({
  leerImagenDeCaptura: async () => {
    const l = lecturas.cola.shift()
    if (!l) throw new Error('la prueba no dejó lectura en la cola')
    return { ok: true, leida: structuredClone(l) }
  },
}))
vi.mock('@/app/(app)/negocios/cotizacion-actions', () => ({
  getCotizacionItems: async (cotizacionId: string) => lineasConRubros(cotizacionId),
  recalcularTotales: async () => ({ success: true }),
  updateCotizacion: async () => ({ success: true }),
  enviarCotizacion: async () => ({ success: true }),
  duplicarCotizacion: async () => ({ success: true }),
  addItem: async () => ({ success: true }),
  updateItem: async () => ({ success: true }),
  deleteItem: async () => ({ success: true }),
  addRubro: async () => ({ success: true }),
  updateRubro: async () => ({ success: true }),
  deleteRubro: async () => ({ success: true }),
  addItemFromServicio: async () => ({ success: true }),
  aplicarAIU: async () => ({ success: true }),
  getRastroDeMargen: async () => ({ ok: true, entradas: [], alcance: 'negocio' }),
}))
vi.mock('@/app/(app)/negocios/adicional-actions', () => ({
  getAdicionalesDeCotizacion: async () => ({ disponible: true, porItem: {} }),
}))
vi.mock('@/app/(app)/config/servicios-actions', () => ({ getServiciosActivos: async () => [] }))
vi.mock('@/app/(app)/negocios/cotizacion-pdf-actions', () => ({ generateCotizacionPDF: async () => ({ success: true }) }))
vi.mock('@/app/(app)/negocios/pantallazo-actions', () => ({
  leerPantallazoDeItem: async () => ({ ok: false, codigo: 'RX1', motivo: '', instruccion: '' }),
  confirmarLecturaDePantallazo: async () => ({ success: true }),
  descartarPropuestaDePantallazo: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/recargo-actions', () => ({ aplicarRecargo: async () => ({ success: true }) }))
// El bloque nuevo nace como en `crearRanuraConOpcion`: con el lugar pedido, y sin él, con el
// destino del viaje (`lugar: pistas.lugar ?? viaje.destino`).
vi.mock('@/app/(app)/negocios/ranura-actions', async () => {
  const { grupoDeRanura, nombreAutomaticoDeRanura, siguienteNumeroDeTipo } = await import('@/lib/cotizaciones/ranuras-cotizacion')
  return {
    // Como en producción: la segunda actividad es «Actividad 2», cada una su bloque.
    crearRanuraConOpcion: async (cotizacionId: string, tipo: 'actividad', pistas: { lugar?: string | null } = {}) => {
      bloquesPedidos.lugares.push(pistas.lugar)
      const numero = siguienteNumeroDeTipo(tipo, (tablas.items ?? []).map(i => i.grupo as string))
      const nombre = nombreAutomaticoDeRanura({ tipo, lugar: pistas.lugar ?? DESTINO, numero, nombresEnUso: [] })
      const grupo = grupoDeRanura({ tipo, numero, nombre })
      const id = `item-${(tablas.items ?? []).length + 1}`
      tablas.items = [...(tablas.items ?? []), fila(id, cotizacionId, grupo, 'Opción 1', {}, (tablas.items ?? []).length + 1)]
      return { success: true, itemId: id, grupo, etiqueta: nombre }
    },
    agregarOpcionARanura: async () => ({ success: false, error: 'no se usa' }),
    detectarCaptura: async () => ({ ok: false, codigo: 'SIN_TIPO', mensaje: '' }),
    eliminarRanura: async () => ({ success: true, borradas: 0, desmarcadas: [] }),
  }
})
vi.mock('@/lib/cotizaciones/imagen-captura', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/cotizaciones/imagen-captura')>()),
  guardarImagenDeCaptura: async () => null,
  borrarImagenesDeCaptura: async () => {},
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso() }))
vi.mock('@/app/(app)/negocios/tarjeta-opcion', async importOriginal => {
  const real = await importOriginal<typeof import('./tarjeta-opcion')>()
  const Tarjeta = (props: Parameters<typeof real.default>[0]) => React.createElement(real.default, { ...props, abierta: vista.abierta })
  return { ...real, default: Tarjeta }
})

// ── El doble de la base (mismo patrón que `detalles-pantalla-e2e.test.ts`) ──────

function clienteFalso() {
  return { from: (tabla: string) => consulta(tabla) }
}

function consulta(tabla: string) {
  const filtros: [string, unknown][] = []
  let operacion: 'select' | 'update' | 'delete' | 'insert' = 'select'
  let payload: Fila | Fila[] = {}
  let embebeCotizacion = false
  const aplica = (f: Fila) => filtros.every(([c, v]) => f[c] === v)
  const ejecutar = () => {
    const filas = (tablas[tabla] ?? []).filter(aplica)
    if (operacion === 'update') {
      for (const f of filas) Object.assign(f, structuredClone(payload as Fila))
      return { data: filas, error: null }
    }
    if (operacion === 'delete') {
      tablas[tabla] = (tablas[tabla] ?? []).filter(f => !aplica(f))
      return { data: null, error: null }
    }
    if (operacion === 'insert') {
      const nuevas = (Array.isArray(payload) ? payload : [payload]).map((p, i) => ({ id: `${tabla}-${Date.now()}-${i}-${Math.random()}`, ...structuredClone(p) }))
      tablas[tabla] = [...(tablas[tabla] ?? []), ...nuevas]
      return { data: nuevas, error: null }
    }
    return {
      data: filas.map(f => {
        const salida = structuredClone(f)
        if (embebeCotizacion) salida.cotizaciones = { estado: 'borrador', negocio_id: 'neg-1', convencion_margen: 'sobre_venta' }
        return salida
      }),
      error: null,
    }
  }
  const api = {
    select(cols?: string) { embebeCotizacion = typeof cols === 'string' && cols.includes('cotizaciones('); return api },
    update(p: Fila) { operacion = 'update'; payload = p; return api },
    delete() { operacion = 'delete'; return api },
    insert(p: Fila | Fila[]) { operacion = 'insert'; payload = p; return api },
    eq(c: string, v: unknown) { filtros.push([c, v]); return api },
    order() { return api },
    async maybeSingle() { const r = ejecutar(); return { data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error } },
    async single() { const r = ejecutar(); return { data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error } },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(ejecutar()).then(res, rej) },
  }
  return api
}

function lineasConRubros(cotizacionId: string): Fila[] {
  return (tablas.items ?? [])
    .filter(i => i.cotizacion_id === cotizacionId)
    .map(i => ({
      ...structuredClone(i),
      rubros: (tablas.rubros ?? []).filter(r => r.item_id === i.id)
        .map(r => ({ ...structuredClone(r), valor_total: Number(r.cantidad) * Number(r.valor_unitario) })),
    }))
}

function fila(id: string, cot: string, grupo: string, nombre: string, tarifa: unknown, orden: number): Fila {
  return {
    id, cotizacion_id: cot, grupo, nombre, descripcion: null, orden,
    cantidad: 1, subtotal: 0, precio_venta: 0, descuento_porcentaje: 0, margen_porcentaje: null,
    precio_manual: false, es_ajuste: false, opcion_de: null, unidad: null, tarifa_pax: tarifa,
  }
}

const { aceptarCapturaDeBandeja, leerCapturaEnBorrador } = await import('./tarifa-pax-actions')
const { GET: leerVista } = await import('@/app/api/cotizaciones/[id]/vista/route')
const { interpretarVistaFresca, lineasParaPintar } = await import('@/lib/cotizaciones/vista-fresca')
const { default: CotizacionEditor } = await import('./cotizacion-editor')

// ── Las lecturas de COT-2026-0020 ──────────────────────────────────────────────

const COT = 'cot-20'

/** Ítem `51d8980e…`: $885.000 COP · 3 personas · 15 nov · Providencia. */
function lecturaCop(over: Partial<LecturaCasilla> = {}): LecturaCasilla {
  return {
    total: 885000,
    campos: [
      { label: 'Proveedor', valor: 'Civitatis' },
      { label: 'Actividad', valor: 'Excursión a Cayo Cangrejo' },
      { label: 'Ciudad', valor: 'Providencia' },
      { label: 'Fecha', valor: '2026-11-15' },
      { label: 'Personas', valor: '3' },
      { label: 'Moneda', valor: 'COP' },
      { label: 'Precio', valor: '885000' },
    ],
    moneda: 'COP',
    nombre: 'Excursión a Cayo Cangrejo',
    alertas: [],
    leidaEn: '2026-10-01T16:43:03.924Z',
    porTipo: [],
    identidad: { fecha: '2026-11-15', nombre: 'Excursión a Cayo Cangrejo' },
    ocupacion: { ninos: null, total: 3, adultos: null, infantes: null },
    descripcion: 'Ciudad: Providencia · Fecha: 2026-11-15 · Proveedor: Civitatis',
    notasCliente: [],
    aPagarAgencia: null,
    ocupacionDelItem: false,
    costoAgenciaOrigen: null,
    ...over,
  }
}

/** Lo que hace la bandeja: lee la captura (borrador firmado) y la acepta. */
async function pegarYAceptar(lectura: LecturaCasilla, pistaDelDetector: string | null) {
  lecturas.cola.push(lectura)
  const b = await leerCapturaEnBorrador(COT, 'actividad', 'data:image/png;base64,AAAA')
  if (!b.ok) throw new Error(b.mensaje)
  const r = await aceptarCapturaDeBandeja(COT, {
    tipo: 'actividad', lecturaJson: b.lecturaJson, firma: b.firma,
    pistas: { lugar: pistaDelDetector, origen: null, destino: null }, decision: 'auto', destinoId: null,
    imagen: null, correcciones: null,
  })
  if (!r.ok) throw new Error(r.mensaje)
  return { borrador: b, aceptada: r }
}

function pintar(items: unknown[], salida: SalidaVista | null = null) {
  return renderToStaticMarkup(React.createElement(CotizacionEditor, {
    salida,
    oportunidadId: 'neg-1',
    cotizacion: {
      id: COT, codigo: 'COT-2026-0020', consecutivo: 'COT-2026-0020', modo: 'detallada', estado: 'borrador',
      descripcion: null, valor_total: 0, margen_porcentaje: 15, costo_total: 0, fecha_envio: null,
      fecha_validez: null, descuento_porcentaje: 0, convencion_margen: 'sobre_venta',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialItems: items as any,
    umbrales: { pisoPct: 5, avisoPct: 10 },
    lineasPorTipo: true,
    composicionViaje: GRUPO,
    fechasViaje: FECHAS,
    destinoViaje: DESTINO,
  }))
}
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

function superficies(items: unknown[], salida: SalidaVista | null = null) {
  const html = pintar(items, salida)
  const t = texto(html)
  const tabla = texto(html.match(/<section aria-label="Costo y precio"[\s\S]*?<\/section>/)?.[0] ?? '')
  const hoja = texto(html.match(/<section aria-label="Así lo ve el cliente"[\s\S]*?<\/section>/)?.[0] ?? '')
  return {
    html,
    t,
    tabla,
    hoja,
    bloques: [...html.matchAll(/data-bloque-titulo[^>]*>([^<]+)</g)].map(m => m[1]),
    precioOpcion: t.match(/\$([\d.]+) Precio \$/)?.[1] ?? null,
    totalCotizacion: t.match(/Total de la cotización \$ ([\d.]+)/)?.[1] ?? null,
    costoLinea: tabla.match(/Total ([\d.]+) \$/)?.[1] ?? null,
    enLaHoja: hoja.match(/\$([\d.]+) Así sale esta opción/)?.[1] ?? null,
    avisosTarjeta: [...html.matchAll(/data-aviso-opcion[^>]*>[\s\S]*?<span>([^<]+)<\/span>/g)].map(m => m[1]),
    revisar: texto(html.match(/data-costo-pendiente[\s\S]*?<\/ul>/)?.[0] ?? ''),
  }
}

async function releida() {
  const r = await leerVista(new Request(`https://x/api/cotizaciones/${COT}/vista`), { params: Promise.resolve({ id: COT }) })
  const fresca = interpretarVistaFresca(await r.json())
  const pagina = { leidaEn: new Date(0).toISOString(), items: [] as unknown[], adicionalesPorItem: {} }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return superficies(lineasParaPintar(pagina as any, fresca, true).items)
}
const recargada = () => superficies(lineasConRubros(COT))
const lineaDeLaBase = (id: string) => lineasConRubros(COT).find(i => i.id === id)!

beforeEach(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secreto-de-prueba')
  tablas = { cotizaciones: [{ id: COT, estado: 'borrador', negocio_id: 'neg-1', valor_total: 0 }], items: [], rubros: [] }
  lecturas.cola = []
  bloquesPedidos.lugares = []
  vista.abierta = true
})
afterEach(() => vi.unstubAllEnvs())

// ── Las actividades del negocio de prueba ───────────────────────────────────

const { actualizarDiaDeItem, marcarActividadEnCotizacion } = await import('./itinerario-actions')
const { diasDelItinerario, sugeridosVisibles } = await import('@/lib/cotizaciones/dia-relativo')
const { itemsQueAportanAlTotal } = await import('@/lib/cotizaciones/itinerarios')
const { TEXTO_ACTIVIDAD_NO_VA } = await import('@/lib/cotizaciones/actividad-en-cotizacion')

/** Una actividad de Civitatis en COP para los 3 (el infante no paga), en Providencia. */
function actividad(nombre: string, fecha: string | null, total: number): LecturaCasilla {
  return lecturaCop({
    total,
    nombre,
    campos: [
      { label: 'Actividad', valor: nombre },
      { label: 'Ciudad', valor: 'Providencia' },
      ...(fecha ? [{ label: 'Fecha', valor: fecha }] : []),
      { label: 'Personas', valor: '3' },
      { label: 'Moneda', valor: 'COP' },
      { label: 'Precio', valor: String(total) },
    ],
    identidad: { nombre, ...(fecha ? { fecha } : {}) },
    descripcion: `Ciudad: Providencia${fecha ? ` · Fecha: ${fecha}` : ''}`,
  })
}

/** La tarjeta de una opción, por su id. */
const tarjetaDe = (html: string, id: string) =>
  html.match(new RegExp(`<div[^>]*data-tarjeta-opcion="${id}"[\\s\\S]*?(?=<div[^>]*data-tarjeta-opcion=|<\\/section>)`))?.[0] ?? ''
const avisosActividades = (html: string) => texto(html.match(/data-avisos-actividades[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '').trim()
const total = (s: { totalCotizacion: string | null }) => Number((s.totalCotizacion ?? '0').replace(/\./g, ''))

/** Las tres del criterio 2 de la aceptación: la del 13 nov, una sin fecha y otra fuera del viaje. */
async function tresActividades() {
  await pegarYAceptar(actividad('Excursión a Cayo Cangrejo', '2026-11-13', 885_000), 'Providencia')
  await pegarYAceptar(actividad('Snorkel en Crab Cay', null, 180_000), 'Providencia')
  await pegarYAceptar(actividad('Tour en lancha por la bahía de Manzanillo', '2026-11-15', 300_000), 'Providencia')
}

describe('punto 2 · la actividad llega con el día de su fecha', () => {
  it('13 nov en un viaje 9–13 nov llega Incluida en el Día 5; sin fecha o fuera del viaje, «Sin día»', async () => {
    await tresActividades()
    expect(lineaDeLaBase('item-1').dia_relativo).toBe(5)
    expect(lineaDeLaBase('item-2').dia_relativo ?? null).toBeNull()
    expect(lineaDeLaBase('item-3').dia_relativo ?? null).toBeNull()
    vista.abierta = false
    for (const s of [await releida(), recargada()]) {
      // Con la tarjeta CERRADA: el check, Incluida y el día con su fecha.
      const t1 = tarjetaDe(s.html, 'item-1')
      expect(t1).toContain('aria-label="Va en la cotización"')
      expect(t1).toMatch(/aria-pressed="true"[^>]*>Incluida en el precio/)
      expect(t1).toMatch(/<option value="5" selected="">Día 5 · viernes 13 nov<\/option>/)
      // Los días del viaje y ninguno más: no hay Día 6.
      expect(t1).toContain('Día 1 · lunes 9 nov')
      expect(t1).not.toContain('Día 6')
      // Sin día, la tarjeta lo pide.
      expect(texto(tarjetaDe(s.html, 'item-2'))).toContain('Elige el día')
      expect(texto(tarjetaDe(s.html, 'item-3'))).toContain('Elige el día')
    }
  })

  it('D4 · el bloque se nombra con el día y la actividad; la hoja del cliente sigue con la ranura', async () => {
    await tresActividades()
    const s = recargada()
    expect(s.t).toContain('Día 5 · Excursión a Cayo Cangrejo')
    expect(s.t).toContain('Snorkel en Crab Cay')
    expect(s.t).not.toMatch(/Actividad \d · Actividad en Providencia/)
    expect(s.hoja).not.toContain('DÍA 5')
  })
})

describe('puntos 1 y 3 · el día se elige entre 1 y N', () => {
  it('el Día 2 se guarda; el Día 6 no (el viaje tiene 5 días)', async () => {
    await tresActividades()
    expect((await actualizarDiaDeItem('item-2', { dia_relativo: 2 })).success).toBe(true)
    expect(lineaDeLaBase('item-2').dia_relativo).toBe(2)
    const r = await actualizarDiaDeItem('item-3', { dia_relativo: 6 })
    expect(r.success).toBe(false)
    expect(r.error).toBe('El viaje tiene 5 días: elige un día del 1 al 5.')
    expect(lineaDeLaBase('item-3').dia_relativo ?? null).toBeNull()
  })

  it('si las fechas cambian y el día queda fuera, la tarjeta lo avisa', async () => {
    await tresActividades()
    // Un día guardado antes de acortar el viaje (escrito como lo dejaría la base).
    const fila2 = tablas.items.find(i => i.id === 'item-2') as Fila
    fila2.dia_relativo = 7
    expect(texto(tarjetaDe(recargada().html, 'item-2'))).toContain('Tiene el Día 7 y el viaje ahora tiene 5 días: elige otro día.')
  })
})

describe('punto 4 (D1) · «Revisar y enviar» pide el día de la que suma sin día', () => {
  it('«Falta el día de …» con el itinerario en uso, y se va al ponerlo', async () => {
    await tresActividades()
    await actualizarDiaDeItem('item-2', { dia_relativo: 2 })
    expect(avisosActividades(recargada().html)).toBe('Falta el día de Tour en lancha por la bahía de Manzanillo.')
    await actualizarDiaDeItem('item-3', { dia_relativo: 4 })
    expect(avisosActividades(recargada().html)).toBe('')
  })
})

describe('punto 0 · Incluida, Opcional y No va', () => {
  async function conDias() {
    await tresActividades()
    await actualizarDiaDeItem('item-2', { dia_relativo: 2 })
    await actualizarDiaDeItem('item-3', { dia_relativo: 4 })
    await pegarYAceptar(actividad('Paseo en catamarán al atardecer', null, 240_000), 'Providencia')
  }
  const precioDe = (html: string, id: string) =>
    Number((texto(tarjetaDe(html, id)).match(/\$([\d.]+) (?:Precio|Opcional · no suma) \$/)?.[1] ?? '0').replace(/\./g, ''))

  it('Opcional no suma, muestra su precio por persona y no pide día; Incluida suma y pide el día', async () => {
    await conDias()
    const antes = total(recargada())
    const precio = precioDe(recargada().html, 'item-4')
    expect(precio).toBeGreaterThan(0)

    expect((await marcarActividadEnCotizacion('item-4', { modo: 'opcional' })).estado).toBe('opcional')
    let s = recargada()
    expect(total(s)).toBe(antes - precio)
    const t4 = texto(tarjetaDe(s.html, 'item-4'))
    expect(t4).toContain('Opcional · no suma')
    expect(t4).toMatch(/No suma al total · Adulto \$[\d.]+ · Infante \$0 por persona/)
    expect(tarjetaDe(s.html, 'item-4')).not.toContain('data-dia-del-viaje')
    expect(s.t).toContain('1 opcional, no suma')

    await marcarActividadEnCotizacion('item-4', { modo: 'incluida' })
    s = recargada()
    expect(total(s)).toBe(antes)
    expect(texto(tarjetaDe(s.html, 'item-4'))).toContain('Elige el día')

    await marcarActividadEnCotizacion('item-4', { modo: 'opcional' })
    expect(total(recargada())).toBe(antes - precio)
  })

  it('sin el check: se queda en su sitio y en gris, no suma, conserva su Día 2; con el check vuelve igual', async () => {
    await conDias()
    const antes = recargada()
    const orden = (html: string) => [...html.matchAll(/data-tarjeta-opcion="([^"]+)"/g)].map(m => m[1])
    const precio = precioDe(antes.html, 'item-2')

    expect((await marcarActividadEnCotizacion('item-2', { va: false })).estado).toBe('no_va')
    expect(lineaDeLaBase('item-2').dia_relativo).toBe(2)
    for (const s of [await releida(), recargada()]) {
      expect(orden(s.html)).toEqual(orden(antes.html))
      const t2 = tarjetaDe(s.html, 'item-2')
      expect(t2).toContain('data-actividad-estado="no_va"')
      expect(texto(t2)).toContain(TEXTO_ACTIVIDAD_NO_VA)
      expect(t2).toMatch(/<input type="checkbox"(?![^>]*checked)[^>]*aria-label="Va en la cotización"/)
      expect(total(s)).toBe(total(antes) - precio)
      expect(avisosActividades(s.html)).toContain('1 actividad no va: Snorkel en Crab Cay.')
    }

    await marcarActividadEnCotizacion('item-2', { va: true })
    const despues = recargada()
    expect(lineaDeLaBase('item-2').dia_relativo).toBe(2)
    expect(tarjetaDe(despues.html, 'item-2')).toMatch(/<option value="2" selected="">Día 2 · martes 10 nov<\/option>/)
    expect(total(despues)).toBe(total(antes))
    expect(avisosActividades(despues.html)).not.toContain('no va')
  })

  it('una Opcional sin el check vuelve Opcional al marcarla', async () => {
    await conDias()
    await marcarActividadEnCotizacion('item-4', { modo: 'opcional' })
    await marcarActividadEnCotizacion('item-4', { va: false })
    expect((await marcarActividadEnCotizacion('item-4', { va: true })).estado).toBe('opcional')
  })

  it('el documento: la que no va no sale; la opcional sale en «Opcionales» y no en el día a día; ninguna que se cobra es «no incluida»', async () => {
    await conDias()
    await marcarActividadEnCotizacion('item-4', { modo: 'opcional' })
    await marcarActividadEnCotizacion('item-2', { va: false })
    const items = lineasConRubros(COT).map(i => ({
      id: i.id as string, grupo: i.grupo as string, orden: i.orden as number, opcion_de: null, es_ajuste: false,
      dia_relativo: (i.dia_relativo ?? null) as number | null,
      entra_al_precio: (i.entra_al_precio ?? null) as boolean | null,
      mostrar_en_sugeridos: (i.mostrar_en_sugeridos ?? null) as boolean | null,
    }))
    expect(diasDelItinerario(items)).toEqual([{ dia: 4, itemIds: ['item-3'] }, { dia: 5, itemIds: ['item-1'] }])
    expect(sugeridosVisibles(items)).toEqual(['item-4'])
    expect(itemsQueAportanAlTotal(items).sort()).toEqual(['item-1', 'item-3'])
  })

  it('solo una actividad lleva el check: un vuelo no sale del precio por aquí', async () => {
    tablas.items.push(fila('vuelo-1', COT, 'vuelo', 'SATENA', {}, 9))
    const r = await marcarActividadEnCotizacion('vuelo-1', { va: false })
    expect(r.success).toBe(false)
    expect(lineaDeLaBase('vuelo-1').entra_al_precio ?? true).toBe(true)
  })
})

