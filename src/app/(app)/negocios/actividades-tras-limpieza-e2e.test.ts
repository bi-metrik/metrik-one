/**
 * Brief del 2026-10-05, «tres fallas de actividades que dejó ver la prueba de #1023», con el
 * negocio de prueba P2 26 1 (Providencia, 9–13 nov, 2 adultos + 1 infante) y las actividades de
 * COT-2026-0021. Mismo arnés que `limpieza-presentar-e2e.test.ts`: las acciones REALES
 * (`aceptarCapturaDeBandeja`, `marcarActividadEnCotizacion`, `actualizarDiaDeItem`) sobre un doble
 * de Supabase que persiste, la ruta REAL del editor y el editor REAL pintado, sin recargar
 * (`releida`) y recargando (`recargada`).
 *
 * Lo que NO se puede afirmar sin navegador: el clic en el check, en «Opcional» y en el desplegable
 * del día; el PDF generado en producción; los tiempos contra Vercel.
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
    // Como en producción: la opción nueva entra en el MISMO grupo de la ranura.
    agregarOpcionARanura: async (cotizacionId: string, grupo: string) => {
      const id = `item-${(tablas.items ?? []).length + 1}`
      tablas.items = [...(tablas.items ?? []), fila(id, cotizacionId, grupo, 'Opción 2', {}, (tablas.items ?? []).length + 1)]
      return { success: true, itemId: id, grupo }
    },
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

const { actualizarDiaDeItem, marcarActividadEnCotizacion } = await import('./itinerario-actions')
const { diasDelItinerario, sugeridosVisibles } = await import('@/lib/cotizaciones/dia-relativo')
const { itemsQueAportanAlTotal } = await import('@/lib/cotizaciones/itinerarios')
const { leerTarifaPax } = await import('@/lib/cotizaciones/tarifa-pasajero')

/**
 * Una actividad de COT-2026-0021: sin ciudad y sin fecha, en COP. `personas` es lo que dice la
 * captura: «2 personas» (solo el total), «2 adultos» (la tabla por tipo, como el buceo) o 3.
 */
function sinCiudadNiFecha(nombre: string, total: number, personas: 'personas' | 'adultos' | 'tres'): LecturaCasilla {
  return lecturaCop({
    total,
    nombre,
    campos: [
      { label: 'Proveedor', valor: 'Civitatis' },
      { label: 'Actividad', valor: nombre },
      { label: 'Duración', valor: '2 horas' },
      { label: 'Personas', valor: personas === 'tres' ? '3' : '2' },
      { label: 'Moneda', valor: 'COP' },
      { label: 'Precio', valor: String(total) },
    ],
    identidad: { nombre },
    descripcion: 'Duración: 2 horas · Proveedor: Civitatis',
    ocupacion: personas === 'personas'
      ? { adultos: null, ninos: null, infantes: null, total: 2 }
      : personas === 'adultos'
        ? { adultos: 2, ninos: null, infantes: null, total: null }
        // El snorkel de COT-2026-0021: «2 adultos, 0 niños, 1 infante».
        : { adultos: 2, ninos: 0, infantes: 1, total: 3 },
    porTipo: personas === 'adultos' ? [{ tipo: 'adulto', cantidad: 2, subtotal: total }] : [],
  } as Partial<LecturaCasilla>)
}

const KAYAK = () => sinCiudadNiFecha('Paseo en kayak por el manglar de McBean', 280_000, 'personas')
const BUCEO = () => sinCiudadNiFecha('Clase de buceo para principiantes', 427_500, 'adultos')

const tarjetaDe = (html: string, id: string) =>
  html.match(new RegExp(`<div[^>]*data-tarjeta-opcion="${id}"[\\s\\S]*?(?=<div[^>]*data-tarjeta-opcion=|<\\/section>)`))?.[0] ?? ''
const total = (s: { totalCotizacion: string | null }) => Number((s.totalCotizacion ?? '0').replace(/\./g, ''))
const precioDe = (html: string, id: string) =>
  Number((texto(tarjetaDe(html, id)).match(/\$([\d.]+) (?:Precio|Opcional · no suma) \$/)?.[1] ?? '0').replace(/\./g, ''))
const conDia = () => lineasConRubros(COT).map(i => ({
  id: i.id as string, grupo: i.grupo as string, orden: i.orden as number, opcion_de: null, es_ajuste: false,
  dia_relativo: (i.dia_relativo ?? null) as number | null,
  entra_al_precio: (i.entra_al_precio ?? null) as boolean | null,
  mostrar_en_sugeridos: (i.mostrar_en_sugeridos ?? null) as boolean | null,
}))

describe('criterio 1 · dos actividades sin ciudad ni fecha suman, cada una en su bloque', () => {
  it('el buceo no entra como «Opción 2» del kayak: dos bloques y las dos suman al total', async () => {
    // El detector no dijo lugar (la captura no lo muestra): lo que pasó en COT-2026-0021.
    const kayak = await pegarYAceptar(KAYAK(), null)
    const buceo = await pegarYAceptar(BUCEO(), null)
    expect(kayak.aceptada.como).toBe('nueva')
    expect(buceo.aceptada.como).toBe('nueva')
    const [l1, l2] = [lineaDeLaBase(kayak.aceptada.itemId), lineaDeLaBase(buceo.aceptada.itemId)]
    expect(l1.grupo).not.toBe(l2.grupo)
    expect(itemsQueAportanAlTotal(conDia()).sort()).toEqual([l1.id, l2.id].sort())
    for (const s of [await releida(), recargada()]) {
      expect(s.t).not.toContain('2 opciones')
      expect(s.t).not.toContain('Opción 2')
      const p1 = precioDe(s.html, l1.id as string)
      const p2 = precioDe(s.html, l2.id as string)
      expect(p1).toBeGreaterThan(0)
      expect(p2).toBeGreaterThan(0)
      expect(total(s)).toBe(p1 + p2)
    }
  })

  it('«Agregar como otra opción» de la misma actividad con otro precio sí la vuelve alternativa', async () => {
    const kayak = await pegarYAceptar(KAYAK(), null)
    lecturas.cola.push({ ...KAYAK(), total: 300_000 })
    const b = await leerCapturaEnBorrador(COT, 'actividad', 'data:image/png;base64,AAAA')
    if (!b.ok) throw new Error(b.mensaje)
    const r = await aceptarCapturaDeBandeja(COT, {
      tipo: 'actividad', lecturaJson: b.lecturaJson, firma: b.firma, pistas: { lugar: null, origen: null, destino: null },
      decision: 'opcion', destinoId: kayak.aceptada.itemId, imagen: null, correcciones: null,
    })
    if (!r.ok) throw new Error(r.mensaje)
    expect(r).toMatchObject({ como: 'hermana', opcion: 2 })
    expect(lineaDeLaBase(r.itemId).grupo).toBe(lineaDeLaBase(kayak.aceptada.itemId).grupo)
    // Alternativas: entra una sola.
    expect(itemsQueAportanAlTotal(conDia())).toHaveLength(1)
  })
})

describe('criterio 2 · el día se conserva entre Incluida, Opcional y No va', () => {
  async function kayakEnDia2() {
    const { aceptada } = await pegarYAceptar(KAYAK(), null)
    expect((await actualizarDiaDeItem(aceptada.itemId, { dia_relativo: 2 })).success).toBe(true)
    return aceptada.itemId
  }
  const diaSeleccionado = (html: string, id: string) => tarjetaDe(html, id).match(/<option value="(\d+)" selected="">/)?.[1] ?? null

  it('Día 2 → Opcional → Incluida: vuelve con el Día 2', async () => {
    const id = await kayakEnDia2()
    expect((await marcarActividadEnCotizacion(id, { modo: 'opcional' })).estado).toBe('opcional')
    expect(lineaDeLaBase(id).dia_relativo).toBe(2)
    // Opcional: no sale en el día a día; sí en «Opcionales».
    expect(diasDelItinerario(conDia())).toEqual([])
    expect(sugeridosVisibles(conDia())).toEqual([id])
    for (const s of [await releida(), recargada()]) expect(tarjetaDe(s.html, id)).not.toContain('data-dia-del-viaje')

    expect((await marcarActividadEnCotizacion(id, { modo: 'incluida' })).estado).toBe('incluida')
    expect(lineaDeLaBase(id).dia_relativo).toBe(2)
    expect(diasDelItinerario(conDia())).toEqual([{ dia: 2, itemIds: [id] }])
    for (const s of [await releida(), recargada()]) {
      expect(diaSeleccionado(s.html, id)).toBe('2')
      expect(texto(tarjetaDe(s.html, id))).not.toContain('Elige el día')
    }
  })

  it('con el check quitado y puesto otra vez (vuelve Opcional), y luego Incluida: Día 2', async () => {
    const id = await kayakEnDia2()
    await marcarActividadEnCotizacion(id, { modo: 'opcional' })
    expect((await marcarActividadEnCotizacion(id, { va: false })).estado).toBe('no_va')
    expect(lineaDeLaBase(id).dia_relativo).toBe(2)
    expect((await marcarActividadEnCotizacion(id, { va: true })).estado).toBe('opcional')
    expect(lineaDeLaBase(id).dia_relativo).toBe(2)
    await marcarActividadEnCotizacion(id, { modo: 'incluida' })
    expect(lineaDeLaBase(id).dia_relativo).toBe(2)
    for (const s of [await releida(), recargada()]) expect(diaSeleccionado(s.html, id)).toBe('2')
  })

  it('Opcional e Incluida mueven el total como en #1023', async () => {
    const id = await kayakEnDia2()
    const antes = total(recargada())
    const precio = precioDe(recargada().html, id)
    expect(precio).toBeGreaterThan(0)
    await marcarActividadEnCotizacion(id, { modo: 'opcional' })
    expect(total(recargada())).toBe(antes - precio)
    await marcarActividadEnCotizacion(id, { modo: 'incluida' })
    expect(total(recargada())).toBe(antes)
  })
})

describe('criterio 3 · la actividad de los adultos queda «Completo», sin aviso de infante', () => {
  const bloquesCompletos = (html: string) => (html.match(/<\/svg> Completo</g) ?? []).length

  it('«2 personas» (kayak) y «2 adultos» (buceo) en el viaje 2A+1I: los dos bloques completos', async () => {
    const kayak = await pegarYAceptar(KAYAK(), null)
    const buceo = await pegarYAceptar(BUCEO(), null)
    for (const id of [kayak.aceptada.itemId, buceo.aceptada.itemId]) {
      expect(leerTarifaPax(lineaDeLaBase(id).tarifa_pax).confirmada).toBeTruthy()
    }
    for (const s of [await releida(), recargada()]) {
      expect(s.t).not.toContain('por acomodar')
      expect(s.html).not.toContain('data-estado-bloque')
      expect(bloquesCompletos(s.html)).toBe(2)
      expect(s.t).toContain('2 bloques · 2 completos')
      expect(s.t).not.toContain('requiere')
    }
  })

  it('el buceo de COT-2026-0021: la línea cubre «2 adultos» (sin el infante) y no falta nadie', async () => {
    const { actualizarComposicionDeItem, confirmarTarifaPorPasajero } = await import('./tarifa-pax-actions')
    const { aceptada } = await pegarYAceptar(BUCEO(), null)
    // Como quedó en producción: la línea dice 2 adultos y el costo se confirmó para ellos.
    expect((await actualizarComposicionDeItem(aceptada.itemId, { adultos: 2, ninos: 0, infantes: 0 })).success).toBe(true)
    expect((await confirmarTarifaPorPasajero(aceptada.itemId, null)).success).toBe(true)
    expect(leerTarifaPax(lineaDeLaBase(aceptada.itemId).tarifa_pax).composicion).toEqual({ adultos: 2, ninos: 0, infantes: 0 })
    for (const s of [await releida(), recargada()]) {
      expect(s.html).not.toContain('data-estado-bloque')
      expect(s.t).toContain('1 bloque · 1 completo')
    }
    // La casilla del pantallazo («Esta línea cubre: …»), donde salía «Faltan 1 infante por acomodar».
    const { default: TarifaPasajeroItem } = await import('./tarifa-pasajero-item')
    const { definicionDeTipo } = await import('@/lib/cotizaciones/ranuras-cotizacion')
    const casilla = (ranura: 'actividad' | 'hotel') => texto(renderToStaticMarkup(React.createElement(TarifaPasajeroItem, {
      itemId: aceptada.itemId, ranura: definicionDeTipo(ranura), composicionViaje: GRUPO,
      tarifaPax: lineaDeLaBase(aceptada.itemId).tarifa_pax, costoUnitarioLinea: 0, onCambio: () => {},
    })))
    expect(casilla('actividad')).toContain('Esta línea cubre: 2 adultos')
    expect(casilla('actividad')).not.toContain('por acomodar')
    // Un hotel con la misma ocupación sigue diciendo quién falta, en singular.
    expect(casilla('hotel')).toContain('Falta 1 infante por acomodar.')
  })

  it('la de 3 personas (2 adultos + 1 bebé) sigue completa', async () => {
    await pegarYAceptar(sinCiudadNiFecha('Snorkel en Crab Cay', 600_000, 'tres'), 'Providencia y Santa Catalina')
    const s = recargada()
    expect(s.html).not.toContain('data-estado-bloque')
    expect(s.t).toContain('1 bloque · 1 completo')
  })
})
