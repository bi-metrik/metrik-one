/**
 * Pliegue de los rubros de viaje (Vera X12): solo con `servicios_viaje.activo` en la línea.
 *
 * VISTO FALLAR (2026-10-12): plegando siempre cae «apagado sale como hoy» (1); sin el pliegue
 * caen «encendido» y «el pago cuenta contra el cubo» (2); sin `servicios_prof` en el mapa de
 * `proveedor_viaje` cae «cotización vieja» (1).
 */
import { describe, expect, it } from 'vitest'
import {
  asignarEjecutadoPorRubro,
  calcularPresupuestoPorRubro,
  tipoRubroMedible,
  totalPresupuestado,
  TIPO_RUBRO_PROVEEDOR_VIAJE,
} from './presupuesto-ejecucion'

const vuelo = {
  cantidad: 2,
  subtotal: 0,
  rubros: [
    { tipo: 'tarifa', valor_total: 800_000 },
    { tipo: 'impuestos', valor_total: 150_000 },
    { tipo: 'fee_proveedor', valor_total: 50_000 },
  ],
}
const hotel = { cantidad: 1, subtotal: 0, rubros: [{ tipo: 'tarifa', valor_total: 1_100_000 }, { tipo: 'materiales', valor_total: 10_000 }] }

describe('pliegue de los rubros de viaje', () => {
  it('apagado (o sin opción) sale como hoy: un rubro por tipo, sin barra para los de viaje', () => {
    const hoy = calcularPresupuestoPorRubro([vuelo, hotel])
    expect(hoy.map(r => r.tipo).sort()).toEqual(['fee_proveedor', 'impuestos', 'materiales', 'tarifa'])
    expect(calcularPresupuestoPorRubro([vuelo, hotel], { plegarViaje: false })).toEqual(hoy)
    expect(tipoRubroMedible('tarifa')).toBe(false)
  })

  it('encendido: tarifa, impuestos y fee se pliegan en un cubo; lo demás no se toca', () => {
    const plegado = calcularPresupuestoPorRubro([vuelo, hotel], { plegarViaje: true })
    expect(plegado).toEqual([
      { tipo: TIPO_RUBRO_PROVEEDOR_VIAJE, nombre: TIPO_RUBRO_PROVEEDOR_VIAJE, total: 2_000_000 + 1_100_000 },
      { tipo: 'materiales', nombre: 'materiales', total: 10_000 },
    ])
    // Plegar no mueve un peso.
    expect(totalPresupuestado(plegado)).toBe(totalPresupuestado(calcularPresupuestoPorRubro([vuelo, hotel])))
  })

  it('el pago a un proveedor del viaje (y la cortesía) cuenta contra el cubo plegado, con barra', () => {
    const presupuesto = calcularPresupuestoPorRubro([vuelo, hotel], { plegarViaje: true })
    const r = asignarEjecutadoPorRubro({
      presupuesto,
      gastosPorCategoria: [{ categoria: 'proveedor_viaje', total: 1_800_000 }, { categoria: 'cortesia_viaje', total: 50_000 }],
      costoHoras: 0,
    })
    expect(r.rubros.find(x => x.tipo === TIPO_RUBRO_PROVEEDOR_VIAJE)?.ejecutado).toBe(1_850_000)
    expect(r.sinPresupuesto.total).toBe(0)
    expect(tipoRubroMedible(TIPO_RUBRO_PROVEEDOR_VIAJE)).toBe(true)
  })

  it('cotización vieja con el costo en «servicios_prof»: el pago cuenta ahí, no cae a «Sin presupuesto»', () => {
    const r = asignarEjecutadoPorRubro({
      presupuesto: [{ tipo: 'servicios_prof', nombre: 'servicios_prof', total: 900_000 }],
      gastosPorCategoria: [{ categoria: 'proveedor_viaje', total: 900_000 }],
      costoHoras: 0,
    })
    expect(r.rubros[0].ejecutado).toBe(900_000)
    expect(r.sinPresupuesto.total).toBe(0)
  })
})
