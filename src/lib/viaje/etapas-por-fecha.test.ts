/**
 * El cron que mueve un viaje a «En viaje» y lo saca por fechas (F6-1, F6-2), contra un doble que
 * aplica los filtros del update (el reclamo) y cede el turno: dos corridas a la vez se intercalan.
 *
 * VISTO FALLAR (2026-10-12), una mutación a la vez:
 *   · quitar `.eq('etapa_actual_id', actual.id)` del update → cae «dos corridas a la vez: un movimiento»;
 *   · `hoy >= p.salida` → `hoy > p.salida` en `movimientoPorFecha` → cae «el día de salida entra».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Fila = Record<string, unknown>
let tablas: Record<string, Fila[]>
let instanciadas: Array<{ negocioId: string; etapaId: string }>
let faltaEntrega: string[]
const ceder = () => new Promise<void>((r) => setTimeout(r, 0))

vi.mock('@/lib/negocios/instanciar-bloques-etapa', () => ({
  instanciarBloquesDeEtapa: async (_db: unknown, a: { negocioId: string; etapaId: string }) => { instanciadas.push(a) },
}))
vi.mock('./entrega-datos', () => ({ evaluarGateEntrega: async () => faltaEntrega }))

function leer(f: Fila, col: string): unknown {
  if (!col.includes('->')) return f[col]
  const partes = col.split(/->>?/)
  let v: unknown = f[partes[0]]
  for (const p of partes.slice(1)) v = v && typeof v === 'object' ? (v as Fila)[p] : undefined
  return v
}

function consulta(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  let op: 'select' | 'update' | 'insert' = 'select'
  let payload: Fila | Fila[] = {}
  const correr = async () => {
    await ceder()
    tablas[tabla] ??= []
    if (op === 'insert') {
      const filas = (Array.isArray(payload) ? payload : [payload]).map((f) => ({ ...f }))
      tablas[tabla].push(...filas)
      return { data: filas, error: null }
    }
    const filas = tablas[tabla].filter((f) => filtros.every((p) => p(f)))
    if (op === 'update') {
      filas.forEach((f) => Object.assign(f, payload))
      return { data: filas.map((f) => ({ id: f.id })), error: null }
    }
    return { data: filas.map((f) => ({ ...f })), error: null }
  }
  const q: Record<string, unknown> = {
    select: () => q,
    insert: (p: Fila) => { op = 'insert'; payload = p; return q },
    update: (p: Fila) => { op = 'update'; payload = p; return q },
    eq: (c: string, v: unknown) => { filtros.push((f) => leer(f, c) === v); return q },
    in: (c: string, vs: unknown[]) => { filtros.push((f) => vs.includes(f[c])); return q },
    not: (c: string) => { filtros.push((f) => leer(f, c) !== null && leer(f, c) !== undefined); return q },
    maybeSingle: async () => ({ data: ((await correr()).data as Fila[] | null)?.[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => correr().then(res, rej),
  }
  return q
}

const svc = {
  from: (t: string) => consulta(t),
  rpc: async (_fn: string, args: Fila) => {
    await ceder()
    const r = (tablas.negocio_responsables ?? []).filter((x) => x.negocio_id === args.p_negocio_id)
    return { data: r.map((x) => ({ profile_id: (tablas.staff ?? []).find((s) => s.id === x.staff_id)?.profile_id })), error: null }
  },
}

const { correrEtapasPorFecha } = await import('./etapas-por-fecha')

const WS = 'ws-t'
const NEG = 'neg-a'

function sembrar(opts: { pagado?: number; etapa?: string } = {}) {
  instanciadas = []
  faltaEntrega = []
  tablas = {
    lineas_negocio: [
      { id: 'linea', workspace_id: WS, config_extra: { etapas_por_fecha: { entrar: { etapa_numero: 7 }, salir: { etapa_numero: 8, offset: 1 } }, aprobaciones: { staff_ids: ['s-edgar'] } } },
      { id: 'soena', workspace_id: 'ws-s', config_extra: {} },
    ],
    etapas_negocio: [
      { id: 'e6', linea_id: 'linea', numero: 6, stage: 'ejecucion', nombre: 'Documentos y entrega', is_active: true, config_extra: { gates: ['paquete_enviado'] } },
      { id: 'e7', linea_id: 'linea', numero: 7, stage: 'ejecucion', nombre: 'En viaje', is_active: true, config_extra: {} },
      { id: 'e8', linea_id: 'linea', numero: 8, stage: 'cobro', nombre: 'Cierre económico', is_active: true, config_extra: {} },
    ],
    negocios: [
      { id: NEG, workspace_id: WS, linea_id: 'linea', nombre: 'Cusco', etapa_actual_id: opts.etapa ?? 'e6', contacto_id: 'c-1', precio_aprobado: 4_052_000, estado: 'abierto', metadata: {} },
      { id: 'neg-soena', workspace_id: 'ws-s', linea_id: 'soena', nombre: 'Moto', etapa_actual_id: 'x', contacto_id: null, precio_aprobado: 1, estado: 'abierto', metadata: {} },
    ],
    negocio_bloques: [{ negocio_id: NEG, data: { fecha_salida: '2026-11-21', fecha_regreso: '2026-11-25' } }],
    cobros: [{ negocio_id: NEG, workspace_id: WS, monto: opts.pagado ?? 3_242_000, fecha: '2026-10-12', retencion_iva: 0, anulado_at: null }],
    contactos: [{ id: 'c-1', nombre: 'Valeria Prueba' }],
    negocio_responsables: [{ negocio_id: NEG, staff_id: 's-dani' }],
    staff: [{ id: 's-dani', workspace_id: WS, profile_id: 'p-dani' }, { id: 's-edgar', workspace_id: WS, profile_id: 'p-edgar' }],
    notificaciones: [],
    activity_log: [],
  }
  // El doble lee `data->fecha_salida` con la ruta: se exponen como columnas del select.
  for (const b of tablas.negocio_bloques) Object.assign(b, { fecha_salida: (b.data as Fila).fecha_salida, fecha_regreso: (b.data as Fila).fecha_regreso })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const correr = (hoy: string) => correrEtapasPorFecha(svc as any, { hoy })
const neg = () => tablas.negocios[0]

beforeEach(() => sembrar())

describe('entrar a En viaje (F6-1, F6-2)', () => {
  it('el día antes no se mueve; el día de salida entra, instancia la etapa y deja traza', async () => {
    await correr('2026-11-20')
    expect(neg().etapa_actual_id).toBe('e6')
    const r = await correr('2026-11-21')
    expect(r.entraron).toBe(1)
    expect(neg()).toMatchObject({ etapa_actual_id: 'e7', stage_actual: 'ejecucion' })
    expect(instanciadas).toEqual([{ negocioId: NEG, etapaId: 'e7', workspaceId: WS }])
    expect(String(tablas.activity_log[0].contenido)).toBe('Entró a En viaje: hoy sale el viaje.')
    // SOENA (sin etapas_por_fecha) no se toca.
    expect(tablas.negocios[1].etapa_actual_id).toBe('x')
  })

  it('sin estar listo entra igual, con traza y aviso a la dirección (P5)', async () => {
    faltaEntrega = ['Falta enviar el paquete de viaje.']
    await correr('2026-11-21')
    expect(neg().etapa_actual_id).toBe('e7')
    expect(String(tablas.activity_log[0].contenido)).toContain('Salió el viaje sin estar listo: Falta enviar el paquete de viaje.')
    const aviso = tablas.notificaciones.find((n) => (n.metadata as Fila).motivo === 'viaje_sin_listo')
    expect(aviso).toMatchObject({ destinatario_id: 'p-edgar', tipo: 'viaje_sin_listo' })
  })

  it('con saldo, aviso a la comercial y a la dirección: «viaja hoy con saldo»', async () => {
    await correr('2026-11-21')
    const avisos = tablas.notificaciones.filter((n) => (n.metadata as Fila).motivo === 'viaja_con_saldo')
    expect(avisos.map((a) => a.destinatario_id).sort()).toEqual(['p-dani', 'p-edgar'])
    expect(avisos[0].contenido).toBe('Valeria Prueba viaja hoy con saldo de $810.000.')
  })

  it('dos corridas a la vez: un movimiento y un aviso', async () => {
    await Promise.all([correr('2026-11-21'), correr('2026-11-21')])
    expect(instanciadas).toHaveLength(1)
    expect(tablas.activity_log).toHaveLength(1)
    expect(tablas.notificaciones.filter((n) => (n.metadata as Fila).motivo === 'viaja_con_saldo')).toHaveLength(2)
  })
})

describe('salir de En viaje', () => {
  it('el día del regreso sigue en viaje; al día siguiente pasa al Cierre económico', async () => {
    sembrar({ etapa: 'e7' })
    await correr('2026-11-25')
    expect(neg().etapa_actual_id).toBe('e7')
    const r = await correr('2026-11-26')
    expect(r.salieron).toBe(1)
    expect(neg().etapa_actual_id).toBe('e8')
    expect(tablas.notificaciones).toHaveLength(0)
  })
})
