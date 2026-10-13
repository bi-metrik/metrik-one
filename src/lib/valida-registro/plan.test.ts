import { describe, expect, it } from 'vitest'
import {
  abreCiclo,
  cicloDeCuota,
  configConPlan,
  esEspacioAutogestion,
  limiteConsultasMes,
  parametrosDelPlan,
  planDeConfig,
  referenciaCiclo,
  type PlanAbierto,
} from './plan'

describe('el límite de consultas del mes', () => {
  it('3.000 fijo: ni el contrato ni el entorno lo cambian (fila 23 de Vera)', () => {
    expect(limiteConsultasMes()).toBe(3000)
  })
})

describe('los parámetros con que nace el contrato', () => {
  it('$150.000, 2 usuarios, sin trial (la prueba ya pasó) y 3.000 consultas', () => {
    expect(parametrosDelPlan()).toEqual({ precio_mensual: 150_000, licencias: 2, dias_trial: 0, limite_consultas_mes: 3000 })
  })
})

describe('el ciclo que abre una cuota pagada', () => {
  const ahora = new Date('2026-10-20T15:00:00Z')
  it('el período empieza el día del vencimiento y la bolsa vence al terminar + 5 días de gracia, medianoche de Bogotá', () => {
    expect(cicloDeCuota('2026-10-18', ahora)).toEqual({
      desde: '2026-10-18',
      hasta: '2026-11-17',
      venceEn: '2026-11-23T05:00:00.000Z',
    })
  })
  it('el 31 no salta de mes', () => {
    expect(cicloDeCuota('2027-01-31', ahora)).toMatchObject({ desde: '2027-01-31', hasta: '2027-02-27', venceEn: '2027-03-05T05:00:00.000Z' })
  })
  it('un pago tan tardío que el ciclo ya terminó no abre una bolsa vencida: dura un día', () => {
    const tarde = new Date('2027-03-01T12:00:00Z')
    expect(cicloDeCuota('2026-10-18', tarde).venceEn).toBe('2027-03-02T12:00:00.000Z')
  })
})

describe('qué pago abre ciclo', () => {
  const plan: PlanAbierto = {
    cliente_id: 'c',
    limite_mes: 3000,
    cobro_id: 'cobro-2',
    cuota_numero: 2,
    desde: '2026-11-18',
    hasta: '2026-12-17',
    vence_en: '2026-12-23T05:00:00.000Z',
    abierto_at: '2026-11-18T10:00:00.000Z',
  }
  it('sin ciclo abierto, el primero', () => {
    expect(abreCiclo({ cuotaNumero: 1, planActual: null })).toBe(true)
  })
  it('solo una cuota más nueva que la abierta: la misma o una vieja pagada tarde no reabre', () => {
    expect(abreCiclo({ cuotaNumero: 3, planActual: plan })).toBe(true)
    expect(abreCiclo({ cuotaNumero: 2, planActual: plan })).toBe(false)
    expect(abreCiclo({ cuotaNumero: 1, planActual: plan })).toBe(false)
  })
  it('config_extra pierde la prueba (la llave ya no vence) y gana el plan', () => {
    const antes = { modo_vitrina: true, origen_registro: 'valida_autogestion', valida_prueba: { cliente_id: 'c' }, valida_cliente_id: 'c' }
    const despues = configConPlan(antes, plan)
    expect(despues).not.toHaveProperty('valida_prueba')
    expect(despues).toMatchObject({ modo_vitrina: true, origen_registro: 'valida_autogestion', valida_cliente_id: 'c', valida_plan: plan })
    expect(planDeConfig(despues)).toEqual(plan)
    expect(planDeConfig({ valida_plan: { cliente_id: 'c' } })).toBeNull()
  })
  it('la referencia cumple el patrón que exige Valida (one-ciclo:)', () => {
    expect(referenciaCiclo('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toMatch(/^one-(ciclo|negocio):[A-Za-z0-9._:-]{1,60}$/)
  })
  it('solo los espacios del registro autogestionado', () => {
    expect(esEspacioAutogestion({ origen_registro: 'valida_autogestion' })).toBe(true)
    expect(esEspacioAutogestion({ modo_vitrina: true })).toBe(false)
    expect(esEspacioAutogestion(null)).toBe(false)
  })
})
