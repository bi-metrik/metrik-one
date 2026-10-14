/**
 * En viaje, Cierre económico y Postventa (F6) probados LLAMANDO A LAS ACCIONES reales sobre el
 * mismo doble de la base de `confirmacion-viaje-e2e.test.ts`.
 *
 * Criterios de Vera: F6-3 (cortesía con valor suma al costo; sin valor no se guarda), F6-4 (nadie
 * teclea el margen), F6-5 (solo la dirección confirma; la huella invalida; reabrir con motivo),
 * F6-6 (saldo a favor bloquea hasta decidir; comisión no), F6-7 (referido crea contacto sin
 * duplicar; cerrar exige calificación y referido), §7.4 (permisos en el servidor), §7.1 (apagado).
 *
 * VISTO FALLAR (2026-10-12), una mutación a la vez:
 *   · quitar `if (!ctx.esDireccion) return …SOLO_DIRECCION` de `confirmarCierre` → cae «la comercial no confirma»;
 *   · quitar la búsqueda del celular existente en `registrarPostventa` → cae «un referido que ya existe no se duplica».
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
const emitirMock: (...a: any[]) => Promise<any> = async () => ({ ok: false, motivo: 'error', mensaje: 'sin doble' })
vi.mock('@/lib/siigo/recibos', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitirReciboDeCobro: (...a: any[]) => emitirMock(...a),
}))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extraerMock: (...a: any[]) => Promise<any> = async () => ({ data: null, error: 'sin doble' })
vi.mock('@/lib/ai/extract-fields', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extractFieldsFromDocument: (...a: any[]) => extraerMock(...a),
}))
const archivoEnStorage: Blob | null = null
const subidos: string[] = []
// El PDF del paquete no se renderiza aquí (lo prueba su propia plantilla): un doble con la huella real.
vi.mock('@/lib/viaje/entrega-paquete', async () => {
  const { huellaVouchers } = await import('@/lib/viaje/entrega')
  return {
    armarPaquetePdf: async (_db: unknown, _ws: string, negocioId: string) => ({
      pdf: Buffer.from('%PDF-1.4 paquete de prueba'),
      filename: 'paquete-prueba.pdf',
      huella: huellaVouchers((tablas.negocio_servicios ?? []).filter(s => s.negocio_id === negocioId).map(s => ({
        id: String(s.id), nombre: String(s.nombre), estado: String(s.estado), costo_cotizado: Number(s.costo_cotizado),
        valor_por_pagar: (s.valor_por_pagar as number | null) ?? null, voucher_ref: (s.voucher_ref as string | null) ?? null, gastos: [],
      }))),
      sinAnexar: [],
    }),
  }
})

vi.mock('@/lib/modulos/exigir-modulo', async () =>
  (await import('../../../../test/exigir-modulo-doble')).dobleExigirModulo())

// ── El doble de la base ──────────────────────────────────────────────────────

function clienteFalso() {
  return {
    from: (tabla: string) => constructor(tabla),
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => ({
      download: async () => (archivoEnStorage ? { data: archivoEnStorage, error: null } : { data: null, error: { message: 'no' } }),
      upload: async (path: string) => { subidos.push(path); return { error: null } },
    }) },
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
      salida.lineas_negocio = l ? { config_extra: l.config_extra } : null
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

import { confirmarClienteViaje, type EntradaConfirmacion } from './confirmacion-viaje-actions'
import { planSugerido, sumarDiasCivil, type CuotaPlan } from '@/lib/viaje/plan-pagos'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { reiniciarModulo } from '../../../../test/exigir-modulo-doble'
import { TERMINOS_BASE_TRAPPVEL } from '@/lib/cotizaciones/__fixtures__/terminos-base-trappvel'

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

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})


import { anotarCortesia, confirmarCierre, decidirSaldoAFavor, reabrirCierre, registrarPostventa } from './viaje-final-actions'
import { evaluarGateCierre, evaluarGatePostventa, leerVistaViajeFinal } from '@/lib/viaje/cierre-viaje-datos'

const GATES_E8 = ['margen_confirmado']

/** Viaje confirmado y pagado, en el Cierre económico, con los servicios pagados al proveedor. */
async function enCierre(opts: { pagado?: number } = {}) {
  sembrar()
  const cfg = tablas.lineas_negocio[0].config_extra as Fila
  cfg.cierre_viaje = { activo: true }
  cfg.etapas_por_fecha = { entrar: { etapa_numero: 7 }, salir: { etapa_numero: 8, offset: 1 } }
  tablas.etapas_negocio.push(
    { id: 'e7', linea_id: LINEA, nombre: 'En viaje', numero: 7, orden: 7, stage: 'ejecucion', config_extra: {} },
    { id: 'e8', linea_id: LINEA, nombre: 'Cierre económico', numero: 8, orden: 8, stage: 'cobro', config_extra: { gates: GATES_E8 } },
    { id: 'e9', linea_id: LINEA, nombre: 'Postventa', numero: 9, orden: 9, stage: 'cobro', config_extra: { gates: ['postventa_completa'] } },
  )
  expect((await confirmarClienteViaje(entrada())).ok).toBe(true)
  const precio = Number(neg().precio_aprobado)
  for (const s of tablas.negocio_servicios) {
    if (!Number(s.costo_cotizado)) s.costo_cotizado = 500_000
    s.valor_por_pagar = null
    tablas.gastos.push({ id: `g-${s.id}`, workspace_id: WS, negocio_id: NEG, servicio_id: s.id, monto: s.costo_cotizado, categoria: 'proveedor_viaje', descripcion: 'Pago', titular_medio: 'empresa' })
  }
  tablas.cobros.push({ id: 'cb-1', workspace_id: WS, negocio_id: NEG, monto: opts.pagado ?? precio, fecha: HOY, retencion_iva: 0, anulado_at: null })
  neg().etapa_actual_id = 'e8'
}

const gate = () => evaluarGateCierre(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates: GATES_E8 })
const comoEdgar = () => { rol = 'admin'; staffId = 's-edgar'; areas = [] }

describe('apagado (§7.1)', () => {
  it('sin cierre_viaje.activo no hay panel, las acciones se niegan y el gate no frena', async () => {
    await enCierre()
    delete (tablas.lineas_negocio[0].config_extra as Fila).cierre_viaje
    expect(await leerVistaViajeFinal(clienteFalso(), WS, NEG)).toBeNull()
    expect((await anotarCortesia({ negocioId: NEG, que: 'Upgrade', detalle: null, valor: 50_000 })).ok).toBe(false)
    expect(await gate()).toEqual([])
  })
})

describe('En viaje: cortesías (F6-3)', () => {
  it('con valor suma al costo real; sin valor no se guarda', async () => {
    await enCierre()
    neg().etapa_actual_id = 'e7'
    const sin = await anotarCortesia({ negocioId: NEG, que: 'Upgrade', detalle: null, valor: '' })
    expect(sin).toMatchObject({ ok: false, error: 'Ponle un valor aproximado. Sin valor no suma al costo real.' })
    const antes = tablas.gastos.length
    expect((await anotarCortesia({ negocioId: NEG, que: 'Acompañamiento en aeropuerto', detalle: 'Duarte', valor: '$50.000' })).ok).toBe(true)
    expect(tablas.gastos).toHaveLength(antes + 1)
    expect(tablas.gastos.at(-1)).toMatchObject({ categoria: 'cortesia_viaje', monto: 50_000, negocio_id: NEG })
    const v = await leerVistaViajeFinal(clienteFalso(), WS, NEG)
    expect(v?.fase).toBe('en_viaje')
    expect(v?.cierre.cortesias).toEqual([{ descripcion: 'Cortesía · Acompañamiento en aeropuerto · Duarte', monto: 50_000 }])
  })

  it('otra comercial no anota (§7.4)', async () => {
    await enCierre()
    staffId = 's-tati'
    expect((await anotarCortesia({ negocioId: NEG, que: 'Upgrade', detalle: null, valor: 10_000 })).ok).toBe(false)
  })
})

describe('Cierre económico (F6-4, F6-5, F6-6)', () => {
  it('solo la dirección confirma; luego el gate deja pasar; un gasto nuevo lo vuelve a pedir', async () => {
    await enCierre()
    expect(await gate()).toEqual(['Falta que Edgar confirme el cierre.'])
    expect(await confirmarCierre(NEG)).toMatchObject({ ok: false, error: 'Solo la dirección confirma, reabre o decide el cierre.' })
    comoEdgar()
    expect((await confirmarCierre(NEG)).ok).toBe(true)
    const conf = (meta().cierre_viaje as Fila).confirmado as Fila
    expect(conf.margen_real).toBe(Number(neg().precio_aprobado) - tablas.gastos.reduce((a, g) => a + Number(g.monto), 0))
    expect(await gate()).toEqual([])
    tablas.gastos.push({ id: 'g-extra', workspace_id: WS, negocio_id: NEG, servicio_id: null, monto: 1, categoria: 'proveedor_viaje', descripcion: 'Incidencia' })
    expect((await gate())[0]).toMatch(/^Cambió un pago o un gasto después de confirmar/)
  })

  it('reabrir exige motivo y deja el cierre sin confirmar', async () => {
    await enCierre()
    comoEdgar()
    await confirmarCierre(NEG)
    expect((await reabrirCierre(NEG, '  ')).ok).toBe(false)
    expect((await reabrirCierre(NEG, 'faltaba un gasto')).ok).toBe(true)
    expect((meta().cierre_viaje as Fila).confirmado).toBeNull()
    expect(((meta().cierre_viaje as Fila).reaperturas as Fila[])[0]).toMatchObject({ motivo: 'faltaba un gasto' })
  })

  it('saldo a favor bloquea hasta decidir', async () => {
    await enCierre()
    tablas.cobros.push({ id: 'cb-2', workspace_id: WS, negocio_id: NEG, monto: 50_000, fecha: HOY, retencion_iva: 0, anulado_at: null })
    comoEdgar()
    const r = await confirmarCierre(NEG)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/tiene un saldo a favor de \$50\.000/)
    expect((await decidirSaldoAFavor(NEG, 'proximo_viaje', null)).ok).toBe(true)
    expect((await confirmarCierre(NEG)).ok).toBe(true)
    expect(await gate()).toEqual([])
  })
})

describe('Postventa (F6-7)', () => {
  it('cerrar exige calificación y referido; el referido crea contacto y no se duplica', async () => {
    await enCierre()
    neg().etapa_actual_id = 'e9'
    const gatePv = () => evaluarGatePostventa(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates: ['postventa_completa'] })
    expect(await gatePv()).toBe('Para cerrar falta: la calificación del viaje y si pediste el referido.')
    const base = { negocioId: NEG, comentario: null, proximoMes: '2027-06', proximoDestino: 'Cartagena' }
    const sinCel = await registrarPostventa({ ...base, calificacion: 5, referido: 'si', referidoNombre: 'Andrés Prueba', referidoCelular: '123' })
    expect(sinCel).toMatchObject({ ok: false, error: 'Escribe el celular del referido: sin eso no le podemos escribir.' })
    const r = await registrarPostventa({ ...base, calificacion: 5, referido: 'si', referidoNombre: 'Andrés Prueba', referidoCelular: '310 555 0000' })
    expect(r).toMatchObject({ ok: true, aviso: 'Contacto creado: Andrés Prueba, referido por Carolina Prueba.' })
    const creado = tablas.contactos.find(c => c.telefono === '3105550000')
    expect(creado).toMatchObject({ fuente_adquisicion: 'referido', fuente_detalle: 'Referido por Carolina Prueba' })
    expect(await gatePv()).toBeNull()
    expect((meta().postventa as Fila).proximo_viaje).toEqual({ mes: '2027-06', destino: 'Cartagena' })
  })

  it('un referido que ya existe no se duplica', async () => {
    await enCierre()
    neg().etapa_actual_id = 'e9'
    tablas.contactos.push({ id: 'c-laura', workspace_id: WS, nombre: 'Laura Pérez', telefono: '+57 310 555 0000' })
    const r = await registrarPostventa({ negocioId: NEG, calificacion: 4, comentario: null, referido: 'si', referidoNombre: 'Laura', referidoCelular: '3105550000', proximoMes: null, proximoDestino: null })
    expect(r).toMatchObject({ ok: true, aviso: 'Laura Pérez ya está en ONE. Lo anotamos como referido de Carolina Prueba.' })
    expect(tablas.contactos.filter(c => String(c.telefono ?? '').replace(/\D/g, '').endsWith('3105550000'))).toHaveLength(1)
    expect((meta().postventa as Fila).referido_contacto_id).toBe('c-laura')
  })

  it('operaciones sola no registra la postventa (§7.4)', async () => {
    await enCierre()
    areas = ['operaciones']
    expect((await registrarPostventa({ negocioId: NEG, calificacion: 5, comentario: null, referido: 'no_quiso', referidoNombre: null, referidoCelular: null, proximoMes: null, proximoDestino: null })).ok).toBe(false)
  })
})
