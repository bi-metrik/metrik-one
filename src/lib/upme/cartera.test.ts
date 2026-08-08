import { describe, it, expect } from 'vitest'
import {
  tarifaEsCartera,
  valorARecaudarCartera,
  valorARecaudar,
  type ContextoCartera,
  type ModeloDinero,
} from './modelo-dinero'

// La tarifa UPME se confirma en Validación, mucho antes de que exista una propuesta
// aprobada. Sin este criterio, un negocio recién entrado al pipeline aparece debiendo
// una tarifa que nadie le ha cotizado: eso no es cartera, es ruido para quien cobra.

const HONORARIO = 637_500
const TARIFA = 701_812
const modelo: ModeloDinero = { tarifa_upme: TARIFA, aprobado_plan: null, aprobado_honorario: null }

const ctx = (over: Partial<ContextoCartera> = {}): ContextoCartera => ({
  recaudado: 0,
  ceroDeliberado: false,
  honorarioAprobado: null,
  ...over,
})

describe('tarifaEsCartera', () => {
  it('sin monto aprobado y sin un solo peso recaudado → NO es cartera', () => {
    // El caso que llena la pestaña de ruido: 26 negocios en etapa Propuesta.
    expect(tarifaEsCartera(ctx())).toBe(false)
    expect(tarifaEsCartera(ctx({ honorarioAprobado: 0 }))).toBe(false)
  })

  it('con honorario aprobado → SÍ es cartera aunque no haya pagado nada', () => {
    expect(tarifaEsCartera(ctx({ honorarioAprobado: HONORARIO }))).toBe(true)
  })

  it('con plata recaudada → SÍ es cartera aunque no haya propuesta aprobada', () => {
    // Si alguien ya pagó, hay plata real en juego: esconderla es peor que el ruido
    // que estamos quitando.
    expect(tarifaEsCartera(ctx({ recaudado: 1 }))).toBe(true)
    expect(tarifaEsCartera(ctx({ recaudado: 350_906 }))).toBe(true)
  })

  it('cero deliberado (propuesta APROBADA en 0) → SÍ es cartera', () => {
    // Una propuesta aprobada cuyo honorario final es 0 sigue siendo una propuesta
    // aprobada: si le queda tarifa por recaudar, eso es cartera legítima.
    expect(tarifaEsCartera(ctx({ ceroDeliberado: true }))).toBe(true)
    expect(tarifaEsCartera(ctx({ honorarioAprobado: 0, ceroDeliberado: true }))).toBe(true)
  })

  it('recaudo inválido o negativo no cuenta como plata en juego', () => {
    expect(tarifaEsCartera(ctx({ recaudado: -100 }))).toBe(false)
    expect(tarifaEsCartera(ctx({ recaudado: Number.NaN }))).toBe(false)
  })

  it('honorario aprobado negativo no cuenta como monto aprobado', () => {
    expect(tarifaEsCartera(ctx({ honorarioAprobado: -1 }))).toBe(false)
  })
})

describe('valorARecaudarCartera', () => {
  it('sin cartera → deja la tarifa por fuera, queda solo el honorario', () => {
    expect(valorARecaudarCartera(0, modelo, ctx())).toBe(0)
    expect(valorARecaudarCartera(120_000, modelo, ctx())).toBe(120_000)
  })

  it('con cartera → idéntico a valorARecaudar', () => {
    const c = ctx({ honorarioAprobado: HONORARIO })
    expect(valorARecaudarCartera(HONORARIO, modelo, c)).toBe(valorARecaudar(HONORARIO, modelo))
    expect(valorARecaudarCartera(HONORARIO, modelo, c)).toBe(HONORARIO + TARIFA)
  })

  it('INVARIANTE: con recaudo > 0 nunca difiere de valorARecaudar', () => {
    // Es lo que garantiza que este criterio NO puede mover sobrepagos ni el badge:
    // un sobrepago exige un cobro, y con cobro las dos funciones coinciden.
    for (const honorario of [0, 1, 120_000, HONORARIO, 5_000_000]) {
      for (const recaudado of [1, 1_000, 988_406, 99_000_000]) {
        const c = ctx({ recaudado })
        expect(valorARecaudarCartera(honorario, modelo, c)).toBe(valorARecaudar(honorario, modelo))
      }
    }
  })

  it('sin tarifa confirmada, el criterio no cambia nada', () => {
    expect(valorARecaudarCartera(HONORARIO, null, ctx())).toBe(valorARecaudar(HONORARIO, null))
    expect(valorARecaudarCartera(HONORARIO, null, ctx({ recaudado: 10 }))).toBe(HONORARIO)
  })

  it('cero deliberado sin pagos conserva la tarifa como cartera', () => {
    expect(valorARecaudarCartera(0, modelo, ctx({ ceroDeliberado: true }))).toBe(TARIFA)
  })
})
