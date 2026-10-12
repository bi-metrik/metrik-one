/**
 * Fuente `salida` del motor de recordatorios (F4-5, Noor §4.4): avisos internos del cobro mínimo
 * antes del viaje. T-30 y T-20 a la comercial solo si el plan no llega al 80 % en T-15 o hay una
 * cuota vencida; T-15 a la comercial y a la dirección si no va en el 80 %. Al viajero no le llega
 * nada de esto (solo los de su cuota).
 *
 * Caso: guion de Vera §8, negocio A ($4.052.000, salida 21 nov, cuotas $1.216.000 hoy · $2.026.000
 * el 6 nov · $810.000 el día del viaje).
 *
 * VISTO FALLAR (2026-10-12): quitar el filtro `salidaPideAviso` en el motor → caen «T-30 con el
 * plan en camino no avisa» y «T-15 con el 80 % no avisa».
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Fila = Record<string, unknown>
let tablas: Record<string, Fila[]>
let seq = 0
const ceder = () => new Promise<void>((r) => setTimeout(r, 0))
const LLAVE_LOG = ['regla_id', 'entidad_id', 'fecha_objetivo', 'destinatario', 'canal']

function leerRuta(f: Fila, ruta: string): unknown {
  const partes = ruta.split(/->>?/)
  let v: unknown = f
  for (const p of partes) v = v && typeof v === 'object' ? (v as Fila)[p] : undefined
  return ruta.includes('->>') && v !== undefined && v !== null ? String(v) : v
}

function consulta(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  let op: 'select' | 'update' | 'insert' | 'upsert' = 'select'
  let payload: Fila | Fila[] = {}
  let opciones: { ignoreDuplicates?: boolean } = {}
  const correr = async () => {
    await ceder()
    tablas[tabla] ??= []
    if (op === 'insert' || op === 'upsert') {
      const filas: Fila[] = (Array.isArray(payload) ? payload : [payload]).map((f) => ({ id: `id-${++seq}`, ...f }))
      const out: Fila[] = []
      for (const f of filas) {
        if (tabla === 'recordatorios_log' && tablas[tabla].some((e) => LLAVE_LOG.every((k) => e[k] === f[k]))) {
          if (op === 'upsert' && opciones.ignoreDuplicates) continue
          return { data: null, error: { message: 'duplicate key', code: '23505' } }
        }
        tablas[tabla].push(f)
        out.push(f)
      }
      return { data: out, error: null }
    }
    const filas = tablas[tabla].filter((f) => filtros.every((p) => p(f)))
    if (op === 'update') {
      filas.forEach((f) => Object.assign(f, payload))
      return { data: filas.map((f) => ({ ...f })), error: null }
    }
    return { data: filas.map((f) => ({ ...f })), error: null }
  }
  const q: Record<string, unknown> = {
    select: () => q,
    insert: (p: Fila) => { op = 'insert'; payload = p; return q },
    upsert: (p: Fila, o: { ignoreDuplicates?: boolean }) => { op = 'upsert'; payload = p; opciones = o ?? {}; return q },
    update: (p: Fila) => { op = 'update'; payload = p; return q },
    eq: (c: string, v: unknown) => { filtros.push((f) => f[c] === v); return q },
    in: (c: string, vs: unknown[]) => { filtros.push((f) => vs.includes(f[c])); return q },
    not: (c: string) => { filtros.push((f) => f[c] !== null && f[c] !== undefined); return q },
    filter: (ruta: string, _op: string, v: unknown) => { filtros.push((f) => leerRuta(f, ruta) === v); return q },
    maybeSingle: async () => {
      const r = await correr()
      return { data: (r.data as Fila[] | null)?.[0] ?? null, error: null }
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => correr().then(res, rej),
  }
  return q
}

const svc = {
  from: (t: string) => consulta(t),
  rpc: async (fn: string, args: Fila) => {
    await ceder()
    if (fn !== 'destinatarios_negocio') return { data: null, error: { message: 'rpc desconocida' } }
    const r = (tablas.negocio_responsables ?? []).filter((x) => x.negocio_id === args.p_negocio_id && x.rol === 'comercial')
    return { data: r.map((x) => ({ profile_id: (tablas.staff ?? []).find((s) => s.id === x.staff_id)?.profile_id })), error: null }
  },
}

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => svc }))

const { correrRecordatorios } = await import('./motor')

const WS = 'ws-trappvel'
const NEG = 'neg-a'

const REGLAS = [
  { id: 'salida_t30', fuente: 'salida', offset: -30, a: ['responsable'], canales: ['in_app'] },
  { id: 'salida_t20', fuente: 'salida', offset: -20, a: ['responsable'], canales: ['in_app'] },
  { id: 'salida_t15', fuente: 'salida', offset: -15, a: ['responsable', 'aprobadores'], canales: ['in_app', 'email'] },
]

function sembrar(pagado: number) {
  seq = 0
  tablas = {
    lineas_negocio: [{ id: 'linea', workspace_id: WS, config_extra: { recordatorios: { activo: true, reglas: REGLAS }, aprobaciones: { staff_ids: ['s-edgar'] } } }],
    negocios: [{ id: NEG, workspace_id: WS, linea_id: 'linea', nombre: 'Cusco', codigo: 'V 26 1', contacto_id: 'c-1', etapa_actual_id: 'e6', pausado: false, estado: 'abierto', precio_aprobado: 4_052_000 }],
    etapas_negocio: [{ id: 'e6', numero: 6 }],
    contactos: [{ id: 'c-1', nombre: 'Valeria Prueba', email: 'valeria@prueba.test', telefono: '3001234567' }],
    negocio_bloques: [{ negocio_id: NEG, fecha_salida: '2026-11-21' }],
    negocio_planes_pago: [{ id: 'plan-1', negocio_id: NEG, estado: 'acordado' }],
    negocio_plan_cuotas: [
      { id: 'c1', plan_id: 'plan-1', numero: 0, monto: 1_216_000, fecha_vencimiento: '2026-10-12' },
      { id: 'c2', plan_id: 'plan-1', numero: 1, monto: 2_026_000, fecha_vencimiento: '2026-11-06' },
      { id: 'c3', plan_id: 'plan-1', numero: 2, monto: 810_000, fecha_vencimiento: '2026-11-21' },
    ],
    cobros: pagado > 0 ? [{ negocio_id: NEG, monto: pagado, fecha: '2026-10-12', retencion_iva: 0, anulado_at: null }] : [],
    negocio_responsables: [{ negocio_id: NEG, staff_id: 's-dani', rol: 'comercial' }],
    staff: [
      { id: 's-dani', profile_id: 'p-dani', workspace_id: WS, is_active: true },
      { id: 's-edgar', profile_id: 'p-edgar', workspace_id: WS, is_active: true },
    ],
    profiles: [{ id: 'p-dani', email: 'dani@prueba.test' }, { id: 'p-edgar', email: 'edgar@prueba.test' }],
    workspaces: [{ id: WS, name: 'Trappvel', slug: 'trappvel', config_extra: {} }],
    notificaciones: [],
    recordatorios_log: [],
    avisos_cliente: [],
  }
}

let correos: Array<{ to: string[]; text: string }> = []
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const correr = (hoy: string) => correrRecordatorios(svc as any, { hoy })
const avisos = () => tablas.notificaciones as Fila[]

beforeEach(() => {
  correos = []
  process.env.RESEND_API_KEY = 'prueba'
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    correos.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ id: `re-${correos.length}` }), { status: 200 })
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.RESEND_API_KEY
})

describe('T-30 y T-20: solo si el plan no llega o hay cuota vencida', () => {
  it('con el anticipo pagado y el plan en camino, T-30 no avisa', async () => {
    sembrar(1_216_000)
    await correr('2026-10-22')
    expect(avisos()).toHaveLength(0)
  })

  it('con el anticipo vencido sin pagar, T-30 avisa a la comercial', async () => {
    sembrar(0)
    await correr('2026-10-22')
    expect(avisos()).toHaveLength(1)
    expect(avisos()[0]).toMatchObject({ destinatario_id: 'p-dani', tipo: 'viaje_sin_listo' })
    expect(String(avisos()[0].contenido)).toBe('En 15 días Valeria debe llevar el 80 % y va en 0 % (V 26 1 — Cusco).')
    expect(correos).toHaveLength(0)
  })
})

describe('T-15: a la comercial y a la dirección si no va en el 80 %', () => {
  it('con el 30 % pagado: aviso en la app y correo a las dos; nada al viajero', async () => {
    sembrar(1_216_000)
    await correr('2026-11-06')
    expect(avisos().map((a) => a.destinatario_id).sort()).toEqual(['p-dani', 'p-edgar'])
    expect(String(avisos()[0].contenido)).toContain('va en 30 %: faltan $2.026.000 para el 80 %')
    expect(correos.map((c) => c.to[0]).sort()).toEqual(['dani@prueba.test', 'edgar@prueba.test'])
    expect((tablas.avisos_cliente as Fila[])).toHaveLength(0)
  })

  it('con el 80 % pagado, T-15 no avisa', async () => {
    sembrar(3_242_000)
    await correr('2026-11-06')
    expect(avisos()).toHaveLength(0)
  })

  it('dos corridas el mismo día: un solo aviso por persona', async () => {
    sembrar(1_216_000)
    await correr('2026-11-06')
    await correr('2026-11-06')
    expect(avisos()).toHaveLength(2)
    expect(correos).toHaveLength(2)
  })
})
