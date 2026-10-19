/**
 * Las acciones del reparto del comercial, alrededor de la función de base
 * `guardar_reparto_comercial` (que se prueba en Postgres de verdad en
 * `lib/cobros/reparto-comercial-sql.test.ts`). Aquí se fija lo que hace el SERVIDOR:
 *
 *   · no llama a la base si el reparto no cuadra;
 *   · editar llama a la función en modo «editar» (reemplazo atómico), deja el antes y el
 *     después en el historial y le vuelve a avisar a la financiera;
 *   · si la base dice que ya está aprobado, el comercial recibe el mensaje que le dice qué
 *     puede hacer (no «elimina las porciones»);
 *   · rechazar le llega al comercial que lo propuso como notificación, con la nota.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WS, estado, reiniciarDoble, servicioFalso } from '../../../test/redistribucion-doble'

const sesion = { role: 'operator', areas: ['comercial'], staffId: 'staff-tatiana', userId: 'profile-tatiana' }
const rpc = vi.fn(async (_nombre: string, _args: Record<string, unknown>) => ({ data: null as unknown, error: null as unknown }))

vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({
    workspaceId: WS,
    userId: sesion.userId,
    staffId: sesion.staffId,
    role: sesion.role,
    areas: sesion.areas,
    supabase: { ...servicioFalso(), rpc: (n: string, a: Record<string, unknown>) => rpc(n, a) },
  }),
}))
vi.mock('@/app/(app)/negocios/negocio-v2-actions', () => ({
  recalcularNegocioPorCambioDeRecaudo: async () => ({ gates_reabiertos: 0 }),
  cambiarEtapaNegocio: async () => ({ error: null }),
}))
const registrarActividad = vi.fn(async (..._a: unknown[]) => ({ ok: true, id: null }))
vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: (...a: unknown[]) => registrarActividad(...a),
}))
vi.mock('@/lib/epayco', () => ({
  consultarTransaccionEpayco: async () => ({ estado: 'Aceptada', monto_bruto: 2_653_451 }),
}))
vi.mock('@/lib/siigo/segundo-plano', () => ({ abonarEnSegundoPlano: async () => {} }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/modulos/exigir-modulo', async () =>
  (await import('../../../test/exigir-modulo-doble')).dobleExigirModulo())

import { editarRepartoComercial, rechazarRepartoComercial, repartirPagoComercial } from './conciliacion-actions'
import { reiniciarModulo } from '../../../test/exigir-modulo-doble'

const REF = '389928481'
const V0587 = 'neg-v0587'
const V0589 = 'neg-v0589'

const correccion = {
  referencia: REF,
  monto_total: 2_653_451,
  fuente: 'epayco' as const,
  porciones: [{ negocio_id: V0587, monto: 1_316_062 }, { negocio_id: V0589, monto: 1_337_389 }],
}

function llamadas(nombre: string) {
  return rpc.mock.calls.filter(([n]) => n === nombre).map(([, a]) => a)
}

beforeEach(() => {
  rpc.mockReset()
  registrarActividad.mockClear()
  reiniciarDoble()
  reiniciarModulo(WS, { business: true })
  Object.assign(sesion, { role: 'operator', areas: ['comercial'], staffId: 'staff-tatiana', userId: 'profile-tatiana' })
  estado.fixtures.workspaces = [{ id: WS, modules: { fab_pago_epayco: true } }]
  rpc.mockImplementation(async (nombre: string) => {
    if (nombre === 'guardar_reparto_comercial') {
      return {
        data: {
          split_id: 'split-2',
          antes: [{ negocio_id: V0587, codigo: 'V0587', monto: 1_326_725 }, { negocio_id: V0589, codigo: 'V0589', monto: 1_326_726 }],
          despues: [{ negocio_id: V0587, codigo: 'V0587', monto: 1_316_062 }, { negocio_id: V0589, codigo: 'V0589', monto: 1_337_389 }],
        },
        error: null,
      }
    }
    return { data: 1, error: null }
  })
})

describe('enviar y corregir', () => {
  it('si no cuadra, no llega a la base', async () => {
    const r = await repartirPagoComercial({ ...correccion, porciones: [{ negocio_id: V0587, monto: 1_326_725 }] })
    expect(r.success).toBe(false)
    expect(llamadas('guardar_reparto_comercial')).toHaveLength(0)
  })

  it('editar reemplaza en la base (modo editar), deja el antes y el después y avisa a la financiera de nuevo', async () => {
    const r = await editarRepartoComercial(correccion)
    expect(r.success).toBe(true)

    const [args] = llamadas('guardar_reparto_comercial')
    expect(args).toMatchObject({ p_referencia: REF, p_modo: 'editar', p_split_total: 2_653_451, p_fuente: 'epayco' })

    const filas = registrarActividad.mock.calls.map((c) => c[1] as Record<string, string>)
    expect(filas.map((f) => f.entidad_id).sort()).toEqual([V0587, V0589])
    expect(filas[0].valor_anterior).toContain('V0587 $1.326.725')
    expect(filas[0].valor_nuevo).toContain('V0587 $1.316.062')

    // El aviso viejo se cierra y sale uno nuevo, que dice que es una corrección.
    expect(llamadas('resolver_grupo_notificaciones')[0]).toMatchObject({ p_grupo_clave: `conciliacion:${REF}` })
    const aviso = llamadas('crear_notificacion_equipo')[0]
    expect(aviso).toMatchObject({ p_area: 'financiera', p_grupo_clave: `conciliacion:${REF}` })
    expect(String(aviso.p_contenido)).toMatch(/corregido/i)
  })

  it('aprobado: la base lo rechaza y el comercial sabe qué hacer, aunque llame la acción directo', async () => {
    rpc.mockImplementation(async (nombre: string) =>
      nombre === 'guardar_reparto_comercial'
        ? { data: null, error: { code: 'P0001', message: 'REPARTO_APROBADO' } }
        : { data: 1, error: null })
    const r = await editarRepartoComercial(correccion)
    expect(r.success).toBe(false)
    expect((r as { error: string }).error).toMatch(/ya aprobó.*ya no se puede editar/)
    expect((r as { error: string }).error).not.toMatch(/elimin/i)
    expect(llamadas('crear_notificacion_equipo')).toHaveLength(0)
  })

  it('manual: la fuente escrita llega a la base (antes se validaba y se perdía)', async () => {
    await repartirPagoComercial({ ...correccion, referencia: 'TRF-1', fuente: 'manual', fuente_nombre: 'Davivienda' })
    expect(llamadas('guardar_reparto_comercial')[0]).toMatchObject({ p_fuente: 'Davivienda', p_modo: 'nuevo' })
  })

  it('manual sin nombre de fuente no se envía', async () => {
    const r = await repartirPagoComercial({ ...correccion, referencia: 'TRF-1', fuente: 'manual' })
    expect(r.success).toBe(false)
    expect(llamadas('guardar_reparto_comercial')).toHaveLength(0)
  })
})

describe('rechazo', () => {
  it('el comercial que lo propuso recibe la nota en una notificación', async () => {
    Object.assign(sesion, { role: 'supervisor', areas: ['financiera'], staffId: 'staff-diana', userId: 'profile-diana' })
    estado.fixtures.staff = [{ id: 'staff-tatiana', workspace_id: WS, profile_id: 'profile-tatiana' }]
    estado.fixtures.cobros = [V0587, V0589].map((id, i) => ({
      id: `c${i}`, workspace_id: WS, negocio_id: id, external_ref: REF, monto: 1_326_725,
      split_json: { origen: 'comercial', propuesto_por: 'staff-tatiana' },
      negocios: { codigo: id === V0587 ? 'V0587' : 'V0589' },
    }))

    const r = await rechazarRepartoComercial(REF, 'Cada uno debía distinto')
    expect(r.success).toBe(true)

    const [n] = llamadas('crear_notificacion')
    expect(n).toMatchObject({ p_destinatario_id: 'profile-tatiana', p_tipo: 'aprobacion_decidida', p_entidad_tipo: 'negocio' })
    expect(String(n.p_contenido)).toContain('Cada uno debía distinto')

    // Y la marca que pinta «Rechazado: <nota>» en el bloque.
    const marca = registrarActividad.mock.calls.map((c) => c[1] as Record<string, string>)
      .find((f) => f.campo_modificado === 'reparto_comercial_rechazado')
    expect(marca).toMatchObject({ valor_anterior: REF, valor_nuevo: 'Cada uno debía distinto' })
  })
})
