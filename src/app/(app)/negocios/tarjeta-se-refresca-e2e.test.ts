/**
 * Lo que cambia el costo se ve sin recargar (brief Trappvel del 2026-10-01, PR 2), con el caso
 * de la prueba de #967: COT-2026-0019, «PRUEBA Lord».
 *
 * Corre las acciones REALES («Corregir datos» y «Confirmar y cargar el costo») sobre un doble
 * de Supabase que persiste, luego la ruta REAL de la que el editor relee la cotización
 * (`/api/cotizaciones/[id]/vista`), elige con la regla REAL cuál lectura gana
 * (`vistaFrescaVigente`) y pinta el editor REAL con lo elegido. Lo que se afirma es lo que ve la
 * persona.
 *
 * Lo que NO puede afirmar una prueba sin navegador: que el clic dispare la relectura y React
 * vuelva a pintar en el mismo instante. Eso lo fija el contrato de cableado de abajo (toda
 * acción de la tarjeta termina en el `refrescar` del editor, que relee) y lo confirma el
 * recorrido en pantalla (C3).
 *
 * Se queda en `.ts` por el `include` de vitest.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { tarifaConHabitaciones } from '@/lib/cotizaciones/habitaciones'
import { lecturaManual, type HotelManual } from '@/lib/cotizaciones/ingreso-manual'
import { ranuraPorSlug } from '@/lib/cotizaciones/ranuras-pantallazo'
import type { Composicion, LecturaCasilla } from '@/lib/cotizaciones/tarifa-pasajero'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
const GRUPO: Composicion = { adultos: 2, ninos: 0, infantes: 1 }

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }),
  useParams: () => ({ id: 'neg-1', cotId: 'cot-19' }),
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
  aceptarCapturaDeBandeja, confirmarTarifaPorPasajero, corregirCampoDeFicha, quitarHabitacionDeOpcion,
} = await import('./tarifa-pax-actions')
const { firmarBorrador } = await import('@/lib/cotizaciones/firma-borrador')
const { GET: leerVista } = await import('@/app/api/cotizaciones/[id]/vista/route')
const { interpretarVistaFresca, lineasParaPintar } = await import('@/lib/cotizaciones/vista-fresca')
const { default: CotizacionEditor } = await import('./cotizacion-editor')

// ── El caso: COT-2026-0019 ─────────────────────────────────────────────────

const HOTEL = ranuraPorSlug('hotel_detalle')!
const lord = (over: Partial<HotelManual> = {}): LecturaCasilla => {
  const r = lecturaManual({
    ranura: HOTEL,
    entrada: {
      tipo: 'hotel',
      datos: {
        hotel: 'PRUEBA Lord', ciudad: 'San Andrés', entrada: '2026-10-09', salida: '2026-11-13',
        habitacion: 'Estándar', regimen: '', incluye: '', adultos: 1, ninos: 0, infantes: 0,
        netoAdulto: 100_000, netoNino: null, netoInfante: null, edadDesde: null, edadHasta: null,
        fuente: 'Telefónico', ...over,
      },
    },
    leidaEn: '2026-09-30T15:00:00Z',
    hoy: '2026-09-30',
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errores))
  return r.lectura
}

const COT = 'cot-19'
const ITEM = 'item-lord'

/** La página: lo que trajo la última carga, con la hora del servidor en que se leyó. */
function cargaDeLaPagina() {
  return { leidaEn: new Date().toISOString(), items: lineasConRubros(COT) }
}

/** Lo que hace `refrescar()`: relee por la ruta. */
async function releerPorLaRuta() {
  const r = await leerVista(new Request(`https://x/api/cotizaciones/${COT}/vista`), { params: Promise.resolve({ id: COT }) })
  return interpretarVistaFresca(await r.json())
}

const esperar = () => new Promise(r => setTimeout(r, 5))

function pintar(items: unknown[]) {
  return renderToStaticMarkup(React.createElement(CotizacionEditor, {
    oportunidadId: 'neg-1',
    cotizacion: {
      id: COT, codigo: 'COT-2026-0019', consecutivo: 'COT-2026-0019', modo: 'detallada', estado: 'borrador',
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


function sembrar(habitaciones: { id: string; lectura: LecturaCasilla }[]) {
  tablas = {
    cotizaciones: [{ id: COT, estado: 'borrador', negocio_id: 'neg-1', valor_total: 0 }],
    items: [{
      id: ITEM, cotizacion_id: COT, grupo: 'hotel', nombre: 'PRUEBA LORD', descripcion: null, orden: 1,
      cantidad: 1, subtotal: 0, precio_venta: 0, descuento_porcentaje: 0, margen_porcentaje: null,
      precio_manual: false, es_ajuste: false, opcion_de: null, unidad: null,
      tarifa_pax: tarifaConHabitaciones({}, habitaciones, GRUPO),
    }],
    rubros: [],
  }
}

const H1 = () => lord()
const H2 = () => lord({ hotel: 'Hotel PRUEBA Lord', entrada: '2026-11-09', infantes: 1, netoInfante: 0 })

/** El precio con el margen de la cotización (15 % sobre la venta), redondeado como la pantalla. */
const conMargen = (costo: number) => Math.round(costo / 0.85)
const pesos = (n: number) => n.toLocaleString('es-CO')

/** Lo que la persona ve, por superficie, en el editor pintado con unas líneas. */
function superficies(items: unknown[]) {
  const html = pintar(items)
  const t = texto(html)
  const tabla = texto(html.match(/<section aria-label="Costo y precio"[\s\S]*?<\/section>/)?.[0] ?? '')
  const hoja = texto(html.match(/<section aria-label="Así lo ve el cliente"[\s\S]*?<\/section>/)?.[0] ?? '')
  return {
    t,
    tabla,
    hoja,
    /** El precio de la opción en su cabecera. */
    precioOpcion: t.match(/PRUEBA Lord San Andrés \$([\d.]+) Precio/)?.[1] ?? null,
    /** El total de la cotización («Revisar y enviar»). */
    totalCotizacion: t.match(/Total de la cotización \$ ([\d.]+)/)?.[1] ?? null,
    /** El costo de la línea (la fila Total de «Costo y precio»). */
    costoLinea: tabla.match(/Total ([\d.]+) \$/)?.[1] ?? null,
  }
}

/**
 * El ciclo de la pantalla: la página se quedó con la carga de ANTES de la acción (el refresco no
 * trajo lo nuevo, que es lo que se vio en producción), el editor relee por la ruta y pinta la
 * lectura que gana.
 */
async function trasLaAccion(accion: () => Promise<unknown>) {
  const pagina = cargaDeLaPagina()
  await esperar()
  await accion()
  const fresca = await releerPorLaRuta()
  expect(fresca).not.toBeNull()
  // La MISMA elección que hace el editor (`lineasParaPintar`), con la carga vieja de la página.
  const elegida = lineasParaPintar({ items: pagina.items, adicionalesPorItem: {}, leidaEn: pagina.leidaEn }, fresca, true)
  expect(elegida.deLaLecturaPropia).toBe(true)
  return { antes: superficies(pagina.items), ahora: superficies(elegida.items) }
}

beforeEach(async () => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secreto-de-prueba')
  sembrar([{ id: 'grupo_completo', lectura: H1() }, { id: 'h2', lectura: H2() }])
  // El estado de la prueba de #967 antes de corregir: confirmado con las 35 noches.
  const r = await confirmarTarifaPorPasajero(ITEM, null)
  expect(r.success, r.success ? '' : r.error).toBe(true)
})
afterEach(() => vi.unstubAllEnvs())

describe('el punto de partida (COT-2026-0019 antes de corregir)', () => {
  it('la base y la pantalla dicen 3.500.000 + 400.000 = 3.900.000', () => {
    const s = superficies(cargaDeLaPagina().items)
    expect(s.tabla).toContain('Habitación 1 1 adulto 1 3.500.000')
    expect(s.tabla).toContain('Habitación 2 1 adulto + 1 infante 1 400.000')
    expect(s.costoLinea).toBe('3.900.000')
    expect(s.precioOpcion).toBe(pesos(conMargen(3_900_000)))
  })
})

/**
 * El estado de COT-2026-0019 el día de la prueba de #967: la entrada se corrigió al 9 de
 * noviembre ANTES de que existiera la reconfirmación automática, así que la confirmación de
 * 3.900.000 quedó vieja y la tarjeta pedía reconfirmar. Se escribe la corrección tal cual.
 */
function corregidaSinReconfirmar() {
  const item = tablas.items.find(i => i.id === ITEM)!
  const tarifa = item.tarifa_pax as Record<string, unknown>
  item.tarifa_pax = {
    ...tarifa,
    correcciones: { check_in: { valor: '2026-11-09', por: 'Mauricio', porId: null, en: '2026-09-30T20:00:00Z' } },
  }
}

/** Un pantallazo: el precio es el de la plataforma para sus fechas (caso dorado C). */
const comoPantallazo = (l: LecturaCasilla): LecturaCasilla => {
  const { origen: _o, manual: _m, ...resto } = l
  void _o
  void _m
  return resto
}

describe('criterio 6 · «Corregir datos» con otras fechas', () => {
  it('habitaciones a mano: la ficha dice las fechas y noches nuevas y la habitación su costo nuevo (ONE reconfirma solo)', async () => {
    const { antes, ahora } = await trasLaAccion(async () => {
      const r = await corregirCampoDeFicha(ITEM, 'check_in', '2026-11-09')
      expect(r.success, r.success ? '' : r.error).toBe(true)
    })
    // Lo que pintaba la página sin relectura: lo de antes (el defecto del reporte de #963).
    expect(antes.t).toContain('9 oct al 13 nov 2026 · 35 noches')
    // Con la relectura:
    expect(ahora.t).not.toContain('35 noches')
    expect(ahora.t).toContain('Fechas 9 al 13 nov 2026 · 4 noches')
    expect(ahora.t).toMatch(/Habitación 1 1 adulto Telefónico .{0,80}\$400\.000/)
    // Desde #967 corregir las fechas de un hotel costeado vuelve a confirmar el costo: el
    // aviso de reconfirmar no queda, y el costo nuevo ya está en la tabla y en el total.
    expect(ahora.t).not.toContain('Cambiaron las fechas')
    expect(ahora.costoLinea).toBe('800.000')
    expect(ahora.totalCotizacion).toBe(pesos(conMargen(800_000)))
  })

  it('una confirmación que quedó vieja (el estado del día de la prueba): aparece el aviso de reconfirmar', () => {
    corregidaSinReconfirmar()
    const s = superficies(cargaDeLaPagina().items)
    expect(s.t).toContain('Fechas 9 al 13 nov 2026 · 4 noches')
    expect(s.t).toContain('Cambiaron las fechas')
  })

  it('caso dorado C · una habitación de pantallazo: el costo NO cambia y pide volver a pegar el pantallazo', async () => {
    sembrar([{ id: 'grupo_completo', lectura: comoPantallazo(H1()) }, { id: 'h2', lectura: H2() }])
    expect((await confirmarTarifaPorPasajero(ITEM, null)).success).toBe(true)
    const { ahora } = await trasLaAccion(() => corregirCampoDeFicha(ITEM, 'check_in', '2026-11-09'))
    expect(ahora.t).toContain('Fechas 9 al 13 nov 2026 · 4 noches')
    expect(ahora.t).toContain('3.500.000')
    expect(ahora.t).toMatch(/[Vv]uelve a pegar el pantallazo/)
  })
})

describe('criterio 5 · «Confirmar y cargar el costo»', () => {
  it('rubros, costo de la línea, «Costo y precio», precio de la opción, «Así lo ve el cliente» y total muestran el número nuevo', async () => {
    corregidaSinReconfirmar()
    const { antes, ahora } = await trasLaAccion(async () => {
      const r = await confirmarTarifaPorPasajero(ITEM, null)
      expect(r.success, r.success ? '' : r.error).toBe(true)
    })
    const precio = pesos(conMargen(800_000))
    expect(precio).toBe('941.176')

    // Sin la relectura: los rubros viejos 3.500.000 + 400.000 = 3.900.000 (lo que se vio en
    // COT-2026-0019 justo después de confirmar).
    expect(antes.t).toContain('3.500.000')
    expect(antes.totalCotizacion).toBe(pesos(conMargen(3_900_000)))

    // Con la relectura, cada superficie:
    expect(ahora.tabla).not.toContain('3.500.000')
    expect(ahora.tabla).toContain('Adulto 2 400.000 470.588 941.176')
    expect(ahora.costoLinea).toBe('800.000')
    expect(ahora.tabla).toContain(`Total 800.000 $${precio}`)
    expect(ahora.precioOpcion).toBe(precio)
    expect(ahora.hoja).toContain(`$${precio}`)
    expect(ahora.totalCotizacion).toBe(precio)
    expect(ahora.t).not.toContain('Cambiaron las fechas')
  })

  it('invariante: ficha = «Así lo ve el cliente» = total de la cotización', async () => {
    corregidaSinReconfirmar()
    const { ahora } = await trasLaAccion(() => confirmarTarifaPorPasajero(ITEM, null))
    const enLaHoja = ahora.hoja.match(/\$([\d.]+) Así sale esta opción/)?.[1]
    expect(enLaHoja).toBe(ahora.precioOpcion)
    expect(ahora.totalCotizacion).toBe(ahora.precioOpcion)
  })
})


describe('criterio 7 · el bloque y el total cambian al quitar o al aceptar una habitación', () => {
  it('quitar la habitación 2: queda una y el total es el de la que queda', async () => {
    const { antes, ahora } = await trasLaAccion(async () => {
      const r = await quitarHabitacionDeOpcion(ITEM, 'h2')
      expect(r.success, r.success ? '' : r.error).toBe(true)
    })
    expect(antes.t).toContain('Habitación 2')
    expect(ahora.t).not.toContain('Habitación 2')
    // Ya escrita, el aviso del «Deshacer» no queda (`aviso-deshacer-render.test.ts`).
    expect(ahora.t).not.toContain('El total se actualiza cuando pase el Deshacer')
    expect(ahora.costoLinea).toBe('3.500.000')
    expect(ahora.precioOpcion).toBe(pesos(conMargen(3_500_000)))
    expect(ahora.totalCotizacion).toBe(ahora.precioOpcion)
  })

  it('aceptar una habitación desde la bandeja («Es una habitación más»): aparece y el total la suma', async () => {
    sembrar([{ id: 'grupo_completo', lectura: lord({ entrada: '2026-11-09' }) }])
    expect((await confirmarTarifaPorPasajero(ITEM, null)).success).toBe(true)
    const lecturaJson = JSON.stringify(H2())
    const { antes, ahora } = await trasLaAccion(async () => {
      const r = await aceptarCapturaDeBandeja(COT, {
        tipo: 'hotel', lecturaJson, firma: firmarBorrador(COT, 'hotel', lecturaJson)!,
        pistas: { lugar: 'San Andrés', origen: null, destino: null }, decision: 'habitacion', destinoId: ITEM,
        imagen: null, correcciones: null,
      })
      expect(r.ok, r.ok ? '' : r.mensaje).toBe(true)
    })
    expect(antes.t).not.toContain('Habitación 2')
    expect(antes.costoLinea).toBe('400.000')
    expect(ahora.t).toContain('Habitación 2')
    expect(ahora.costoLinea).toBe('800.000')
    expect(ahora.totalCotizacion).toBe(pesos(conMargen(800_000)))
  })
})

/**
 * El cableado: toda acción de la tarjeta que cambia costo, fechas u ocupación termina en el
 * `refrescar` del editor, que además del refresco relee por la ruta. Un `router.refresh()`
 * suelto en estas piezas volvería a dejar la pantalla con lo de antes.
 */
describe('contrato · toda acción de la tarjeta pasa por la relectura', () => {
  const fuente = (archivo: string) => readFileSync(join(__dirname, archivo), 'utf8')

  it('el editor no refresca por su cuenta: todo pasa por `refrescar`, que relee en el flujo de viaje', () => {
    const editor = fuente('cotizacion-editor.tsx')
    expect(editor.match(/router\.refresh\(\)/g)?.length).toBe(1)
    const cuerpo = editor.match(/function refrescar\(\) \{[\s\S]*?\n {2}\}/)?.[0] ?? ''
    expect(cuerpo).toContain('router.refresh()')
    expect(cuerpo).toContain('if (!lineasPorTipo) return')
    expect(cuerpo).toContain('traerVistaFresca(cotizacion.id)')
  })

  it('lo que pinta el editor sale de `lineasParaPintar` (página o lectura propia, la más nueva)', () => {
    const editor = fuente('cotizacion-editor.tsx')
    expect(editor).toMatch(/const aPintar = lineasParaPintar\(\s*\{ items: itemsDeLaPagina, adicionalesPorItem: adicionalesDeLaPagina\.porItem, leidaEn \},\s*vistaFresca,\s*lineasPorTipo,\s*\)/)
    expect(editor).toContain('const initialItems: ItemRow[] = aPintar.items')
    expect(editor).toContain('setVistaFresca(prev => laMasNueva(prev, v))')
  })

  it('la tarjeta y las dos bandejas reciben ese `refrescar`', () => {
    const editor = fuente('cotizacion-editor.tsx')
    expect(editor.match(/onCambio=\{refrescar\}/g)?.length).toBe(2)
    const tarjeta = editor.slice(editor.indexOf('<TarjetaOpcion'), editor.indexOf('<TarjetaOpcion') + 6000)
    expect(tarjeta).toContain('onCambio={() => refrescar()}')
  })

  it('las piezas de la tarjeta no llaman al router: avisan con `onCambio`', () => {
    for (const archivo of ['tarjeta-opcion.tsx', 'tarjeta-costo.tsx', 'habitaciones-opcion.tsx', 'tarifa-pasajero-item.tsx', 'hoja-cliente.tsx']) {
      expect(fuente(archivo), archivo).not.toMatch(/router\.refresh\(\)/)
    }
  })

  it('la bandeja usa el `onCambio` del editor cuando lo tiene', () => {
    const bandeja = fuente('bandeja-capturas.tsx')
    expect(bandeja.match(/router\.refresh\(\)/g)?.length).toBe(1)
    expect(bandeja).toContain('const refrescar = () => (onCambio ? onCambio() : router.refresh())')
  })
})
