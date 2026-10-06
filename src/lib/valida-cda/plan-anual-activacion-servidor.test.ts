import { describe, expect, it, vi } from 'vitest'
import { crearDoble, type Tablas } from '../../../test/tablas-doble'

vi.mock('server-only', () => ({}))

const { activarPlanAnualSiCorresponde } = await import('./plan-anual-activacion-servidor')

/**
 * La activación que corre el webhook: lee la elección, las cuotas, los cobros y los cargos REALES del
 * plan, reparte lo pagado SIN el pago del anual, y llama a la función de la base con lo que calcula
 * `planDeActivacion`. La función de la base se prueba ejecutada en `plan-anual-sql.test.ts`.
 */

const PLAN = 'plan-1'
const ANUAL = 'cobro-anual'

function tablas(over: Partial<Tablas> = {}): Tablas {
  return {
    planes_anuales_cda: [
      {
        id: 'pa-1', estado: 'elegido', periodo_desde: '2026-10-23', periodo_hasta: '2027-10-22', cobro_id: ANUAL,
        negocio_id: 'neg-1', plan_cobro_id: PLAN, workspace_id: 'ws-metrik', servicio_contratado_id: 'sc-1',
      },
    ],
    servicios_contratados: [{ id: 'sc-1', vigente_desde: '2026-09-23' }],
    plan_cobro_cuotas: [
      { id: 'q1', plan_cobro_id: PLAN, numero: 1, tipo: 'cuota', monto: 150000, fecha_vencimiento: '2026-09-30', concepto_detalle: 'S — periodo del 23/09/2026 al 22/10/2026' },
      { id: 'q2', plan_cobro_id: PLAN, numero: 2, tipo: 'cuota', monto: 150000, fecha_vencimiento: '2026-10-30', concepto_detalle: 'S — periodo del 23/10/2026 al 22/11/2026' },
      { id: 'q3', plan_cobro_id: PLAN, numero: 3, tipo: 'cuota', monto: 200000, fecha_vencimiento: '2026-11-30', concepto_detalle: 'S — periodo del 23/11/2026 al 22/12/2026' },
    ],
    cobros: [
      { id: 'c1', negocio_id: 'neg-1', workspace_id: 'ws-metrik', plan_cobro_id: PLAN, numero_cuota: 1, monto: 150000, retencion_iva: 0, fecha: '2026-09-29', anulado_at: null },
      { id: 'c2', negocio_id: 'neg-1', workspace_id: 'ws-metrik', plan_cobro_id: PLAN, numero_cuota: 2, monto: 150000, retencion_iva: 0, fecha: null, anulado_at: null },
      { id: ANUAL, negocio_id: 'neg-1', workspace_id: 'ws-metrik', plan_cobro_id: PLAN, numero_cuota: null, monto: 1650000, retencion_iva: 0, fecha: '2026-10-10', anulado_at: null },
    ],
    licencias_adicionales_cargos: [
      { plan_cobro_cuota_id: 'q3', tipo: 'periodo', periodo_desde: '2026-11-23', periodo_hasta: '2026-12-22', dias: 30, dias_periodo: 30, monto: 50000, anulado_at: null },
    ],
    ...over,
  }
}

function conRpc(t: Tablas, respuesta: { data: unknown; error: unknown } = { data: 'activado', error: null }) {
  const d = crearDoble(t)
  const rpc = vi.fn(async () => respuesta)
  return { ...d, db: Object.assign(d.db, { rpc }) as typeof d.db, rpc }
}

describe('activarPlanAnualSiCorresponde', () => {
  it('un cobro que no es de un plan anual: nada', async () => {
    const d = conRpc(tablas())
    expect(await activarPlanAnualSiCorresponde(d.db, 'c1')).toEqual({ tipo: 'no_aplica' })
    expect(d.rpc).not.toHaveBeenCalled()
  })

  it('pide a la base lo que calcula el servidor: el enlace de octubre anulado, octubre en cero, noviembre con su usuario adicional', async () => {
    const d = conRpc(tablas())
    expect(await activarPlanAnualSiCorresponde(d.db, ANUAL)).toEqual({ tipo: 'activado', planAnualId: 'pa-1' })
    const [nombre, args] = d.rpc.mock.calls[0] as unknown as [string, { p_cambios: Record<string, unknown> }]
    expect(nombre).toBe('activar_plan_anual_cda')
    const c = args.p_cambios as {
      actualizar: { id: string; monto: number; monto_esperado: number }[]
      insertar: unknown[]
      anular_cobros: string[]
      cuota_anual: { numero: number; monto: number; fecha_vencimiento: string }
    }
    expect(c.actualizar.map((x) => [x.id, x.monto_esperado, x.monto])).toEqual([
      ['q2', 150000, 0],
      ['q3', 200000, 50000],
    ])
    expect(c.insertar).toHaveLength(10)
    expect(c.anular_cobros).toEqual(['c2'])
    expect(c.cuota_anual).toMatchObject({ numero: 14, monto: 1650000, fecha_vencimiento: '2026-10-09' })
  })

  it('pagado con una cuota vencida e impaga: no se activa, la elección pasa a revisión y no se llama a la base', async () => {
    const t = tablas()
    t.cobros = (t.cobros ?? []).map((c) => (c.id === 'c1' ? { ...c, fecha: null } : c))
    const d = conRpc(t)
    const r = await activarPlanAnualSiCorresponde(d.db, ANUAL)
    expect(r).toMatchObject({ tipo: 'requiere_revision', planAnualId: 'pa-1' })
    expect(d.rpc).not.toHaveBeenCalled()
    expect(d.tablas.planes_anuales_cda[0]).toMatchObject({ estado: 'requiere_revision' })
    expect(String(d.tablas.planes_anuales_cda[0].detalle)).toContain('2.2')
  })

  it('un plan ya activo: el reintento del webhook no hace nada', async () => {
    const t = tablas()
    t.planes_anuales_cda[0].estado = 'activo'
    const d = conRpc(t)
    expect(await activarPlanAnualSiCorresponde(d.db, ANUAL)).toEqual({ tipo: 'ya_activo', planAnualId: 'pa-1' })
    expect(d.rpc).not.toHaveBeenCalled()
  })

  it('si la base rechaza por una carrera (una cuota cambió), a revisión; si la base se cae, lanza para reintentar', async () => {
    const carrera = conRpc(tablas(), { data: null, error: { message: 'cuota_cambio: la cuota 2 (cuota 160000) cambió' } })
    expect(await activarPlanAnualSiCorresponde(carrera.db, ANUAL)).toMatchObject({ tipo: 'requiere_revision' })
    const caida = conRpc(tablas(), { data: null, error: { message: 'connection reset' } })
    await expect(activarPlanAnualSiCorresponde(caida.db, ANUAL)).rejects.toThrow(/connection reset/)
  })
})
