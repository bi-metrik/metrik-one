/**
 * «El cliente confirmó» (F2) probado LLAMANDO A LAS ACCIONES reales sobre un doble de la base que
 * escribe (mismo patrón que `servicios-viaje-e2e.test.ts`).
 *
 * Criterios de Vera: F2-2 (una acción guarda tarifa, fecha, titular, plan, servicios, mensaje y
 * etapa), F2-3 (plan que no suma, fuera de regla con aprobación y huella), F2-9 (prerreserva
 * vencida), C1 (mensaje preparado + traza; correo solo si hay), C15/§7.4 (el servidor rechaza a
 * quien no puede), §7.1 (apagado = nada), §7.2.1 (idempotencia por intención).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
let secuencia = 0

const WS = '64010015-a9a2-4aca-be83-e456cf217d96'
const LINEA = 'linea-viaje'
const NEG = '7c1d2e3f-4a5b-4c6d-8e8f-90a1b2c3d4e5'
const COT = 'cot-1'

let rol = 'operator'
let areas: string[] = ['comercial']
let staffId = 's-dani'

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(),
    workspaceId: WS,
    userId: `p-${staffId}`,
    staffId,
    role: rol,
    areas,
    impersonating: false,
    realRole: rol,
    error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => clienteFalso(),
  createClient: async () => clienteFalso(),
}))
vi.mock('@/lib/cobros/soporte-pago', () => ({
  archivarSoporte: async (_s: unknown, _w: string, _n: string, e: { storage_path: string; file_name: string }) => ({ url: `one://ve-documentos/${e.storage_path}`, file_name: e.file_name }),
}))
// Siigo NUNCA se llama de verdad en pruebas: el recibo pasa por este doble.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let emitirMock: (...a: any[]) => Promise<any> = async () => ({ ok: false, motivo: 'error', mensaje: 'sin doble' })
vi.mock('@/lib/siigo/recibos', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitirReciboDeCobro: (...a: any[]) => emitirMock(...a),
}))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extraerMock: (...a: any[]) => Promise<any> = async () => ({ data: null, error: 'sin doble' })
vi.mock('@/lib/ai/extract-fields', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extractFieldsFromDocument: (...a: any[]) => extraerMock(...a),
}))
let archivoEnStorage: Blob | null = null
let autorizada = false

vi.mock('@/lib/modulos/exigir-modulo', async () =>
  (await import('../../../../test/exigir-modulo-doble')).dobleExigirModulo())

// ── El doble de la base ──────────────────────────────────────────────────────

function clienteFalso() {
  return {
    from: (tabla: string) => constructor(tabla),
    // La autorización de datos del contacto (`autorizacion_datos_estado`): la regla vive en la RPC.
    rpc: async (fn: string) => fn === 'autorizacion_datos_estado'
      ? { data: { existe: true, vigente: { generales: autorizada } }, error: null }
      : { data: null, error: null },
    storage: { from: () => ({ download: async () => (archivoEnStorage ? { data: archivoEnStorage, error: null } : { data: null, error: { message: 'no' } }) }) },
  }
}

/** `metadata->prerreserva->>estado` → el valor dentro del JSON; `bloque_definitions.tipo` → `tipo`. */
function leerCol(f: Fila, col: string): unknown {
  if (col === 'bloque_definitions.tipo') return f.tipo
  if (!col.includes('->')) return f[col]
  const partes = col.split(/->>?/)
  let v: unknown = f[partes[0]]
  for (const p of partes.slice(1)) v = v && typeof v === 'object' ? (v as Fila)[p] : undefined
  return v
}

function constructor(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  let operacion: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let payload: Fila | Fila[] = {}
  let columnas = ''
  let limite: number | null = null
  let orden: { col: string; asc: boolean } | null = null
  let contar = false

  const proyectar = (f: Fila): Fila => {
    const salida: Fila = { ...f }
    if (columnas.includes('rubros(')) salida.rubros = (tablas.rubros ?? []).filter(r => r.item_id === f.id).map(r => ({ ...r }))
    if (columnas.includes('lineas_negocio(')) {
      const l = (tablas.lineas_negocio ?? []).find(x => x.id === f.linea_id)
      // Las etapas de la línea, para saber si alguna pide la autorización de datos (`envio.ts`).
      const etapas = columnas.includes('etapas_negocio(') ? { etapas_negocio: (tablas.etapas_negocio ?? []).filter(e => e.linea_id === f.linea_id).map(e => ({ config_extra: e.config_extra })) } : {}
      salida.lineas_negocio = l ? { config_extra: l.config_extra, ...etapas } : null
    }
    if (columnas.includes('itinerario_opciones(')) {
      salida.itinerario_opciones = (tablas.itinerario_opciones ?? []).filter(o => o.itinerario_id === f.id).map(o => ({ item_id: o.item_id }))
    }
    if (tabla === 'bloque_configs' && columnas.includes('bloque_definitions')) salida.bloque_definitions = { tipo: f.tipo }
    if (tabla === 'negocio_bloques' && columnas.includes('bloque_configs')) {
      const bc = (tablas.bloque_configs ?? []).find(b => b.id === f.bloque_config_id)
      salida.bloque_configs = bc ? { etapa_id: bc.etapa_id, bloque_definitions: { tipo: bc.tipo } } : null
    }
    if (tabla === 'negocio_responsables' && columnas.includes('staff')) {
      const st = (tablas.staff ?? []).find(s => s.id === f.staff_id)
      salida.staff = st ? { full_name: st.full_name } : null
    }
    if (columnas.includes('empresas(')) salida.empresas = null
    return salida
  }

  const ejecutar = (): { data: unknown; error: { code?: string; message: string } | null; count?: number } => {
    const todas = tablas[tabla] ?? (tablas[tabla] = [])
    const coinciden = todas.filter(f => filtros.every(fn => fn(f)))
    if (operacion === 'insert') {
      const lote = Array.isArray(payload) ? payload : [payload]
      if (tabla === 'negocio_servicios') {
        const choca = lote.some(p => p.item_id != null && todas.some(f => f.negocio_id === p.negocio_id && f.item_id === p.item_id))
        if (choca) return { data: null, error: { code: '23505', message: 'duplicate key' } }
      }
      if (tabla === 'negocio_planes_pago') {
        // Índice único parcial: un solo acordado por negocio.
        const choca = lote.some(p => p.estado === 'acordado' && todas.some(f => f.negocio_id === p.negocio_id && f.estado === 'acordado'))
        if (choca) return { data: null, error: { code: '23505', message: 'negocio_planes_pago_un_acordado' } }
      }
      if (tabla === 'claves_idempotencia' && lote.some(p => todas.some(f => f.clave === p.clave))) {
        return { data: null, error: { code: '23505', message: 'duplicate key' } }
      }
      if (tabla === 'aprobaciones_excepcion') {
        const choca = lote.some(p => todas.some(f => f.entidad_id === p.entidad_id && f.tipo === p.tipo && ['solicitada', 'aprobada'].includes(String(f.estado))))
        if (choca) return { data: null, error: { code: '23505', message: 'aprobaciones_excepcion_vigente' } }
      }
      const nuevas = lote.map(p => ({ id: `${tabla}-${++secuencia}`, created_at: new Date(Date.now() + secuencia).toISOString(), ...p }))
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
      filas.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1))
    }
    if (limite !== null) filas = filas.slice(0, limite)
    return { data: filas.map(proyectar), error: null, ...(contar ? { count: filas.length } : {}) }
  }

  const enOtroTurno = <T,>(v: T) => new Promise<T>(r => setTimeout(() => r(v), 0))

  const api = {
    select(cols?: string, opts?: { count?: string }) {
      if (operacion === 'select') columnas = typeof cols === 'string' ? cols : '*'
      if (opts?.count) contar = true
      return api
    },
    insert(p: Fila | Fila[]) { operacion = 'insert'; payload = p; return api },
    upsert(p: Fila | Fila[]) { operacion = 'insert'; payload = p; return api },
    update(p: Fila) { operacion = 'update'; payload = p; return api },
    delete() { operacion = 'delete'; return api },
    eq(col: string, val: unknown) { filtros.push(f => leerCol(f, col) === val); return api },
    neq(col: string, val: unknown) { filtros.push(f => leerCol(f, col) !== val); return api },
    is(col: string, val: unknown) { filtros.push(f => (f[col] ?? null) === val); return api },
    lt(col: string, val: unknown) { filtros.push(f => String(f[col]) < String(val)); return api },
    not(col: string, op: string, val: unknown) {
      if (op === 'is' && val === null) filtros.push(f => f[col] != null)
      return api
    },
    filter(col: string, _op: string, val: unknown) { filtros.push(f => String(leerCol(f, col)) === String(val)); return api },
    in(col: string, vals: unknown[]) { filtros.push(f => vals.includes(f[col])); return api },
    order(col: string, opts?: { ascending?: boolean }) { orden = { col, asc: opts?.ascending !== false }; return api },
    limit(n: number) { limite = n; return api },
    single() { return enOtroTurno(ejecutar()).then(r => ({ data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error })) },
    maybeSingle() { return enOtroTurno(ejecutar()).then(r => ({ data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error })) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
      return enOtroTurno(null).then(() => ejecutar()).then(resolve, reject)
    },
  }
  return api
}

import {
  aplicarPrerreservaSiVencio,
  confirmarClienteViaje,
  decidirAprobacionPlan,
  marcarConfirmacionEnviada,
  pedirAprobacionPlan,
  type EntradaConfirmacion,
} from './confirmacion-viaje-actions'
import { evaluarGatesConfirmacion, leerVistaConfirmacion } from '@/lib/viaje/confirmacion-datos'
import { planSugerido, sumarDiasCivil, type CuotaPlan } from '@/lib/viaje/plan-pagos'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { reiniciarModulo } from '../../../../test/exigir-modulo-doble'
import { TERMINOS_BASE_TRAPPVEL } from '@/lib/cotizaciones/__fixtures__/terminos-base-trappvel'
import { MENSAJE_ENVIO } from '@/lib/autorizacion-datos/envio'

// ── Escenario sintético: Cusco, dos tarifas ──────────────────────────────────

const HOY = todayBogotaISO()
const SALIDA = sumarDiasCivil(HOY, 60)
const REGRESO = sumarDiasCivil(HOY, 65)
const GATES_E4 = ['confirmacion_registrada', 'plan_pagos_acordado', 'anticipo_con_soporte']

function linea(id: string, costo: number, precio: number, extra: Fila = {}): Fila {
  return {
    id, cotizacion_id: COT, nombre: id.toUpperCase(), descripcion: null, grupo: null, opcion_de: null, orden: 1,
    es_ajuste: false, cantidad: 1, subtotal: costo, descuento_porcentaje: 0, margen_porcentaje: null,
    precio_venta: precio, precio_manual: true, unidad: null, ...extra,
  }
}

function sembrar(opts: { activo?: boolean; correo?: string | null } = {}) {
  secuencia = 0
  rol = 'operator'
  areas = ['comercial']
  staffId = 's-dani'
  reiniciarModulo(WS, { business: true })
  tablas = {
    cotizaciones: [{
      id: COT, workspace_id: WS, negocio_id: NEG, oportunidad_id: null, codigo: 'COT-2026-0099', consecutivo: 'COT-2026-0099',
      modo: 'detallada', descripcion: 'PRUEBA · Cusco', estado: 'enviada', valor_total: 0, costo_total: 0,
      margen_porcentaje: null, margen_default_pct: 15, convencion_margen: 'sobre_venta', descuento_porcentaje: 0, descuento_valor: 0,
      aiu_admin_pct: 0, aiu_imprevistos_pct: 0, piso_margen_pct: 5, aviso_margen_pct: 10, fecha_envio: '2026-10-01', fecha_validez: '2026-12-20',
      updated_at: '2026-10-12T10:00:00Z', created_at: '2026-10-01T10:00:00Z',
    }],
    items: [
      linea('va', 1_800_000, 2_200_000, { nombre: 'LATAM BOG-CUZ', grupo: 'vuelo', orden: 1 }),
      linea('vb', 2_100_000, 2_500_000, { nombre: 'AVIANCA BOG-CUZ', grupo: 'vuelo', opcion_de: 'va', orden: 2 }),
      linea('hotel', 1_100_000, 1_300_000, { nombre: 'Hotel Andino', grupo: 'hotel', orden: 3 }),
      linea('traslado', 200_000, 250_000, { nombre: 'Traslado aeropuerto', grupo: 'traslado', orden: 4 }),
    ],
    rubros: [],
    item_adicionales: [],
    negocios: [{ id: NEG, workspace_id: WS, linea_id: LINEA, nombre: 'PRUEBA · CUSCO', estado: 'abierto', carpeta_url: null, empresa_id: null, precio_aprobado: null, etapa_actual_id: 'e3', contacto_id: 'c-1', metadata: {} }],
    contactos: [{ id: 'c-1', workspace_id: WS, nombre: 'Carolina Prueba', email: opts.correo ?? null, telefono: '3001234567' }],
    lineas_negocio: [{
      id: LINEA,
      config_extra: {
        margen: { piso_pct: 5, aviso_pct: 10, convencion: 'sobre_venta', default_pct: 15 },
        servicios_viaje: { activo: true },
        aprobaciones: { staff_ids: ['s-edgar'] },
        terminos_base: TERMINOS_BASE_TRAPPVEL,
        ...(opts.activo === false ? {} : { plan_pagos: { activo: true } }),
      },
    }],
    etapas_negocio: [
      { id: 'e2', linea_id: LINEA, nombre: 'Cotización', numero: 2, orden: 2, stage: 'venta', config_extra: {} },
      { id: 'e3', linea_id: LINEA, nombre: 'Seguimiento', numero: 3, orden: 3, stage: 'venta', config_extra: {} },
      { id: 'e4', linea_id: LINEA, nombre: 'Confirmación', numero: 4, orden: 4, stage: 'venta', config_extra: { gates: GATES_E4 } },
      { id: 'e5', linea_id: LINEA, nombre: 'Reservas y pagos', numero: 5, orden: 5, stage: 'ejecucion', config_extra: {} },
    ],
    bloque_configs: [{ id: 'bc-cot', etapa_id: 'e2', workspace_id: WS, estado: 'editable', config_extra: {}, tipo: 'cotizacion' }],
    negocio_bloques: [
      { id: 'nb-viaje', negocio_id: NEG, bloque_config_id: 'bc-viaje', data: {}, destino: 'Cusco', fecha_salida: SALIDA, fecha_regreso: REGRESO, adultos: 2, ninos: 0, infantes: 1 },
      { id: 'nb-cot', negocio_id: NEG, bloque_config_id: 'bc-cot', estado: 'completo' },
    ],
    cotizacion_itinerarios: [
      { id: 'it-eco', workspace_id: WS, cotizacion_id: COT, nombre: 'Económica', orden: 1, va_en_propuesta: true, es_principal: false },
      { id: 'it-rec', workspace_id: WS, cotizacion_id: COT, nombre: 'Recomendada', orden: 2, va_en_propuesta: true, es_principal: false },
    ],
    itinerario_opciones: [{ itinerario_id: 'it-eco', item_id: 'va' }, { itinerario_id: 'it-rec', item_id: 'vb' }],
    cotizacion_ranuras: [],
    cotizacion_excepciones_margen: [],
    activity_log: [],
    decisiones_combinacion: [],
    negocio_responsables: [{ negocio_id: NEG, staff_id: 's-dani', rol: 'comercial' }],
    negocio_servicios: [],
    negocio_planes_pago: [],
    negocio_plan_cuotas: [],
    aprobaciones_excepcion: [],
    avisos_cliente: [],
    notificaciones: [],
    gastos: [],
    cobros: [],
    claves_idempotencia: [],
    profiles: [
      { id: 'p-s-dani', workspace_id: WS, role: 'operator', full_name: 'Daniela Prueba', email: 'dani@prueba.test' },
      { id: 'p-s-edgar', workspace_id: WS, role: 'admin', full_name: 'Edgar Prueba', email: 'edgar@prueba.test' },
    ],
    staff: [
      { id: 's-dani', workspace_id: WS, full_name: 'Daniela Prueba', profile_id: 'p-s-dani' },
      { id: 's-edgar', workspace_id: WS, full_name: 'Edgar Prueba', profile_id: 'p-s-edgar' },
      { id: 's-tati', workspace_id: WS, full_name: 'Tatiana Prueba', profile_id: 'p-s-tati' },
    ],
    workspaces: [{ id: WS, name: 'Trappvel', cotizacion_template_slug: 'trappvel', config_extra: {} }],
    empresas: [],
    fiscal_profiles: [{ workspace_id: WS, person_type: 'persona_juridica', tax_regime: 'ordinario', iva_responsible: true, is_declarante: true, self_withholder: false, is_complete: true, nit: '900945317', razon_social: 'TRAPPVEL PRUEBA S.A.S' }],
  }
}

/** Precio de la Recomendada (vb + hotel + traslado). */
const TOTAL_REC = 2_500_000 + 1_300_000 + 250_000

function sugerido(total = TOTAL_REC): CuotaPlan[] {
  return planSugerido({ total, fechaSalida: SALIDA, hoy: HOY })!
}

function entrada(extra: Partial<EntradaConfirmacion> = {}): EntradaConfirmacion {
  return {
    negocioId: NEG,
    cotizacionId: COT,
    itinerarioId: 'it-rec',
    cuotas: sugerido(),
    motivo: null,
    fechaConfirmacion: HOY,
    titular: { tipo: 'viajero' },
    correoCliente: null,
    prerreservaVence: null,
    extra: null,
    pantallazo: null,
    ...extra,
  }
}

const neg = () => tablas.negocios[0] as Fila
const meta = () => (neg().metadata ?? {}) as Fila
const planes = () => tablas.negocio_planes_pago

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('apagado: nada cambia (§7.1)', () => {
  it('sin plan_pagos.activo la acción se niega y no escribe nada', async () => {
    sembrar({ activo: false })
    const r = await confirmarClienteViaje(entrada())
    expect(r.ok).toBe(false)
    expect(planes()).toHaveLength(0)
    expect(tablas.cotizaciones[0].estado).toBe('enviada')
    expect(meta().confirmacion_cliente).toBeUndefined()
  })
})

describe('H10-2 · un negocio perdido no se confirma (QA del 2026-10-29)', () => {
  it('desistido en Seguimiento: la acción se niega y no toca la cotización, el plan ni la confirmación', async () => {
    sembrar()
    tablas.negocios[0].estado = 'perdido'
    const r = await confirmarClienteViaje(entrada())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/cerrado/)
    expect(tablas.cotizaciones[0].estado).toBe('enviada')
    expect(planes()).toHaveLength(0)
    expect(meta().confirmacion_cliente).toBeUndefined()
  })

  it('la vista lo dice: `negocioAbierto` en falso', async () => {
    sembrar()
    tablas.negocios[0].estado = 'perdido'
    const vista = await leerVistaConfirmacion(clienteFalso(), WS, NEG)
    expect(vista?.negocioAbierto).toBe(false)
  })
})

describe('«El cliente confirmó» en una acción (F2-2)', () => {
  beforeEach(() => sembrar())

  it('acepta la tarifa, crea los servicios y el plan acordado, prepara el mensaje y deja el negocio en Confirmación', async () => {
    const r = await confirmarClienteViaje(entrada())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(tablas.cotizaciones[0].estado).toBe('aceptada')
    expect(tablas.cotizaciones[0].tarifa_aceptada_id).toBe('it-rec')
    expect(neg().precio_aprobado).toBe(TOTAL_REC)
    expect(r.servicios).toBe(3)
    expect(tablas.negocio_servicios).toHaveLength(3)

    expect(planes()).toHaveLength(1)
    expect(planes()[0]).toMatchObject({ estado: 'acordado', version: 1, origen: 'sugerido', dentro_de_regla: true, total: TOTAL_REC })
    const cuotas = tablas.negocio_plan_cuotas
    expect(cuotas.reduce((s, c) => s + Number(c.monto), 0)).toBe(TOTAL_REC)

    const conf = meta().confirmacion_cliente as Fila
    expect(conf.fecha).toBe(HOY)
    expect(conf.total).toBe(TOTAL_REC)
    const texto = (conf.mensaje as Fila).texto as string
    expect(texto).toContain('Carolina, ¿todo bien con esto?')
    expect(texto).toContain('$4.050.000')
    expect(texto).toContain('Bancolombia, cuenta de ahorros 32800003241')
    expect(texto).toContain('recargo promedio del 3 %')
    expect(texto).not.toMatch(/link de pago\]|sale por WhatsApp/)
    expect((conf.mensaje as Fila).enviado_at).toBeNull()
    expect(r.waUrl).toMatch(/^https:\/\/wa\.me\/573001234567\?text=/)
    expect((meta().titular_facturacion as Fila).tipo).toBe('viajero')

    expect(neg().etapa_actual_id).toBe('e4')
    // Sin correo: se traza como omitido, no se finge un envío (C1).
    expect(tablas.avisos_cliente).toEqual([expect.objectContaining({ canal: 'email', estado: 'omitido', motivo: 'sin_correo' })])
    expect(r.correo).toBe('omitido')
  })

  it('la misma intención dos veces deja una sola confirmación y un solo plan (§7.2.1)', async () => {
    const clave = 'c0ffee00-1111-4222-8333-444455556666'
    const [a, b] = await Promise.all([confirmarClienteViaje(entrada(), clave), confirmarClienteViaje(entrada(), clave)])
    expect(a.ok && b.ok).toBe(true)
    expect(planes()).toHaveLength(1)
  })

  it('una segunda confirmación (otra intención) no rehace nada', async () => {
    await confirmarClienteViaje(entrada())
    const r = await confirmarClienteViaje(entrada())
    expect(r.ok).toBe(false)
    expect(planes()).toHaveLength(1)
  })

  it('«Ya lo mandé» deja la traza del WhatsApp de la comercial', async () => {
    await confirmarClienteViaje(entrada())
    expect(await marcarConfirmacionEnviada(NEG)).toEqual({ ok: true })
    const m = (meta().confirmacion_cliente as Fila).mensaje as Fila
    expect(m.enviado_por).toBe('s-dani')
    expect(tablas.avisos_cliente.some(a => a.canal === 'whatsapp' && a.estado === 'disparado' && a.motivo === 'wa_manual')).toBe(true)
  })

  it('con el correo nuevo del cliente lo guarda en el contacto (opcional, C1.6)', async () => {
    await confirmarClienteViaje(entrada({ correoCliente: 'carolina@prueba.test' }))
    expect(tablas.contactos[0].email).toBe('carolina@prueba.test')
    // Sin llave de Resend en la prueba: queda como fallido, nunca como enviado.
    expect(tablas.avisos_cliente[0]).toMatchObject({ canal: 'email', destino: 'carolina@prueba.test', estado: 'fallido' })
  })

  it('factura a nombre de una empresa: exige NIT y razón social', async () => {
    const mal = await confirmarClienteViaje(entrada({ titular: { tipo: 'empresa', nombre: 'Acme' } }))
    expect(mal.ok).toBe(false)
    const bien = await confirmarClienteViaje(entrada({ titular: { tipo: 'empresa', nombre: 'Acme S.A.S', numero_documento: '900123456-7' } }))
    expect(bien.ok).toBe(true)
    expect(meta().titular_facturacion).toMatchObject({ tipo: 'empresa', tipo_documento: '31', numero_documento: '900123456-7' })
  })
})

describe('cotización sin tarifas: una sola opción por componente (2026-10-22)', () => {
  /** LATAM + hotel + traslado: la única combinación posible. */
  const TOTAL_UNICO = 2_200_000 + 1_300_000 + 250_000

  function sinTarifas(valorTotal: number) {
    sembrar()
    tablas.items = tablas.items.filter((i) => i.id !== 'vb')
    tablas.cotizacion_itinerarios = []
    tablas.itinerario_opciones = []
    tablas.cotizaciones[0].valor_total = valorTotal
  }

  it('la vista trae una tarifa única con el total de la cotización, sin itinerario', async () => {
    sinTarifas(TOTAL_UNICO)
    const vista = await leerVistaConfirmacion(clienteFalso(), WS, NEG)
    expect(vista?.errorTarifas).toBeNull()
    expect(vista?.tarifas).toEqual([{ itinerarioId: null, nombre: 'Total de la cotización', esRecomendada: false, precio: TOTAL_UNICO, motivo: null }])
  })

  it('sin total la lista queda vacía y sin error: la hoja muestra su aviso', async () => {
    sinTarifas(0)
    const vista = await leerVistaConfirmacion(clienteFalso(), WS, NEG)
    expect(vista?.tarifas).toEqual([])
    expect(vista?.errorTarifas).toBeNull()
  })

  it('se confirma con itinerarioId null: precio aprobado, plan acordado por ese total, servicios y gates', async () => {
    sinTarifas(TOTAL_UNICO)
    const r = await confirmarClienteViaje(entrada({ itinerarioId: null, cuotas: sugerido(TOTAL_UNICO) }))
    expect(r).toMatchObject({ ok: true, servicios: 3 })
    expect(tablas.cotizaciones[0].estado).toBe('aceptada')
    expect(tablas.cotizaciones[0].tarifa_aceptada_id ?? null).toBeNull()
    expect(neg().precio_aprobado).toBe(TOTAL_UNICO)
    expect(planes()).toHaveLength(1)
    expect(planes()[0]).toMatchObject({ estado: 'acordado', total: TOTAL_UNICO })
    const conf = meta().confirmacion_cliente as Fila
    expect(conf).toMatchObject({ itinerario_id: null, tarifa_nombre: null, total: TOTAL_UNICO })
    expect((conf.mensaje as Fila).texto).not.toContain('*Tarifa:*')

    const gates = await evaluarGatesConfirmacion(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates: GATES_E4, mensajes: {} })
    expect(gates).toEqual(['Para pasar a Reservas y pagos falta: el anticipo con su comprobante y la cuenta donde entró.'])
  })

  it('con el IVA sobre el ingreso propio encima, el plan se mide contra el mismo precio que se aprueba', async () => {
    sinTarifas(TOTAL_UNICO)
    tablas.workspaces[0].config_extra = { iva_cotizacion: { base: 'ingreso_propio', en_documento: 'linea_incluida', precio: 'iva_aparte' } }
    const vista = await leerVistaConfirmacion(clienteFalso(), WS, NEG)
    const precio = vista?.tarifas[0]?.precio ?? 0
    expect(precio).toBeGreaterThan(TOTAL_UNICO)

    const r = await confirmarClienteViaje(entrada({ itinerarioId: null, cuotas: sugerido(precio) }))
    expect(r.ok).toBe(true)
    expect(neg().precio_aprobado).toBe(precio)
    expect(planes()[0]).toMatchObject({ estado: 'acordado', total: precio })
  })
})

describe('plan que no suma o fuera de la regla (F2-3)', () => {
  beforeEach(() => sembrar())

  it('un plan que no suma el total no se confirma: dice cuánto falta', async () => {
    const cuotas = sugerido().map((c, i) => (i === 0 ? { ...c, monto: c.monto - 165_000 } : c))
    const r = await confirmarClienteViaje(entrada({ cuotas }))
    expect(r).toEqual({ ok: false, error: expect.stringContaining('Faltan $165.000') })
    expect(planes()).toHaveLength(0)
    expect(tablas.cotizaciones[0].estado).toBe('enviada')
  })

  it('fuera de la regla: sin aprobación no confirma; dirección aprueba; la misma huella confirma', async () => {
    // 50 % al confirmar y 50 % el día del viaje: al T-15 lleva el 50 %.
    const mitad = Math.round(TOTAL_REC / 2)
    const cuotas: CuotaPlan[] = [
      { numero: 0, monto: mitad, fecha: HOY, concepto: null },
      { numero: 1, monto: TOTAL_REC - mitad, fecha: SALIDA, concepto: null },
    ]
    expect((await confirmarClienteViaje(entrada({ cuotas }))).ok).toBe(false)

    expect(await pedirAprobacionPlan(entrada({ cuotas, motivo: 'el cliente cobra la prima en diciembre' }))).toEqual({ ok: true })
    const ap = tablas.aprobaciones_excepcion[0]
    expect(ap).toMatchObject({ tipo: 'plan_fuera_de_regla', estado: 'solicitada', entidad_tipo: 'plan_pago' })
    expect(tablas.notificaciones).toEqual([expect.objectContaining({ destinatario_id: 'p-s-edgar', tipo: 'aprobacion_pendiente' })])

    // La comercial no puede aprobarse a sí misma.
    expect((await decidirAprobacionPlan(NEG, ap.id as string, 'aprobada', null)).ok).toBe(false)
    staffId = 's-edgar'
    rol = 'operator'
    areas = ['direccion']
    expect(await decidirAprobacionPlan(NEG, ap.id as string, 'aprobada', null)).toEqual({ ok: true })
    expect(ap.estado).toBe('aprobada')

    // Cambiar una cuota después de aprobar invalida la aprobación (huella).
    staffId = 's-dani'
    areas = ['comercial']
    const otra = cuotas.map((c, i) => (i === 0 ? { ...c, monto: c.monto - 1000 } : { ...c, monto: c.monto + 1000 }))
    expect((await confirmarClienteViaje(entrada({ cuotas: otra }))).ok).toBe(false)

    const r = await confirmarClienteViaje(entrada({ cuotas }))
    expect(r.ok).toBe(true)
    const acordado = planes().find(p => p.estado === 'acordado') as Fila
    expect(acordado).toMatchObject({ dentro_de_regla: false, aprobacion_id: ap.id })
  })

  it('el panel lee el plan vigente como el gate: una pedida más nueva no tapa la aprobada (barrido 2026-10-22)', async () => {
    const mitad = Math.round(TOTAL_REC / 2)
    const cuotas: CuotaPlan[] = [
      { numero: 0, monto: mitad, fecha: HOY, concepto: null },
      { numero: 1, monto: TOTAL_REC - mitad, fecha: SALIDA, concepto: null },
    ]
    await pedirAprobacionPlan(entrada({ cuotas, motivo: 'prima de diciembre' }))
    const ap = tablas.aprobaciones_excepcion[0]
    staffId = 's-edgar'; rol = 'operator'; areas = ['direccion']
    await decidirAprobacionPlan(NEG, ap.id as string, 'aprobada', null)
    staffId = 's-dani'; areas = ['comercial']
    expect((await confirmarClienteViaje(entrada({ cuotas }))).ok).toBe(true)
    // Después alguien pidió otra aprobación (otras cuotas) que sigue abierta: es la ÚLTIMA.
    tablas.aprobaciones_excepcion.push({ id: 'ap-nueva', negocio_id: NEG, tipo: 'plan_fuera_de_regla', estado: 'solicitada', huella: 'otra', entidad_tipo: 'plan_pago', solicitada_at: '2999-01-01T00:00:00Z', detalle: {} })
    const gates = await evaluarGatesConfirmacion(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates: ['plan_pagos_acordado'], mensajes: {} })
    expect(gates).toEqual([])
    const vista = await leerVistaConfirmacion(clienteFalso(), WS, NEG)
    expect(vista?.estado.planVigente).toBe(true)
  })

  it('«No aprobar» exige motivo', async () => {
    const mitad = Math.round(TOTAL_REC / 2)
    const cuotas: CuotaPlan[] = [
      { numero: 0, monto: mitad, fecha: HOY, concepto: null },
      { numero: 1, monto: TOTAL_REC - mitad, fecha: SALIDA, concepto: null },
    ]
    await pedirAprobacionPlan(entrada({ cuotas }))
    staffId = 's-edgar'
    rol = 'admin'
    const id = tablas.aprobaciones_excepcion[0].id as string
    expect((await decidirAprobacionPlan(NEG, id, 'rechazada', '')).ok).toBe(false)
    expect(await decidirAprobacionPlan(NEG, id, 'rechazada', 'Que pague el 80 % a tiempo')).toEqual({ ok: true })
  })
})

describe('permisos en el servidor (C15, §7.4)', () => {
  beforeEach(() => sembrar())

  it('otra comercial (no responsable) no confirma', async () => {
    staffId = 's-tati'
    const r = await confirmarClienteViaje(entrada())
    expect(r.ok).toBe(false)
    expect(planes()).toHaveLength(0)
  })

  it('operaciones sola no confirma', async () => {
    areas = ['operaciones']
    expect((await confirmarClienteViaje(entrada())).ok).toBe(false)
  })

  it('la dirección sí confirma aunque no sea responsable', async () => {
    staffId = 's-edgar'
    areas = []
    expect((await confirmarClienteViaje(entrada())).ok).toBe(true)
  })
})

describe('gates de la etapa Confirmación', () => {
  beforeEach(() => sembrar())

  it('antes de confirmar faltan los tres; después falta solo el anticipo con soporte y cuenta', async () => {
    const antes = await evaluarGatesConfirmacion(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates: GATES_E4, mensajes: {} })
    expect(antes).toHaveLength(3)
    await confirmarClienteViaje(entrada())
    const despues = await evaluarGatesConfirmacion(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates: GATES_E4, mensajes: {} })
    expect(despues).toEqual(['Para pasar a Reservas y pagos falta: el anticipo con su comprobante y la cuenta donde entró.'])

    // Un cobro sin cuenta receptora no basta; con cuenta y soporte, sí.
    tablas.cobros.push({ id: 'cb-1', workspace_id: WS, negocio_id: NEG, monto: 1_215_000, fecha: HOY, soporte: { url: 'one://x' }, cuenta_recaudo: null })
    expect(await evaluarGatesConfirmacion(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates: GATES_E4, mensajes: {} })).toHaveLength(1)
    tablas.cobros[0].cuenta_recaudo = 'bancolombia'
    expect(await evaluarGatesConfirmacion(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates: GATES_E4, mensajes: {} })).toEqual([])
  })

  it('una etapa sin estos gates no consulta nada', async () => {
    expect(await evaluarGatesConfirmacion(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates: ['saldo_cero'], mensajes: {} })).toEqual([])
  })
})

describe('prerreserva vencida (C9, F2-9)', () => {
  beforeEach(() => sembrar())

  async function confirmarConPrerreserva() {
    const vence = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const r = await confirmarClienteViaje(entrada({ prerreservaVence: vence }))
    expect(r.ok).toBe(true)
    expect(meta().prerreserva).toMatchObject({ estado: 'vigente' })
    // Pasó la hora.
    ;(meta().prerreserva as Fila).vence_at = new Date(Date.now() - 1000).toISOString()
  }

  it('vuelve a Cotización, anula el plan, suelta los servicios sin pagos, duplica la cotización y cuenta reproceso', async () => {
    await confirmarConPrerreserva()
    const hotel = tablas.negocio_servicios.find(s => s.item_id === 'hotel') as Fila
    tablas.gastos.push({ id: 'g-1', workspace_id: WS, negocio_id: NEG, servicio_id: hotel.id, monto: 300_000 })

    expect(await aplicarPrerreservaSiVencio(NEG)).toEqual({ ok: true, aplicada: true })
    expect(neg().etapa_actual_id).toBe('e2')
    expect(neg().precio_aprobado).toBeNull()
    expect(planes().every(p => p.estado === 'anulado' || p.estado === 'reemplazado')).toBe(true)
    expect(tablas.negocio_servicios.map(s => [s.item_id, s.estado])).toEqual([['hotel', 'cancelado']])
    expect(tablas.cotizaciones.find(c => c.id === COT)?.estado).toBe('vencida')
    const nueva = tablas.cotizaciones.find(c => c.id !== COT)
    expect(nueva).toMatchObject({ estado: 'borrador', origen_version: 'prerreserva_vencida' })
    expect(meta().prerreserva).toMatchObject({ estado: 'vencida' })
    expect(tablas.activity_log.some(a => String(a.contenido).startsWith('Reproceso: venció la prerreserva'))).toBe(true)

    // Idempotente.
    expect(await aplicarPrerreservaSiVencio(NEG)).toEqual({ ok: true, aplicada: false })
    expect(tablas.cotizaciones).toHaveLength(2)
  })

  it('con un pago registrado la prerreserva no vence', async () => {
    await confirmarConPrerreserva()
    tablas.cobros.push({ id: 'cb-1', workspace_id: WS, negocio_id: NEG, monto: 1_000_000, fecha: HOY })
    expect(await aplicarPrerreservaSiVencio(NEG)).toEqual({ ok: true, aplicada: false })
    expect(neg().etapa_actual_id).toBe('e4')
  })
})

// ── Riel de cobro (PR 9) ─────────────────────────────────────────────────────

import {
  consolidarPagoViajero,
  deshacerPagoViajero,
  leerComprobantePago,
  registrarPagoViajero,
  reintentarReciboViaje,
  type EntradaPagoViajero,
} from './riel-cobro-actions'

const SOPORTE = { storage_path: `${WS}/pagos-viajero/c1.png`, file_name: 'comprobante.png', mime_type: 'image/png' }

function pagoEntrada(extra: Partial<EntradaPagoViajero> = {}): EntradaPagoViajero {
  return { negocioId: NEG, monto: 1_215_000, fecha: HOY, cuentaId: 'bancolombia-3241', referencia: 'M4471023', banco: 'Nequi', soporte: SOPORTE, ...extra }
}

async function confirmado() {
  sembrar()
  tablas.staff.push({ id: 's-ale', workspace_id: WS, full_name: 'Alejandra Prueba', profile_id: 'p-s-ale', is_active: true })
  tablas.staff_areas = [{ staff_id: 's-ale', area: 'operaciones', staff: { workspace_id: WS, is_active: true } }]
  tablas.negocio_responsables.push({ negocio_id: NEG, staff_id: 's-ale', rol: 'operaciones' })
  const r = await confirmarClienteViaje(entrada())
  expect(r.ok).toBe(true)
  expect(neg().etapa_actual_id).toBe('e4')
  archivoEnStorage = null
  emitirMock = async () => ({ ok: false, motivo: 'error', mensaje: 'sin doble' })
  extraerMock = async () => ({ data: null, error: 'sin doble' })
}

describe('riel de cobro: registrar el pago del viajero (F2-5, F2-8)', () => {
  beforeEach(confirmado)

  it('registra UN cobro con fecha, cuenta, comprobante y referencia; con el anticipo pasa la etapa y avisa a operaciones', async () => {
    const r = await registrarPagoViajero(pagoEntrada())
    expect(r.ok).toBe(true)
    expect(tablas.cobros).toHaveLength(1)
    expect(tablas.cobros[0]).toMatchObject({ monto: 1_215_000, fecha: HOY, tipo_cobro: 'anticipo', cuenta_recaudo: 'bancolombia-3241', external_ref: 'M4471023' })
    // `cobros.created_by` apunta a auth.users: va el usuario, no el staff (con el staff, la FK
    // rechazaba todo pago en producción; QA de punta a punta del 2026-10-29).
    expect(tablas.cobros[0].created_by).toBe('p-s-dani')
    expect((tablas.cobros[0].soporte as Fila).url).toBe(`one://ve-documentos/${SOPORTE.storage_path}`)
    if (!r.ok) return
    expect(r.avanzo).toBe('Reservas y pagos')
    expect(neg().etapa_actual_id).toBe('e5')
    expect(tablas.notificaciones.some((n) => n.tipo === 'handoff' && n.destinatario_id === 'p-s-ale' && String(n.contenido) === 'Carolina Prueba pagó el anticipo. Ya puedes reservar.')).toBe(true)
  })

  it('doble toque con la misma intención: un solo cobro', async () => {
    const clave = 'c0ffee00-1111-4222-8333-777777777777'
    await Promise.all([registrarPagoViajero(pagoEntrada(), clave), registrarPagoViajero(pagoEntrada(), clave)])
    expect(tablas.cobros).toHaveLength(1)
  })

  it('misma referencia y monto: avisa antes de registrar; si es otro pago, lo registra', async () => {
    await registrarPagoViajero(pagoEntrada())
    const r = await registrarPagoViajero(pagoEntrada())
    expect(r).toMatchObject({ ok: false, repetido: true })
    expect(tablas.cobros).toHaveLength(1)
    expect((await registrarPagoViajero(pagoEntrada({ confirmarRepetido: true }))).ok).toBe(true)
    expect(tablas.cobros).toHaveLength(2)
    expect(tablas.cobros[1].tipo_cobro).toBe('pago')
  })

  it('sin cuenta receptora o sin comprobante no registra', async () => {
    expect((await registrarPagoViajero(pagoEntrada({ cuentaId: 'otra' }))).ok).toBe(false)
    expect((await registrarPagoViajero(pagoEntrada({ soporte: { storage_path: '', file_name: '', mime_type: '' } }))).ok).toBe(false)
    expect(tablas.cobros).toHaveLength(0)
  })

  it('otra comercial no registra; operaciones sola tampoco (§7.4)', async () => {
    staffId = 's-tati'
    expect((await registrarPagoViajero(pagoEntrada())).ok).toBe(false)
    staffId = 's-ale'
    areas = ['operaciones']
    expect((await registrarPagoViajero(pagoEntrada())).ok).toBe(false)
    expect(tablas.cobros).toHaveLength(0)
  })

  it('Deshacer: otra persona no deshace el pago de quien lo registró', async () => {
    const r = await registrarPagoViajero(pagoEntrada())
    if (!r.ok) throw new Error(r.error)
    staffId = 's-edgar'
    expect((await deshacerPagoViajero(NEG, r.cobroId)).ok).toBe(false)
    expect(tablas.cobros).toHaveLength(1)
  })

  it('Deshacer (8): el pago desaparece y el negocio vuelve a Confirmación', async () => {
    const r = await registrarPagoViajero(pagoEntrada())
    if (!r.ok) throw new Error(r.error)
    expect(await deshacerPagoViajero(NEG, r.cobroId)).toEqual({ ok: true })
    expect(tablas.cobros).toHaveLength(0)
    expect(neg().etapa_actual_id).toBe('e4')
  })
})

/**
 * QA G11 (2026-10-30, bitácora del bloqueo): con un anticipo de $1,5 M sobre $3,2 M el negocio pasó
 * solo de Seguimiento a Reservas y pagos; en la actividad Confirmación no aparecía. VISTO FALLAR
 * sobre main: el pago parcial movía a e5 y la confirmación no dejaba rastro de su paso de etapa.
 */
describe('el avance solo no se salta Confirmación (QA G11)', () => {
  beforeEach(confirmado)

  it('el paso a Confirmación queda en la actividad', () => {
    expect(tablas.activity_log.some((a) => a.tipo === 'cambio_etapa' && a.valor_anterior === 'Seguimiento' && a.valor_nuevo === 'Confirmación')).toBe(true)
  })

  it('con el anticipo a medias el negocio sigue en Confirmación y operaciones no recibe «ya puedes reservar»', async () => {
    const anticipo = Number([...tablas.negocio_plan_cuotas].sort((a, b) => Number(a.numero) - Number(b.numero))[0].monto)
    const r = await registrarPagoViajero(pagoEntrada({ monto: anticipo - 500_000 }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.avanzo).toBeNull()
    expect(r.textoAvance).toBe(`Faltan $500.000 del anticipo: el negocio sigue en Confirmación. Pasa solo a Reservas y pagos con el anticipo completo; si ya se acordó otra cosa, avánzalo a mano.`)
    expect(neg().etapa_actual_id).toBe('e4')
    expect(tablas.notificaciones.some((n) => n.tipo === 'handoff')).toBe(false)
    // Con el resto del anticipo, pasa solo.
    const r2 = await registrarPagoViajero(pagoEntrada({ monto: 500_000, referencia: 'M4471099' }))
    expect(r2.ok && r2.avanzo).toBe('Reservas y pagos')
    expect(neg().etapa_actual_id).toBe('e5')
  })
})

describe('riel de cobro: recibo de caja (F2-6, C7)', () => {
  beforeEach(confirmado)

  it('con la emisión apagada en la línea: el pago queda y el recibo pendiente con su motivo; Siigo no se llama', async () => {
    let llamadas = 0
    emitirMock = async () => { llamadas++; return { ok: true, numero: 'RC-X' } }
    const r = await registrarPagoViajero(pagoEntrada())
    if (!r.ok) throw new Error(r.error)
    const c = await consolidarPagoViajero(NEG, r.cobroId)
    expect(c).toMatchObject({ ok: true, numero: null, pendiente: expect.stringContaining('no está encendida') })
    expect(llamadas).toBe(0)
    expect(((meta().recibos_viaje as Fila)[r.cobroId] as Fila).motivo).toMatch(/no está encendida/)
  })

  it('encendida: uno por cobro, con la forma de pago de la cuenta que recibió la plata', async () => {
    ;(tablas.lineas_negocio[0].config_extra as Fila).siigo = { recibo_total_automatico: true }
    tablas.workspaces[0].config_extra = { cuentas_recaudo: [{ id: 'bancolombia-3241', nombre: 'Bancolombia ahorros', tipo: 'banco', numero: '32800003241', siigo_payment_id: 5638 }] }
    const llamadas: unknown[][] = []
    emitirMock = async (...a: unknown[]) => { llamadas.push(a); return { ok: true, numero: 'RC-0142', siigo_id: 'x', valor: 1, archivada: true, recibos: [] } }
    const r = await registrarPagoViajero(pagoEntrada())
    if (!r.ok) throw new Error(r.error)
    const c = await consolidarPagoViajero(NEG, r.cobroId)
    expect(c).toMatchObject({ ok: true, numero: 'RC-0142', pendiente: null })
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0][1]).toBe(r.cobroId)
    expect(llamadas[0][3]).toMatchObject({ formaDePagoId: 5638, avisarAlCliente: false })
    if (c.ok) expect(decodeURIComponent(c.waUrl)).toContain('Adjunto tu recibo de caja RC-0142.')
  })

  it('sin credenciales (Siigo responde error): pendiente con «Reintentar»', async () => {
    ;(tablas.lineas_negocio[0].config_extra as Fila).siigo = { recibo_total_automatico: true }
    emitirMock = async () => ({ ok: false, motivo: 'error', mensaje: 'No hay credenciales de Siigo configuradas' })
    const r = await registrarPagoViajero(pagoEntrada())
    if (!r.ok) throw new Error(r.error)
    const c = await consolidarPagoViajero(NEG, r.cobroId)
    expect(c).toMatchObject({ ok: true, numero: null, pendiente: 'Siigo no está conectado para este espacio.' })
    emitirMock = async () => ({ ok: true, numero: 'RC-0143', siigo_id: 'x', valor: 1, archivada: true, recibos: [] })
    expect(await reintentarReciboViaje(NEG, r.cobroId)).toMatchObject({ ok: true, numero: 'RC-0143', pendiente: null })
    expect((meta().recibos_viaje as Fila)[r.cobroId]).toBeUndefined()
  })
})

describe('riel de cobro: lectura del comprobante (F2-4)', () => {
  beforeEach(confirmado)

  it('propone monto, fecha, banco, referencia y cuenta; la persona confirma', async () => {
    process.env.GEMINI_API_KEY = 'prueba'
    archivoEnStorage = new Blob(['x'], { type: 'image/png' })
    extraerMock = async () => ({ data: {
      monto: { value: '1215000' }, fecha: { value: HOY }, banco_origen: { value: 'Nequi' },
      cuenta_destino: { value: '3241' }, destinatario: { value: 'Trappvel Enterprise' }, referencia: { value: 'M4471023' },
    } })
    const r = await leerComprobantePago(NEG, SOPORTE)
    expect(r).toMatchObject({ ok: true, leido: true, aviso: null, lectura: { monto: 1_215_000, fecha: HOY, banco: 'Nequi', referencia: 'M4471023', cuentaId: 'bancolombia-3241' } })
    // Leer no registra nada.
    expect(tablas.cobros).toHaveLength(0)
    delete process.env.GEMINI_API_KEY
  })

  it('ilegible o sin llave: propuesta vacía para escribir a mano', async () => {
    delete process.env.GEMINI_API_KEY
    const r = await leerComprobantePago(NEG, SOPORTE)
    expect(r).toMatchObject({ ok: true, leido: false })
  })

  it('un archivo de otro espacio no se lee', async () => {
    expect((await leerComprobantePago(NEG, { ...SOPORTE, storage_path: 'otro-ws/x.png' })).ok).toBe(false)
  })
})

describe('sin la autorización de datos no se confirma (2026-10-25)', () => {
  // La línea pide la autorización en Cotización, como después del SQL del #1257.
  const conGate = () => {
    sembrar()
    autorizada = false
    tablas.etapas_negocio[0].config_extra = { gates: ['autorizacion_datos'] }
  }
  beforeEach(conGate)

  it('sin firma: no confirma, con el motivo de «Enviar», y no escribe nada', async () => {
    const r = await confirmarClienteViaje(entrada())
    expect(r).toEqual({ ok: false, error: MENSAJE_ENVIO.generales })
    expect(planes()).toHaveLength(0)
    expect(meta().confirmacion_cliente).toBeUndefined()
    expect(tablas.cotizaciones[0].estado).toBe('enviada')
  })

  it('con la cotización ya aprobada tampoco (antes pasaba: solo frenaba la aprobación)', async () => {
    tablas.cotizaciones[0].estado = 'aceptada'
    tablas.cotizaciones[0].tarifa_aceptada_id = 'it-rec'
    const r = await confirmarClienteViaje(entrada())
    expect(r.ok).toBe(false)
    expect(meta().confirmacion_cliente).toBeUndefined()
  })

  it('firmada: confirma como siempre', async () => {
    autorizada = true
    const r = await confirmarClienteViaje(entrada())
    expect(r.ok).toBe(true)
    expect(meta().confirmacion_cliente).toBeDefined()
  })
})
