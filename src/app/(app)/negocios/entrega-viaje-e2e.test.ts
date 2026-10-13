/**
 * «Documentos y entrega» (F4) probado LLAMANDO A LAS ACCIONES reales sobre el mismo doble de la
 * base que `confirmacion-viaje-e2e.test.ts` (copiado tal cual; solo agrega `upload` al Storage y un
 * doble del PDF del paquete).
 *
 * Criterios de Vera: F4-1 (vouchers de las filas), F4-2 (pasaporte en el CONTACTO, C11), F4-3
 * (`cobro_minimo` en el servidor; «Enviar igual» solo dirección, con motivo y aprobación
 * registrada), F4-4 (paquete por C1 y `metadata.paquete_viaje.enviado_at`, que lee F5), §7.4
 * (permisos en el servidor), §7.1 (apagado = nada), §7.2.1 (idempotencia por intención).
 *
 * VISTO FALLAR (2026-10-12), una mutación a la vez:
 *   · quitar el `if (!ctx.esDireccion) return …SOLO_DIRECCION` → cae «la comercial no envía igual»;
 *   · quitar el chequeo de `vista.cobro.cumple` → cae «sin ir al día no sale»;
 *   · `enviado_at` con otro nombre de llave → cae «queda enviado_at para F5».
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
let subidos: string[] = []
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

import { enviarPaquete, guardarDocumentoViajero, marcarPaqueteMandado } from './entrega-viaje-actions'
import { evaluarGateEntrega } from '@/lib/viaje/entrega-datos'
import { registrarPagoViajero } from './riel-cobro-actions'

const SOPORTE = { storage_path: `${WS}/pagos-viajero/c1.png`, file_name: 'comprobante.png', mime_type: 'image/png' }
const GATES_E6 = ['vouchers_completos', 'documentos_viajero', 'cobro_minimo', 'paquete_enviado']

/** Confirmado (etapa 4), con la entrega encendida, la etapa 6 declarada y los vouchers puestos. */
async function listoParaEntregar(opts: { vouchers?: boolean; internacional?: boolean } = {}) {
  sembrar()
  ;(tablas.lineas_negocio[0].config_extra as Fila).entrega_viaje = { activo: true, contactos_emergencia: 'Edgar 313 000 0000' }
  tablas.etapas_negocio.push({ id: 'e6', linea_id: LINEA, nombre: 'Documentos y entrega', numero: 6, orden: 6, stage: 'ejecucion', config_extra: { gates: GATES_E6 } })
  ;(tablas.negocio_bloques[0] as Fila).destino_tipo = opts.internacional === false ? 'nacional' : 'internacional'
  const r = await confirmarClienteViaje(entrada())
  expect(r.ok).toBe(true)
  expect(tablas.negocio_servicios.length).toBeGreaterThan(0)
  for (const s of tablas.negocio_servicios) {
    // El doble no tiene rubros: cada fila con un costo para que pida voucher (F4-1).
    if (!Number(s.costo_cotizado)) s.costo_cotizado = 500_000
    if (opts.vouchers !== false) s.voucher_ref = `one://ve-documentos/${WS}/vouchers/${s.id}.pdf`
  }
  neg().etapa_actual_id = 'e6'
  subidos = []
}

async function pagarAnticipo() {
  const anticipo = sugerido()[0].monto
  const r = await registrarPagoViajero({ negocioId: NEG, monto: anticipo, fecha: HOY, cuentaId: 'bancolombia-3241', referencia: 'M1', banco: 'Nequi', soporte: SOPORTE })
  expect(r.ok).toBe(true)
}

const aprobacionesPaquete = () => tablas.aprobaciones_excepcion.filter(a => a.tipo === 'enviar_paquete_sin_cobro')

describe('apagado: nada cambia (§7.1)', () => {
  it('sin entrega_viaje.activo el envío se niega y el gate no frena', async () => {
    await listoParaEntregar()
    delete (tablas.lineas_negocio[0].config_extra as Fila).entrega_viaje
    const r = await enviarPaquete({ negocioId: NEG, nota: null })
    expect(r).toMatchObject({ ok: false, error: 'Esta línea no usa la entrega del viaje.' })
    expect(await evaluarGateEntrega(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates: GATES_E6 })).toEqual([])
    expect(meta().paquete_viaje).toBeUndefined()
  })
})

describe('cobro mínimo en el servidor (F4-3)', () => {
  it('sin ir al día con las cuotas no sale; la comercial no puede «enviar igual»', async () => {
    await listoParaEntregar()
    const r = await enviarPaquete({ negocioId: NEG, nota: null })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/^No se puede enviar el paquete todavía\. Carolina no va al día con sus cuotas: faltan \$/)
    expect(r.puedeEnviarIgual).toBe(false)
    const igual = await enviarPaquete({ negocioId: NEG, nota: null, enviarIgualMotivo: 'el cliente es de confianza' })
    expect(igual).toMatchObject({ ok: false, error: 'Solo la dirección puede enviar el paquete sin el cobro mínimo.' })
    expect(meta().paquete_viaje).toBeUndefined()
    expect(aprobacionesPaquete()).toHaveLength(0)
  })

  it('la dirección envía igual con motivo: queda la aprobación y el paquete', async () => {
    await listoParaEntregar()
    rol = 'admin'
    staffId = 's-edgar'
    const r = await enviarPaquete({ negocioId: NEG, nota: null, enviarIgualMotivo: 'viaja mañana y paga en el aeropuerto' })
    expect(r.ok).toBe(true)
    expect(aprobacionesPaquete()).toHaveLength(1)
    expect(aprobacionesPaquete()[0]).toMatchObject({ estado: 'aprobada', entidad_id: NEG, decidida_por: 's-edgar', motivo: 'viaja mañana y paga en el aeropuerto' })
    expect((meta().paquete_viaje as Fila).forzado).toMatchObject({ motivo: 'viaja mañana y paga en el aeropuerto' })
  })
})

describe('paquete por C1 (F4-4)', () => {
  it('con el anticipo pagado y los vouchers: sale, queda enviado_at para F5 y el gate deja pasar', async () => {
    await listoParaEntregar()
    await pagarAnticipo()
    neg().etapa_actual_id = 'e6'
    await guardarDocumentoViajero({ negocioId: NEG, tipo: 'pasaporte', numero: 'AB123456', nombre: 'CAROLINA PRUEBA', pais: 'Colombia', fechaEmision: null, fechaVencimiento: '2035-01-01', soporte: null, leidoPorIa: false })
    const antes = await evaluarGateEntrega(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates: GATES_E6 })
    expect(antes).toEqual(['Falta enviar el paquete de viaje.'])

    const r = await enviarPaquete({ negocioId: NEG, nota: 'Lleva el registro civil del bebé.' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(decodeURIComponent(r.waUrl)).toContain('Aquí va tu paquete de viaje (te lo adjunto en PDF).')
    expect(decodeURIComponent(r.waUrl)).toContain('Lleva el registro civil del bebé.')
    expect(r.correo).toBe('omitido')
    expect(subidos).toHaveLength(1)
    expect(subidos[0]).toMatch(new RegExp(`^${WS}/paquetes-viaje/${NEG}/\\d+\\.pdf$`))
    const p = meta().paquete_viaje as Fila
    expect(typeof p.enviado_at).toBe('string')
    expect(p.archivo_ref).toBe(`one://ve-documentos/${subidos[0]}`)
    expect(await evaluarGateEntrega(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates: GATES_E6 })).toEqual([])

    expect((await marcarPaqueteMandado(NEG)).ok).toBe(true)
    expect(tablas.avisos_cliente.some(a => a.canal === 'whatsapp' && a.motivo === 'wa_manual' && a.titulo === 'Paquete de viaje')).toBe(true)
  })

  it('sin un voucher no sale y el gate lo nombra (F4-1)', async () => {
    await listoParaEntregar({ vouchers: false })
    await pagarAnticipo()
    neg().etapa_actual_id = 'e6'
    const r = await enviarPaquete({ negocioId: NEG, nota: null })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/^Faltan \d+ vouchers: /)
    const gate = await evaluarGateEntrega(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates: ['vouchers_completos'] })
    expect(gate[0]).toMatch(/^Faltan \d+ vouchers: /)
  })

  it('doble toque con la misma intención: un solo envío', async () => {
    await listoParaEntregar()
    await pagarAnticipo()
    neg().etapa_actual_id = 'e6'
    const clave = 'c0ffee00-1111-4222-8333-888888888888'
    await Promise.all([enviarPaquete({ negocioId: NEG, nota: null }, clave), enviarPaquete({ negocioId: NEG, nota: null }, clave)])
    expect(subidos).toHaveLength(1)
    expect((meta().paquete_viaje as Fila).envios).toBe(1)
  })

  it('otra comercial no envía; operaciones sola tampoco (§7.4)', async () => {
    await listoParaEntregar()
    await pagarAnticipo()
    staffId = 's-tati'
    expect((await enviarPaquete({ negocioId: NEG, nota: null })).ok).toBe(false)
    staffId = 's-dani'
    areas = ['operaciones']
    expect((await enviarPaquete({ negocioId: NEG, nota: null })).ok).toBe(false)
    expect(meta().paquete_viaje).toBeUndefined()
  })
})

describe('documentos del viajero en el contacto (F4-2, C11)', () => {
  it('el pasaporte se guarda en el contacto; el mismo número se actualiza, no se duplica', async () => {
    await listoParaEntregar()
    const base = { negocioId: NEG, tipo: 'pasaporte' as const, nombre: 'CAROLINA PRUEBA', pais: null, fechaEmision: null, soporte: null, leidoPorIa: true }
    expect((await guardarDocumentoViajero({ ...base, numero: 'ab 123 456', fechaVencimiento: '2027-01-10' })).ok).toBe(true)
    expect((await guardarDocumentoViajero({ ...base, numero: 'AB123456', fechaVencimiento: '2031-01-10' })).ok).toBe(true)
    expect(tablas.contacto_documentos).toHaveLength(1)
    expect(tablas.contacto_documentos[0]).toMatchObject({ contacto_id: 'c-1', numero: 'AB123456', fecha_vencimiento: '2031-01-10', vigente: true })
  })

  it('sin número o sin vencimiento el pasaporte no se guarda; operaciones sí puede cargarlo', async () => {
    await listoParaEntregar()
    const base = { negocioId: NEG, tipo: 'pasaporte' as const, nombre: null, pais: null, fechaEmision: null, soporte: null, leidoPorIa: false }
    expect((await guardarDocumentoViajero({ ...base, numero: 'AB1', fechaVencimiento: null })).ok).toBe(false)
    areas = ['operaciones']
    tablas.staff_areas = [{ staff_id: 's-dani', area: 'operaciones' }]
    staffId = 's-dani'
    tablas.negocio_responsables = []
    expect((await guardarDocumentoViajero({ ...base, numero: 'AB1', fechaVencimiento: '2035-01-01' })).ok).toBe(true)
  })

  it('internacional sin pasaporte: el gate lo pide', async () => {
    await listoParaEntregar()
    const gate = await evaluarGateEntrega(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates: ['documentos_viajero'] })
    expect(gate).toEqual(['Falta el pasaporte del viajero.'])
  })
})
