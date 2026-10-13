/**
 * /conciliacion y el negocio de prueba (F8-1): ni sus pagos ni su saldo entran al panel de la
 * financiera real; quien lo lleva sí los ve.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dobleFiltrante, type Fila } from '../../../test/doble-filtrante'

const WS = 'ws-trappvel'
let tablas: Record<string, Fila[]>
const sesion = vi.hoisted(() => ({ staffId: 's-financiera' }))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: dobleFiltrante(() => tablas), workspaceId: WS, userId: 'p-x', staffId: sesion.staffId, role: 'owner', areas: ['financiera'],
  }),
}))

const { getConciliacionV2 } = await import('./conciliacion-actions')

function negocio(id: string, extra: Fila = {}): Fila {
  return {
    id, workspace_id: WS, codigo: id.toUpperCase(), nombre: `Viaje ${id}`, precio_aprobado: 4_000_000, precio_estimado: null,
    estado: 'abierto', stage_actual: 'cobro', created_at: '2026-10-01', etapas_negocio: { nombre: 'Cobro', orden: 5 }, empresas: null, ...extra,
  }
}

beforeEach(() => {
  sesion.staffId = 's-financiera'
  tablas = {
    negocios: [
      negocio('real'),
      negocio('prueba', { metadata: { es_prueba: true }, linea_id: 'l-clon', negocio_responsables: [{ staff_id: 's-cp' }] }),
    ],
    cobros: [
      { id: 'c-real', workspace_id: WS, negocio_id: 'real', monto: 1_000_000, tipo_cobro: 'pago', external_ref: 'REF-REAL', fecha: '2026-10-10', split_json: null, anulado_at: null },
      { id: 'c-prueba', workspace_id: WS, negocio_id: 'prueba', monto: 1_216_000, tipo_cobro: 'pago', external_ref: 'REF-PRUEBA', fecha: '2026-10-12', split_json: null, anulado_at: null },
    ],
    lineas_negocio: [{ id: 'l-clon', workspace_id: WS, config_extra: {} }],
  }
})

const referencias = async () => (await getConciliacionV2()).data!.referencias.map((r) => r.external_ref).sort()
const negociosDelPanel = async () => {
  const { data } = await getConciliacionV2()
  return [...data!.saldos, ...data!.conciliados, ...data!.negociosConSaldo].map((n) => n.negocio_id)
}

describe('getConciliacionV2 y el negocio de prueba (F8-1)', () => {
  it('la financiera real no ve su pago ni su saldo', async () => {
    expect(await referencias()).toEqual(['REF-REAL'])
    expect(await negociosDelPanel()).not.toContain('prueba')
    expect(await negociosDelPanel()).toContain('real')
  })

  it('quien lo lleva sí', async () => {
    sesion.staffId = 's-cp'
    expect(await referencias()).toEqual(['REF-PRUEBA', 'REF-REAL'])
    expect(await negociosDelPanel()).toContain('prueba')
  })
})
