/**
 * Detalles de pantalla de la cotización de Trappvel (brief del 2026-10-01), con el negocio de
 * prueba P2 26 1: 2 adultos + 1 infante, 9 al 13 de noviembre.
 *
 * Corre las acciones REALES sobre un doble de Supabase que persiste (el mismo de
 * `tarjeta-se-refresca-e2e.test.ts`), relee por la ruta REAL del editor y pinta el editor REAL.
 * Cada criterio se mira dos veces: sin recargar (lo que relee `refrescar()`) y recargando (lo que
 * hay en la base).
 *
 * Lo que NO se puede afirmar sin navegador: el clic, el tiempo real contra Supabase y el
 * celular. Eso va al recorrido en pantalla (C3).
 *
 * Se queda en `.ts` por el `include` de vitest.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { tarifaConHabitaciones } from '@/lib/cotizaciones/habitaciones'
import { hotelesDeItems } from '@/lib/cotizaciones/detalle-viaje'
import { lecturaManual, type HotelManual, type TrasladoManual } from '@/lib/cotizaciones/ingreso-manual'
import { nombreVisibleDeLinea } from '@/lib/cotizaciones/nombre-visible'
import { precioPorPasajeroDeItem } from '@/lib/cotizaciones/precio-pasajero-pdf'
import { ranuraPorSlug } from '@/lib/cotizaciones/ranuras-pantallazo'
import { textosDeTarjetaHotel } from '@/lib/pdf/cotizacion-trappvel-formato'
import { leerTarifaPax, type Composicion, type LecturaCasilla } from '@/lib/cotizaciones/tarifa-pasajero'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
const GRUPO: Composicion = { adultos: 2, ninos: 0, infantes: 1 }

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }),
  useParams: () => ({ id: 'neg-1', cotId: 'cot-19' }),
}))
vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {} }) }))
// La sesión, con el memo de las rutas (`memo-de-ruta.ts`): cuenta cuántas veces se resuelve.
const sesiones = vi.hoisted(() => ({ n: 0 }))
vi.mock('@/lib/actions/get-workspace', async () => {
  const { memoDeRuta } = await import('@/lib/actions/memo-de-ruta')
  return {
    getWorkspace: memoDeRuta(async () => {
      sesiones.n++
      return { supabase: clienteFalso(), workspaceId: 'ws-trappvel', userId: 'p-mauricio', error: null }
    }),
  }
})
vi.mock('@/lib/modulos/exigir-modulo', () => ({
  exigirModulo: async () => ({ ok: true }),
  MENSAJE_MODULO_NO_ACTIVO: 'sin módulo',
  REQUISITO: { clarity: 'clarity' },
}))
vi.mock('@/lib/server-keys', () => ({ getServerKey: () => 'llave-de-prueba' }))
vi.mock('@/lib/cotizaciones/viaje-negocio', () => ({
  leerViajeDelNegocio: async () => ({
    viaje: { composicion: GRUPO, fechas: { inicio: '2026-11-09', fin: '2026-11-13' } },
    error: null,
  }),
}))
// Lo que lee la página y la ruta: las líneas con sus rubros (`select('*, rubros(*)')`).
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
vi.mock('@/app/(app)/negocios/ranura-actions', () => ({
  crearRanuraConOpcion: async () => ({ success: true, itemId: 'x', grupo: 'hotel' }),
  agregarOpcionARanura: async () => ({ success: true, itemId: 'x', grupo: 'hotel' }),
  detectarCaptura: async () => ({ ok: false, codigo: 'SIN_TIPO', mensaje: '' }),
  eliminarRanura: async () => ({ success: true, borradas: 0, desmarcadas: [] }),
}))
// La habitación de la bandeja es de ingreso manual: no hay imagen que subir.
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

// La única pieza de UI que se toca: la tarjeta se pinta ABIERTA, como la tiene la persona
// cuando confirma o corrige (una opción confirmada nace contraída y un render estático no
// puede hacer clic). Todo lo demás —props, cálculos, textos— es el editor real.
vi.mock('@/app/(app)/negocios/tarjeta-opcion', async importOriginal => {
  const real = await importOriginal<typeof import('./tarjeta-opcion')>()
  const Abierta = (props: Parameters<typeof real.default>[0]) => React.createElement(real.default, { ...props, abierta: true })
  return { ...real, default: Abierta }
})

// ── El doble de la base (mismo patrón que `tarifa-pax-actions.test.ts`) ─────────

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
      // `rubros.valor_total` es una columna calculada en la base (cantidad × valor unitario).
      rubros: (tablas.rubros ?? []).filter(r => r.item_id === i.id)
        .map(r => ({ ...structuredClone(r), valor_total: Number(r.cantidad) * Number(r.valor_unitario) })),
    }))
}

const {
  aceptarCapturaDeBandeja, confirmarTarifaPorPasajero, marcarHabitacionQueVa,
} = await import('./tarifa-pax-actions')
const { firmarBorrador } = await import('@/lib/cotizaciones/firma-borrador')
const { POST: aceptarPorLaRuta } = await import('@/app/api/cotizaciones/[id]/aceptar-captura/route')
const { GET: leerVista } = await import('@/app/api/cotizaciones/[id]/vista/route')
const { interpretarVistaFresca, lineasParaPintar } = await import('@/lib/cotizaciones/vista-fresca')
const { default: CotizacionEditor } = await import('./cotizacion-editor')
const { TEXTO_NO_VA } = await import('./tarjeta-opcion')

// ── Los datos: el negocio de prueba P2 26 1 (2 adultos + 1 infante, 9-13 nov) ──────────────

const HOTEL = ranuraPorSlug('hotel_detalle')!
const TRASLADO = ranuraPorSlug('traslado_detalle')!
const COT = 'cot-p2'
const ITEM = 'item-hotel'
const ITEM_T = 'item-traslado'

const habitacion = (over: Partial<HotelManual> = {}): LecturaCasilla => {
  const r = lecturaManual({
    ranura: HOTEL,
    entrada: {
      tipo: 'hotel',
      datos: {
        hotel: 'PRUEBA Posada del Mar', ciudad: 'Providencia', entrada: '2026-11-09', salida: '2026-11-13',
        habitacion: 'Doble estándar', regimen: 'Desayuno y cena', incluye: '', adultos: 1, ninos: 0, infantes: 0,
        netoAdulto: 100_000, netoNino: null, netoInfante: null, edadDesde: 2, edadHasta: 11,
        fuente: 'Telefónico', ...over,
      },
    },
    leidaEn: '2026-10-01T15:00:00Z',
    hoy: '2026-10-01',
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errores))
  return r.lectura
}

/** El traslado de la prueba del 2026-09-28: 45.000 por persona por trayecto, ida y regreso. */
const traslado = (over: Partial<TrasladoManual> = {}): LecturaCasilla => {
  const r = lecturaManual({
    ranura: TRASLADO,
    entrada: {
      tipo: 'traslado',
      datos: {
        ruta: 'Aeropuerto - hotel', fecha: '2026-11-09', adultos: 2, ninos: 0, infantes: 1, cobro: 'por_persona',
        precio: 'por_trayecto', neto: 45_000, netoNino: null, netoInfante: null, idaYRegreso: true,
        fuente: 'Portafolio Dolphins 2026', ...over,
      },
    },
    leidaEn: '2026-10-01T15:00:00Z',
    hoy: '2026-10-01',
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errores))
  return r.lectura
}

/** 1 adulto a 100.000 la noche (400.000), 1 adulto + 1 infante (400.000), 1 adulto a 120.000 (480.000). */
const R1 = () => habitacion()
const R2 = () => habitacion({ hotel: 'Hotel PRUEBA Posada del Mar', infantes: 1, netoInfante: 0 })
const R3 = () => habitacion({ netoAdulto: 120_000 })

function fila(id: string, grupo: string, nombre: string, tarifa: unknown, orden: number): Fila {
  return {
    id, cotizacion_id: COT, grupo, nombre, descripcion: null, orden,
    cantidad: 1, subtotal: 0, precio_venta: 0, descuento_porcentaje: 0, margen_porcentaje: null,
    precio_manual: false, es_ajuste: false, opcion_de: null, unidad: null, tarifa_pax: tarifa,
  }
}

function sembrarHotel(habitaciones: { id: string; lectura: LecturaCasilla }[]) {
  tablas = {
    cotizaciones: [{ id: COT, estado: 'borrador', negocio_id: 'neg-1', valor_total: 0 }],
    // El nombre como lo guarda Trappvel: en mayúscula (`aMayusculas` al confirmar la lectura).
    items: [fila(ITEM, 'hotel', 'PRUEBA POSADA DEL MAR · PROVIDENCIA', tarifaConHabitaciones({}, habitaciones, GRUPO), 1)],
    rubros: [],
  }
}

function sembrarTraslado(lectura: LecturaCasilla) {
  tablas = {
    cotizaciones: [{ id: COT, estado: 'borrador', negocio_id: 'neg-1', valor_total: 0 }],
    items: [fila(ITEM_T, 'traslado', (lectura.nombre ?? '').toLocaleUpperCase('es-CO'), {
      casillas: { grupo_completo: { ...lectura, paraComposicion: GRUPO } },
      composicion: GRUPO,
    }, 1)],
    rubros: [],
  }
}

function pintar(items: unknown[]) {
  return renderToStaticMarkup(React.createElement(CotizacionEditor, {
    oportunidadId: 'neg-1',
    cotizacion: {
      id: COT, codigo: 'COT-2026-0021', consecutivo: 'COT-2026-0021', modo: 'detallada', estado: 'borrador',
      descripcion: null, valor_total: 0, margen_porcentaje: 15, costo_total: 0, fecha_envio: null,
      fecha_validez: null, descuento_porcentaje: 0, convencion_margen: 'sobre_venta',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialItems: items as any,
    umbrales: { pisoPct: 5, avisoPct: 10 },
    lineasPorTipo: true,
    composicionViaje: GRUPO,
    fechasViaje: { inicio: '2026-11-09', fin: '2026-11-13' },
  }))
}
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const conMargen = (costo: number) => Math.round(costo / 0.85)
const pesos = (n: number) => n.toLocaleString('es-CO')

/** Lo que la persona ve en el editor, por superficie. */
function superficies(items: unknown[]) {
  const html = pintar(items)
  const t = texto(html)
  const tabla = texto(html.match(/<section aria-label="Costo y precio"[\s\S]*?<\/section>/)?.[0] ?? '')
  const hoja = texto(html.match(/<section aria-label="Así lo ve el cliente"[\s\S]*?<\/section>/)?.[0] ?? '')
  const alojamiento = texto(html.match(/<section aria-label="Alojamiento"[\s\S]*?<\/section>/)?.[0] ?? '')
  return {
    html,
    t,
    tabla,
    hoja,
    alojamiento,
    /** «1 bloque · 1 completo» del paso Componentes. */
    resumen: t.match(/\d+ bloques? · \d+ complet[oa]s?(?: · \d+ requieren? atención)?/)?.[0] ?? null,
    /** El precio de la opción, en su cabecera. */
    precioOpcion: t.match(/\$([\d.]+) Precio \$/)?.[1] ?? null,
    totalCotizacion: t.match(/Total de la cotización \$ ([\d.]+)/)?.[1] ?? null,
    costoLinea: tabla.match(/Total ([\d.]+) \$/)?.[1] ?? null,
    /** El precio de la opción al pie de «Así lo ve el cliente». */
    enLaHoja: hoja.match(/\$([\d.]+) Así sale esta opción/)?.[1] ?? null,
  }
}

/** Lo que pinta el editor después de una acción: relee por la ruta, como `refrescar()`. */
async function releida() {
  const r = await leerVista(new Request(`https://x/api/cotizaciones/${COT}/vista`), { params: Promise.resolve({ id: COT }) })
  const fresca = interpretarVistaFresca(await r.json())
  const pagina = { leidaEn: new Date(0).toISOString(), items: [] as unknown[], adicionalesPorItem: {} }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return superficies(lineasParaPintar(pagina as any, fresca, true).items)
}
/** Recargar la página: lo que hay en la base, sin nada en memoria. */
const recargada = () => superficies(lineasConRubros(COT))

const itemDeLaBase = (id: string) => lineasConRubros(COT).find(i => i.id === id)!

beforeEach(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secreto-de-prueba')
  sesiones.n = 0
})
afterEach(() => vi.unstubAllEnvs())

// ── Punto 1 ──────────────────────────────────────────────────────────────────

describe('punto 1 · el resumen de Componentes dice lo mismo que la tarjeta', () => {
  it('con solo una habitación de 1 adulto: NO dice «completo» y nombra a los mismos que la tarjeta', async () => {
    sembrarHotel([{ id: 'r1', lectura: R1() }])
    expect((await confirmarTarifaPorPasajero(ITEM, null)).success).toBe(true)
    for (const s of [await releida(), recargada()]) {
      expect(s.alojamiento).toContain('Faltan 1 adulto y 1 infante: pega su habitación.')
      expect(s.resumen).toBe('1 bloque · 0 completos · 1 requiere atención')
      expect(s.t).not.toContain('1 bloque · 1 completo')
    }
  })

  it('al aceptar desde la bandeja la habitación que falta, pasa a completo', async () => {
    sembrarHotel([{ id: 'r1', lectura: R1() }])
    expect((await confirmarTarifaPorPasajero(ITEM, null)).success).toBe(true)
    const lecturaJson = JSON.stringify(R2())
    const r = await aceptarCapturaDeBandeja(COT, {
      tipo: 'hotel', lecturaJson, firma: firmarBorrador(COT, 'hotel', lecturaJson)!,
      pistas: { lugar: 'Providencia', origen: null, destino: null }, decision: 'habitacion', destinoId: ITEM,
      imagen: null, correcciones: null,
    })
    expect(r.ok, r.ok ? '' : r.mensaje).toBe(true)
    for (const s of [await releida(), recargada()]) {
      expect(s.alojamiento).not.toContain('pega su habitación')
      expect(s.resumen).toBe('1 bloque · 1 completo')
    }
  })
})

// ── Punto 2 ──────────────────────────────────────────────────────────────────

describe('punto 2 · la operadora elige qué habitaciones van', () => {
  /** R1 + R2 cubren al grupo; R3 (1 adulto) entra y sobra: ONE la propone de referencia. */
  async function conLaQueSobra() {
    sembrarHotel([{ id: 'r1', lectura: R1() }, { id: 'r2', lectura: R2() }, { id: 'r3', lectura: R3() }])
    expect((await confirmarTarifaPorPasajero(ITEM, null)).success).toBe(true)
  }
  const filaDe = (html: string, id: string) => texto(html.match(new RegExp(`data-habitacion="${id}"[\\s\\S]*?(?=data-habitacion="|<\\/section>)`))?.[0] ?? '')

  it('la que sobra conserva su número, dice que no suma, y el resumen la cuenta aparte; el total no cambia', async () => {
    await conLaQueSobra()
    const s = await releida()
    expect(s.alojamiento).toContain('2 habitaciones · cubre a los 3 viajeros · 1 de referencia, no suma')
    // Brief del 2026-10-05, punto 16: nada se renumera; el check «Va en la cotización» queda sin marcar.
    expect(filaDe(s.html, 'r3')).toContain('Habitación 3')
    expect(filaDe(s.html, 'r3')).toContain(TEXTO_NO_VA)
    expect(s.html).toMatch(/data-habitacion="r3"[\s\S]*?data-check-va[\s\S]*?<input type="checkbox"(?![^>]*checked)[^>]*aria-label="Va en la cotización"/)
    expect(s.costoLinea).toBe('800.000')
    expect(s.totalCotizacion).toBe(pesos(conMargen(800_000)))
    expect(s.resumen).toBe('1 bloque · 1 completo')
  })

  it('«Va» en la que sobraba: el aviso dice que sobra 1 adulto, y el bloque requiere atención', async () => {
    await conLaQueSobra()
    const r = await marcarHabitacionQueVa(ITEM, 'r3', true)
    expect(r.success, r.error).toBe(true)
    for (const s of [await releida(), recargada()]) {
      expect(s.alojamiento).toContain('Sobra 1 adulto: quítale el check a la habitación que no va.')
      expect(s.resumen).toBe('1 bloque · 0 completos · 1 requiere atención')
      expect(s.costoLinea).toBe('1.280.000')
    }
  })

  it('«Va» en la que sobraba y «No va» en otra: bloque, «Así lo ve el cliente», columna, PDF y total siguen la elección; recargar la conserva', async () => {
    await conLaQueSobra()
    expect((await marcarHabitacionQueVa(ITEM, 'r3', true)).success).toBe(true)
    expect((await marcarHabitacionQueVa(ITEM, 'r1', false)).success).toBe(true)
    const precio = pesos(conMargen(880_000))
    for (const s of [await releida(), recargada()]) {
      // Cada una en su sitio y con su número: la 1 no va, la 3 sí (punto 16 del 2026-10-05).
      expect(filaDe(s.html, 'r1')).toContain('Habitación 1')
      expect(filaDe(s.html, 'r1')).toContain(TEXTO_NO_VA)
      expect(filaDe(s.html, 'r3')).toContain('Habitación 3')
      expect(filaDe(s.html, 'r3')).not.toContain(TEXTO_NO_VA)
      expect(s.html.indexOf('data-habitacion="r1"')).toBeLessThan(s.html.indexOf('data-habitacion="r2"'))
      expect(s.alojamiento).toContain('2 habitaciones · cubre a los 3 viajeros · 1 de referencia, no suma')
      expect(s.alojamiento).not.toMatch(/Sobra|Falta/)
      expect(s.costoLinea).toBe('880.000')
      expect(s.precioOpcion).toBe(precio)
      expect(s.enLaHoja).toBe(precio)
      expect(s.totalCotizacion).toBe(precio)
    }
    // El PDF: la acomodación son las que van, y su costo es el de la opción.
    const item = itemDeLaBase(ITEM)
    const [h] = hotelesDeItems([{ nombre: item.nombre as string, grupo: 'hotel', tarifa_pax: item.tarifa_pax, adicionales: [] }])
    expect(textosDeTarjetaHotel(h, false).condiciones).toContain('Acomodación: 2 habitaciones: 1 adulto + 1 infante; 1 adulto')
    const conf = leerTarifaPax(item.tarifa_pax).confirmada!
    const costos = conf.costos.length > 0 ? conf.costos.map(c => c.totalCOP) : (conf.porHabitacion ?? []).map(x => x.totalCOP)
    expect(costos.reduce((a, b) => a + b, 0)).toBe(880_000)
  })

  it('al menos una tiene que ir', async () => {
    sembrarHotel([{ id: 'r1', lectura: R1() }, { id: 'r2', lectura: R2() }])
    expect((await confirmarTarifaPorPasajero(ITEM, null)).success).toBe(true)
    expect((await marcarHabitacionQueVa(ITEM, 'r1', false)).success).toBe(true)
    const r = await marcarHabitacionQueVa(ITEM, 'r2', false)
    expect(r.success).toBe(false)
    expect(r.error).toContain('Al menos una habitación tiene que ir')
  })

  it('con una sola captura no hay «Va / No va»: la única siempre va', async () => {
    sembrarHotel([{ id: 'r1', lectura: R1() }])
    expect((await confirmarTarifaPorPasajero(ITEM, null)).success).toBe(true)
    expect(recargada().html).not.toContain('data-check-va')
  })
})

// ── Punto 3 ──────────────────────────────────────────────────────────────────

describe('punto 3 · «Aceptar» resuelve la sesión una vez', () => {
  async function aceptar(porLaRuta: boolean) {
    sembrarHotel([{ id: 'r1', lectura: R1() }])
    expect((await confirmarTarifaPorPasajero(ITEM, null)).success).toBe(true)
    const lecturaJson = JSON.stringify(R2())
    const cuerpo = {
      tipo: 'hotel' as const, lecturaJson, firma: firmarBorrador(COT, 'hotel', lecturaJson)!,
      pistas: { lugar: 'Providencia', origen: null, destino: null }, decision: 'habitacion' as const, destinoId: ITEM,
      imagen: null, correcciones: null,
    }
    sesiones.n = 0
    if (!porLaRuta) {
      expect((await aceptarCapturaDeBandeja(COT, cuerpo)).ok).toBe(true)
      return { sesiones: sesiones.n, timing: null }
    }
    const res = await aceptarPorLaRuta(
      new Request(`https://x/api/cotizaciones/${COT}/aceptar-captura`, { method: 'POST', body: JSON.stringify(cuerpo) }),
      { params: Promise.resolve({ id: COT }) },
    )
    expect((await res.json()).ok).toBe(true)
    return { sesiones: sesiones.n, timing: res.headers.get('Server-Timing') }
  }

  // Fuera de la ruta la aceptación resuelve la sesión 4 veces en este doble; en producción son 5,
  // porque `recalcularTotales` (aquí un doble) la resuelve otra vez.
  it('por la ruta, una sola vez (fuera de ella, la acción la resuelve una vez por paso, en serie)', async () => {
    expect((await aceptar(false)).sesiones).toBe(4)
    const r = await aceptar(true)
    expect(r.sesiones).toBe(1)
    // Punto 13 del brief del 2026-10-05: el total y cada etapa, para medir en producción.
    expect(r.timing).toMatch(/^aceptar;dur=\d+(, [a-z]+;dur=\d+)+$/)
    for (const etapa of ['contexto', 'lineas', 'confirmar', 'ubicacion']) expect(r.timing).toContain(`${etapa};dur=`)
  })

})

// ── Puntos 4, 5 y 8: el traslado y la tarifa niño ──────────────────────────────

describe('punto 4 · el traslado se ve como el hotel, no en MAYÚSCULAS', () => {
  it('en el bloque y en «Así lo ve el cliente» va el nombre como se escribió; en el PDF también', async () => {
    sembrarTraslado(traslado())
    expect((await confirmarTarifaPorPasajero(ITEM_T, null)).success).toBe(true)
    const s = recargada()
    expect(s.t).toContain('Aeropuerto - hotel (ida y regreso)')
    expect(s.t).not.toContain('AEROPUERTO - HOTEL')
    expect(s.hoja).toContain('Aeropuerto - hotel (ida y regreso)')
    // La línea de «Inversión» del PDF lleva `nombreVisibleDeLinea` (contrato abajo).
    expect(nombreVisibleDeLinea(itemDeLaBase(ITEM_T) as never)).toBe('Aeropuerto - hotel (ida y regreso)')
  })

  it('el PDF arma la línea con `nombreVisibleDeLinea`', () => {
    const pdf = readFileSync(join(__dirname, 'cotizacion-pdf-actions.ts'), 'utf8')
    const paraPlantilla = pdf.slice(pdf.indexOf('const paraPlantilla = '), pdf.indexOf('const paraPlantilla = ') + 1500)
    expect(paraPlantilla).toContain('nombre: nombreVisibleDeLinea(i),')
  })
})

describe('punto 5 · «Tarifa niño…» solo si el viaje lleva un niño', () => {
  it('2 adultos + 1 infante: ni la hoja ni el PDF la mencionan', async () => {
    sembrarHotel([{ id: 'r1', lectura: R1() }, { id: 'r2', lectura: R2() }])
    expect((await confirmarTarifaPorPasajero(ITEM, null)).success).toBe(true)
    expect(recargada().hoja).not.toContain('Tarifa niño')
    const item = itemDeLaBase(ITEM)
    const [h] = hotelesDeItems([{ nombre: item.nombre as string, grupo: 'hotel', tarifa_pax: item.tarifa_pax, adicionales: [] }])
    expect(textosDeTarjetaHotel(h, false).condiciones).not.toContain('Tarifa niño')
  })

  it('con 1 niño, sí', async () => {
    sembrarHotel([{ id: 'r1', lectura: R1() }, { id: 'r2', lectura: habitacion({ ninos: 1, netoNino: 80_000 }) }])
    const item = itemDeLaBase(ITEM)
    const [h] = hotelesDeItems([{ nombre: item.nombre as string, grupo: 'hotel', tarifa_pax: item.tarifa_pax, adicionales: [] }])
    expect(textosDeTarjetaHotel(h, false).condiciones).toContain('Tarifa niño de 2 a 11 años cumplidos a la fecha del viaje')
  })
})

describe('punto 8 · un solo redondeo: tabla = «Así lo ve el cliente» = PDF = total', () => {
  // 45.000 por trayecto, ida y regreso, 2 adultos + 1 infante sin costo: 180.000 → 211.765.
  // Y el criterio 8: 45.000 in-out × 2 adultos → 90.000 → 105.882 (el infante va en 0).
  // Brief del 2026-10-05, punto 11: 180.000 → 211.764,7 se reparte en 105.882 × 2 = 211.764. El
  // precio de la línea es la suma de lo que paga cada pasajero (antes 211.765, y 105.883 × 2 =
  // 211.766 en la vista del cliente).
  for (const [caso, lectura, costo, precio] of [
    ['por trayecto, 2 adultos + 1 infante', () => traslado(), 180_000, 211_764],
    ['in-out, 2 adultos (+ 1 infante sin costo)', () => traslado({ precio: 'in_out' }), 90_000, 105_882],
  ] as const) {
    it(caso, async () => {
      sembrarTraslado(lectura())
      expect((await confirmarTarifaPorPasajero(ITEM_T, null)).success).toBe(true)
      const s = recargada()
      expect(Math.abs(precio - conMargen(costo))).toBeLessThanOrEqual(2)
      expect(s.costoLinea).toBe(pesos(costo))
      expect(s.precioOpcion).toBe(pesos(precio))
      expect(s.enLaHoja).toBe(pesos(precio))
      expect(s.totalCotizacion).toBe(pesos(precio))
      const adultoTabla = s.tabla.match(/Adulto 2 [\d.]+ ([\d.]+) /)?.[1]
      const adultoHoja = s.hoja.match(/Adulto \$([\d.]+)/)?.[1]
      // El PDF: lo que `recalcularTotales` escribe en `precio_venta` (el precio de la línea, al peso).
      const item = { ...itemDeLaBase(ITEM_T), precio_venta: precio }
      const adultoPdf = precioPorPasajeroDeItem(item as never, GRUPO)?.find(p => p.tipo === 'adulto')?.precioUnitario
      expect(adultoTabla).toBeDefined()
      expect(adultoHoja).toBe(adultoTabla)
      expect(adultoPdf !== undefined ? pesos(adultoPdf) : null).toBe(adultoTabla)
      // Ficha = vista del cliente = PDF = total: los 2 adultos suman el precio de la línea.
      expect(pesos(precio / 2)).toBe(adultoTabla)
    })
  }
})
