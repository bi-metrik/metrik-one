/**
 * «La Recomendada manda el total y el cliente elige su tarifa al aprobar» (decisión de
 * Mauricio del 2026-09-22, Trappvel), probado LLAMANDO A LAS ACCIONES: el PDF, los dos
 * «Enviar», «Aprobar», «Corregir», los dos «Duplicar», `marcarPrincipal` y el renombre.
 *
 * La sesión y el cliente de servicio se sustituyen por un doble que ESCRIBE (mismo patrón
 * que `margen-salida-e2e.test.ts`): «queda registrada la elección» y «la copia trae los
 * adicionales» solo se pueden afirmar leyendo lo que quedó.
 *
 * Las siete verificaciones del brief, en su orden:
 *  1. Tres tarifas en la propuesta: el TOTAL del PDF es el de la Recomendada.
 *  2. No hay forma de hacer principal a la Económica, ni desde la acción.
 *  3. Sin la Recomendada en la propuesta, «Enviar» se rechaza.
 *  4. Aprobar eligiendo la Premium: `precio_aprobado` es el de la Premium y queda la elección.
 *  5. Duplicar desde el editor y desde el bloque da copias idénticas, en borrador.
 *  6. Una cotización sin tarifas se comporta igual que hoy.
 *  7. Otro workspace no cambia.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
let secuencia = 0
let consecutivos = 20

const WS = 'ws-trappvel'
const LINEA = 'linea-viaje'
const NEG = 'neg-1'
const COT = 'cot-1'

let rol = 'operator'

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(),
    workspaceId: WS,
    userId: 'p-ale',
    staffId: 's-ale',
    role: rol,
    areas: [],
    impersonating: false,
    realRole: rol,
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
    rpc: async (nombre: string) =>
      nombre === 'get_next_cotizacion_consecutivo'
        ? { data: `COT-2026-00${++consecutivos}`, error: null }
        : { data: null, error: null },
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
    // Los rubros de VERDAD: duplicar tiene que copiarlos, y un doble que los devuelve
    // vacíos haría pasar una copia sin rubros.
    if (columnas.includes('rubros(')) {
      salida.rubros = (tablas.rubros ?? []).filter(r => r.item_id === f.id).map(r => ({ ...r }))
    }
    if (columnas.includes('lineas_negocio(')) {
      const l = (tablas.lineas_negocio ?? []).find(x => x.id === f.linea_id)
      salida.lineas_negocio = l ? { config_extra: l.config_extra } : null
    }
    if (columnas.includes('itinerario_opciones(')) {
      salida.itinerario_opciones = (tablas.itinerario_opciones ?? [])
        .filter(o => o.itinerario_id === f.id)
        .map(o => ({ item_id: o.item_id }))
    }
    if (tabla === 'bloque_configs' && columnas.includes('bloque_definitions')) {
      salida.bloque_definitions = { tipo: f.tipo }
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
        // `rubros.valor_total` es GENERATED en la base: nadie lo inserta, la base lo calcula.
        ...(tabla === 'rubros' ? { valor_total: Number(p.cantidad) * Number(p.valor_unitario) } : {}),
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
import { duplicarCotizacion, enviarCotizacion, recalcularTotales, updateCotizacion, aceptarCotizacion } from './cotizacion-actions'
import {
  aceptarCotizacionNegocio,
  corregirCotizacionAceptada,
  duplicarCotizacionNegocio,
  enviarCotizacionNegocio,
  opcionesDeAprobacion,
} from './[id]/cotizacion/actions'
import { marcarEnPropuesta, marcarPrincipal, renombrarItinerario } from './itinerario-actions'
import { textoDelPDF } from '@/lib/pdf/texto-del-pdf'

// ── Escenario ────────────────────────────────────────────────────────────────

/** Una línea con precio escrito a mano: costo y precio exactos, margen exacto. */
function linea(id: string, costo: number, precio: number, extra: Fila = {}): Fila {
  return {
    id, cotizacion_id: COT, nombre: id.toUpperCase(), descripcion: null,
    grupo: null, opcion_de: null, orden: 1, es_ajuste: false, cantidad: 1,
    subtotal: costo, descuento_porcentaje: 0, margen_porcentaje: null,
    precio_venta: precio, precio_manual: true, unidad: null,
    ...extra,
  }
}

const PERFIL_TRAPPVEL = {
  workspace_id: WS, person_type: 'persona_juridica', tax_regime: 'ordinario', iva_responsible: true,
  is_declarante: true, self_withholder: false, ica_rate: null, ica_city: null, is_complete: true,
  nit: '900945317', razon_social: 'TRAPPVEL ENTERPRISE S.A.S',
}

/** Las correcciones de la ficha (#821): tienen que viajar a la copia. */
const TARIFA_PAX_LATAM = {
  casillas: { grupo: { leidaEn: '2026-09-22T12:00:00Z', total: 1_150_000 } },
  correcciones: { hora_salida: { valor: '07:10', por: 'Alejandra', en: '2026-09-22T12:05:00Z' } },
}

const PRECIO = {
  economica: 2_000_000, // AVIANCA 1.000.000 + hotel 1.000.000
  recomendada: 2_400_000, // LATAM 1.400.000 + hotel
  premium: 3_120_000, // IBERIA 2.000.000 + maleta 120.000 + hotel
}

/**
 * Tres tarifas en la ranura de vuelo, todas sobre el mínimo, y el hotel fijo.
 *
 * ⚠️ La columna `es_principal` está puesta en la ECONÓMICA: es el defecto que abrió el
 * brief (la principal elegida a mano). Con la regla nueva no manda.
 */
function sembrar(opts: { configWorkspace?: Fila; plantilla?: string; conTarifas?: boolean; conRegla?: boolean } = {}) {
  const conTarifas = opts.conTarifas !== false
  const conRegla = opts.conRegla !== false
  secuencia = 0
  consecutivos = 20
  subidas.length = 0
  rol = 'operator'
  tablas = {
    cotizaciones: [{
      id: COT, workspace_id: WS, negocio_id: NEG, oportunidad_id: null,
      codigo: 'COT-2026-0009', consecutivo: 'COT-2026-0009', modo: 'detallada',
      descripcion: 'Cancún', estado: 'borrador', valor_total: 0, costo_total: 0,
      margen_porcentaje: null, margen_default_pct: 15, convencion_margen: 'sobre_venta',
      descuento_porcentaje: 0, descuento_valor: 0, aiu_admin_pct: 0, aiu_imprevistos_pct: 0,
      piso_margen_pct: 5, aviso_margen_pct: 10, fecha_envio: '2026-09-20T15:00:00Z', fecha_validez: '2026-10-20',
      condiciones_pago: '50 % para reservar', notas: 'Cliente frecuente', lugar_entrega: null,
      documento_cliente: { intro: 'Cancún en familia', revisado_en: '2026-09-22T10:00:00Z', revisado_por: 'p-ale', revisado_por_nombre: 'Alejandra', fuente_hash: 'h1' },
    }],
    items: conTarifas
      ? [
          linea('va', 800_000, 1_000_000, { nombre: 'AVIANCA', grupo: 'vuelo', orden: 1 }),
          linea('vb', 1_150_000, 1_400_000, { nombre: 'LATAM', grupo: 'vuelo', opcion_de: 'va', orden: 2, tarifa_pax: TARIFA_PAX_LATAM }),
          linea('vc', 1_600_000, 2_000_000, { nombre: 'IBERIA', grupo: 'vuelo', opcion_de: 'va', orden: 3 }),
          linea('hotel', 900_000, 1_000_000, { nombre: 'HOTEL PLAYA', grupo: 'hotel', orden: 4 }),
        ]
      : [linea('paquete', 1_700_000, 2_000_000, { nombre: 'PAQUETE CANCÚN' })],
    rubros: conTarifas
      ? [
          { id: 'r-hotel', item_id: 'hotel', tipo: 'servicios_prof', descripcion: 'Noches', cantidad: 1, unidad: 'noche', valor_unitario: 900_000, valor_total: 900_000, sugerido: false },
          { id: 'r-sug', item_id: 'hotel', tipo: 'servicios_prof', descripcion: 'Propuesta sin confirmar', cantidad: 1, unidad: 'noche', valor_unitario: 50_000, valor_total: 50_000, sugerido: true },
        ]
      : [],
    item_adicionales: conTarifas
      ? [{ id: 'ad-1', item_id: 'vc', codigo: 'equipaje_bodega', nombre: 'Maleta 23 kg', cantidad: 1, costo: 100_000, precio: 120_000, moneda: 'COP', tasa_cop: null, origen: 'manual', orden: 1 }]
      : [],
    negocios: [{ id: NEG, workspace_id: WS, linea_id: LINEA, nombre: 'CANCÚN FAMILIA', carpeta_url: null, empresa_id: null, precio_aprobado: null, etapa_actual_id: 'e2' }],
    lineas_negocio: [{
      id: LINEA,
      config_extra: conRegla ? { margen: { piso_pct: 5, aviso_pct: 10, convencion: 'sobre_venta', default_pct: 15 } } : {},
    }],
    etapas_negocio: [
      { id: 'e1', linea_id: LINEA, orden: 1, config_extra: {} },
      { id: 'e2', linea_id: LINEA, orden: 2, config_extra: conRegla ? { gates: ['margen_sobre_piso'] } : {} },
    ],
    bloque_configs: [{ id: 'bc-cot', etapa_id: 'e2', workspace_id: WS, estado: 'editable', config_extra: {}, tipo: 'cotizacion' }],
    cotizacion_itinerarios: conTarifas
      ? [
          { id: 'it-eco', workspace_id: WS, cotizacion_id: COT, nombre: 'Económica', orden: 1, va_en_propuesta: true, es_principal: true, motivo_codigo: 'precio', motivo_texto: null },
          { id: 'it-rec', workspace_id: WS, cotizacion_id: COT, nombre: 'Recomendada', orden: 2, va_en_propuesta: true, es_principal: false, motivo_codigo: 'horario', motivo_texto: 'sale temprano' },
          { id: 'it-pre', workspace_id: WS, cotizacion_id: COT, nombre: 'Premium', orden: 3, va_en_propuesta: true, es_principal: false, motivo_codigo: null, motivo_texto: null },
        ]
      : [],
    itinerario_opciones: conTarifas
      ? [
          { itinerario_id: 'it-eco', item_id: 'va' },
          { itinerario_id: 'it-rec', item_id: 'vb' },
          { itinerario_id: 'it-pre', item_id: 'vc' },
        ]
      : [],
    cotizacion_excepciones_margen: [],
    activity_log: [],
    decisiones_combinacion: [],
    negocio_bloques: [],
    cobros: [],
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

type ResultadoPDF = {
  success: boolean
  pdf: string
  borrador?: boolean
  aviso?: string | null
  fiscal: { subtotal: number; iva: number; totalBruto: number }
}

const texto = (res: ResultadoPDF) => textoDelPDF(Buffer.from(res.pdf, 'base64'))
const cot = (id = COT) => tablas.cotizaciones.find(c => c.id === id) as Fila
const itin = (id: string) => tablas.cotizacion_itinerarios.find(i => i.id === id) as Fila
const precioAprobado = () => (tablas.negocios[0] as Fila).precio_aprobado
const cifra = (n: number) => n.toLocaleString('es-CO').replace(/,/g, '.')

beforeEach(() => sembrar())

// ── 1 · El TOTAL es el de la Recomendada ─────────────────────────────────────

describe('1 · tres tarifas en la propuesta: el TOTAL es el de la Recomendada', () => {
  it('`valor_total` es el de la Recomendada, aunque la columna `es_principal` diga Económica', async () => {
    await recalcularTotales(COT)
    expect(cot().valor_total).toBe(PRECIO.recomendada)
  })

  it('el PDF sale limpio, con el TOTAL de la Recomendada y la leyenda que lo dice', async () => {
    await recalcularTotales(COT)
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.borrador).toBeUndefined()
    expect(pdf.fiscal.subtotal).toBe(PRECIO.recomendada)
    const t = texto(pdf)
    expect(t).toContain('El total de abajo corresponde a la opción recomendada')
    // Las tres tarjetas, cada una con su precio.
    for (const p of Object.values(PRECIO)) expect(t).toContain(cifra(p))
    // Y la marca «La que recomendamos» va una sola vez: no hay dos principales.
    expect(t.split('La que recomendamos').length - 1).toBe(1)
  })

  it('cambiar la celda de la Recomendada mueve el total del documento en el acto', async () => {
    // Antes `cambiarOpcionDeItinerario` no recalculaba: el total se quedaba con la
    // combinación vieja hasta la siguiente tecla del editor.
    const { cambiarOpcionDeItinerario } = await import('./itinerario-actions')
    await recalcularTotales(COT)
    await cambiarOpcionDeItinerario('it-rec', 'vuelo', 'vc')
    expect(cot().valor_total).toBe(PRECIO.premium)
  })
})

// ── 2 · La principal no se elige a mano ──────────────────────────────────────

describe('2 · no hay forma de hacer principal a la Económica', () => {
  it('`marcarPrincipal` sobre la Económica se rechaza, llamado directo', async () => {
    const res = await marcarPrincipal('it-eco')
    expect(res.success).toBe(false)
    expect(res.error).toContain('La principal es siempre la tarifa Recomendada')
    await recalcularTotales(COT)
    expect(cot().valor_total).toBe(PRECIO.recomendada)
  })

  it('tampoco renombrándola «Recomendada»: dos con ese nombre no se permiten', async () => {
    const res = await renombrarItinerario('it-eco', 'recomendada')
    expect(res.success).toBe(false)
    expect(itin('it-eco').nombre).toBe('Económica')
  })

  it('sobre la Recomendada, marcarla principal es marcarla para la propuesta', async () => {
    itin('it-rec').va_en_propuesta = false
    const res = await marcarPrincipal('it-rec')
    expect(res.success).toBe(true)
    expect(itin('it-rec').va_en_propuesta).toBe(true)
    expect(cot().valor_total).toBe(PRECIO.recomendada)
  })
})

// ── 3 · Sin la Recomendada no sale ───────────────────────────────────────────

describe('3 · sin la Recomendada en la propuesta, no sale', () => {
  beforeEach(() => { itin('it-rec').va_en_propuesta = false })

  it('los dos «Enviar», «Aprobar» y las puertas traseras se rechazan en el servidor', async () => {
    const motivo = 'La tarifa Recomendada no está marcada «va en propuesta»'
    expect((await enviarCotizacion(COT)).error).toContain(motivo)
    expect((await enviarCotizacionNegocio(COT, NEG)).error).toContain(motivo)
    expect((await aceptarCotizacionNegocio(COT, NEG, 'it-pre')).error).toContain(motivo)
    expect((await updateCotizacion(COT, { estado: 'enviada' })).error).toContain(motivo)
    expect(cot().estado).toBe('borrador')
    expect(precioAprobado()).toBeNull()
  })

  it('el PDF sale como borrador, con su razón (no la del margen) y SIN la leyenda de la recomendada', async () => {
    await recalcularTotales(COT)
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.borrador).toBe(true)
    expect(pdf.aviso).toContain('La tarifa Recomendada no está marcada')
    const t = texto(pdf)
    expect(t).toContain('falta la tarifa Recomendada')
    expect(t).not.toContain('margen bajo el m')
    expect(t).not.toContain('El total de abajo corresponde a la opción recomendada')
    expect(subidas).toEqual([])
    expect(tablas.decisiones_combinacion).toEqual([])
  })

  it('el control: marcada otra vez, «Enviar» pasa', async () => {
    await marcarEnPropuesta('it-rec', true)
    expect((await enviarCotizacion(COT)).success).toBe(true)
    expect(cot().estado).toBe('enviada')
  })
})

// ── 4 · Aprobar con la tarifa del cliente ────────────────────────────────────

describe('4 · al aprobar se escoge la tarifa', () => {
  it('la pregunta ofrece las tres con su precio y marca la Recomendada', async () => {
    const o = await opcionesDeAprobacion(COT)
    expect(o.success).toBe(true)
    if (!o.success) return
    expect(o.tarifas.map(t => [t.nombre, t.precio])).toEqual([
      ['Económica', PRECIO.economica],
      ['Recomendada', PRECIO.recomendada],
      ['Premium', PRECIO.premium],
    ])
    expect(o.preseleccion).toBe('it-rec')
  })

  it('sin escoger, con tarifas, no se aprueba', async () => {
    const res = await aceptarCotizacionNegocio(COT, NEG)
    expect(res.success).toBe(false)
    expect(cot().estado).toBe('borrador')
    expect(precioAprobado()).toBeNull()
  })

  it('con la Premium: `precio_aprobado` es el de la Premium y la elección queda en un campo y en el registro', async () => {
    const res = await aceptarCotizacionNegocio(COT, NEG, 'it-pre')
    expect(res).toEqual({ success: true })
    expect(precioAprobado()).toBe(PRECIO.premium)
    expect(cot().estado).toBe('aceptada')
    expect(cot().tarifa_aceptada_id).toBe('it-pre')

    // El dato del motor: qué escogió frente a qué se le recomendó.
    const [fila] = tablas.decisiones_combinacion
    expect(tablas.decisiones_combinacion).toHaveLength(1)
    expect(fila).toMatchObject({
      evento: 'aceptacion',
      itinerario_id: 'it-pre',
      tarifa_nombre: 'Premium',
      precio_elegida: PRECIO.premium,
      recomendada_itinerario_id: 'it-rec',
      recomendada_nombre: 'Recomendada',
      precio_recomendada: PRECIO.recomendada,
      propuesta: null,
      decidido_por: 's-ale',
    })
    expect((fila.tarifas_ofrecidas as Fila[]).map(t => t.nombre)).toEqual(['Económica', 'Recomendada', 'Premium'])

    // Y el timeline lo explica: el precio aprobado no es el TOTAL del documento.
    const log = tablas.activity_log.find(l => l.campo_modificado === 'precio_aprobado') as Fila
    expect(log.contenido).toContain('escogió la tarifa Premium')
    expect(log.contenido).toContain('La Recomendada, que da el total del documento')
  })

  it('con el IVA de #830 encendido, la Premium lleva el IVA de SUS líneas, y es la cifra de su tarjeta en el PDF', async () => {
    sembrar({ configWorkspace: IVA_INGRESO_PROPIO })
    await recalcularTotales(COT)
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    // Ingreso propio de la Premium: 400.000 (vuelo) + 20.000 (maleta) + 100.000 (hotel).
    const ivaPremium = 76_000 + 3_800 + 19_000
    expect(texto(pdf)).toContain(cifra(PRECIO.premium + ivaPremium))

    await aceptarCotizacionNegocio(COT, NEG, 'it-pre')
    expect(precioAprobado()).toBe(PRECIO.premium + ivaPremium)
  })

  it('con el IVA ADENTRO del precio (#831), la Premium se aprueba por el precio de su cascada: el IVA ya viene en él', async () => {
    sembrar({ configWorkspace: { iva_cotizacion: { ...IVA_INGRESO_PROPIO.iva_cotizacion, precio: 'iva_incluido' } } })
    await recalcularTotales(COT)
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(texto(pdf)).toContain(cifra(PRECIO.premium))
    await aceptarCotizacionNegocio(COT, NEG, 'it-pre')
    expect(precioAprobado()).toBe(PRECIO.premium)
  })

  it('la elegida pasa por el MISMO mínimo de #824: la Premium bajo el piso no se aprueba sin la firma del dueño', async () => {
    ;(tablas.items.find(i => i.id === 'vc') as Fila).subtotal = 1_990_000
    const res = await aceptarCotizacionNegocio(COT, NEG, 'it-pre')
    expect(res.success).toBe(false)
    expect(res.error).toContain('La tarifa Premium deja un margen')
    expect(precioAprobado()).toBeNull()
  })

  it('una tarifa que no iba en la propuesta no se puede escoger', async () => {
    itin('it-pre').va_en_propuesta = false
    const res = await aceptarCotizacionNegocio(COT, NEG, 'it-pre')
    expect(res.success).toBe(false)
    expect(precioAprobado()).toBeNull()
  })

  it('la aprobación vieja y el `estado` por el endpoint genérico no aprueban sin escoger', async () => {
    cot().estado = 'enviada'
    expect((await aceptarCotizacion(COT)).success).toBe(false)
    expect((await updateCotizacion(COT, { estado: 'aceptada' })).success).toBe(false)
    expect((await updateCotizacion(COT, { tarifa_aceptada_id: 'it-eco' })).success).toBe(false)
    expect(cot().estado).toBe('enviada')
  })

  it('corregir la aprobación RESPETA la tarifa elegida: se conserva, se dice y se vuelve a ofrecer', async () => {
    await aceptarCotizacionNegocio(COT, NEG, 'it-pre')
    rol = 'owner'
    const res = await corregirCotizacionAceptada(COT, NEG)
    expect(res).toEqual({ success: true })
    expect(cot().estado).toBe('borrador')
    expect(precioAprobado()).toBeNull()
    expect(cot().tarifa_aceptada_id).toBe('it-pre')
    const log = tablas.activity_log.filter(l => l.campo_modificado === 'precio_aprobado').at(-1) as Fila
    expect(log.contenido).toContain('tarifa Premium')

    const o = await opcionesDeAprobacion(COT)
    expect(o.success && o.preseleccion).toBe('it-pre')
  })
})

// ── 5 · Duplicar copia todo, por un solo camino ──────────────────────────────

/** Una cotización leída como la vería alguien: sin ids, con los vínculos por NOMBRE. */
function foto(cotizacionId: string) {
  const items = tablas.items.filter(i => i.cotizacion_id === cotizacionId)
  const nombreDe = new Map(items.map(i => [i.id, i.nombre]))
  return {
    cotizacion: (({ id: _i, consecutivo: _c, descripcion: _d, created_at: _ca, ...resto }) => resto)(cot(cotizacionId)),
    items: items
      .map(({ id: _i, cotizacion_id: _c, created_at: _ca, opcion_de, ...resto }): Fila => ({ ...resto, opcion_de: opcion_de ? nombreDe.get(opcion_de as string) : null }))
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))),
    rubros: tablas.rubros
      .filter(r => nombreDe.has(r.item_id as string))
      .map(({ id: _i, item_id, created_at: _ca, ...resto }): Fila => ({ ...resto, item: nombreDe.get(item_id as string) }))
      .sort((a, b) => String(a.descripcion).localeCompare(String(b.descripcion))),
    adicionales: tablas.item_adicionales
      .filter(a => nombreDe.has(a.item_id as string))
      .map(({ id: _i, item_id, created_at: _ca, ...resto }): Fila => ({ ...resto, item: nombreDe.get(item_id as string) })),
    tarifas: tablas.cotizacion_itinerarios
      .filter(t => t.cotizacion_id === cotizacionId)
      .map(({ id, cotizacion_id: _c, created_at: _ca, ...resto }): Fila => ({
        ...resto,
        seleccion: tablas.itinerario_opciones.filter(o => o.itinerario_id === id).map(o => nombreDe.get(o.item_id as string)),
      }))
      .sort((a, b) => Number(a.orden) - Number(b.orden)),
  }
}

describe('5 · duplicar desde el editor y desde el bloque da la misma copia, completa y en borrador', () => {
  beforeEach(async () => {
    await recalcularTotales(COT)
    cot().estado = 'enviada'
    // Una autorización del dueño bajo el mínimo: NO viaja, la copia vuelve a medir.
    tablas.cotizacion_excepciones_margen.push({ id: 'ex-1', workspace_id: WS, cotizacion_id: COT, perdida_at: null })
  })

  it('los dos botones dan copias idénticas', async () => {
    const delEditor = await duplicarCotizacion(COT) as { success: boolean; id: string }
    const delBloque = await duplicarCotizacionNegocio(COT, NEG) as { success: boolean; id: string }
    expect(delEditor.success).toBe(true)
    expect(delBloque.success).toBe(true)
    expect(foto(delBloque.id)).toEqual(foto(delEditor.id))
  })

  it('la copia trae ítems, rubros (también el sugerido), tarifa por pasajero con correcciones, adicionales, tarifas y la Recomendada', async () => {
    const { id } = await duplicarCotizacionNegocio(COT, NEG) as { id: string }
    const copia = foto(id)
    const original = foto(COT)

    expect(copia.items).toEqual(original.items)
    expect(copia.rubros).toEqual(original.rubros)
    expect(copia.rubros.some(r => r.sugerido === true)).toBe(true)
    expect(copia.items.find(i => i.nombre === 'LATAM')?.tarifa_pax).toEqual(TARIFA_PAX_LATAM)
    expect(copia.adicionales).toEqual([expect.objectContaining({ item: 'IBERIA', nombre: 'Maleta 23 kg', precio: 120_000 })])
    expect(copia.tarifas.map(t => [t.nombre, t.va_en_propuesta, t.seleccion])).toEqual([
      ['Económica', true, ['AVIANCA']],
      ['Recomendada', true, ['LATAM']],
      ['Premium', true, ['IBERIA']],
    ])
    expect(copia.tarifas.find(t => t.nombre === 'Recomendada')).toMatchObject({ motivo_codigo: 'horario', motivo_texto: 'sale temprano' })

    // Ningún vínculo apunta a la original.
    const idsOriginales = new Set(tablas.items.filter(i => i.cotizacion_id === COT).map(i => i.id))
    const idsCopia = new Set(tablas.items.filter(i => i.cotizacion_id === id).map(i => i.id))
    for (const i of tablas.items.filter(x => x.cotizacion_id === id)) {
      if (i.opcion_de) expect(idsOriginales.has(i.opcion_de)).toBe(false)
    }
    for (const a of tablas.item_adicionales.filter(x => idsCopia.has(x.item_id))) expect(idsOriginales.has(a.item_id)).toBe(false)
  })

  it('nace en borrador, sin fechas de envío, sin excepción de margen, con el texto sin revisar, y mide su total de nuevo', async () => {
    const { id } = await duplicarCotizacionNegocio(COT, NEG) as { id: string }
    const c = cot(id)
    expect(c.estado).toBe('borrador')
    expect(c.fecha_envio).toBeUndefined()
    expect(c.fecha_validez).toBeUndefined()
    expect(c.duplicada_de).toBe(COT)
    expect(c.condiciones_pago).toBe('50 % para reservar')
    expect((c.documento_cliente as Fila).revisado_en).toBeNull()
    expect((c.documento_cliente as Fila).intro).toBe('Cancún en familia')
    expect(tablas.cotizacion_excepciones_margen.filter(e => e.cotizacion_id === id)).toEqual([])
    // Y su total sale de lo que se copió: el de la Recomendada, no uno heredado.
    expect(c.valor_total).toBe(PRECIO.recomendada)
    // La original no se tocó.
    expect(cot().estado).toBe('enviada')
  })

  it('el bloque ya no crea una cotización SIN ítems con el total de la original', async () => {
    const { id } = await duplicarCotizacionNegocio(COT, NEG) as { id: string }
    expect(tablas.items.filter(i => i.cotizacion_id === id)).toHaveLength(4)
  })

  it('el bloque no duplica una cotización de otro negocio', async () => {
    const res = await duplicarCotizacionNegocio(COT, 'neg-ajeno')
    expect(res.success).toBe(false)
  })
})

// ── 6 · Sin tarifas, como hoy ────────────────────────────────────────────────

describe('6 · una cotización sin tarifas se comporta igual que hoy', () => {
  beforeEach(() => sembrar({ conTarifas: false }))

  it('«Aprobar» no pregunta nada y fija `valor_total`', async () => {
    await recalcularTotales(COT)
    const o = await opcionesDeAprobacion(COT)
    expect(o.success && o.tarifas).toEqual([])
    expect(await aceptarCotizacionNegocio(COT, NEG)).toEqual({ success: true })
    expect(precioAprobado()).toBe(2_000_000)
    expect(cot()).not.toHaveProperty('tarifa_aceptada_id')
    expect(tablas.decisiones_combinacion).toEqual([])
    expect(tablas.activity_log.filter(l => l.campo_modificado === 'precio_aprobado')).toEqual([])
  })

  it('mandarle una tarifa se rechaza', async () => {
    expect((await aceptarCotizacionNegocio(COT, NEG, 'it-inventada')).success).toBe(false)
  })

  it('«Enviar» y el PDF, como siempre', async () => {
    await recalcularTotales(COT)
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.borrador).toBeUndefined()
    expect(texto(pdf)).not.toContain('recomendada')
    expect((await enviarCotizacionNegocio(COT, NEG)).success).toBe(true)
  })
})

// ── 7 · Otro workspace ───────────────────────────────────────────────────────

describe('7 · otro workspace (Termotech: sin piso en la salida, sin tarifas, otra plantilla)', () => {
  beforeEach(() => sembrar({ conTarifas: false, conRegla: false, plantilla: 'termotech' }))

  it('Enviar, Aprobar y el PDF, como siempre', async () => {
    await recalcularTotales(COT)
    const pdf = await generateCotizacionPDF(COT) as ResultadoPDF
    expect(pdf.borrador).toBeUndefined()
    expect(await aceptarCotizacionNegocio(COT, NEG)).toEqual({ success: true })
    expect(precioAprobado()).toBe(2_000_000)
  })

  it('duplicar: la copia trae ahora TODO, incluidas las condiciones comerciales (el cambio declarado)', async () => {
    await recalcularTotales(COT)
    const { id } = await duplicarCotizacion(COT) as { id: string }
    const c = cot(id)
    expect(c.estado).toBe('borrador')
    expect(c.valor_total).toBe(2_000_000)
    expect(c.condiciones_pago).toBe('50 % para reservar')
    expect(c.notas).toBe('Cliente frecuente')
    expect(tablas.items.filter(i => i.cotizacion_id === id).map(i => i.nombre)).toEqual(['PAQUETE CANCÚN'])
  })
})
