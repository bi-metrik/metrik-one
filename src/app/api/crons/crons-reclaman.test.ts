/**
 * Dos corridas del mismo cron A LA VEZ avisan una sola vez por ítem.
 *
 * Vercel puede entregar un cron dos veces. Medido el 2026-10-06: 2 pares `cobro_vencido` en
 * advise. `pausa-sla` y el paso 2 de `procesar-planes-cobro` marcaban el ítem con un update SIN
 * condición y avisaban después: las dos corridas leían el ítem pendiente, las dos lo marcaban y
 * las dos avisaban. Ahora el update RECLAMA (`.eq('pausado', true)` / `.eq('vencido', false)`) y
 * solo quien lo pasó avisa.
 *
 * El doble aplica los filtros (incluido el del update) y cede el turno en cada operación, así que
 * dos GET a la vez se intercalan como dos invocaciones reales.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Fila = Record<string, unknown>
let tablas: Record<string, Fila[]>
let actividad: Fila[]

const ceder = () => new Promise<void>((r) => setTimeout(r, 0))

function consulta(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  let op: 'select' | 'update' | 'insert' = 'select'
  let payload: Fila | Fila[] = {}
  let conSelect = false
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
      return { data: conSelect ? filas.map((f) => ({ id: f.id })) : null, error: null }
    }
    return { data: filas.map((f) => ({ ...f })), error: null }
  }
  const q: Record<string, unknown> = {
    select: () => { conSelect = true; return q },
    insert: (p: Fila) => { op = 'insert'; payload = p; return q },
    update: (p: Fila) => { op = 'update'; payload = p; return q },
    eq: (c: string, v: unknown) => { filtros.push((f) => f[c] === v); return q },
    is: (c: string, v: unknown) => { filtros.push((f) => (f[c] ?? null) === v); return q },
    in: (c: string, vs: unknown[]) => { filtros.push((f) => vs.includes(f[c])); return q },
    lte: (c: string, v: string) => { filtros.push((f) => String(f[c]) <= v); return q },
    filter: () => q,
    order: () => q,
    range: () => q,
    maybeSingle: async () => ({ data: ((await correr()).data as Fila[] | null)?.[0] ?? null, error: null }),
    single: async () => ({ data: ((await correr()).data as Fila[] | null)?.[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => correr().then(res, rej),
  }
  return q
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (t: string) => consulta(t), rpc: async () => ({ data: null, error: null }) }),
}))
// El candado de crons (#1049) es la primera capa y aquí se apaga: esta prueba mide la segunda, el
// reclamo del ítem, que es la que protege cuando el candado no está (migración ausente, base caída
// al tomarlo, o `?forzar=1`). Con el candado puesto, el doble de `rpc` haría que ninguna corriera.
vi.mock('@/lib/idempotencia/candado-cron', () => ({ candadoDeCron: async () => null }))
vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: async (_s: unknown, fila: Fila) => {
    actividad.push(fila)
    return { ok: true, id: 'x' }
  },
}))
// Lo que viene después del paso 2 del cron de planes no es objeto de esta prueba.
vi.mock('@/lib/cobros/generar-cuentas-cobro', () => ({ generarCuentasCobroPeriodo: async () => ({ emitidas: 0, omitidas: 0, errores: [] }) }))
vi.mock('@/lib/cobros/emitir-cuota-explicita', () => ({ emitirCuentasExplicitasPeriodo: async () => ({ emitidas: 0, omitidas: 0, errores: [] }) }))
vi.mock('@/lib/cobros/cronograma-explicito', () => ({
  planesConCronogramaExplicito: async () => new Set(),
  particionarPorCronograma: (p: unknown[]) => ({ uniformes: p, explicitos: [] }),
}))
vi.mock('@/lib/cobros/enlace-automatico-servidor', () => ({ generarEnlacesAutomaticos: async () => ({}) }))
vi.mock('@/lib/cobros/enrolar-ciclo-servidor', () => ({ enrolarContratosPorCiclo: async () => ({}) }))
vi.mock('@/lib/suscripciones/pasarela/registro', () => ({ adapterPara: () => null }))

const pausaSla = await import('./pausa-sla/route')
const planes = await import('./procesar-planes-cobro/route')

const req = () => new Request('https://x/api/crons/c', { headers: { 'x-vercel-cron': '1' } }) as never

beforeEach(() => {
  actividad = []
  tablas = {
    workspaces: [{ id: 'ws-1', modules: { pausa_sla_auto_enabled: true } }],
    negocios: [
      { id: 'n-1', workspace_id: 'ws-1', nombre: 'Caso', codigo: 'V1', responsable_id: 's-1', pausado: true, estado: 'abierto', pausado_hasta: '2026-01-01' },
    ],
    staff: [{ id: 's-1', profile_id: 'p-1', workspace_id: 'ws-1', is_active: true }],
    profiles: [{ id: 'p-dueno', workspace_id: 'ws-1', role: 'owner' }],
    planes_cobro: [],
    cobros: [
      { id: 'c-1', workspace_id: 'ws-1', negocio_id: 'n-1', plan_cobro_id: 'pl-1', numero_cuota: 2, monto: 100, tipo_cobro: 'programado', vencido: false, fecha: null, fecha_esperada: '2026-01-01' },
    ],
    staff_areas: [],
    notificaciones: [],
    suscripciones: [],
  }
})

describe('pausa-sla', () => {
  it('dos corridas a la vez: una reactivación, una línea de actividad, un aviso', async () => {
    await Promise.all([pausaSla.GET(req()), pausaSla.GET(req())])
    expect(tablas.negocios[0].pausado).toBe(false)
    expect(actividad).toHaveLength(1)
    expect(tablas.notificaciones.filter((n) => n.tipo === 'negocio_reactivado')).toHaveLength(1)
  })
})

describe('procesar-planes-cobro, paso 2 (cuota vencida)', () => {
  it('dos corridas a la vez: cada destinatario recibe UN aviso de la cuota', async () => {
    await Promise.all([planes.GET(req()), planes.GET(req())])
    const avisos = tablas.notificaciones.filter((n) => n.tipo === 'cobro_vencido')
    expect(tablas.cobros[0].vencido).toBe(true)
    // El doble no resuelve el embed del responsable: el destinatario que queda es el dueño.
    expect(avisos.map((a) => a.destinatario_id)).toEqual(['p-dueno'])
  })
})
