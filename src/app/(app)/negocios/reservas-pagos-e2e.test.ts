/**
 * Reservas y pagos (F3) probado LLAMANDO A LAS ACCIONES reales sobre un doble de la base que
 * escribe (mismo doble que `confirmacion-viaje-e2e.test.ts`).
 *
 * Criterios de Vera: F3-2 (registrarPagoServicio idempotente; soporte, medio y titular del medio),
 * F3-3 (reglas con huella), F3-4 y C5 (los dos caminos; «No aprobar» con motivo no borra el gasto),
 * F3-7 (gate servicios_listos), C15/§7.4 (el servidor rechaza a quien no puede).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
let secuencia = 0

const WS = '64010015-a9a2-4aca-be83-e456cf217d96'
const LINEA = 'linea-viaje'
const NEG = '7c1d2e3f-4a5b-4c6d-8e8f-90a1b2c3d4e5'

let rol = 'operator'
let areas: string[] = ['operaciones']
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
vi.mock('@/lib/modulos/exigir-modulo', async () =>
  (await import('../../../../test/exigir-modulo-doble')).dobleExigirModulo())

// ── El doble de la base ──────────────────────────────────────────────────────

function clienteFalso() {
  return {
    from: (tabla: string) => constructor(tabla),
    rpc: async () => ({ data: null, error: null }),
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

import {
  decidirAprobacionServicio,
  pedirAprobacionServicio,
  registrarPagoServicio,
  type EntradaPagoServicio,
} from './servicios-viaje-actions'
import { evaluarGateServicios, leerServiciosDelNegocio } from '@/lib/viaje/servicios-viaje-datos'
import { estadoDelServicio } from '@/lib/viaje/estado-servicio'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { reiniciarModulo } from '../../../../test/exigir-modulo-doble'

// ── Escenario sintético: San Andrés, tres servicios ──────────────────────────

const HOY = todayBogotaISO()
const SOPORTE = `one://ve-documentos/${WS}/negocios/${NEG}/servicios/sv-vuelo/soporte-1.jpg`

function sembrar(opts: { anticipo?: number; activo?: boolean } = {}) {
  secuencia = 0
  rol = 'operator'
  areas = ['operaciones']
  staffId = 's-ale'
  reiniciarModulo(WS, { business: true })
  tablas = {
    negocios: [{ id: NEG, workspace_id: WS, linea_id: LINEA, nombre: 'PRUEBA · SAN ANDRÉS', estado: 'abierto', precio_aprobado: 9_000_000, precio_estimado: null, etapa_actual_id: 'e5', metadata: {} }],
    negocio_responsables: [{ negocio_id: NEG, staff_id: 's-dani', rol: 'comercial' }],
    lineas_negocio: [{
      id: LINEA,
      config_extra: {
        servicios_viaje: opts.activo === false ? { activo: false } : { activo: true },
        aprobaciones: { staff_ids: ['s-edgar'] },
      },
    }],
    workspaces: [{
      id: WS,
      name: 'Agencia de prueba',
      config_extra: {
        medios_pago_proveedor: [
          { id: 'tc-empresa', label: 'Tarjeta empresa ••4417', titular: 'empresa' },
          { id: 'tc-edgar', label: 'Tarjeta personal Edgar ••0932', titular: 'personal' },
        ],
      },
    }],
    staff: [
      { id: 's-ale', workspace_id: WS, full_name: 'Alejandra Prueba', profile_id: 'p-s-ale' },
      { id: 's-edgar', workspace_id: WS, full_name: 'Edgar Prueba', profile_id: 'p-s-edgar' },
    ],
    profiles: [],
    cobros: opts.anticipo
      ? [{ id: 'cob-1', workspace_id: WS, negocio_id: NEG, monto: opts.anticipo, fecha: HOY, soporte: { url: 'x' }, cuenta_recaudo: 'bancolombia', anulado_at: null }]
      : [],
    negocio_servicios: [
      { id: 'sv-vuelo', workspace_id: WS, negocio_id: NEG, nombre: 'Vuelo San Andrés ⇄ Providencia', tipo: 'vuelo', proveedor_nombre: 'SATENA', localizador: 'K7P2Q', estado: 'reservado', fecha_servicio: null, fecha_limite_pago: null, costo_cotizado: 1_180_000, valor_por_pagar: null, voucher_ref: null, confirmacion_ref: null, orden: 1, origen: 'cotizacion' },
      { id: 'sv-hotel', workspace_id: WS, negocio_id: NEG, nombre: 'Hotel Arena Blanca', tipo: 'hotel', proveedor_nombre: 'Arena Blanca', localizador: null, estado: 'por_reservar', fecha_servicio: null, fecha_limite_pago: null, costo_cotizado: 2_410_000, valor_por_pagar: null, voucher_ref: null, confirmacion_ref: null, orden: 2, origen: 'cotizacion' },
      { id: 'sv-cancelado', workspace_id: WS, negocio_id: NEG, nombre: 'Kayak', tipo: 'actividad', proveedor_nombre: null, localizador: null, estado: 'cancelado', fecha_servicio: null, fecha_limite_pago: null, costo_cotizado: 100_000, valor_por_pagar: null, voucher_ref: null, confirmacion_ref: null, orden: 3, origen: 'cotizacion' },
    ],
    gastos: [],
    aprobaciones_excepcion: [],
    notificaciones: [],
    activity_log: [],
    claves_idempotencia: [],
  }
}

const pagoVuelo = (extra: Partial<EntradaPagoServicio> = {}): EntradaPagoServicio => ({
  servicioId: 'sv-vuelo', monto: 1_180_000, fecha: HOY, medioId: 'tc-empresa', soporteRef: SOPORTE, ...extra,
})

const comoEdgar = () => { rol = 'operator'; areas = ['direccion']; staffId = 's-edgar' }
const aprobacionesDe = (servicioId: string) => (tablas.aprobaciones_excepcion ?? []).filter(a => a.entidad_id === servicioId)
async function estadoDe(servicioId: string) {
  const filas = await leerServiciosDelNegocio(clienteFalso(), { workspaceId: WS, negocioId: NEG })
  const s = filas!.find(f => f.id === servicioId)!
  return estadoDelServicio(s, s.gastos, s.aprobaciones)
}

beforeEach(() => sembrar({ anticipo: 2_000_000 }))

describe('registrarPagoServicio (F3-2)', () => {
  it('registra UN gasto proveedor_viaje atado a la fila, con soporte, medio y el titular del medio', async () => {
    const r = await registrarPagoServicio(pagoVuelo())
    expect(r).toEqual({ ok: true, gastoId: expect.any(String), esperando: [] })
    const g = tablas.gastos
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({
      servicio_id: 'sv-vuelo', negocio_id: NEG, categoria: 'proveedor_viaje', monto: 1_180_000,
      soporte_url: SOPORTE, medio_pago: 'tc-empresa', titular_medio: 'empresa', fecha: HOY,
    })
    expect(aprobacionesDe('sv-vuelo')).toHaveLength(0)
    expect(await estadoDe('sv-vuelo')).toBe('pagado')
  })

  it('el titular NO lo escoge nadie: sale del medio aunque se intente mandar otro', async () => {
    await registrarPagoServicio({ ...pagoVuelo({ medioId: 'tc-edgar' }), titular_medio: 'empresa' } as EntradaPagoServicio)
    expect(tablas.gastos[0].titular_medio).toBe('personal')
  })

  it('doble clic o reintento con la misma intención: un solo pago', async () => {
    const clave = 'c0ffee00-1111-4222-8333-444455556666'
    await Promise.all([registrarPagoServicio(pagoVuelo(), clave), registrarPagoServicio(pagoVuelo(), clave)])
    await registrarPagoServicio(pagoVuelo(), clave)
    expect(tablas.gastos).toHaveLength(1)
  })

  it('exige soporte del espacio, medio configurado, valor y fecha no futura', async () => {
    expect(await registrarPagoServicio(pagoVuelo({ soporteRef: '' }))).toMatchObject({ ok: false })
    expect(await registrarPagoServicio(pagoVuelo({ soporteRef: 'one://ve-documentos/otro-ws/x.jpg' }))).toMatchObject({ ok: false })
    expect(await registrarPagoServicio(pagoVuelo({ medioId: 'inventado' }))).toMatchObject({ ok: false, error: 'Elige con qué se pagó.' })
    expect(await registrarPagoServicio(pagoVuelo({ monto: 0 }))).toMatchObject({ ok: false })
    expect(await registrarPagoServicio(pagoVuelo({ fecha: '2999-01-01' }))).toMatchObject({ ok: false })
    expect(tablas.gastos).toHaveLength(0)
  })

  it('una fila «No va» no se paga', async () => {
    expect(await registrarPagoServicio(pagoVuelo({ servicioId: 'sv-cancelado' }))).toMatchObject({ ok: false })
  })

  it('permisos (§7.4): la comercial no registra pagos a proveedor; con la línea apagada nadie', async () => {
    areas = ['comercial']
    staffId = 's-dani'
    expect(await registrarPagoServicio(pagoVuelo())).toMatchObject({ ok: false, error: expect.stringContaining('no permite') })
    sembrar({ anticipo: 2_000_000, activo: false })
    expect(await registrarPagoServicio(pagoVuelo())).toMatchObject({ ok: false, error: expect.stringContaining('no están activos') })
    expect(tablas.gastos).toHaveLength(0)
  })
})

describe('reglas y aprobación de Edgar (F3-3, F3-4, C5)', () => {
  it('(b) el pago ya salió y rompe una regla: el gasto queda y la fila espera a Edgar, que recibe el aviso', async () => {
    const r = await registrarPagoServicio(pagoVuelo({ monto: 1_262_000 }))
    expect(r).toMatchObject({ ok: true, esperando: ['Costó $82.000 más de lo cotizado (+6,9 %).'] })
    expect(tablas.gastos).toHaveLength(1)
    expect(aprobacionesDe('sv-vuelo')).toEqual([expect.objectContaining({ tipo: 'desviacion_costo', estado: 'solicitada', huella: 'desviacion_costo|1262000' })])
    expect(await estadoDe('sv-vuelo')).toBe('esperando')
    expect(tablas.notificaciones).toEqual([expect.objectContaining({ destinatario_id: 'p-s-edgar', tipo: 'aprobacion_pendiente', entidad_tipo: 'servicio' })])
  })

  it('sin anticipo y con tarjeta personal: dos pedidas', async () => {
    sembrar({})
    await registrarPagoServicio(pagoVuelo({ medioId: 'tc-edgar' }))
    expect(aprobacionesDe('sv-vuelo').map(a => a.tipo).sort()).toEqual(['medio_personal', 'pago_sin_abono'])
  })

  it('(a) pedir ANTES de pagar: sin gasto; Edgar aprueba; el pago con el mismo monto pasa sin volver a pedir', async () => {
    const p = await pedirAprobacionServicio({ servicioId: 'sv-vuelo', monto: 1_262_000, medioId: 'tc-empresa' })
    expect(p).toMatchObject({ ok: true })
    expect(tablas.gastos).toHaveLength(0)
    expect(await estadoDe('sv-vuelo')).toBe('esperando')

    comoEdgar()
    const id = aprobacionesDe('sv-vuelo')[0].id as string
    expect(await decidirAprobacionServicio('sv-vuelo', id, 'aprobada', null)).toEqual({ ok: true })

    rol = 'operator'; areas = ['operaciones']; staffId = 's-ale'
    const r = await registrarPagoServicio(pagoVuelo({ monto: 1_262_000 }))
    expect(r).toMatchObject({ ok: true, esperando: [] })
    expect(aprobacionesDe('sv-vuelo').filter(a => a.estado === 'solicitada')).toHaveLength(0)
    expect(await estadoDe('sv-vuelo')).toBe('pagado')
  })

  it('cambiar el monto después de aprobar caduca la aprobación y se vuelve a pedir', async () => {
    await pedirAprobacionServicio({ servicioId: 'sv-vuelo', monto: 1_262_000, medioId: 'tc-empresa' })
    comoEdgar()
    await decidirAprobacionServicio('sv-vuelo', aprobacionesDe('sv-vuelo')[0].id as string, 'aprobada', null)
    rol = 'operator'; areas = ['operaciones']; staffId = 's-ale'
    const r = await registrarPagoServicio(pagoVuelo({ monto: 1_300_000 }))
    expect(r).toMatchObject({ ok: true, esperando: [expect.stringContaining('más de lo cotizado')] })
    const estados = aprobacionesDe('sv-vuelo').map(a => `${a.estado}:${a.huella}`).sort()
    expect(estados).toEqual(['caducada:desviacion_costo|1262000', 'solicitada:desviacion_costo|1300000'])
  })

  it('un pago más barato o la primera parte de uno partido no piden aprobación', async () => {
    expect(await registrarPagoServicio(pagoVuelo({ monto: 600_000 }))).toMatchObject({ ok: true, esperando: [] })
    expect(aprobacionesDe('sv-vuelo')).toHaveLength(0)
  })

  it('pedir cuando no hace falta: lo dice y no crea nada', async () => {
    expect(await pedirAprobacionServicio({ servicioId: 'sv-vuelo', monto: 1_180_000, medioId: 'tc-empresa' })).toMatchObject({ ok: false })
    expect(aprobacionesDe('sv-vuelo')).toHaveLength(0)
  })

  it('«No aprobar» exige motivo, le llega a quien pidió, no borra el gasto y la fila no cuenta', async () => {
    await registrarPagoServicio(pagoVuelo({ monto: 1_262_000 }))
    const id = aprobacionesDe('sv-vuelo')[0].id as string
    comoEdgar()
    expect(await decidirAprobacionServicio('sv-vuelo', id, 'rechazada', '')).toMatchObject({ ok: false })
    expect(await decidirAprobacionServicio('sv-vuelo', id, 'rechazada', 'Busca otra tarifa')).toEqual({ ok: true })
    expect(tablas.gastos).toHaveLength(1)
    expect(await estadoDe('sv-vuelo')).toBe('no_aprobado')
    expect(tablas.notificaciones.some(n => n.destinatario_id === 'p-s-ale' && String(n.contenido).includes('Busca otra tarifa'))).toBe(true)
    // Solo Edgar levanta el bloqueo: puede aprobar después la que rechazó.
    expect(await decidirAprobacionServicio('sv-vuelo', id, 'aprobada', null)).toEqual({ ok: true })
    expect(await estadoDe('sv-vuelo')).toBe('pagado')
  })

  it('solo la dirección decide (§7.4): operaciones recibe un rechazo del servidor', async () => {
    await registrarPagoServicio(pagoVuelo({ monto: 1_262_000 }))
    const id = aprobacionesDe('sv-vuelo')[0].id as string
    expect(await decidirAprobacionServicio('sv-vuelo', id, 'aprobada', null)).toMatchObject({ ok: false, error: expect.stringContaining('dirección') })
    expect(aprobacionesDe('sv-vuelo')[0].estado).toBe('solicitada')
  })
})

describe('gate servicios_listos (F3-7)', () => {
  it('frena con lo que falta de cada fila y suelta cuando todo lo que va está confirmado', async () => {
    const gates = ['servicios_listos']
    let falta = await evaluarGateServicios(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates })
    expect(falta.map(f => f.texto)).toEqual([
      'Vuelo San Andrés ⇄ Providencia: falta registrar el pago',
      'Hotel Arena Blanca: falta registrar el pago',
    ])
    await registrarPagoServicio(pagoVuelo())
    await registrarPagoServicio(pagoVuelo({ servicioId: 'sv-hotel', monto: 2_410_000 }))
    falta = await evaluarGateServicios(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates })
    expect(falta.map(f => f.texto)).toEqual([
      'Vuelo San Andrés ⇄ Providencia: falta la confirmación del proveedor final',
      'Hotel Arena Blanca: falta la confirmación del proveedor final',
    ])
    for (const s of tablas.negocio_servicios) s.confirmacion_ref = 'one://ve-documentos/x/confirmacion.pdf'
    expect(await evaluarGateServicios(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates })).toEqual([])
  })

  it('esperando a Edgar no cuenta para el gate', async () => {
    await registrarPagoServicio(pagoVuelo({ monto: 1_262_000 }))
    const falta = await evaluarGateServicios(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates: ['servicios_listos'] })
    expect(falta[0].texto).toBe('Vuelo San Andrés ⇄ Providencia: esperando a Edgar')
  })

  it('sin el gate en la etapa, o con la línea apagada, no consulta ni frena (SOENA y los demás no cambian)', async () => {
    expect(await evaluarGateServicios(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates: [] })).toEqual([])
    sembrar({ activo: false })
    expect(await evaluarGateServicios(clienteFalso(), { workspaceId: WS, negocioId: NEG, gates: ['servicios_listos'] })).toEqual([])
  })
})
