/**
 * Tableros genéricos (Financiero, Comercial, Operativo) y las bandejas operativas con el negocio
 * de prueba (F8-1): no suma ni aparece para el staff real; para quien lo lleva, sí.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dobleFiltrante, type Fila } from '../../../../test/doble-filtrante'
import { todayBogotaISO } from '@/lib/dates/bogota'

const WS = 'ws-trappvel'
let tablas: Record<string, Fila[]>
const sesion = vi.hoisted(() => ({ staffId: 's-edgar' }))

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: dobleFiltrante(() => tablas), workspaceId: WS, staffId: sesion.staffId, role: 'owner', areas: [] }),
}))

const { getFinancieroData, getComercialData, getOperativoData } = await import('./actions')
const { getBandejasOperativas } = await import('./bandejas-actions')

const HOY = todayBogotaISO()

beforeEach(() => {
  sesion.staffId = 's-edgar'
  tablas = {
    negocios: [
      { id: 'real', workspace_id: WS, codigo: 'R', nombre: 'Real', estado: 'abierto', stage_actual: 'venta', precio_estimado: 1_000_000, precio_aprobado: null, created_at: HOY, updated_at: HOY, metadata: {} },
      {
        id: 'prueba', workspace_id: WS, codigo: 'P', nombre: 'PRUEBA', estado: 'abierto', stage_actual: 'venta', precio_estimado: 4_052_000, precio_aprobado: null,
        created_at: HOY, updated_at: HOY, linea_id: 'l-clon', metadata: { es_prueba: true }, negocio_responsables: [{ staff_id: 's-cp' }],
      },
      { id: 'real-e', workspace_id: WS, codigo: 'RE', nombre: 'Real E', estado: 'abierto', stage_actual: 'ejecucion', precio_aprobado: 2_000_000, created_at: HOY, updated_at: HOY, metadata: {} },
      { id: 'prueba-e', workspace_id: WS, codigo: 'PE', nombre: 'PRUEBA E', estado: 'abierto', stage_actual: 'ejecucion', precio_aprobado: 9_000_000, created_at: HOY, updated_at: HOY, linea_id: 'l-clon', metadata: { es_prueba: true }, negocio_responsables: [{ staff_id: 's-cp' }] },
    ],
    cobros: [
      { id: 'c1', workspace_id: WS, negocio_id: 'real', monto: 100_000, fecha: HOY, tipo_cobro: 'pago' },
      { id: 'c2', workspace_id: WS, negocio_id: 'prueba', monto: 1_216_000, fecha: HOY, tipo_cobro: 'pago' },
    ],
    gastos: [
      { id: 'g1', workspace_id: WS, negocio_id: 'real', monto: 10_000, fecha: HOY, categoria: 'otros', estado_pago: 'pendiente', soporte_pendiente: true },
      { id: 'g2', workspace_id: WS, negocio_id: 'prueba', monto: 1_800_000, fecha: HOY, categoria: 'otros', estado_pago: 'pendiente', soporte_pendiente: true },
    ],
    v_cartera_negocio: [
      { workspace_id: WS, negocio_id: 'real', codigo: 'R', nombre: 'Real', honorario: 500_000, honorario_recaudado: 0, saldo: 500_000, dias: 40, con_cronograma: false, saldo_vencido: null, dias_mora: null },
      { workspace_id: WS, negocio_id: 'prueba', codigo: 'P', nombre: 'PRUEBA', honorario: 2_836_000, honorario_recaudado: 0, saldo: 2_836_000, dias: 40, con_cronograma: false, saldo_vencido: null, dias_mora: null },
    ],
    lineas_negocio: [{ id: 'l-clon', workspace_id: WS, config_extra: { aprobaciones: { staff_ids: ['s-dp'] } } }],
  }
})

describe('Financiero (F8-1)', () => {
  it('cobros, gastos y cartera del negocio de prueba no suman para el staff real', async () => {
    const f = (await getFinancieroData('6meses'))!
    expect(f.totalCarteraCobrar).toBe(500_000)
    expect(f.totalGastosPorPagar).toBe(10_000)
    expect(f.flujoNeto).toBe(90_000)
  })
  it('para quien lo lleva, sí', async () => {
    sesion.staffId = 's-cp'
    const f = (await getFinancieroData('6meses'))!
    expect(f.totalCarteraCobrar).toBe(3_336_000)
    expect(f.flujoNeto).toBe(100_000 + 1_216_000 - 10_000 - 1_800_000)
  })
})

describe('Comercial (F8-1)', () => {
  it('el embudo y el recaudo no cuentan el negocio de prueba para el staff real', async () => {
    const c = (await getComercialData('mes'))!
    expect(c.recaudoMes).toBe(100_000)
    expect(c.pipeline.find(p => p.count > 0 && p.valor === 1_000_000)).toBeTruthy()
    expect(c.pipeline.reduce((s, p) => s + p.count, 0)).toBe(2)
  })
  it('la dirección de prueba (aprobadora del clon) sí lo cuenta', async () => {
    sesion.staffId = 's-dp'
    const c = (await getComercialData('mes'))!
    expect(c.recaudoMes).toBe(1_316_000)
    expect(c.pipeline.reduce((s, p) => s + p.count, 0)).toBe(4)
  })
})

describe('Operativo (F8-1)', () => {
  it('el negocio de prueba no es un proyecto activo para el staff real', async () => {
    expect((await getOperativoData('mes'))!.proyectosActivos).toBe(1)
    sesion.staffId = 's-cp'
    expect((await getOperativoData('mes'))!.proyectosActivos).toBe(2)
  })
})

describe('Bandejas operativas (F8-1)', () => {
  const idsEn = (b: unknown) => JSON.stringify(b)
  const entradas = (b: Awaited<ReturnType<typeof getBandejasOperativas>>) =>
    b!.bandejas.comercial.contexto.find(c => c.etiqueta === 'Entradas de la semana')!.valor
  it('el negocio de prueba y su gasto no entran a las bandejas del staff real', async () => {
    const b = await getBandejasOperativas()
    expect(idsEn(b)).not.toContain('PRUEBA')
    expect(idsEn(b)).not.toContain('g2')
    expect(entradas(b)).toBe(2)
  })
  it('sí a las de quien lo lleva', async () => {
    sesion.staffId = 's-cp'
    const b = await getBandejasOperativas()
    expect(idsEn(b)).toContain('PRUEBA')
    expect(entradas(b)).toBe(4)
  })
})
