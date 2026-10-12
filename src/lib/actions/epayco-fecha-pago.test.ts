/**
 * SOE-013: el pago que queda en el bloque «Pagos» guarda la fecha del PAGO en ePayco,
 * la misma del cobro, no el día en que alguien lo registró en ONE.
 *
 * El caso real: V0136, ref 386159602. Pagado el 16-sep por la noche (hora Bogotá) y
 * registrado el 17-sep: el bloque decía 17 y el cobro 16. Aquí «hoy» es el 17 y ePayco
 * devuelve el 16 a las 20:15, que en UTC ya es 17: si la conversión o la fuente fallan,
 * la prueba lo ve.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { estado, reiniciarDoble, servicioFalso, filas } from '../../../test/redistribucion-doble'
import type { EpaycoDesglose } from '@/lib/epayco'

const WS = 'ws-soena'
const HOY = '2026-09-17'

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: servicioFalso(), workspaceId: WS, error: null }),
}))
vi.mock('@/lib/epayco', () => ({ consultarTransaccionEpayco: async () => ({ estado: 'Aceptada' }) }))
vi.mock('@/lib/siigo/segundo-plano', () => ({ alRegistrarCobroEnSegundoPlano: async () => null }))
vi.mock('@/lib/cobros/aviso-sobrepago-servidor', () => ({ avisarSobrepagoSiCorresponde: async () => null }))
vi.mock('@/lib/modulos/exigir-modulo', async () =>
  (await import('../../../test/exigir-modulo-doble')).dobleExigirModulo())
vi.mock('@/lib/dates/bogota', async (original) => ({
  ...(await original<typeof import('@/lib/dates/bogota')>()),
  todayBogotaISO: () => HOY,
}))

import { registrarPagoEpayco } from './epayco-actions'
import { MODULES, reiniciarModulo } from '../../../test/exigir-modulo-doble'

function desglose(fecha: string): EpaycoDesglose {
  return {
    ref_payco: 386159602,
    monto_bruto: 1_339_312,
    comision: 30_000,
    iva_comision: 5_700,
    retefuente: 0,
    reteica: 0,
    total_descuentos: 35_700,
    monto_neto: 1_303_612,
    franquicia: 'PSE',
    banco: 'Bancolombia',
    estado: 'Aceptada',
    fecha,
    factura: 'V0136',
    pagador_nombre: 'Pagador de prueba',
    pagador_documento: '1',
    pagador_email: 'p@ejemplo.co',
  }
}

const pagosDelBloque = () =>
  ((filas('negocio_bloques')[0]?.data as { pagos?: Array<{ fecha: string }> }).pagos ?? [])

beforeEach(() => {
  reiniciarDoble()
  reiniciarModulo(WS, MODULES.soena)
  estado.fixtures.negocio_bloques = [{ id: 'nb-1', data: { pagos: [] } }]
})

describe('registrarPagoEpayco guarda en el bloque la fecha del pago (SOE-013)', () => {
  it('un pago nuevo guarda la fecha de ePayco, igual a la del cobro, no la del registro', async () => {
    const r = await registrarPagoEpayco('nb-1', 'n-v0136', desglose('2026-09-16 20:15:00'), 'pago')
    expect(r.success).toBe(true)
    expect(filas('cobros')[0]?.fecha).toBe('2026-09-16')
    expect(pagosDelBloque()[0]?.fecha).toBe('2026-09-16')
    if (r.success) expect(r.pagos[0]?.fecha).toBe('2026-09-16')
  })

  it('si ePayco no da una fecha legible, bloque y cobro caen en el día del registro, los dos igual', async () => {
    const r = await registrarPagoEpayco('nb-1', 'n-v0136', desglose('sin fecha'), 'pago')
    expect(r.success).toBe(true)
    expect(filas('cobros')[0]?.fecha).toBe(HOY)
    expect(pagosDelBloque()[0]?.fecha).toBe(HOY)
  })

  it('si el cobro ya existía, el bloque toma la fecha de ESE cobro', async () => {
    estado.fixtures.cobros = [
      { id: 'c-1', workspace_id: WS, negocio_id: 'n-v0136', external_ref: '386159602', fecha: '2026-09-10' },
    ]
    const r = await registrarPagoEpayco('nb-1', 'n-v0136', desglose('2026-09-16 20:15:00'), 'pago')
    expect(r.success).toBe(true)
    expect(filas('cobros')).toHaveLength(1)
    expect(pagosDelBloque()[0]?.fecha).toBe('2026-09-10')
  })
})
