import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { asignarResponsableAlEntrar, leerResponsableAutomatico } from './responsable-automatico'

// Ids reales de SOENA (GIT EV/HEV) para que el caso se lea como el pedido de Deisy.
const CARGUE = 'bf24a84c-5fdb-4391-acff-51f23b8b2ae4'
const CAMILA = '101e03b6-dc15-4a1e-bef4-26dab9a47aee'
const WS = 'ws-soena'

type Fila = Record<string, unknown>
type Op = { tabla: string; accion: string; payload?: unknown; filtros: Record<string, unknown> }

/**
 * Doble de supabase con estado: `negocio_responsables` es una tabla viva (delete/upsert la
 * cambian), así se afirma sobre lo que quedó escrito, no sobre lo que devolvió el helper.
 */
function fakeDb(opts: {
  etapas: Record<string, { nombre: string; config_extra: unknown }>
  staff: Array<{ id: string; full_name: string; is_active: boolean; workspace_id: string; areas: string[] }>
  responsables?: Array<{ negocio_id: string; staff_id: string; rol: string | null }>
  upsertLanza?: boolean
}) {
  const responsables = [...(opts.responsables ?? [])]
  const ops: Op[] = []
  const client = {
    from(tabla: string) {
      const filtros: Record<string, unknown> = {}
      let accion = 'select'
      const filas = (): Fila[] => {
        if (tabla === 'etapas_negocio') {
          const e = opts.etapas[filtros.id as string]
          return e ? [{ id: filtros.id, ...e }] : []
        }
        if (tabla === 'negocio_responsables') {
          return responsables.filter(
            (r) =>
              (filtros.negocio_id === undefined || r.negocio_id === filtros.negocio_id) &&
              (filtros.rol === undefined || r.rol === filtros.rol),
          )
        }
        if (tabla === 'staff') {
          return opts.staff
            .filter(
              (s) =>
                (filtros.id === undefined || s.id === filtros.id) &&
                (filtros.workspace_id === undefined || s.workspace_id === filtros.workspace_id),
            )
            .map((s) => ({ id: s.id, full_name: s.full_name, is_active: s.is_active }))
        }
        if (tabla === 'staff_areas') {
          const s = opts.staff.find((x) => x.id === filtros.staff_id)
          return (s?.areas ?? []).map((area) => ({ area }))
        }
        if (tabla === 'negocios') return [{ workspace_id: WS }]
        return []
      }
      const chain: Record<string, unknown> = {
        select() {
          return chain
        },
        eq(col: string, val: unknown) {
          filtros[col] = val
          return chain
        },
        order() {
          return chain
        },
        limit() {
          return chain
        },
        delete() {
          accion = 'delete'
          return chain
        },
        update(payload: unknown) {
          accion = 'update'
          ops.push({ tabla, accion, payload, filtros })
          return chain
        },
        insert(payload: unknown) {
          ops.push({ tabla, accion: 'insert', payload, filtros })
          return chain
        },
        upsert(payload: { negocio_id: string; staff_id: string; rol: string | null }) {
          if (opts.upsertLanza) throw new Error('red caída')
          ops.push({ tabla, accion: 'upsert', payload, filtros })
          const i = responsables.findIndex((r) => r.negocio_id === payload.negocio_id && r.staff_id === payload.staff_id)
          if (i >= 0) responsables[i] = payload
          else responsables.push(payload)
          return Promise.resolve({ error: null })
        },
        maybeSingle() {
          if (tabla === 'activity_log') return Promise.resolve({ data: { id: 'evt' }, error: null })
          return Promise.resolve({ data: filas()[0] ?? null, error: null })
        },
        single() {
          return Promise.resolve({ data: filas()[0] ?? null, error: null })
        },
        then(resolve: (v: unknown) => unknown) {
          if (accion === 'delete') {
            ops.push({ tabla, accion, filtros })
            for (let i = responsables.length - 1; i >= 0; i--) {
              const r = responsables[i]
              if (r.negocio_id === filtros.negocio_id && r.rol === filtros.rol) responsables.splice(i, 1)
            }
            return Promise.resolve({ error: null }).then(resolve)
          }
          return Promise.resolve({ data: filas(), error: null }).then(resolve)
        },
      }
      return chain
    },
  }
  return { client, ops, responsables }
}

const etapasSoena = {
  [CARGUE]: { nombre: 'Cargue', config_extra: { responsable_automatico: { rol: 'operaciones', staff_id: CAMILA } } },
  'etapa-sin-config': { nombre: 'Radicación', config_extra: { gates: [] } },
}
const camila = { id: CAMILA, full_name: 'Camila', is_active: true, workspace_id: WS, areas: ['operaciones'] }
const comercial = { id: 'com-1', full_name: 'Laura', is_active: true, workspace_id: WS, areas: ['comercial'] }
const otraOperativa = { id: 'op-2', full_name: 'Deisy', is_active: true, workspace_id: WS, areas: ['operaciones'] }

function eventoLog(ops: Op[]) {
  return ops.find((o) => o.tabla === 'activity_log' && o.accion === 'insert')?.payload as
    | { contenido: string; autor_id: string | null }
    | undefined
}

describe('leerResponsableAutomatico', () => {
  it('acepta solo la forma completa', () => {
    expect(leerResponsableAutomatico({ responsable_automatico: { rol: 'operaciones', staff_id: 's' } })).toEqual({
      rol: 'operaciones',
      staff_id: 's',
    })
    expect(leerResponsableAutomatico(null)).toBeNull()
    expect(leerResponsableAutomatico({})).toBeNull()
    expect(leerResponsableAutomatico({ responsable_automatico: { rol: 'financiera', staff_id: 's' } })).toBeNull()
    expect(leerResponsableAutomatico({ responsable_automatico: { rol: 'operaciones' } })).toBeNull()
  })
})

describe('asignarResponsableAlEntrar', () => {
  it('entrar a Cargue sin operativo asigna a Camila con rol operaciones, sin autor y diciendo por qué', async () => {
    const { client, ops, responsables } = fakeDb({ etapas: etapasSoena, staff: [camila] })
    const r = await asignarResponsableAlEntrar(client, { negocioId: 'n1', etapaId: CARGUE, workspaceId: WS })
    expect(r).toBe('asignado')
    expect(responsables).toEqual([{ negocio_id: 'n1', staff_id: CAMILA, rol: 'operaciones', assigned_by: null }])
    const evt = eventoLog(ops)
    expect(evt?.contenido).toBe('Responsable agregado: Camila como operaciones (asignado automáticamente al entrar a Cargue)')
    expect(evt?.autor_id).toBeNull()
  })

  it('con un operativo ya puesto no lo cambia', async () => {
    const { client, ops, responsables } = fakeDb({
      etapas: etapasSoena,
      staff: [camila, otraOperativa],
      responsables: [{ negocio_id: 'n1', staff_id: 'op-2', rol: 'operaciones' }],
    })
    const r = await asignarResponsableAlEntrar(client, { negocioId: 'n1', etapaId: CARGUE, workspaceId: WS })
    expect(r).toBe('ya_tiene_responsable')
    expect(responsables).toEqual([{ negocio_id: 'n1', staff_id: 'op-2', rol: 'operaciones' }])
    expect(ops.filter((o) => o.accion !== 'select')).toEqual([])
  })

  it('una etapa sin configuración no asigna', async () => {
    const { client, ops, responsables } = fakeDb({ etapas: etapasSoena, staff: [camila] })
    const r = await asignarResponsableAlEntrar(client, { negocioId: 'n1', etapaId: 'etapa-sin-config', workspaceId: WS })
    expect(r).toBe('sin_configuracion')
    expect(responsables).toEqual([])
    expect(ops).toEqual([])
  })

  it('un staff inactivo no se asigna y lo deja en el log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, responsables } = fakeDb({ etapas: etapasSoena, staff: [{ ...camila, is_active: false }] })
    const r = await asignarResponsableAlEntrar(client, { negocioId: 'n1', etapaId: CARGUE, workspaceId: WS })
    expect(r).toBe('staff_no_disponible')
    expect(responsables).toEqual([])
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('un staff de otro workspace o sin el área del rol no se asigna', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ajeno = fakeDb({ etapas: etapasSoena, staff: [{ ...camila, workspace_id: 'otro' }] })
    expect(await asignarResponsableAlEntrar(ajeno.client, { negocioId: 'n1', etapaId: CARGUE, workspaceId: WS })).toBe(
      'staff_no_disponible',
    )
    const sinArea = fakeDb({ etapas: etapasSoena, staff: [{ ...camila, areas: ['financiera'] }] })
    expect(await asignarResponsableAlEntrar(sinArea.client, { negocioId: 'n1', etapaId: CARGUE, workspaceId: WS })).toBe(
      'staff_sin_area',
    )
    expect(ajeno.responsables).toEqual([])
    expect(sinArea.responsables).toEqual([])
    warn.mockRestore()
  })

  it('el responsable comercial no se toca', async () => {
    const { client, responsables } = fakeDb({
      etapas: etapasSoena,
      staff: [camila, comercial],
      responsables: [{ negocio_id: 'n1', staff_id: 'com-1', rol: 'comercial' }],
    })
    const r = await asignarResponsableAlEntrar(client, { negocioId: 'n1', etapaId: CARGUE, workspaceId: WS })
    expect(r).toBe('asignado')
    expect(responsables).toContainEqual({ negocio_id: 'n1', staff_id: 'com-1', rol: 'comercial' })
    expect(responsables).toContainEqual(expect.objectContaining({ staff_id: CAMILA, rol: 'operaciones' }))
  })

  it('quien lleva comercial y operaciones entra como operaciones y no desplaza al comercial', async () => {
    const daniela = { id: 'dan', full_name: 'Daniela', is_active: true, workspace_id: WS, areas: ['comercial', 'operaciones'] }
    const { client, responsables } = fakeDb({
      etapas: { [CARGUE]: { nombre: 'Cargue', config_extra: { responsable_automatico: { rol: 'operaciones', staff_id: 'dan' } } } },
      staff: [daniela, comercial],
      responsables: [{ negocio_id: 'n1', staff_id: 'com-1', rol: 'comercial' }],
    })
    await asignarResponsableAlEntrar(client, { negocioId: 'n1', etapaId: CARGUE, workspaceId: WS })
    expect(responsables).toContainEqual({ negocio_id: 'n1', staff_id: 'com-1', rol: 'comercial' })
    expect(responsables).toContainEqual(expect.objectContaining({ staff_id: 'dan', rol: 'operaciones' }))
  })

  it('un fallo al asignar no lanza: el avance de etapa sigue', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeDb({ etapas: etapasSoena, staff: [camila], upsertLanza: true })
    await expect(
      asignarResponsableAlEntrar(client, { negocioId: 'n1', etapaId: CARGUE, workspaceId: WS }),
    ).resolves.toBe('error')
    err.mockRestore()
  })
})

// ── Cobertura de los caminos que mueven la etapa ─────────────────────────────
// Cada camino que escribe `etapa_actual_id` desde el código de la app llama al helper después
// del UPDATE. Si alguien agrega un movedor sin él, la etapa configurada deja de asignar en
// silencio: esta guarda lo hace visible.
describe('los movedores de etapa llaman al responsable automático', () => {
  const movedores = [
    'src/app/(app)/negocios/negocio-v2-actions.ts', // cambiarEtapaNegocio: botón, salto con motivo, cierre, conciliación, reversa
    'src/lib/viaje/etapas-por-fecha.ts', // cron por fechas
    'src/lib/actions/reapertura.ts', // reabrir (en sitio y clon)
    'src/lib/actions/reproceso-actions.ts',
    'src/lib/correcciones/retorno.ts',
    'src/lib/actions/devolucion-actions.ts',
  ]
  it.each(movedores)('%s', (ruta) => {
    const src = readFileSync(join(process.cwd(), ruta), 'utf8')
    expect(src).toContain('asignarResponsableAlEntrar(')
  })
})
