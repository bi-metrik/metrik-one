/**
 * Fuente `cuota` del motor de recordatorios (F2, §2.3 bis 4, Vera F4-6, C1, §7.7): 3 días antes y
 * el día al cliente (correo si lo tiene + mensaje listo para el WhatsApp de la comercial); el día a
 * la comercial; vencida a los 2 días, a la dirección una sola vez. El estado de la cuota sale del
 * FIFO de los pagos con fecha: una cuota pagada no avisa; una en parte recuerda lo que falta.
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
const NEG = 'neg-1'
const CUOTA_1 = '11111111-1111-4111-8111-111111111111'
const CUOTA_2 = '22222222-2222-4222-8222-222222222222'

let correos: Array<{ to: string[]; text: string; subject: string }> = []

function sembrar(opts: { correo?: string | null; cuentas?: unknown; pagos?: Fila[] } = {}) {
  seq = 0
  correos = []
  tablas = {
    lineas_negocio: [{ id: 'linea', workspace_id: WS, config_extra: { recordatorios: { activo: true }, aprobaciones: { staff_ids: ['s-edgar'] } } }],
    negocios: [{ id: NEG, workspace_id: WS, linea_id: 'linea', nombre: 'Cusco', codigo: 'C 26 1', contacto_id: 'c-1', etapa_actual_id: 'e5', pausado: false, estado: 'abierto' }],
    etapas_negocio: [{ id: 'e5', numero: 5 }],
    contactos: [{ id: 'c-1', nombre: 'Carolina Prueba', email: opts.correo === undefined ? 'carolina@prueba.test' : opts.correo, telefono: '3001234567' }],
    cotizaciones: [],
    negocio_servicios: [],
    gastos: [],
    negocio_planes_pago: [{ id: 'plan-1', negocio_id: NEG, estado: 'acordado' }],
    negocio_plan_cuotas: [
      { id: CUOTA_1, plan_id: 'plan-1', numero: 0, monto: 2_000_000, fecha_vencimiento: '2026-10-13' },
      { id: CUOTA_2, plan_id: 'plan-1', numero: 1, monto: 2_666_000, fecha_vencimiento: '2026-10-22' },
    ],
    cobros: opts.pagos ?? [{ negocio_id: NEG, monto: 2_000_000, fecha: '2026-10-13', retencion_iva: 0, anulado_at: null }],
    negocio_responsables: [{ negocio_id: NEG, staff_id: 's-dani', rol: 'comercial' }],
    staff: [
      { id: 's-dani', profile_id: 'p-dani', workspace_id: WS, is_active: true },
      { id: 's-edgar', profile_id: 'p-edgar', workspace_id: WS, is_active: true },
    ],
    workspaces: [{ id: WS, name: 'Trappvel', config_extra: opts.cuentas ? { cuentas_recaudo: opts.cuentas } : {} }],
    notificaciones: [],
    recordatorios_log: [],
    avisos_cliente: [],
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const correr = (hoy: string) => correrRecordatorios(svc as any, { hoy })
const avisos = () => tablas.notificaciones as Fila[]

beforeEach(() => {
  sembrar()
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

describe('cuota a 3 días (al cliente)', () => {
  it('correo al cliente y el mensaje listo para el WhatsApp de la comercial; sin link propio no hay link', async () => {
    await correr('2026-10-19')
    expect(correos).toHaveLength(1)
    expect(correos[0].to).toEqual(['carolina@prueba.test'])
    expect(correos[0].text).toContain('Carolina, ¿te queda bien pagar el jueves 22 oct tu cuota de $2.666.000?')
    expect(correos[0].text).not.toMatch(/link|\[/i)
    const tarea = avisos().find((a) => a.tipo === 'cuota_por_vencer')
    expect(tarea).toMatchObject({ destinatario_id: 'p-dani', entidad_id: NEG })
    expect(String((tarea!.metadata as Fila).wa_url)).toMatch(/^https:\/\/wa\.me\/573001234567\?text=/)
    expect(tablas.recordatorios_log.map((l) => [l.regla_id, l.destinatario, l.canal, l.estado])).toEqual([
      ['cuota_t3', 'cliente:c-1', 'email', 'enviado'],
      ['cuota_t3', 'cliente:c-1', 'wa_manual', 'enviado'],
    ])
    expect(tablas.avisos_cliente).toEqual([expect.objectContaining({ canal: 'email', estado: 'enviado', destino: 'carolina@prueba.test' })])
  })

  it('dos corridas el mismo día no repiten el aviso al cliente (§7.7: un repetido al cliente es grave)', async () => {
    await correr('2026-10-19')
    await correr('2026-10-19')
    expect(correos).toHaveLength(1)
  })

  it('sin correo: queda omitido y no se gasta un envío', async () => {
    sembrar({ correo: null })
    await correr('2026-10-19')
    expect(correos).toHaveLength(0)
    expect(tablas.recordatorios_log.find((l) => l.canal === 'email')?.estado).toBe('omitido')
    expect(avisos().some((a) => a.tipo === 'cuota_por_vencer')).toBe(true)
  })

  it('con link de pago propio de la agencia, el mensaje lo trae', async () => {
    sembrar({ cuentas: [{ id: 'link', nombre: 'Link', tipo: 'link', url: 'https://pagos.agencia.test/x' }] })
    await correr('2026-10-19')
    expect(correos[0].text).toContain('o pagar aquí: https://pagos.agencia.test/x')
  })
})

describe('el estado sale de la plata (FIFO)', () => {
  it('una cuota ya pagada no avisa', async () => {
    sembrar({ pagos: [{ negocio_id: NEG, monto: 4_666_000, fecha: '2026-10-15', retencion_iva: 0, anulado_at: null }] })
    await correr('2026-10-19')
    expect(correos).toHaveLength(0)
    expect(tablas.recordatorios_log).toHaveLength(0)
  })
  it('una cuota en parte recuerda lo que falta', async () => {
    sembrar({ pagos: [{ negocio_id: NEG, monto: 3_000_000, fecha: '2026-10-15', retencion_iva: 0, anulado_at: null }] })
    await correr('2026-10-19')
    expect(correos[0].text).toContain('tu cuota de $1.666.000')
  })
})

describe('el día y la cuota vencida', () => {
  it('el día: al cliente y a la comercial en la app', async () => {
    await correr('2026-10-22')
    expect(correos[0].text).toContain('hoy vence tu cuota de $2.666.000')
    expect(tablas.recordatorios_log.filter((l) => l.regla_id === 'cuota_t0').map((l) => [l.destinatario, l.canal])).toEqual(
      expect.arrayContaining([['p-dani', 'in_app'], ['cliente:c-1', 'email'], ['cliente:c-1', 'wa_manual']]),
    )
  })
  it('vencida a los 2 días (sábado → lunes): a la dirección una sola vez', async () => {
    await correr('2026-10-26')
    await correr('2026-10-26')
    const aEdgar = avisos().filter((a) => a.destinatario_id === 'p-edgar')
    expect(aEdgar).toHaveLength(1)
    expect(aEdgar[0]).toMatchObject({ tipo: 'cobro_vencido' })
    expect(String(aEdgar[0].contenido)).toContain('Cuota vencida: Carolina Prueba · $2.666.000')
  })
})
