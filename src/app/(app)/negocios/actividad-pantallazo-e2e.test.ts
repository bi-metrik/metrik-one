/**
 * La actividad por pantallazo carga su costo con el infante gratis (brief del 2026-10-01,
 * «actividad por pantallazo»), con el negocio de prueba P2 26 1: 2 adultos + 1 infante, del 9
 * al 13 de noviembre, destino Providencia. Las lecturas son las de COT-2026-0020 tal como
 * quedaron guardadas (Civitatis, «Excursión a Cayo Cangrejo», COP y EUR).
 *
 * Corre las acciones REALES sobre un doble de Supabase que persiste (el de
 * `detalles-pantalla-e2e.test.ts`), relee por la ruta REAL del editor y pinta el editor REAL.
 * Cada criterio se mira sin recargar (lo que relee `refrescar()`) y recargando (la base).
 *
 * Lo que NO se puede afirmar sin navegador: el clic, el foco de la casilla al pegar, el tiempo
 * real de la lectura contra Vercel y el celular. Eso va al recorrido en pantalla (C3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { precioPorPasajeroDeItem } from '@/lib/cotizaciones/precio-pasajero-pdf'
import { casillasDe, leerTarifaPax, resolverTarifa, type Composicion, type LecturaCasilla } from '@/lib/cotizaciones/tarifa-pasajero'
import { esAvisoFechasFueraDelViaje } from '@/lib/cotizaciones/ingreso-manual'
import { revisarBorrador } from '@/lib/cotizaciones/revisar-borrador'

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
  const { grupoDeRanura, nombreAutomaticoDeRanura } = await import('@/lib/cotizaciones/ranuras-cotizacion')
  return {
    crearRanuraConOpcion: async (cotizacionId: string, tipo: 'actividad', pistas: { lugar?: string | null } = {}) => {
      bloquesPedidos.lugares.push(pistas.lugar)
      const nombre = nombreAutomaticoDeRanura({ tipo, lugar: pistas.lugar ?? DESTINO, numero: 1, nombresEnUso: [] })
      const grupo = grupoDeRanura({ tipo, numero: 1, nombre })
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
vi.mock('@/app/(app)/negocios/itinerario-actions', () => ({
  agregarOpcionAItem: async () => ({ success: true }),
  actualizarRanuraDeItem: async () => ({ success: true }),
  actualizarDiaDeItem: async () => ({ success: true }),
}))
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

const { aceptarCapturaDeBandeja, confirmarTarifaPorPasajero, leerCapturaEnBorrador, leerCasillaDeItem } = await import('./tarifa-pax-actions')
const { GET: leerVista } = await import('@/app/api/cotizaciones/[id]/vista/route')
const { interpretarVistaFresca, lineasParaPintar } = await import('@/lib/cotizaciones/vista-fresca')
const { default: CotizacionEditor } = await import('./cotizacion-editor')

// ── Las lecturas de COT-2026-0020 ──────────────────────────────────────────────

const COT = 'cot-20'
const AVISO_3_PERSONAS = 'El pantallazo dice 3 personas sin separar adultos y menores: se toma 2 adultos y 1 infante. Confírmalo.'

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

/** Ítem `9a3f53fb…`: 233,37 EUR · 3 personas · 13 nov · sin ciudad. */
function lecturaEur(): LecturaCasilla {
  return lecturaCop({
    total: 233.37,
    moneda: 'EUR',
    campos: [
      { label: 'Actividad', valor: 'Excursión a Cayo Cangrejo' },
      { label: 'Fecha', valor: '2026-11-13' },
      { label: 'Idioma', valor: 'español' },
      { label: 'Personas', valor: '3' },
      { label: 'Moneda', valor: 'EUR' },
      { label: 'Precio', valor: '233.37' },
    ],
    alertas: [
      'La captura no muestra: proveedor, ciudad. La línea conserva los datos que ya tiene: complétalos si hace falta.',
      'El precio está en EUR. Escribe la tasa de cambio antes de confirmar: el sistema no inventa una.',
    ],
    identidad: { fecha: '2026-11-13', nombre: 'Excursión a Cayo Cangrejo' },
    descripcion: 'Fecha: 2026-11-13 · Idioma: español',
  })
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

function pintar(items: unknown[]) {
  return renderToStaticMarkup(React.createElement(CotizacionEditor, {
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
const pesos = (n: number) => n.toLocaleString('es-CO')
const veces = (t: string, aguja: string) => t.split(aguja).length - 1

function superficies(items: unknown[]) {
  const html = pintar(items)
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

// ── Criterio 1 ───────────────────────────────────────────────────────────────

describe('criterio 1 · actividad en COP con infante: UN pantallazo carga el costo', () => {
  it('885.000 para 3 personas: Adulto 442.500 × 2, Infante $0, precio 1.041.176; tabla = hoja = PDF = total', async () => {
    const { aceptada } = await pegarYAceptar(lecturaCop(), 'Providencia')
    expect(aceptada.pendiente).toBeNull()
    const precio = Math.round(885_000 / 0.85)
    expect(precio).toBe(1_041_176)
    for (const s of [await releida(), recargada()]) {
      expect(s.costoLinea).toBe('885.000')
      expect(s.tabla).toMatch(/Adulto 2 442\.500/)
      expect(s.tabla).toMatch(/Infante 1 0 /)
      expect(s.precioOpcion).toBe(pesos(precio))
      expect(s.enLaHoja).toBe(pesos(precio))
      expect(s.totalCotizacion).toBe(pesos(precio))
      // No se pide el pantallazo 2.
      expect(s.t).not.toContain('Solo adultos')
      expect(s.t).not.toContain('Falta el 2')
    }
    // Los rubros: el costo del grupo entre los adultos, el infante en 0.
    const rubros = (tablas.rubros ?? []).map(r => [r.descripcion, r.cantidad, r.valor_unitario])
    expect(rubros).toEqual([['Adulto', 2, 442_500], ['Infante', 1, 0]])
    // El PDF: el precio de cada pasajero sale del mismo reparto.
    const linea = { ...lineaDeLaBase('item-1'), precio_venta: precio }
    const pdf = precioPorPasajeroDeItem(linea as never, GRUPO)
    expect(pdf).toEqual([
      { tipo: 'adulto', cantidad: 2, precioUnitario: precio / 2 },
      { tipo: 'infante', cantidad: 1, precioUnitario: 0 },
    ])
    const hoja = recargada().hoja
    expect(hoja).toContain(`Adulto $${pesos(precio / 2)}`)
    expect(hoja).toContain('Infante $0')
  })

  it('criterio 2 del pedido · «3 personas» incluye al infante: no se divide entre 3', () => {
    const e = resolverTarifa(GRUPO, { grupo_completo: lecturaCop() }, 'actividad_detalle')
    expect(e.estado).toBe('resuelta')
    if (e.estado !== 'resuelta') return
    expect(e.costos.map(c => [c.tipo, c.cantidad, c.unitario])).toEqual([['adulto', 2, 442_500], ['infante', 1, 0]])
    expect(e.costoTotal).toBe(885_000)
    expect(casillasDe(GRUPO, 'actividad_detalle').map(c => c.clave)).toEqual(['grupo_completo'])
  })
})

// ── Criterio 2 ───────────────────────────────────────────────────────────────

describe('criterio 2 · EUR sin tasa: lo dicen la tarjeta cerrada y «Revisar y enviar»', () => {
  it('falta la tasa; al escribirla el costo carga sin otro pantallazo', async () => {
    const { aceptada } = await pegarYAceptar(lecturaEur(), 'Cayo Cangrejo')
    expect(aceptada.pendiente).toContain('falta la tasa de cambio')
    const aviso = 'El precio está en EUR: escribe la tasa de cambio para cargar el costo.'
    vista.abierta = false
    for (const s of [await releida(), recargada()]) {
      expect(s.avisosTarjeta).toContain(aviso)
      expect(s.revisar).toContain(aviso)
      expect(s.precioOpcion).toBe('0')
    }
    // Escribo la tasa (lo que hace «Confirmar y cargar el costo» con la tasa escrita).
    const r = await confirmarTarifaPorPasajero('item-1', 4500)
    expect(r.success, r.error).toBe(true)
    // ⚠️ El unitario en EUR se redondea al centavo ANTES de pasar a pesos (`resolverTarifa`, igual
    // que en «solo adultos» de siempre): 233,37 / 2 = 116,685 → 116,69 × 4.500 × 2 = 1.050.210, 45
    // pesos sobre 233,37 × 4.500. Es del motor de antes, no de este cambio: queda anotado.
    const costo = Math.round(233.37 / 2 * 100) / 100 * 4500 * 2
    vista.abierta = true
    for (const s of [await releida(), recargada()]) {
      expect(s.avisosTarjeta).not.toContain(aviso)
      expect(s.revisar).toBe('')
      expect(s.costoLinea).toBe(pesos(Math.round(costo)))
    }
    expect((tablas.rubros ?? []).map(x => [x.descripcion, x.cantidad])).toEqual([['Adulto', 2], ['Infante', 1]])
  })
})

// ── Criterio 3 ───────────────────────────────────────────────────────────────

describe('criterio 3 · sin ciudad en el pantallazo, el bloque lleva la ciudad del viaje', () => {
  it('«Actividad en Providencia», no «Actividad en Cayo Cangrejo» (el detector dijo Cayo Cangrejo)', async () => {
    const { borrador } = await pegarYAceptar(lecturaEur(), 'Cayo Cangrejo')
    expect(bloquesPedidos.lugares).toEqual([null])
    expect(lineaDeLaBase('item-1').grupo).toBe('actividad: Actividad en Providencia')
    for (const s of [await releida(), recargada()]) {
      expect(s.t).toContain('Actividad en Providencia')
      expect(s.t).not.toContain('Actividad en Cayo Cangrejo')
    }
    // Lo que la fila de la bandeja dice antes de aceptar es lo mismo.
    const rev = revisarBorrador({
      capId: 'c1', borrador: { tipo: 'actividad', lectura: borrador.lectura, lecturaJson: borrador.lecturaJson, firma: borrador.firma, pistas: { lugar: 'Cayo Cangrejo', origen: null, destino: null } },
      lineas: [], comparables: [], composicion: GRUPO, ubicaciones: {}, comparar: false, destinoViaje: DESTINO,
    })
    expect(rev.donde).toBe('Actividad en Providencia · nuevo')
  })

  it('con ciudad en el pantallazo, esa ciudad', async () => {
    await pegarYAceptar(lecturaCop(), 'Cayo Cangrejo')
    expect(bloquesPedidos.lugares).toEqual(['Providencia'])
  })
})

// ── Criterio 4 ───────────────────────────────────────────────────────────────

describe('criterio 4 · fecha fuera del viaje: aviso en la bandeja y en la tarjeta', () => {
  const aviso = 'La actividad es el 15 nov 2026 y el viaje es del 9 nov 2026 al 13 nov 2026. Revisa la fecha.'

  it('15 nov en un viaje del 9 al 13: la fila lo trae como aviso de fechas y la tarjeta lo pinta, cerrada y abierta', async () => {
    const { borrador } = await pegarYAceptar(lecturaCop(), 'Providencia')
    expect(borrador.alertas).toContain(aviso)
    // La fila de la bandeja lo pinta como texto (mismo estilo que el del hotel, `data-aviso-fechas`).
    expect(borrador.alertas.filter(esAvisoFechasFueraDelViaje)).toEqual([aviso])
    for (const abierta of [false, true]) {
      vista.abierta = abierta
      for (const s of [await releida(), recargada()]) expect(s.avisosTarjeta).toContain(aviso)
    }
  })

  it('13 nov (dentro del viaje): sin aviso', async () => {
    const { borrador } = await pegarYAceptar(lecturaEur(), null)
    expect(borrador.alertas.some(esAvisoFechasFueraDelViaje)).toBe(false)
    expect(recargada().avisosTarjeta.some(a => a.startsWith('La actividad es el'))).toBe(false)
  })
})

// ── Criterio 5 ───────────────────────────────────────────────────────────────

describe('criterio 5 · cada aviso sale una sola vez', () => {
  it('el aviso de «3 personas» queda una vez en `alertas` y una vez en pantalla', async () => {
    await pegarYAceptar(lecturaEur(), null)
    const alertas = leerTarifaPax(lineaDeLaBase('item-1').tarifa_pax).casillas?.grupo_completo?.alertas ?? []
    expect(alertas.filter(a => a === AVISO_3_PERSONAS)).toHaveLength(1)
    // En crudo, también (no solo al leer).
    const crudo = (lineaDeLaBase('item-1').tarifa_pax as { casillas: { grupo_completo: { alertas: string[] } } }).casillas.grupo_completo.alertas
    expect(crudo.filter(a => a === AVISO_3_PERSONAS)).toHaveLength(1)
    for (const s of [await releida(), recargada()]) expect(veces(s.t, AVISO_3_PERSONAS)).toBeLessThanOrEqual(1)
  })

  it('las lecturas guardadas antes (COT-2026-0020, con el aviso duplicado) se leen sin repetir', () => {
    const t = leerTarifaPax({ casillas: { grupo_completo: { ...lecturaCop(), alertas: [AVISO_3_PERSONAS, AVISO_3_PERSONAS] } } })
    expect(t.casillas?.grupo_completo?.alertas).toEqual([AVISO_3_PERSONAS])
  })
})

// ── Criterio 6: lo que no cambia ───────────────────────────────────────────────

describe('criterio 6 · hotel y vuelo siguen como hoy; la actividad con niños también', () => {
  const unTotal = (over: Partial<LecturaCasilla> = {}) => lecturaCop({ ocupacion: { adultos: 2, ninos: 0, infantes: 1, total: 3 }, ...over })

  it('hotel con infante y un solo total: sigue pidiendo el pantallazo 2 «Solo adultos»', () => {
    expect(casillasDe(GRUPO, 'hotel_detalle').map(c => c.clave)).toEqual(['grupo_completo', 'solo_adultos'])
    const e = resolverTarifa(GRUPO, { grupo_completo: unTotal() }, 'hotel_detalle')
    expect(e.estado).toBe('falta')
    if (e.estado === 'falta') expect(e.mensaje).toBe('Este pantallazo tiene un solo total para el grupo. Falta el 2: busca con 2 adultos.')
  })

  it('vuelo con infante y un solo total: igual que hoy', () => {
    expect(resolverTarifa(GRUPO, { grupo_completo: unTotal() }, 'vuelo_detalle').estado).toBe('falta')
  })

  it('actividad con un NIÑO: no se inventa el reparto, sigue pidiendo las búsquedas (decisión pendiente de Mauricio)', () => {
    const conNino: Composicion = { adultos: 2, ninos: 1, infantes: 0 }
    const e = resolverTarifa(conNino, { grupo_completo: unTotal({ ocupacion: { adultos: 2, ninos: 1, infantes: 0, total: 3 } }) }, 'actividad_detalle')
    expect(e.estado).toBe('falta')
    const conAmbos: Composicion = { adultos: 2, ninos: 1, infantes: 1 }
    expect(casillasDe(conAmbos, 'actividad_detalle').map(c => c.clave)).toEqual(['grupo_completo', 'sin_infantes', 'solo_adultos'])
  })
})

// ── Criterio 7 ───────────────────────────────────────────────────────────────

describe('criterio 7 · hotel con infante: el pantallazo 2 queda en su casilla', () => {
  const hotel = (total: number, ocupacion: LecturaCasilla['ocupacion']): LecturaCasilla => lecturaCop({
    total,
    ocupacion,
    nombre: 'PRUEBA Posada del Mar',
    campos: [{ label: 'Hotel', valor: 'PRUEBA Posada del Mar' }, { label: 'Ciudad', valor: 'Providencia' }],
    identidad: { hotel: 'PRUEBA Posada del Mar', check_in: '2026-11-09', check_out: '2026-11-13' },
    descripcion: '',
  })

  it('el 1 sigue ahí, el 2 queda en «solo adultos» y el costo se reparte por resta', async () => {
    tablas.items = [fila('item-h', COT, 'hotel', 'PRUEBA POSADA DEL MAR', {}, 1)]
    lecturas.cola.push(hotel(1_200_000, { adultos: 2, ninos: 0, infantes: 1, total: 3 }))
    const r1 = await leerCasillaDeItem('item-h', 'grupo_completo', 'data:image/png;base64,AAAA')
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.mensaje).toBe('Este pantallazo tiene un solo total para el grupo. Falta el 2: busca con 2 adultos.')

    lecturas.cola.push(hotel(1_200_000, { adultos: 2, ninos: 0, infantes: 0, total: 2 }))
    const r2 = await leerCasillaDeItem('item-h', 'solo_adultos', 'data:image/png;base64,BBBB')
    expect(r2.ok, r2.ok ? '' : r2.mensaje).toBe(true)

    const t = leerTarifaPax(lineaDeLaBase('item-h').tarifa_pax)
    expect(t.casillas?.grupo_completo?.ocupacion.infantes).toBe(1)
    expect(t.casillas?.solo_adultos?.ocupacion.adultos).toBe(2)
    // Mismo precio en las dos: el infante no paga en ese hotel, y la tarjeta lo pide confirmar.
    const e = resolverTarifa(GRUPO, t.casillas ?? {}, 'hotel_detalle')
    expect(e.estado).toBe('confirmar_menor_no_paga')
  })

  it('cada casilla tiene su «Subir foto»: el archivo elegido va a ESA casilla, no a «Cambiar pantallazo»', async () => {
    tablas.items = [fila('item-h', COT, 'hotel', 'PRUEBA POSADA DEL MAR', {}, 1)]
    lecturas.cola.push(hotel(1_200_000, { adultos: 2, ninos: 0, infantes: 1, total: 3 }))
    expect((await leerCasillaDeItem('item-h', 'grupo_completo', 'data:image/png;base64,AAAA')).ok).toBe(true)
    for (const s of [await releida(), recargada()]) {
      expect(s.html).toContain('data-subir-casilla="grupo_completo"')
      expect(s.html).toContain('data-subir-casilla="solo_adultos"')
    }
  })
})
