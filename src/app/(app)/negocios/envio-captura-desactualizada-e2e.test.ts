/**
 * «Mientras una línea tenga el pantallazo de otros pasajeros, la cotización no sale»
 * (decisión de Mauricio, 2026-09-22, sobre la pendiente #1 del #825), probado LLAMANDO A
 * LAS ACCIONES y no mirando el botón.
 *
 * Corre contra las funciones reales: los dos «Enviar» (`enviarCotizacion` del editor y
 * `enviarCotizacionNegocio` del bloque), «Aprobar» (`aceptarCotizacionNegocio`, que desde
 * borrador salta el envío), la puerta genérica `updateCotizacion({ estado })` y el PDF.
 * La sesión y el cliente se sustituyen por un doble que ESCRIBE (mismo patrón que
 * `margen-salida-e2e.test.ts`): «no se envió» se afirma leyendo el estado que quedó.
 *
 * Qué se prueba, en orden:
 *  1. El viaje pasó de 2 a 3 adultos y el hotel tiene el pantallazo de 2: toda salida se
 *     niega en el SERVIDOR, con un mensaje que nombra la línea. El PDF se descarga igual,
 *     con su aviso.
 *  2. Pegar el pantallazo nuevo (y reconfirmar) suelta el freno.
 *  3. R6: una cotización sin tarifa por pasajero sale como siempre y ni siquiera se leen
 *     los pasajeros del viaje.
 *  4. Una cotización que ya salió (`enviada`) se sigue pudiendo aprobar: el freno es para
 *     lo que sale de borrador.
 *  5. Sin poder leer los pasajeros, no sale: el lado seguro de un control es frenar.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
let secuencia = 0
/**
 * Cada SELECT que se pidió, como `tabla|columnas`, para afirmar qué NO se leyó (R6).
 * Por columnas y no por tabla: `aceptarCotizacionNegocio` también ESCRIBE en
 * `negocio_bloques` (cierra el bloque de cotización), y eso no es leer los pasajeros.
 */
let lecturas: string[] = []
/** Tablas cuya lectura devuelve error, para probar el lado seguro. */
let fallaLectura = new Set<string>()

const WS = 'ws-trappvel'
const LINEA = 'linea-viaje'
const NEG = 'neg-1'
const COT = 'cot-1'

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(),
    workspaceId: WS,
    userId: 'p-ale',
    staffId: 's-ale',
    role: 'operator',
    areas: [],
    impersonating: false,
    realRole: 'operator',
    error: null,
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => clienteFalso(),
  createClient: async () => clienteFalso(),
}))

const subidas: string[] = []
vi.mock('@/lib/almacenamiento/proveedor', () => ({ usaAlmacenamientoExterno: async () => true }))
vi.mock('@/lib/almacenamiento/supabase-externo', () => ({
  almacenamientoExternoDe: async () => ({
    subirArchivo: async (a: { nombre: string }) => {
      subidas.push(a.nombre)
      return { referencia: `sbext://one-documentos/${a.nombre}`, path: '', bytes: 0, sha256: '' }
    },
  }),
}))
vi.mock('@/lib/google-drive', () => ({
  uploadFileToDrive: async () => { throw new Error('Drive no debe llamarse') },
  createDriveFolder: async () => { throw new Error('Drive no debe llamarse') },
}))
vi.mock('@/lib/pdf/pdf-render-client', () => ({
  isPdfRenderConfigured: () => false,
  renderViaService: async () => { throw new Error('no debería llamarse') },
}))

// ── El doble de la base ──────────────────────────────────────────────────────

function clienteFalso() {
  return {
    from: (tabla: string) => constructor(tabla),
  }
}

function constructor(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  let operacion: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let payload: Fila | Fila[] = {}
  let columnas = ''
  let limite: number | null = null
  let orden: { col: string; asc: boolean } | null = null

  const proyectar = (f: Fila): Fila => {
    const salida: Fila = { ...f }
    if (columnas.includes('rubros(')) salida.rubros = []
    if (columnas.includes('lineas_negocio(')) {
      const l = (tablas.lineas_negocio ?? []).find(x => x.id === f.linea_id)
      salida.lineas_negocio = l ? { config_extra: l.config_extra } : null
    }
    if (columnas.includes('itinerario_opciones(')) {
      salida.itinerario_opciones = (tablas.itinerario_opciones ?? [])
        .filter(o => o.itinerario_id === f.id)
        .map(o => ({ item_id: o.item_id }))
    }
    if (columnas.includes('empresas(')) salida.empresas = null
    if (columnas.includes('oportunidades(')) salida.oportunidades = null
    return salida
  }

  const ejecutar = (): { data: unknown; error: { code?: string; message: string } | null } => {
    if (operacion === 'select' && fallaLectura.has(tabla)) {
      return { data: null, error: { code: '57014', message: `canceling statement due to statement timeout (${tabla})` } }
    }
    const todas = tablas[tabla] ?? (tablas[tabla] = [])
    const coinciden = todas.filter(f => filtros.every(fn => fn(f)))
    if (operacion === 'insert') {
      const nuevas = (Array.isArray(payload) ? payload : [payload]).map(p => ({
        id: `${tabla}-${++secuencia}`,
        created_at: new Date(Date.now() + secuencia).toISOString(),
        ...p,
      }))
      todas.push(...nuevas)
      return { data: nuevas.map(proyectar), error: null }
    }
    if (operacion === 'update') {
      for (const f of coinciden) Object.assign(f, payload)
      return { data: coinciden.map(proyectar), error: null }
    }
    if (operacion === 'delete') {
      tablas[tabla] = todas.filter(f => !coinciden.includes(f))
      return { data: null, error: null }
    }
    let filas = [...coinciden]
    if (orden) {
      const { col, asc } = orden
      filas.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1))
    }
    if (limite !== null) filas = filas.slice(0, limite)
    return { data: filas.map(proyectar), error: null }
  }

  const api = {
    select(cols?: string) {
      if (operacion === 'select') {
        columnas = typeof cols === 'string' ? cols : '*'
        lecturas.push(`${tabla}|${columnas}`)
      }
      return api
    },
    insert(p: Fila | Fila[]) { operacion = 'insert'; payload = p; return api },
    upsert(p: Fila | Fila[]) { operacion = 'insert'; payload = p; return api },
    update(p: Fila) { operacion = 'update'; payload = p; return api },
    delete() { operacion = 'delete'; return api },
    eq(col: string, val: unknown) { filtros.push(f => f[col] === val); return api },
    neq(col: string, val: unknown) { filtros.push(f => f[col] !== val); return api },
    is(col: string, val: unknown) { filtros.push(f => (f[col] ?? null) === val); return api },
    in(col: string, vals: unknown[]) { filtros.push(f => vals.includes(f[col])); return api },
    order(col: string, opts?: { ascending?: boolean }) {
      orden = { col, asc: opts?.ascending !== false }
      return api
    },
    limit(n: number) { limite = n; return api },
    single() {
      const r = ejecutar()
      return Promise.resolve({ data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error })
    },
    maybeSingle() {
      const r = ejecutar()
      return Promise.resolve({ data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(ejecutar()).then(resolve, reject)
    },
  }
  return api
}

import { generateCotizacionPDF } from './cotizacion-pdf-actions'
import { enviarCotizacion, updateCotizacion } from './cotizacion-actions'
import { aceptarCotizacionNegocio, enviarCotizacionNegocio } from './[id]/cotizacion/actions'

// ── Escenario ────────────────────────────────────────────────────────────────

const DOS = { adultos: 2, ninos: 0, infantes: 0 }
const TRES = { adultos: 3, ninos: 0, infantes: 0 }

/** Una casilla del hotel leída para `para` pasajeros. */
function lectura(para: { adultos: number; ninos: number; infantes: number }) {
  return {
    moneda: 'COP', total: 800, aPagarAgencia: null, porTipo: [],
    ocupacion: { ...para, total: para.adultos + para.ninos + para.infantes }, ocupacionDelItem: false,
    identidad: {}, notasCliente: [], alertas: [], campos: [], nombre: 'Hotel', descripcion: '',
    leidaEn: '2026-09-22T12:00:00Z', paraComposicion: para,
  }
}

/** El costo confirmado para `para` pasajeros. */
function confirmada(para: { adultos: number; ninos: number; infantes: number }) {
  return {
    composicion: para,
    costos: [{ tipo: 'adulto', cantidad: para.adultos, unitarioCOP: 800 / para.adultos, totalCOP: 800 }],
    costoTotalCOP: 800, moneda: 'COP', tasa: null, confirmadaEn: '2026-09-22T13:00:00Z',
  }
}

/**
 * Una línea con margen del 20 % (sobre el piso del 5 %): lo único que puede frenarla aquí
 * es el pantallazo, no el margen.
 */
function linea(id: string, extra: Fila = {}): Fila {
  return {
    id, cotizacion_id: COT, nombre: id.toUpperCase(), descripcion: null,
    grupo: null, opcion_de: null, orden: 1, es_ajuste: false, cantidad: 1,
    subtotal: 800, descuento_porcentaje: 0, margen_porcentaje: null,
    precio_venta: 1000, precio_manual: true, unidad: null, tarifa_pax: null,
    ...extra,
  }
}

/** El hotel con la casilla de 2 adultos: el caso del brief cuando el viaje pasa a 3. */
function hotel(id: string, tarifaPax: unknown): Fila {
  return linea(id, { grupo: 'hotel', tarifa_pax: tarifaPax })
}

function sembrar(opts: {
  items: Fila[]
  /** Los pasajeros del viaje, en la etapa 1 del negocio. */
  viaje?: { adultos: number; ninos: number; infantes: number } | null
  /** La línea de negocio declara el piso de margen (Trappvel). `false` = otro workspace. */
  conRegla?: boolean
  estado?: string
}) {
  const conRegla = opts.conRegla !== false
  secuencia = 0
  subidas.length = 0
  lecturas = []
  fallaLectura = new Set()
  tablas = {
    cotizaciones: [{
      id: COT, workspace_id: WS, negocio_id: NEG, oportunidad_id: null,
      codigo: 'COT-2026-0007', consecutivo: 'COT-2026-0007', modo: 'detallada',
      descripcion: 'Cartagena', estado: opts.estado ?? 'borrador', valor_total: 1000, costo_total: 800,
      margen_porcentaje: 20, margen_default_pct: 15, convencion_margen: 'sobre_venta',
      descuento_porcentaje: 0, descuento_valor: 0, aiu_admin_pct: 0, aiu_imprevistos_pct: 0,
      piso_margen_pct: 5, aviso_margen_pct: 10, fecha_envio: null, fecha_validez: null,
      condiciones_pago: null, notas: null,
    }],
    items: opts.items,
    negocios: [{ id: NEG, workspace_id: WS, linea_id: LINEA, nombre: 'Viaje Cartagena', carpeta_url: null, empresa_id: null, precio_aprobado: null }],
    lineas_negocio: [{
      id: LINEA,
      config_extra: conRegla
        ? { margen: { piso_pct: 5, aviso_pct: 10, convencion: 'sobre_venta', default_pct: 15 } }
        : {},
    }],
    etapas_negocio: [
      { id: 'e1', linea_id: LINEA, orden: 1, config_extra: {} },
      { id: 'e2', linea_id: LINEA, orden: 2, config_extra: conRegla ? { gates: ['margen_sobre_piso'] } : {} },
    ],
    // «Condiciones del viaje» (etapa 1). El doble no evalúa `data->adultos`: la fila ya
    // trae las columnas que la consulta proyecta.
    negocio_bloques: opts.viaje ? [{ negocio_id: NEG, ...opts.viaje }] : [],
    cotizacion_itinerarios: [],
    itinerario_opciones: [],
    cotizacion_excepciones_margen: [],
    activity_log: [],
    decisiones_combinacion: [],
    profiles: [{ id: 'p-ale', workspace_id: WS, role: 'operator', full_name: 'Alejandra Lancheros', platform_admin: false }],
    staff: [{ id: 's-ale', full_name: 'Alejandra Lancheros' }],
    workspaces: [{ id: WS, name: 'Trappvel', logo_url: null, color_primario: null, cotizacion_template_slug: 'metrik', config_extra: {} }],
    empresas: [],
    fiscal_profiles: [],
  }
}

const estadoCot = () => (tablas.cotizaciones[0] as Fila).estado
/** ¿Se leyeron los pasajeros del viaje? Es la consulta de `leerViajeDelNegocio`. */
const leyoPasajeros = () => lecturas.some(l => l.startsWith('negocio_bloques|') && l.includes('adultos'))
const precioAprobado = () => (tablas.negocios[0] as Fila).precio_aprobado

const PEGAR_HOTEL = 'Antes de enviar, pega el pantallazo nuevo en: «HOTEL CARTAGENA».'

beforeEach(() => sembrar({ items: [] }))

// ── 1 · El pantallazo es de otros pasajeros ──────────────────────────────────

describe('1 · el viaje pasó a 3 adultos y el hotel tiene el pantallazo de 2', () => {
  beforeEach(() => sembrar({
    items: [hotel('hotel cartagena', { casillas: { grupo_completo: lectura(DOS) } })],
    viaje: TRES,
  }))

  it('«Enviar» del editor se niega en el servidor y nombra la línea', async () => {
    const res = await enviarCotizacion(COT)
    expect(res.success).toBe(false)
    expect(res.error).toBe(PEGAR_HOTEL)
    expect(estadoCot()).toBe('borrador')
    // Control del instrumento de R6: aquí SÍ hay tarifa por pasajero y los pasajeros se
    // leen. Sin esta mitad, `leyoPasajeros()` en falso no probaría nada.
    expect(leyoPasajeros()).toBe(true)
  })

  it('«Enviar» del bloque del negocio se niega igual', async () => {
    const res = await enviarCotizacionNegocio(COT, NEG)
    expect(res.success).toBe(false)
    expect(res.error).toBe(PEGAR_HOTEL)
    expect(estadoCot()).toBe('borrador')
  })

  it('«Aprobar» desde borrador (salta el envío) se niega y no toca el precio aprobado', async () => {
    const res = await aceptarCotizacionNegocio(COT, NEG)
    expect(res.success).toBe(false)
    expect(res.error).toBe('Antes de aprobar, pega el pantallazo nuevo en: «HOTEL CARTAGENA».')
    expect(estadoCot()).toBe('borrador')
    expect(precioAprobado()).toBeNull()
  })

  it('la puerta genérica del `estado` tampoco lo deja salir', async () => {
    const enviar = await updateCotizacion(COT, { estado: 'enviada' })
    expect(enviar.success).toBe(false)
    expect(enviar.error).toBe(PEGAR_HOTEL)
    const aprobar = await updateCotizacion(COT, { estado: 'aceptada' })
    expect(aprobar.success).toBe(false)
    expect(estadoCot()).toBe('borrador')
  })

  it('editar otra cosa por la misma puerta sí pasa: el freno es solo para salir', async () => {
    const res = await updateCotizacion(COT, { descripcion: 'Cartagena 3 adultos' })
    expect(res.success).toBe(true)
    expect((tablas.cotizaciones[0] as Fila).descripcion).toBe('Cartagena 3 adultos')
  })

  it('el PDF se descarga igual, con el aviso de la línea', async () => {
    const pdf = await generateCotizacionPDF(COT) as { success: boolean; avisosCaptura?: string[] }
    expect(pdf.success).toBe(true)
    expect(pdf.avisosCaptura).toHaveLength(1)
    expect(pdf.avisosCaptura![0]).toContain('«HOTEL CARTAGENA»')
  })
})

describe('1b · varias líneas: nombra todas y separa lo que es solo volver a confirmar', () => {
  it('una con el pantallazo viejo y otra con el pantallazo nuevo sin reconfirmar', async () => {
    sembrar({
      items: [
        hotel('hotel cartagena', { casillas: { grupo_completo: lectura(DOS) } }),
        hotel('hotel santa marta', { casillas: { grupo_completo: lectura(TRES) }, confirmada: confirmada(DOS) }),
      ],
      viaje: TRES,
    })
    const res = await enviarCotizacion(COT)
    expect(res.error).toBe(
      'Antes de enviar, pega el pantallazo nuevo en: «HOTEL CARTAGENA». ' +
      'Y vuelve a confirmar el costo de: «HOTEL SANTA MARTA».',
    )
    expect(estadoCot()).toBe('borrador')
  })

  it('solo falta reconfirmar: el mensaje no manda a pegar nada', async () => {
    sembrar({
      items: [hotel('hotel santa marta', { casillas: { grupo_completo: lectura(TRES) }, confirmada: confirmada(DOS) })],
      viaje: TRES,
    })
    const res = await enviarCotizacionNegocio(COT, NEG)
    expect(res.error).toBe('Antes de enviar, vuelve a confirmar el costo de: «HOTEL SANTA MARTA».')
  })
})

// ── 2 · Lo que suelta el freno ───────────────────────────────────────────────

describe('2 · con el pantallazo de los pasajeros de hoy, sale', () => {
  it('pantallazo nuevo pegado: «Enviar» pasa', async () => {
    sembrar({ items: [hotel('hotel cartagena', { casillas: { grupo_completo: lectura(TRES) } })], viaje: TRES })
    expect((await enviarCotizacion(COT)).success).toBe(true)
    expect(estadoCot()).toBe('enviada')
  })

  it('pantallazo nuevo y costo reconfirmado: «Aprobar» pasa y fija el precio', async () => {
    sembrar({
      items: [hotel('hotel cartagena', { casillas: { grupo_completo: lectura(TRES) }, confirmada: confirmada(TRES) })],
      viaje: TRES,
    })
    const res = await aceptarCotizacionNegocio(COT, NEG)
    expect(res.success).toBe(true)
    expect(estadoCot()).toBe('aceptada')
    expect(precioAprobado()).not.toBeNull()
  })
})

// ── 3 · R6: lo que no tiene tarifa por pasajero, igual que antes ─────────────

describe('3 · R6 · una cotización sin tarifa por pasajero sale como siempre', () => {
  it('otro workspace (sin piso ni gate), líneas sin ranura: «Enviar» pasa y no se leen los pasajeros', async () => {
    sembrar({ items: [linea('paquete'), linea('seguro')], conRegla: false })
    expect((await enviarCotizacion(COT)).success).toBe(true)
    expect(estadoCot()).toBe('enviada')
    expect(leyoPasajeros()).toBe(false)
  })

  it('otro workspace: «Aprobar» desde borrador pasa y fija el precio', async () => {
    sembrar({ items: [linea('paquete')], conRegla: false })
    expect((await aceptarCotizacionNegocio(COT, NEG)).success).toBe(true)
    expect(estadoCot()).toBe('aceptada')
    expect(precioAprobado()).not.toBeNull()
    expect(leyoPasajeros()).toBe(false)
  })

  it('Trappvel con un hotel todavía sin pantallazo: no hay nada viejo que frenar', async () => {
    sembrar({ items: [hotel('hotel cartagena', null)], viaje: TRES })
    expect((await enviarCotizacionNegocio(COT, NEG)).success).toBe(true)
    expect(leyoPasajeros()).toBe(false)
  })
})

// ── 4 · Lo que ya salió ──────────────────────────────────────────────────────

describe('4 · una cotización ya enviada se sigue pudiendo aprobar', () => {
  it('el freno es para lo que sale de borrador: aprobar la enviada registra lo que el cliente aceptó', async () => {
    sembrar({
      items: [hotel('hotel cartagena', { casillas: { grupo_completo: lectura(DOS) } })],
      viaje: TRES,
      estado: 'enviada',
    })
    expect((await aceptarCotizacionNegocio(COT, NEG)).success).toBe(true)
    expect(estadoCot()).toBe('aceptada')
  })
})

// ── 5 · El lado seguro ───────────────────────────────────────────────────────

describe('5 · si no se pueden leer los pasajeros del viaje, no sale', () => {
  it('la lectura del viaje falla: «Enviar» se niega con un motivo que se puede reintentar', async () => {
    sembrar({ items: [hotel('hotel cartagena', { casillas: { grupo_completo: lectura(TRES) } })], viaje: TRES })
    fallaLectura.add('negocio_bloques')
    const res = await enviarCotizacion(COT)
    expect(res.success).toBe(false)
    expect(res.error).toBe(
      'No se pudieron leer los pasajeros del viaje para comprobar los pantallazos: vuelve a intentarlo.',
    )
    expect(estadoCot()).toBe('borrador')
  })
})
