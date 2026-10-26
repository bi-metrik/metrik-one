/**
 * `addComment` ya no pone `mencion_id` cuando el comentario trae menciones nuevas: ese campo
 * disparaba `trg_notif_mencion` antes de que existieran las filas de `activity_menciones`, y la
 * primera persona mencionada recibía dos avisos (la prueba en SQL está en
 * `src/lib/activity/menciones-doble-aviso-sql.test.ts`). El distintivo del timeline sale ahora
 * de `activity_menciones`, que `getActivityLog` lee aparte.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const WS = 'ws-1'
let filaLog: Record<string, unknown> | null = null
let insertadasMenciones: Array<Record<string, unknown>> = []
let mencionesGuardadas: Array<Record<string, unknown>> = []
let errorMenciones: { message: string } | null = null

const LOG = [
  { id: 'c1', tipo: 'comentario', autor_id: 's-autora', mencion: null },
  { id: 'c-viejo', tipo: 'comentario', autor_id: 's-autora', mencion: { id: 's-beto', full_name: 'Beto' } },
  { id: 'e1', tipo: 'cambio_etapa', autor_id: 's-autora', mencion: null },
]

function consulta(resultado: () => { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) q[m] = () => q
  q.then = (resolve: (r: unknown) => void) => resolve(resultado())
  return q
}

function doble() {
  return {
    from: (tabla: string) => {
      if (tabla === 'activity_log') return consulta(() => ({ data: LOG, error: null }))
      if (tabla === 'activity_menciones') {
        return {
          ...consulta(() => ({ data: mencionesGuardadas, error: errorMenciones })),
          insert: async (filas: Array<Record<string, unknown>>) => {
            insertadasMenciones.push(...filas)
            return { error: null }
          },
        }
      }
      throw new Error(`tabla inesperada: ${tabla}`)
    },
  }
}

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: doble(), workspaceId: WS, role: 'operator', staffId: 's-autora', error: null }),
}))
vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: async (_s: unknown, fila: Record<string, unknown>) => {
    filaLog = fila
    return { ok: true, id: 'log-1' }
  },
}))

const { addComment, getActivityLog } = await import('./activity-actions')

beforeEach(() => {
  filaLog = null
  insertadasMenciones = []
  mencionesGuardadas = []
  errorMenciones = null
})

describe('addComment', () => {
  it('con personas mencionadas, mencion_id va null y las menciones van a su tabla', async () => {
    const r = await addComment('negocio', 'n1', 'hola', null, null, { staffIds: ['s-beto', 's-carla'] })
    expect(r).toEqual({ success: true })
    expect(filaLog?.mencion_id).toBeNull()
    expect(insertadasMenciones.map(m => m.staff_id)).toEqual(['s-beto', 's-carla'])
  })

  it('con solo un equipo etiquetado, mencion_id va null', async () => {
    await addComment('negocio', 'n1', 'hola', null, null, { areas: ['operaciones'] })
    expect(filaLog?.mencion_id).toBeNull()
    expect(insertadasMenciones).toEqual([{ workspace_id: WS, activity_log_id: 'log-1', staff_id: null, area: 'operaciones' }])
  })

  it('el camino legado (un mencionId suelto, sin lista) lo sigue escribiendo', async () => {
    await addComment('negocio', 'n1', 'hola', 's-beto')
    expect(filaLog?.mencion_id).toBe('s-beto')
    expect(insertadasMenciones).toEqual([])
  })
})

describe('getActivityLog', () => {
  it('trae las menciones de cada comentario por nombre y equipo', async () => {
    mencionesGuardadas = [
      { activity_log_id: 'c1', area: null, persona: { full_name: 'Beto' } },
      { activity_log_id: 'c1', area: 'operaciones', persona: null },
    ]
    const r = (await getActivityLog('negocio', 'n1')) as Array<{ id: string; menciones: string[] }>
    expect(r.find(e => e.id === 'c1')?.menciones).toEqual(['Beto', '@operaciones'])
    expect(r.find(e => e.id === 'c-viejo')?.menciones).toEqual([])
  })

  it('si la lectura de menciones falla, el timeline sale igual', async () => {
    errorMenciones = { message: 'boom' }
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await getActivityLog('negocio', 'n1')
    expect(r).toHaveLength(3)
    espia.mockRestore()
  })
})
