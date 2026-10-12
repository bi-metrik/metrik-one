/**
 * Motor de recordatorios contra un doble de Supabase que aplica filtros, la llave única de
 * `recordatorios_log` y cede el turno en cada operación (dos corridas a la vez se intercalan
 * como dos invocaciones reales del cron).
 *
 * Criterios: Vera F1-2 (toques a 1, 3 y 7 días hábiles; se apagan al salir de la etapa 3 o al
 * aplazar; dos corridas el mismo día = un aviso), §7.2.1 (idempotencia con `fecha_objetivo` en la
 * llave), §7.7 (un aviso perdido se recupera, hasta 3 intentos) y «apagado = nada».
 *
 * VISTO FALLAR (2026-10-12), una mutación a la vez:
 *   · `reclamar` devuelve siempre una fila (sin mirar el conflicto) → 5 rojas, entre ellas «dos
 *     corridas el mismo día» y «dos corridas A LA VEZ»;
 *   · quitar el filtro de `etapa_numero` → cae «se apagan al salir de Seguimiento»;
 *   · quitar `p.intentos >= MAX_INTENTOS` → cae «hasta 3 intentos»;
 *   · `pagado >= valor` → `pagado > valor` en fuentes.ts → 7 rojas, entre ellas «pagado completo
 *     no avisa».
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { correrRecordatorios } from './motor'

type Fila = Record<string, unknown>
let tablas: Record<string, Fila[]>
let fallarNotificaciones = 0
let seq = 0

const ceder = () => new Promise<void>((r) => setTimeout(r, 0))
const LLAVE_LOG = ['regla_id', 'entidad_id', 'fecha_objetivo', 'destinatario', 'canal']

function leerRuta(f: Fila, ruta: string): unknown {
  // 'config_extra->recordatorios->>activo'
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
      if (tabla === 'notificaciones' && fallarNotificaciones > 0) {
        fallarNotificaciones--
        return { data: null, error: { message: 'caída simulada' } }
      }
      const out: Fila[] = []
      for (const f of filas) {
        if (tabla === 'recordatorios_log') {
          const choca = tablas[tabla].some((e) => LLAVE_LOG.every((k) => e[k] === f[k]))
          if (choca) {
            if (op === 'upsert' && opciones.ignoreDuplicates) continue
            return { data: null, error: { message: 'duplicate key', code: '23505' } }
          }
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
    eq: (c: string, v: unknown) => {
      filtros.push((f) => {
        // `staff_areas.area` del embed !inner
        if (c === 'staff_areas.area') return ((f.staff_areas as Fila[] | undefined) ?? []).some((a) => a.area === v)
        return f[c] === v
      })
      return q
    },
    in: (c: string, vs: unknown[]) => { filtros.push((f) => vs.includes(f[c])); return q },
    not: (c: string, _op: string, _v: unknown) => { filtros.push((f) => f[c] !== null && f[c] !== undefined); return q },
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
    // Comercial dueña del negocio (stage venta): su perfil.
    const r = (tablas.negocio_responsables ?? []).filter((x) => x.negocio_id === args.p_negocio_id && x.rol === 'comercial')
    const perfiles = r.map((x) => (tablas.staff ?? []).find((s) => s.id === x.staff_id)?.profile_id)
    return { data: perfiles.map((p) => ({ profile_id: p })), error: null }
  },
}

const WS = 'ws-trappvel'
const LINEA = 'linea-viaje'
const NEG = 'neg-1'
const ETAPA3 = 'etapa-3'
const ETAPA4 = 'etapa-4'

function sembrar(opts: { activo?: unknown; reglas?: unknown } = {}) {
  seq = 0
  fallarNotificaciones = 0
  const recordatorios: Fila = { activo: opts.activo ?? true }
  if (opts.reglas) recordatorios.reglas = opts.reglas
  tablas = {
    lineas_negocio: [
      { id: LINEA, workspace_id: WS, config_extra: { recordatorios, aprobaciones: { staff_ids: ['s-edgar'] } } },
      // Otra línea (SOENA) sin interruptor: nada suyo se lee ni se avisa.
      { id: 'linea-soena', workspace_id: 'ws-soena', config_extra: {} },
    ],
    negocios: [
      { id: NEG, workspace_id: WS, linea_id: LINEA, nombre: 'San Andrés', codigo: 'D 26 1', contacto_id: 'c-1', etapa_actual_id: ETAPA3, pausado: false, estado: 'abierto' },
      { id: 'neg-soena', workspace_id: 'ws-soena', linea_id: 'linea-soena', nombre: 'Moto', codigo: null, contacto_id: null, etapa_actual_id: ETAPA3, pausado: false, estado: 'abierto' },
    ],
    etapas_negocio: [{ id: ETAPA3, numero: 3 }, { id: ETAPA4, numero: 4 }],
    contactos: [{ id: 'c-1', nombre: 'Carolina' }],
    cotizaciones: [
      { id: 'cot-v1', negocio_id: NEG, fecha_envio: '2026-10-05T15:00:00Z' },
      // La versión más reciente manda: v2 enviada el vie 9 a las 10 a. m. de Bogotá.
      { id: 'cot-v2', negocio_id: NEG, fecha_envio: '2026-10-09T15:00:00Z' },
      { id: 'cot-soena', negocio_id: 'neg-soena', fecha_envio: '2026-10-09T15:00:00Z' },
    ],
    negocio_servicios: [
      { id: 'srv-hotel', negocio_id: NEG, nombre: 'Hotel Arena Blanca', estado: 'reservado', fecha_limite_pago: '2026-10-16', costo_cotizado: 3000000, valor_por_pagar: null },
      { id: 'srv-vuelo', negocio_id: NEG, nombre: 'Vuelo', estado: 'por_reservar', fecha_limite_pago: '2026-10-16', costo_cotizado: 1000000, valor_por_pagar: null },
      { id: 'srv-no-va', negocio_id: NEG, nombre: 'Kayak', estado: 'cancelado', fecha_limite_pago: '2026-10-16', costo_cotizado: 200000, valor_por_pagar: null },
    ],
    gastos: [{ servicio_id: 'srv-vuelo', monto: 1000000 }],
    negocio_responsables: [
      { negocio_id: NEG, staff_id: 's-daniela', rol: 'comercial' },
      { negocio_id: NEG, staff_id: 's-alejandra', rol: 'operaciones' },
    ],
    staff: [
      { id: 's-daniela', profile_id: 'p-daniela', workspace_id: WS, is_active: true, staff_areas: [{ area: 'comercial' }] },
      { id: 's-alejandra', profile_id: 'p-alejandra', workspace_id: WS, is_active: true, staff_areas: [{ area: 'operaciones' }] },
      { id: 's-edgar', profile_id: 'p-edgar', workspace_id: WS, is_active: true, staff_areas: [] },
    ],
    notificaciones: [],
    recordatorios_log: [],
  }
}

const avisos = () => tablas.notificaciones as Fila[]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const correr = (hoy: string) => correrRecordatorios(svc as any, { hoy })

beforeEach(() => sembrar())

describe('apagado = nada', () => {
  it('sin el interruptor de la línea no se avisa nada ni se escribe el log', async () => {
    sembrar({ activo: false })
    const r = await correr('2026-10-13')
    expect(r.lineas).toBe(0)
    expect(avisos()).toHaveLength(0)
    expect(tablas.recordatorios_log).toHaveLength(0)
  })

  it('en día no hábil no corre (festivo del lunes 12 de octubre)', async () => {
    const r = await correr('2026-10-12')
    expect(r.dia_no_habil).toBe(true)
    expect(avisos()).toHaveLength(0)
  })
})

describe('toques de Seguimiento (fuente envio)', () => {
  it('el toque del día hábil 1 llega a la comercial dueña, con la versión más reciente', async () => {
    // v2 enviada el vie 9: el 1.er hábil es el mar 13 (lun 12 festivo).
    const r = await correr('2026-10-13')
    const toques = avisos().filter((a) => a.tipo === 'toque_seguimiento')
    expect(toques).toHaveLength(1)
    expect(toques[0]).toMatchObject({ destinatario_id: 'p-daniela', entidad_tipo: 'negocio', entidad_id: NEG, deep_link: `/negocios/${NEG}` })
    expect(String(toques[0].contenido)).toContain('Carolina')
    expect(r.enviados).toBeGreaterThanOrEqual(1)
    // El negocio de SOENA (línea sin interruptor) no recibe nada.
    expect(avisos().some((a) => a.workspace_id === 'ws-soena')).toBe(false)
  })

  it('dos corridas el mismo día dan un solo aviso', async () => {
    await correr('2026-10-13')
    const antes = avisos().length
    const r2 = await correr('2026-10-13')
    expect(avisos().length).toBe(antes)
    expect(r2.enviados).toBe(0)
    expect(r2.ya_reclamados).toBeGreaterThan(0)
  })

  it('dos corridas A LA VEZ dan un solo aviso por destinatario', async () => {
    await Promise.all([correr('2026-10-13'), correr('2026-10-13')])
    const toques = avisos().filter((a) => a.tipo === 'toque_seguimiento')
    expect(toques).toHaveLength(1)
  })

  it('se apagan al salir de Seguimiento o al aplazar', async () => {
    ;(tablas.negocios[0] as Fila).etapa_actual_id = ETAPA4
    await correr('2026-10-13')
    expect(avisos().filter((a) => a.tipo === 'toque_seguimiento')).toHaveLength(0)

    sembrar()
    ;(tablas.negocios[0] as Fila).pausado = true
    await correr('2026-10-13')
    expect(avisos().filter((a) => a.tipo === 'toque_seguimiento')).toHaveLength(0)
  })

  it('una versión nueva enviada rearma los toques (otra entidad, otra fecha)', async () => {
    await correr('2026-10-13')
    tablas.cotizaciones.push({ id: 'cot-v3', negocio_id: NEG, fecha_envio: '2026-10-13T15:00:00Z' })
    await correr('2026-10-14')
    const toques = avisos().filter((a) => a.tipo === 'toque_seguimiento')
    expect(toques).toHaveLength(2)
    expect((toques[1].metadata as Fila).fecha_objetivo).toBe('2026-10-13')
  })
})

describe('pago a proveedor', () => {
  it('T-3 a operaciones: solo lo que falta pagar; pagado completo o «No va» no avisa', async () => {
    // Límite vie 16: −3 = mar 13.
    await correr('2026-10-13')
    const prov = avisos().filter((a) => String(a.tipo).startsWith('pago_proveedor'))
    expect(prov).toHaveLength(1)
    expect(prov[0]).toMatchObject({ destinatario_id: 'p-alejandra', tipo: 'pago_proveedor_por_vencer', entidad_tipo: 'servicio', entidad_id: 'srv-hotel' })
    expect(String(prov[0].contenido)).toContain('Hotel Arena Blanca')
  })

  it('vencido a un día escala a los aprobadores de la línea, una sola vez', async () => {
    // Límite vie 16, +1 = sáb 17 → lun 19.
    await correr('2026-10-19')
    await correr('2026-10-19')
    const venc = avisos().filter((a) => a.tipo === 'pago_proveedor_vencido' && a.destinatario_id === 'p-edgar')
    expect(venc).toHaveLength(1)
    expect(String(venc[0].contenido)).toContain('sin pagar')
    // El aviso del día (T0) que no salió el viernes se recupera el lunes, una vez, a operaciones.
    const t0 = avisos().filter((a) => (a.metadata as Fila).regla_id === 'prov_t0')
    expect(t0.map((a) => a.destinatario_id)).toEqual(['p-alejandra'])
  })

  it('al recuperar, de una misma cadena a las mismas personas sale solo el más reciente', async () => {
    // Motor encendido el jue 15 con la cotización enviada el vie 9: toque 1 (mar 13) y toque 3
    // (jue 15) caen en la ventana; sale solo el 3.
    await correr('2026-10-15')
    const toques = avisos().filter((a) => a.tipo === 'toque_seguimiento')
    expect(toques.map((a) => (a.metadata as Fila).regla_id)).toEqual(['toque_3'])
  })

  it('si la fecha límite se mueve, el recordatorio se rearma solo', async () => {
    await correr('2026-10-13')
    ;(tablas.negocio_servicios[0] as Fila).fecha_limite_pago = '2026-10-23'
    await correr('2026-10-20') // 23 − 3
    const t3 = avisos().filter((a) => a.tipo === 'pago_proveedor_por_vencer' && (a.metadata as Fila).regla_id === 'prov_t3')
    expect(t3).toHaveLength(2)
  })

  it('pagado completo no avisa', async () => {
    tablas.gastos.push({ servicio_id: 'srv-hotel', monto: 3000000 })
    await correr('2026-10-13')
    expect(avisos().filter((a) => String(a.tipo).startsWith('pago_proveedor'))).toHaveLength(0)
  })
})

describe('un aviso perdido se recupera (Vera §7.7)', () => {
  it('fallido se reintenta en la corrida siguiente, hasta 3 intentos', async () => {
    const soloProv = [{ id: 'prov_t3', fuente: 'pago_proveedor', offset: -3, a: ['area:operaciones'], canales: ['in_app'] }]
    sembrar({ reglas: soloProv })
    fallarNotificaciones = 10
    await correr('2026-10-13')
    await correr('2026-10-14')
    await correr('2026-10-15')
    await correr('2026-10-16')
    const log = tablas.recordatorios_log as Fila[]
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ estado: 'fallido', intentos: 3 })
    expect(avisos()).toHaveLength(0)

    // Con la base de vuelta, al cuarto día ya no se insiste.
    fallarNotificaciones = 0
    await correr('2026-10-16')
    expect(avisos()).toHaveLength(0)
  })

  it('un fallido que se recupera sale una vez', async () => {
    const soloProv = [{ id: 'prov_t3', fuente: 'pago_proveedor', offset: -3, a: ['area:operaciones'], canales: ['in_app'] }]
    sembrar({ reglas: soloProv })
    fallarNotificaciones = 1
    await correr('2026-10-13')
    await correr('2026-10-14')
    await correr('2026-10-15')
    expect(avisos()).toHaveLength(1)
    expect((tablas.recordatorios_log as Fila[])[0]).toMatchObject({ estado: 'enviado', intentos: 2 })
  })

  it('un canal que el motor aún no manda no gasta la llave', async () => {
    const conEmail = [{ id: 'prov_t3', fuente: 'pago_proveedor', offset: -3, a: ['area:operaciones'], canales: ['email'] }]
    sembrar({ reglas: conEmail })
    const r = await correr('2026-10-13')
    expect(r.canal_sin_soporte).toBe(1)
    expect(tablas.recordatorios_log).toHaveLength(0)
  })
})
