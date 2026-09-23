/**
 * El IVA sobre el ingreso propio (brief del 2026-09-22, Trappvel), probado LLAMANDO A LAS
 * ACCIONES: `generateCotizacionPDF`, `aceptarCotizacionNegocio` y `recalcularTotales`.
 *
 * La sesión y el cliente de servicio se sustituyen por un doble que ESCRIBE (mismo patrón
 * que `margen-salida-e2e.test.ts`): «Aprobar» tiene que dejar en `precio_aprobado` la misma
 * cifra que el PDF imprime como TOTAL, y eso solo se puede afirmar leyendo lo que quedó.
 *
 * Los precios y costos de las líneas son los de COT-2026-0002, leídos de producción el
 * 2026-09-22 sin escribir nada.
 *
 * Verificaciones del brief, en orden:
 *  1. Base encendida y costo conocido: el IVA es el 19 % del ingreso propio, y el PDF y el
 *     cobro dicen la misma cifra (el editor, en `cotizacion-iva-render.test.ts`).
 *  2. Una línea sin costo: no sale un IVA inventado.
 *  3. Base apagada: Trappvel da lo mismo que hoy, peso por peso.
 *  4. Otro workspace (Termotech): lo mismo que hoy.
 *  5. Dos líneas con reglas distintas en la misma cotización.
 * Y el hallazgo del #824: el PDF de borrador no calla los pantallazos viejos.
 *
 * Adenda del 23-sep (bloque 6): con `precio: 'iva_incluido'` el TOTAL es el de la cascada,
 * el IVA se extrae del ingreso propio y «Aprobar» fija ese mismo total.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
let secuencia = 0

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
  return { from: (tabla: string) => constructor(tabla) }
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
      if (operacion === 'select') columnas = typeof cols === 'string' ? cols : '*'
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
import { recalcularTotales } from './cotizacion-actions'
import { aceptarCotizacionNegocio } from './[id]/cotizacion/actions'
import { textoDelPDF } from '@/lib/pdf/texto-del-pdf'
import { calcularFiscal } from '@/lib/fiscal/calculos'

// ── Escenario ────────────────────────────────────────────────────────────────

/** Una línea con precio escrito a mano: costo y precio exactos. */
function linea(id: string, costo: number, precio: number, extra: Fila = {}): Fila {
  return {
    id, cotizacion_id: COT, nombre: id.toUpperCase(), descripcion: null,
    grupo: null, opcion_de: null, orden: 1, es_ajuste: false, cantidad: 1,
    subtotal: costo, descuento_porcentaje: 0, margen_porcentaje: null,
    precio_venta: precio, precio_manual: true, unidad: null,
    ...extra,
  }
}

/** Las dos líneas con precio de COT-2026-0002, tal cual están en producción. */
const COT_0002 = () => [
  linea('latam bog-mco', 11_306_378, 13_301_621, { orden: 1 }),
  linea('hotel decameron', 1_818_919, 2_139_905, { orden: 2 }),
]
const VALOR_0002 = 15_441_526

const PERFIL_TRAPPVEL = {
  workspace_id: WS, person_type: 'persona_juridica', tax_regime: 'ordinario', iva_responsible: true,
  is_declarante: true, self_withholder: false, ica_rate: null, ica_city: null, is_complete: true,
  nit: '900945317', razon_social: 'TRAPPVEL ENTERPRISE S.A.S',
}

function sembrar(opts: {
  items: Fila[]
  valorTotal?: number
  /** `config_extra` del workspace. Ausente = nada declarado (lo de todos). */
  configWorkspace?: Fila
  plantilla?: string
}) {
  secuencia = 0
  subidas.length = 0
  tablas = {
    cotizaciones: [{
      id: COT, workspace_id: WS, negocio_id: NEG, oportunidad_id: null,
      codigo: 'COT-2026-0002', consecutivo: 'COT-2026-0002', modo: 'detallada',
      descripcion: 'Europa', estado: 'borrador', valor_total: opts.valorTotal ?? VALOR_0002, costo_total: 0,
      margen_porcentaje: null, margen_default_pct: 15, convencion_margen: 'sobre_venta',
      descuento_porcentaje: 0, descuento_valor: 0, aiu_admin_pct: 0, aiu_imprevistos_pct: 0,
      piso_margen_pct: 5, aviso_margen_pct: 10, fecha_envio: null, fecha_validez: null,
      condiciones_pago: null, notas: null,
    }],
    items: opts.items,
    negocios: [{ id: NEG, workspace_id: WS, linea_id: LINEA, nombre: 'EUROPA 20D', carpeta_url: null, empresa_id: null, precio_aprobado: null }],
    lineas_negocio: [{
      id: LINEA,
      config_extra: {
        margen: { piso_pct: 5, aviso_pct: 10, convencion: 'sobre_venta', default_pct: 15 },
        recargo: { valor: 100000, activo: true, aplica_a: ['vuelo_detalle'], etiqueta: 'Recargo de emision' },
      },
    }],
    etapas_negocio: [
      { id: 'e1', linea_id: LINEA, orden: 1, config_extra: {} },
      { id: 'e2', linea_id: LINEA, orden: 2, config_extra: { gates: ['margen_sobre_piso'] } },
    ],
    cotizacion_itinerarios: [],
    itinerario_opciones: [],
    cotizacion_excepciones_margen: [],
    activity_log: [],
    decisiones_combinacion: [],
    negocio_bloques: [],
    profiles: [{ id: 'p-ale', workspace_id: WS, role: 'operator', full_name: 'Alejandra Lancheros', platform_admin: false }],
    staff: [{ id: 's-ale', full_name: 'Alejandra Lancheros', position: 'Asesora' }],
    workspaces: [{
      id: WS, name: 'Trappvel', logo_url: null, color_primario: null,
      cotizacion_template_slug: opts.plantilla ?? 'trappvel',
      config_extra: opts.configWorkspace ?? {},
    }],
    empresas: [],
    fiscal_profiles: [PERFIL_TRAPPVEL],
  }
}

const IVA_INGRESO_PROPIO = { iva_cotizacion: { base: 'ingreso_propio', en_documento: 'linea_incluida' } }
/** La configuración que se le va a encender a Trappvel: el IVA va ADENTRO del precio. */
const IVA_ADENTRO = { iva_cotizacion: { base: 'ingreso_propio', en_documento: 'linea_incluida', precio: 'iva_incluido' } }

/** Las dos líneas de COT-2026-0006 (San Andrés - Providencia), tal cual en producción. */
const COT_0006 = () => [
  linea('avianca bog-adz', 6_208_296, 7_303_878, { orden: 1 }),
  linea('satena adz-providencia', 3_292_196, 3_873_172, { orden: 2 }),
]
const VALOR_0006 = 11_177_050

type ResultadoPDF = {
  success: boolean
  pdf: string
  filename: string
  borrador?: boolean
  aviso?: string | null
  avisosCaptura?: string[]
  fiscal: { subtotal: number; iva: number; totalBruto: number }
}

const texto = (res: ResultadoPDF) => textoDelPDF(Buffer.from(res.pdf, 'base64'))
const precioAprobado = () => (tablas.negocios[0] as Fila).precio_aprobado
const cifra = (n: number) => n.toLocaleString('es-CO').replace(/,/g, '.')

beforeEach(() => sembrar({ items: [] }))

// ── 1 · Base encendida, costo conocido ───────────────────────────────────────

describe('1 · Trappvel con la base encendida y el costo conocido', () => {
  beforeEach(() => sembrar({ items: COT_0002(), configWorkspace: IVA_INGRESO_PROPIO }))

  it('el IVA es el 19 % del ingreso propio, y el PDF y el cobro dicen la misma cifra', async () => {
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.borrador).toBeUndefined()
    // Ingreso propio: 15.441.526 − 13.125.297 = 2.316.229 → 379.096 + 60.987 por línea.
    expect(pdf.fiscal.subtotal).toBe(VALOR_0002)
    expect(pdf.fiscal.iva).toBe(440_083)
    expect(pdf.fiscal.totalBruto).toBe(15_881_609)

    const t = texto(pdf)
    expect(t).toContain(cifra(15_881_609))
    expect(t).toContain('Incluye IVA de')
    expect(t).toContain(cifra(440_083))
    // Cada línea con SU IVA adentro: la columna suma el TOTAL sin una fila aparte.
    expect(t).toContain(cifra(13_301_621 + 379_096))
    expect(t).toContain(cifra(2_139_905 + 60_987))
    // Y ya no se imprime el IVA sobre todo el paquete.
    expect(t).not.toContain(cifra(2_933_890))

    const aprobada = await aceptarCotizacionNegocio(COT, NEG)
    expect(aprobada.success).toBe(true)
    expect(precioAprobado()).toBe(pdf.fiscal.totalBruto)
  })

  it('el subtotal de la cotización no se mueve: el IVA no toca la cascada', async () => {
    await recalcularTotales(COT)
    expect((tablas.cotizaciones[0] as Fila).valor_total).toBe(VALOR_0002)
  })

  it('con el IVA oculto el TOTAL es el mismo y el documento no dice cuánto IVA lleva', async () => {
    sembrar({ items: COT_0002(), configWorkspace: { iva_cotizacion: { base: 'ingreso_propio', en_documento: 'oculto' } } })
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.fiscal.totalBruto).toBe(15_881_609)
    const t = texto(pdf)
    expect(t).toContain(cifra(15_881_609))
    expect(t).not.toContain('Incluye IVA de')
    expect(t).not.toContain(cifra(440_083))
  })

  it('el recargo fijo es de la agencia: lleva IVA sobre su precio y no deja el PDF en borrador', async () => {
    sembrar({
      items: [...COT_0002(), linea('recargo de emision', 0, 100_000, { orden: 3 })],
      valorTotal: VALOR_0002 + 100_000,
      configWorkspace: IVA_INGRESO_PROPIO,
    })
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.borrador).toBeUndefined()
    expect(pdf.fiscal.iva).toBe(440_083 + 19_000)
  })
})

// ── 2 · Una línea sin costo medible ──────────────────────────────────────────

describe('2 · una línea con precio y sin costo', () => {
  beforeEach(() => sembrar({
    items: [...COT_0002(), linea('tour a mano', 0, 500_000, { orden: 3 })],
    valorTotal: VALOR_0002 + 500_000,
    configWorkspace: IVA_INGRESO_PROPIO,
  }))

  it('no sale un IVA inventado: el PDF sale como borrador y dice por qué', async () => {
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.borrador).toBe(true)
    expect(pdf.filename).toMatch(/BORRADOR\.pdf$/)
    expect(pdf.aviso).toContain('«TOUR A MANO» tiene precio y no tiene costo')
    expect(texto(pdf)).toContain('BORRADOR')
    expect(subidas).toEqual([])
    // El IVA de la línea sin costo no se calcula: no se le pone el 19 % a sus $500.000.
    expect(pdf.fiscal.iva).toBe(440_083)
  })

  it('«Aprobar» se rechaza y el precio aprobado no se toca', async () => {
    const res = await aceptarCotizacionNegocio(COT, NEG)
    expect(res.success).toBe(false)
    expect(res.error).toContain('«TOUR A MANO»')
    expect(precioAprobado()).toBeNull()
    expect((tablas.cotizaciones[0] as Fila).estado).toBe('borrador')
  })

  it('marcada como servicio propio, su IVA va sobre el precio entero y el PDF sale limpio', async () => {
    ;(tablas.items.find(i => i.id === 'tour a mano') as Fila).base_iva = 'valor_completo'
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.borrador).toBeUndefined()
    expect(pdf.fiscal.iva).toBe(440_083 + 95_000)
  })
})

// ── 3 · Base apagada: Trappvel como hoy ──────────────────────────────────────

describe('3 · Trappvel con la base apagada', () => {
  beforeEach(() => sembrar({ items: COT_0002() }))

  it('el PDF da exactamente el resultado fiscal de siempre', async () => {
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF & { fiscal: unknown }
    // El mapeo viejo del PDF: `tax_regime` de la base como régimen del vendedor, y el
    // cliente genérico de la cotización sin empresa.
    const deSiempre = calcularFiscal(
      VALOR_0002,
      { tipo_persona: 'persona_juridica' as never, regimen_tributario: 'ordinario' as never, gran_contribuyente: false, agente_retenedor: false, autorretenedor: false, ica_rate: null, ica_city: null },
      { tipo_persona: 'juridica', regimen_tributario: 'responsable', gran_contribuyente: false, agente_retenedor: false, autorretenedor: false, ica_rate: null, ica_city: null },
    )
    expect(pdf.fiscal).toEqual(deSiempre)
    expect(texto(pdf)).not.toContain('Incluye IVA de')
  })

  it('«Aprobar» fija `valor_total`, como siempre', async () => {
    await aceptarCotizacionNegocio(COT, NEG)
    expect(precioAprobado()).toBe(VALOR_0002)
  })

  it('una línea sin costo no frena nada', async () => {
    sembrar({ items: [...COT_0002(), linea('tour a mano', 0, 500_000, { orden: 3 })], valorTotal: VALOR_0002 + 500_000 })
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.borrador).toBeUndefined()
  })
})

// ── 4 · Otro workspace ───────────────────────────────────────────────────────

describe('4 · un workspace que no declara nada (Termotech)', () => {
  it('su PDF y su aprobación son los de siempre', async () => {
    sembrar({ items: [linea('tuberia', 123_925_695, 153_655_469)], valorTotal: 153_655_469, plantilla: 'termotech' })
    tablas.lineas_negocio[0].config_extra = {}
    tablas.etapas_negocio = []
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF & { fiscal: unknown }
    const deSiempre = calcularFiscal(
      153_655_469,
      { tipo_persona: 'persona_juridica' as never, regimen_tributario: 'ordinario' as never, gran_contribuyente: false, agente_retenedor: false, autorretenedor: false, ica_rate: null, ica_city: null },
      { tipo_persona: 'juridica', regimen_tributario: 'responsable', gran_contribuyente: false, agente_retenedor: false, autorretenedor: false, ica_rate: null, ica_city: null },
    )
    expect(pdf.fiscal).toEqual(deSiempre)
    await aceptarCotizacionNegocio(COT, NEG)
    expect(precioAprobado()).toBe(153_655_469)
  })
})

// ── 5 · Reglas distintas en la misma cotización ──────────────────────────────

describe('5 · un tiquete a nombre de tercero, un servicio propio y un comisionable', () => {
  it('cada línea se liquida con su regla', async () => {
    sembrar({
      items: [
        linea('tiquete internacional', 1_800_000, 2_000_000, { orden: 1 }),
        linea('acompanamiento', 100_000, 300_000, { orden: 2, base_iva: 'valor_completo' }),
        linea('decameron', 1_818_919, 2_029_118, { orden: 3, base_iva: 'sin_iva' }),
      ],
      valorTotal: 4_329_118,
      configWorkspace: IVA_INGRESO_PROPIO,
    })
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    // 19 % de 200.000 + 19 % de 300.000 + 0.
    expect(pdf.fiscal.iva).toBe(38_000 + 57_000)
    await aceptarCotizacionNegocio(COT, NEG)
    expect(precioAprobado()).toBe(4_329_118 + 95_000)
  })
})

// ── El hallazgo del #824 ─────────────────────────────────────────────────────

describe('el PDF de borrador no calla los pantallazos de otros pasajeros', () => {
  it('bajo el piso y con una captura vieja, el borrador trae `avisosCaptura`', async () => {
    const leidaParaDos = {
      moneda: 'COP', total: 900_000, aPagarAgencia: null, porTipo: [],
      ocupacion: { adultos: 2, ninos: 0, infantes: 0, total: 2 }, ocupacionDelItem: false,
      identidad: {}, notasCliente: [], alertas: [], campos: [], nombre: 'Hotel', descripcion: '',
      leidaEn: '2026-09-22T12:00:00Z', paraComposicion: { adultos: 2, ninos: 0, infantes: 0 },
    }
    sembrar({
      items: [linea('hotel cartagena', 970, 1000, {
        grupo: 'hotel',
        tarifa_pax: { composicion: { adultos: 3, ninos: 0, infantes: 0 }, casillas: { grupo_completo: leidaParaDos } },
      })],
      valorTotal: 1000,
    })
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.borrador).toBe(true)
    expect(pdf.avisosCaptura).toHaveLength(1)
    expect(pdf.avisosCaptura![0]).toContain('«HOTEL CARTAGENA»')
  })
})

// ── 6 · El IVA ADENTRO del precio (adenda del 23-sep) ─────────────────────────

describe('6 · Trappvel con el IVA dentro del precio', () => {
  it('COT-2026-0002: el TOTAL es el de hoy y el IVA es el 19/119 del ingreso propio', async () => {
    sembrar({ items: COT_0002(), configWorkspace: IVA_ADENTRO })
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.borrador).toBeUndefined()
    expect(pdf.fiscal.subtotal).toBe(VALOR_0002)
    expect(pdf.fiscal.totalBruto).toBe(VALOR_0002)
    // 2.316.229 × 19/119, redondeado por línea: 318.568 + 51.250.
    expect(pdf.fiscal.iva).toBe(369_818)

    const t = texto(pdf)
    expect(t).toContain(cifra(VALOR_0002))
    expect(t).toContain('Incluye IVA de')
    expect(t).toContain(cifra(369_818))
    // Las líneas salen con el precio de la cascada: no se les suma nada.
    expect(t).toContain(cifra(13_301_621))
    expect(t).toContain(cifra(2_139_905))
    expect(t).not.toContain(cifra(13_301_621 + 318_568))
    // Ni el total ni el IVA del modo «aparte».
    expect(t).not.toContain(cifra(15_881_609))
    expect(t).not.toContain(cifra(440_083))

    const aprobada = await aceptarCotizacionNegocio(COT, NEG)
    expect(aprobada.success).toBe(true)
    expect(precioAprobado()).toBe(VALOR_0002)
    expect(precioAprobado()).toBe(pdf.fiscal.totalBruto)
  })

  it('COT-2026-0006: el TOTAL es el de hoy y el IVA es $267.686', async () => {
    sembrar({ items: COT_0006(), valorTotal: VALOR_0006, configWorkspace: IVA_ADENTRO })
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.borrador).toBeUndefined()
    expect(pdf.fiscal.totalBruto).toBe(VALOR_0006)
    expect(pdf.fiscal.iva).toBe(267_686)
    expect(texto(pdf)).toContain(cifra(VALOR_0006))
    await aceptarCotizacionNegocio(COT, NEG)
    expect(precioAprobado()).toBe(VALOR_0006)
  })

  it('con el IVA oculto el TOTAL es el mismo y no hay nota', async () => {
    sembrar({
      items: COT_0002(),
      configWorkspace: { iva_cotizacion: { base: 'ingreso_propio', en_documento: 'oculto', precio: 'iva_incluido' } },
    })
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.fiscal.totalBruto).toBe(VALOR_0002)
    const t = texto(pdf)
    expect(t).toContain(cifra(VALOR_0002))
    expect(t).not.toContain('Incluye IVA de')
    expect(t).not.toContain(cifra(369_818))
  })

  it('el subtotal de la cotización no se mueve', async () => {
    sembrar({ items: COT_0002(), configWorkspace: IVA_ADENTRO })
    await recalcularTotales(COT)
    expect((tablas.cotizaciones[0] as Fila).valor_total).toBe(VALOR_0002)
  })

  it('una línea con precio y sin costo sigue frenando el PDF y «Aprobar»', async () => {
    sembrar({
      items: [...COT_0002(), linea('tour a mano', 0, 500_000, { orden: 3 })],
      valorTotal: VALOR_0002 + 500_000,
      configWorkspace: IVA_ADENTRO,
    })
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.borrador).toBe(true)
    const res = await aceptarCotizacionNegocio(COT, NEG)
    expect(res.success).toBe(false)
    expect(precioAprobado()).toBeNull()
  })

  it('con dos tarifas, cada tarifa sale con su precio de hoy y la nota de SU IVA', async () => {
    // Recomendada: LATAM + hotel (la de COT-2026-0002). Económica: AVIANCA + el mismo hotel.
    sembrar({
      items: [
        linea('latam bog-mco', 11_306_378, 13_301_621, { orden: 1, grupo: 'vuelo' }),
        linea('avianca bog-mco', 11_000_000, 12_941_176, { orden: 2, grupo: 'vuelo', opcion_de: 'latam bog-mco' }),
        linea('hotel decameron', 1_818_919, 2_139_905, { orden: 3, grupo: 'hotel' }),
      ],
      configWorkspace: IVA_ADENTRO,
    })
    tablas.cotizacion_itinerarios = [
      { id: 'it-1', cotizacion_id: COT, nombre: 'Recomendada', orden: 1, va_en_propuesta: true, es_principal: true },
      { id: 'it-2', cotizacion_id: COT, nombre: 'Económica', orden: 2, va_en_propuesta: true, es_principal: false },
    ]
    tablas.itinerario_opciones = [
      { itinerario_id: 'it-1', item_id: 'latam bog-mco' },
      { itinerario_id: 'it-1', item_id: 'hotel decameron' },
      { itinerario_id: 'it-2', item_id: 'avianca bog-mco' },
      { itinerario_id: 'it-2', item_id: 'hotel decameron' },
    ]
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.fiscal.totalBruto).toBe(VALOR_0002)
    const t = texto(pdf)
    // Cada tarifa con el precio de la cascada: 15.441.526 y 12.941.176 + 2.139.905.
    expect(t).toContain(cifra(VALOR_0002))
    expect(t).toContain(cifra(15_081_081))
    // Ninguna con su IVA sumado encima (369.818 y 309.936 + 51.250).
    expect(t).not.toContain(cifra(VALOR_0002 + 369_818))
    expect(t).not.toContain(cifra(15_081_081 + 361_186))
    // Y cada una dice cuánto IVA lleva adentro.
    // (Entre «$» y la cifra va un espacio duro.)
    expect(t).toMatch(/Incluye IVA de \$\s369\.818 LATAM/)
    expect(t).toMatch(/Incluye IVA de \$\s361\.186 AVIANCA/)
  })

  it('los adicionales de una línea salen con su precio, sin sumarles el IVA', async () => {
    sembrar({ items: COT_0002(), valorTotal: VALOR_0002 + 250_000, configWorkspace: IVA_ADENTRO })
    tablas.item_adicionales = [{
      id: 'ad-1', item_id: 'latam bog-mco', codigo: null, nombre: 'Maleta de 23 kg', cantidad: 1,
      costo: 200_000, precio: 250_000, moneda: 'COP', origen: 'manual', orden: 1,
    }]
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.fiscal.totalBruto).toBe(VALOR_0002 + 250_000)
    // El adicional deja $50.000: adentro van 50.000 × 19/119 = $7.983.
    expect(pdf.fiscal.iva).toBe(369_818 + 7_983)
    const t = texto(pdf)
    // La línea imprime su precio más el adicional, tal cual: 13.301.621 + 250.000.
    expect(t).toContain(cifra(13_301_621 + 250_000))
    expect(t).not.toContain(cifra(13_301_621 + 250_000 + 7_983))
  })

  it('con una plantilla que no lo sabe imprimir, el PDF sale como borrador y dice por qué', async () => {
    sembrar({ items: COT_0002(), configWorkspace: IVA_ADENTRO, plantilla: 'termotech' })
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.borrador).toBe(true)
    expect(pdf.aviso).toContain('IVA dentro del precio')
    expect(subidas).toEqual([])
    // El total del cobro sigue siendo el de la cascada.
    expect(pdf.fiscal.totalBruto).toBe(VALOR_0002)
  })
})

describe('6 · `iva_aparte` declarado es el #830, peso por peso', () => {
  it('mismo resultado fiscal, mismo documento y mismo precio aprobado que sin la llave', async () => {
    sembrar({ items: COT_0002(), configWorkspace: IVA_INGRESO_PROPIO })
    const sinLlave = await generateCotizacionPDF(COT) as ResultadoPDF
    await aceptarCotizacionNegocio(COT, NEG)
    const aprobadoSinLlave = precioAprobado()

    sembrar({
      items: COT_0002(),
      configWorkspace: { iva_cotizacion: { base: 'ingreso_propio', en_documento: 'linea_incluida', precio: 'iva_aparte' } },
    })
    const aparte = await generateCotizacionPDF(COT) as ResultadoPDF
    await aceptarCotizacionNegocio(COT, NEG)

    expect(aparte.fiscal).toEqual(sinLlave.fiscal)
    expect(aparte.fiscal.totalBruto).toBe(15_881_609)
    expect(texto(aparte)).toBe(texto(sinLlave))
    expect(precioAprobado()).toBe(aprobadoSinLlave)
    expect(precioAprobado()).toBe(15_881_609)
  })
})
