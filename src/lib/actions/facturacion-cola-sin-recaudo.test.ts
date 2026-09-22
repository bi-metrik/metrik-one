/**
 * La cola de facturación ya NO mira el recaudo: un caso se factura por sus datos, no
 * por lo que el cliente haya pagado.
 *
 * Decisión de Mauricio (2026-09-22). Del 2026-09-08 al 22 el honorario recaudado era
 * condición de entrada a la cola: tres estados (`cubierto`, `descuadre_menor`,
 * `retenido`), una banda del 1% y una sección propia para los retenidos, que no se
 * podían facturar. Desde el 22 la factura sale a crédito en cualquier momento, y la
 * cuenta por cobrar la cierran los abonos (`lib/siigo/abonos-factura.ts`).
 *
 * Lo que este archivo fija, del lado del SERVIDOR:
 *
 *   · un caso SIN un peso recaudado sale LISTO si tiene sus datos completos;
 *   · un caso a medio pagar y uno pagado completo cuentan igual en la bandeja;
 *   · lo único que saca a un caso de «listo» sigue siendo un dato del borrador.
 *
 * Cifras sembradas: honorario $637.500. V0406 (el retenido más cercano a la banda el
 * 2026-09-08) debía $50.000; V0224 la mitad; los 14 casos sin pago, el 100%.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RUT_COMPLETO, WS, reiniciarDoble, sembrar, servicioFalso } from '../../../test/cola-facturacion-doble'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
  createClient: async () => servicioFalso(),
}))

vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({
    workspaceId: WS, staffId: 'staff-diana', role: 'owner', areas: ['financiera'], supabase: null,
  }),
}))

vi.mock('@/lib/siigo/client', () => ({ siigoRequest: async () => ({ results: [] }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { getColaFacturacion } from './facturacion-actions'

const HONORARIO = 637_500

beforeEach(reiniciarDoble)

describe('cola de facturación — el recaudo no decide nada', () => {
  it('pagado completo, a medio pagar, debiendo $50.000 y sin un peso: los cuatro LISTOS', async () => {
    sembrar({
      casos: 4,
      recaudo: i => [HONORARIO, HONORARIO / 2, HONORARIO - 50_000, 0][i],
    })
    const { data, error } = await getColaFacturacion()
    expect(error).toBeUndefined()

    expect(data!.casos).toHaveLength(4)
    expect(data!.totales.listos).toBe(4)
    expect(data!.totales.incompletos).toBe(0)
    // Y el valor listo es el honorario COMPLETO de los cuatro: la factura no baja a lo
    // recaudado (el saldo queda en Siigo y lo cierran los abonos).
    expect(data!.totales.valor_listo).toBe(4 * HONORARIO)
  })

  it('la bandeja ya no trae el contador de retenidos', async () => {
    sembrar({ casos: 2, recaudo: () => 0 })
    const { data } = await getColaFacturacion()
    expect(Object.keys(data!.totales)).not.toContain('retenidos_por_recaudo')
  })

  it('CONTROL: un dato faltante sigue sacando al caso de «listo»', async () => {
    // Sin este caso, "los cuatro listos" podría deberse a que la cola ya no mira nada.
    const vacio: Record<string, { value: unknown }> = {}
    sembrar({
      casos: 2,
      recaudo: () => HONORARIO,
      rut: i => (i === 0 ? vacio : RUT_COMPLETO),
    })
    const { data } = await getColaFacturacion()
    expect(data!.totales.listos).toBe(1)
    expect(data!.totales.incompletos).toBe(1)
    const sinRut = data!.casos.find(c => c.sin_rut)!
    expect(sinRut.codigo).toBe('V0000')
  })

  it('un ya facturado sigue fuera de los pendientes, deba o no deba', async () => {
    sembrar({
      casos: 2,
      recaudo: () => 0,
      metadata: i => (i === 0 ? { siigo_factura: { numero: 'FV-2-600', siigo_id: 'x', total: HONORARIO } } : {}),
    })
    const { data } = await getColaFacturacion()
    expect(data!.totales.ya_facturados).toBe(1)
    expect(data!.totales.listos).toBe(1)
  })
})
