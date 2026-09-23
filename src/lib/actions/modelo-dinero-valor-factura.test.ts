/**
 * `leerModeloDineroCompleto` lee la tarifa UPME de referencia desde la Factura cuando
 * el negocio no tiene bloque de confirmación (negocios anteriores a ese bloque).
 *
 * Esa lectura hacía `Number(valor.replace(/[^\d.-]/g, ''))`, que conserva el punto de
 * miles: «$ 98.500.000» daba NaN, el negocio se quedaba sin tarifa de referencia y
 * Cobros la mostraba en cero. Ahora pasa por `valorSinIvaDeFactura`.
 *
 * El doble responde por los filtros que la función de verdad usa, así que cada
 * consulta recibe lo que recibiría de la base.
 */
import { describe, it, expect, vi } from 'vitest'
import { calcularTarifaUpmePorAnio } from '@/lib/upme/tarifa'

// Lo que arrastra el módulo y no se ejercita aquí.
vi.mock('./get-workspace', () => ({ getWorkspace: async () => ({ workspaceId: null }) }))
vi.mock('@/app/(app)/negocios/negocio-v2-actions', () => ({
  recalcularNegocioPorCambioDeRecaudo: async () => ({ gates_reabiertos: 0 }),
  cambiarEtapaNegocio: async () => ({ error: null }),
}))
vi.mock('@/lib/activity/registrar-actividad', () => ({ registrarActividad: async () => ({ error: null }) }))
vi.mock('@/lib/epayco', () => ({ consultarTransaccionEpayco: async () => null }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { leerModeloDineroCompleto } from './conciliacion-actions'

type Fila = { data: Record<string, unknown> | null }

/** Cliente que contesta cada una de las cuatro lecturas de la función. */
function clienteFalso(facturas: Fila[]) {
  return {
    from() {
      const filtros: Record<string, unknown> = {}
      const cadena = {
        select: () => cadena,
        eq: (campo: string, valor: unknown) => {
          filtros[campo] = valor
          return cadena
        },
        then: (resolve: (r: { data: Fila[]; error: null }) => unknown) => {
          // Propuesta aprobada, bloque de confirmación y servicio contratado: vacíos,
          // para que la única fuente de la tarifa sea la Factura.
          const data = filtros['bloque_configs.slug'] === 'factura_venta_vehiculo' ? facturas : []
          return resolve({ data, error: null })
        },
      }
      return cadena
    },
  }
}

const factura = (valor: unknown): Fila => ({
  data: { campos: { valor_unitario_sin_iva: { value: valor } } },
})

describe('leerModeloDineroCompleto — tarifa de referencia desde la Factura', () => {
  it('«$ 98.500.000» da la tarifa de 98,5 millones (antes: NaN y ninguna tarifa)', async () => {
    const modelo = await leerModeloDineroCompleto(clienteFalso([factura('$ 98.500.000')]), 'neg-1')
    expect(modelo?.tarifa_upme_ref).toBe(calcularTarifaUpmePorAnio(98500000))
  })

  it('«98.500.000,00», con coma decimal, también (antes: NaN)', async () => {
    const modelo = await leerModeloDineroCompleto(clienteFalso([factura('98.500.000,00')]), 'neg-1')
    expect(modelo?.tarifa_upme_ref).toBe(calcularTarifaUpmePorAnio(98500000))
  })

  // CONTROL: el valor limpio que deja el extractor da lo mismo que antes.
  it('el valor sin separadores no cambia', async () => {
    const modelo = await leerModeloDineroCompleto(clienteFalso([factura('98500000')]), 'neg-1')
    expect(modelo?.tarifa_upme_ref).toBe(calcularTarifaUpmePorAnio(98500000))
  })

  it('sin valor legible no hay tarifa ni modelo', async () => {
    expect(await leerModeloDineroCompleto(clienteFalso([factura('')]), 'neg-1')).toBeNull()
    expect(await leerModeloDineroCompleto(clienteFalso([]), 'neg-1')).toBeNull()
  })
})
