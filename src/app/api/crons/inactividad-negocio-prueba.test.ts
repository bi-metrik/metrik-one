/**
 * Crons de inactividad y el negocio de prueba (F8-1): el escalamiento al owner y al supervisor del
 * workspace REAL no alcanza al viaje de prueba. Un negocio real sigue avisando igual.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dobleFiltrante, type Fila } from '../../../../test/doble-filtrante'

const WS = 'ws-trappvel'
let tablas: Record<string, Fila[]>

function cliente() {
  const db = dobleFiltrante(() => tablas)
  db.rpc = async (fn: string, args?: Record<string, unknown>) => {
    if (fn === 'negocios_ultima_actividad') {
      return { data: (args!.p_ids as string[]).map((id) => ({ negocio_id: id, dias_habiles: 20, umbral_dias: 3, debe_alertar: true })), error: null }
    }
    return { data: [], error: null }
  }
  return db
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => cliente() }))
vi.mock('@/lib/idempotencia/candado-cron', () => ({ candadoDeCron: async () => null }))

const oportunidades = await import('./inactividad-oportunidades/route')
const proyectos = await import('./inactividad-proyectos/route')

const pedir = () => new Request('https://x.test/api/crons', { headers: { 'x-vercel-cron': '1' } })

function negocio(id: string, stage: string, extra: Fila = {}): Fila {
  return { id, workspace_id: WS, nombre: `Viaje ${id}`, estado: 'abierto', stage_actual: stage, linea_id: 'l-clon', metadata: {}, ...extra }
}

beforeEach(() => {
  tablas = {
    negocios: [
      negocio('real-v', 'venta'),
      negocio('prueba-v', 'venta', { metadata: { es_prueba: true } }),
      negocio('real-e', 'ejecucion'),
      negocio('prueba-e', 'ejecucion', { metadata: { es_prueba: true } }),
    ],
    // Sin `routing_por_responsable`: el comportamiento histórico escala al owner (Edgar).
    workspaces: [{ id: WS, config_extra: {} }],
    profiles: [{ id: 'p-edgar', workspace_id: WS, role: 'owner' }, { id: 'p-super', workspace_id: WS, role: 'supervisor' }],
    negocio_responsables: [{ negocio_id: 'prueba-v', staff_id: 's-cp' }, { negocio_id: 'prueba-e', staff_id: 's-cp' }],
    lineas_negocio: [{ id: 'l-clon', config_extra: { aprobaciones: { staff_ids: ['s-dp'] } } }],
    staff: [{ id: 's-cp', workspace_id: WS, profile_id: 'p-cp' }, { id: 's-dp', workspace_id: WS, profile_id: 'p-dp' }],
    notificaciones: [],
  }
})

describe('inactividad y el negocio de prueba (F8-1)', () => {
  it('venta: el owner y el supervisor reales reciben el aviso del negocio real, nunca el de prueba', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await oportunidades.GET(pedir() as any)
    const entidades = tablas.notificaciones.map((n) => n.entidad_id)
    expect(entidades).toContain('real-v')
    expect(entidades).not.toContain('prueba-v')
  })

  it('ejecución: igual', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await proyectos.GET(pedir() as any)
    const entidades = tablas.notificaciones.map((n) => n.entidad_id)
    expect(entidades).toContain('real-e')
    expect(entidades).not.toContain('prueba-e')
  })
})
