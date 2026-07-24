import { describe, it, expect } from 'vitest'
import {
  valorARecaudar,
  repartirPagoTarifaHonorario,
  tipoCobroHonorario,
  saldoEsperadoPorModalidad,
  umbralRecaudoHandoff,
  calcularPendienteHandoff,
  esCeroDeliberado,
  TOLERANCIA_SALDO_COP,
  type ModeloDinero,
  type PropuestaBloqueData,
} from './modelo-dinero'

// precio_aprobado del negocio = HONORARIO. La tarifa (pasante) vive aparte, en el
// modelo. valor_a_recaudar = honorario + tarifa.
const HONORARIO = 3_000_000
const TARIFA = 1_200_000
const modelo = (over: Partial<ModeloDinero>): ModeloDinero => ({
  tarifa_upme: TARIFA,
  aprobado_plan: 1,
  aprobado_honorario: HONORARIO,
  ...over,
})

describe('valorARecaudar — honorario (precio_aprobado) + tarifa (pasante)', () => {
  it('suma honorario + tarifa confirmada', () => {
    expect(valorARecaudar(HONORARIO, modelo({}))).toBe(4_200_000)
  })
  it('sin tarifa confirmada (0) → valor a recaudar = honorario', () => {
    expect(valorARecaudar(HONORARIO, modelo({ tarifa_upme: 0 }))).toBe(HONORARIO)
  })
  it('sin modelo → valor a recaudar = honorario (no asume tarifa)', () => {
    expect(valorARecaudar(HONORARIO, null)).toBe(HONORARIO)
  })
  it('tarifa negativa o NaN se trata como 0 (no resta al honorario)', () => {
    expect(valorARecaudar(HONORARIO, modelo({ tarifa_upme: -50 as number }))).toBe(HONORARIO)
    expect(valorARecaudar(HONORARIO, modelo({ tarifa_upme: Number.NaN }))).toBe(HONORARIO)
  })
  it('honorario inválido → 0 + tarifa', () => {
    expect(valorARecaudar(0, modelo({}))).toBe(TARIFA)
    expect(valorARecaudar(Number.NaN, modelo({}))).toBe(TARIFA)
  })
  it('redondea a peso', () => {
    expect(valorARecaudar(1_000_000.4, modelo({ tarifa_upme: 500_000.4 }))).toBe(1_500_001)
  })
})

describe('repartirPagoTarifaHonorario — la tarifa se cubre primero', () => {
  it('pago > tarifa → pasante = tarifa, honorario = resto', () => {
    const r = repartirPagoTarifaHonorario(4_200_000, 1_200_000)
    expect(r.monto_pasante).toBe(1_200_000)
    expect(r.monto_honorario).toBe(3_000_000)
  })
  it('pago = tarifa → todo pasante, honorario 0', () => {
    const r = repartirPagoTarifaHonorario(1_200_000, 1_200_000)
    expect(r.monto_pasante).toBe(1_200_000)
    expect(r.monto_honorario).toBe(0)
  })
  it('SIN BARRERAS: pago < tarifa → pasante toma todo el pago, honorario 0 (no rechaza)', () => {
    const r = repartirPagoTarifaHonorario(800_000, 1_200_000)
    expect(r.monto_pasante).toBe(800_000)
    expect(r.monto_honorario).toBe(0)
  })
  it('50/50: 1er pago = tarifa completa + 50% honorario', () => {
    // honorario 3M, tarifa 1.2M. 1er pago (anticipo) = 1.2M + 1.5M = 2.7M
    const r = repartirPagoTarifaHonorario(2_700_000, 1_200_000)
    expect(r.monto_pasante).toBe(1_200_000)   // tarifa completa primero
    expect(r.monto_honorario).toBe(1_500_000) // 50% del honorario de 3M
  })
  it('sin tarifa (0) → todo honorario', () => {
    const r = repartirPagoTarifaHonorario(3_000_000, 0)
    expect(r.monto_pasante).toBe(0)
    expect(r.monto_honorario).toBe(3_000_000)
  })
})

describe('tipoCobroHonorario — según modalidad', () => {
  it('plan 1 (50/50) → anticipo', () => {
    expect(tipoCobroHonorario(1)).toBe('anticipo')
  })
  it('plan 2 (único) → pago', () => {
    expect(tipoCobroHonorario(2)).toBe('pago')
  })
  it('sin modalidad → pago', () => {
    expect(tipoCobroHonorario(null)).toBe('pago')
  })
})

describe('saldoEsperadoPorModalidad — 50/50 espera el 2º 50% del honorario', () => {
  it('50/50 → saldo esperado = 50% del honorario (NO descuadre)', () => {
    expect(saldoEsperadoPorModalidad(modelo({}))).toBe(1_500_000)
  })
  it('único (plan 2) → saldo esperado 0', () => {
    expect(saldoEsperadoPorModalidad(modelo({ aprobado_plan: 2 }))).toBe(0)
  })
  it('sin modelo → 0', () => {
    expect(saldoEsperadoPorModalidad(null)).toBe(0)
  })
  it('50/50 sin honorario conocido → 0 (no oculta faltante real)', () => {
    expect(saldoEsperadoPorModalidad(modelo({ aprobado_honorario: null }))).toBe(0)
  })
})

describe('escenario integrado 50/50: valor a recaudar, reparto y descuadre', () => {
  it('el descuadre = 0 cuando solo falta el 2º 50% esperado', () => {
    const m = modelo({}) // honorario 3M, tarifa 1.2M, plan 1
    const valorRecaudar = valorARecaudar(HONORARIO, m) // 4.2M
    // 1er pago 50/50: tarifa completa + 50% honorario = 2.7M
    const primerPago = TARIFA + HONORARIO * 0.5
    const cobrado = primerPago
    const diferencia = valorRecaudar - cobrado          // 1.5M pendiente
    const esperado = saldoEsperadoPorModalidad(m)       // 1.5M esperado
    const descuadre = diferencia - esperado             // 0 → NO es descuadre
    expect(descuadre).toBe(0)
  })
})

describe('umbralRecaudoHandoff — valor a recaudar menos saldo diferido', () => {
  it('Plan 1 (50/50) → tarifa + 50% honorario', () => {
    expect(umbralRecaudoHandoff(HONORARIO, modelo({ aprobado_plan: 1 }))).toBe(TARIFA + HONORARIO * 0.5) // 2.7M
  })
  it('Plan 2 (único) → valor a recaudar completo (tarifa + 100% honorario)', () => {
    expect(umbralRecaudoHandoff(HONORARIO, modelo({ aprobado_plan: 2 }))).toBe(4_200_000)
  })
  it('sin modelo → umbral = honorario (no difiere nada, no asume tarifa)', () => {
    expect(umbralRecaudoHandoff(HONORARIO, null)).toBe(HONORARIO)
  })
  it('honorario inválido → 0', () => {
    expect(umbralRecaudoHandoff(0, null)).toBe(0)
    expect(umbralRecaudoHandoff(Number.NaN, null)).toBe(0)
  })
})

describe('calcularPendienteHandoff — desglose UPME vs honorario', () => {
  const modeloP1 = modelo({ aprobado_plan: 1 })
  const modeloP2 = modelo({ aprobado_plan: 2 })
  const valorRecaudar = 4_200_000 // honorario 3M + tarifa 1.2M

  it('Plan 1, recaudo 0 → falta UPME completa + 50% honorario', () => {
    const p = calcularPendienteHandoff(HONORARIO, modeloP1, 0)
    expect(p.umbral).toBe(2_700_000)
    expect(p.pendienteUpme).toBe(1_200_000)
    expect(p.pendienteHonorario).toBe(1_500_000)
    expect(p.pendienteTotal).toBe(2_700_000)
    expect(p.cubierto).toBe(false)
  })

  it('Plan 1, recaudo parcial que solo cubre la UPME → falta el anticipo del honorario', () => {
    const p = calcularPendienteHandoff(HONORARIO, modeloP1, 1_200_000)
    expect(p.pendienteUpme).toBe(0)          // UPME cubierta (reparto tarifa-primero)
    expect(p.pendienteHonorario).toBe(1_500_000)
    expect(p.pendienteTotal).toBe(1_500_000)
    expect(p.cubierto).toBe(false)
  })

  it('Plan 1, recaudo = umbral (tarifa + 50% honorario) → cubierto, avanza', () => {
    const p = calcularPendienteHandoff(HONORARIO, modeloP1, 2_700_000)
    expect(p.pendienteUpme).toBe(0)
    expect(p.pendienteHonorario).toBe(0)
    expect(p.pendienteTotal).toBe(0)
    expect(p.cubierto).toBe(true)
  })

  it('Plan 2, recaudo = tarifa + 50% honorario NO alcanza (exige 100% honorario)', () => {
    const p = calcularPendienteHandoff(HONORARIO, modeloP2, 2_700_000)
    expect(p.umbral).toBe(valorRecaudar)
    expect(p.pendienteUpme).toBe(0)
    expect(p.pendienteHonorario).toBe(1_500_000)
    expect(p.cubierto).toBe(false)
  })

  it('Plan 2, recaudo = valor a recaudar → cubierto', () => {
    const p = calcularPendienteHandoff(HONORARIO, modeloP2, valorRecaudar)
    expect(p.pendienteTotal).toBe(0)
    expect(p.cubierto).toBe(true)
  })

  it('desglose es consistente: pendienteUpme + pendienteHonorario = pendienteTotal', () => {
    for (const rec of [0, 500_000, 1_200_000, 2_000_000, 2_700_000]) {
      const p = calcularPendienteHandoff(HONORARIO, modeloP1, rec)
      expect(p.pendienteUpme + p.pendienteHonorario).toBe(p.pendienteTotal)
    }
  })

  // Tolerancia de materialidad (piso de Carmen, CFO): residuos ≤ TOLERANCIA_SALDO_COP
  // ($1.000) no bloquean el avance; faltantes mayores sí. La tolerancia solo destraba
  // el gate — no genera cobro ni ingreso.
  it('residuo de $85 bajo el umbral → cubierto (materialidad)', () => {
    const p = calcularPendienteHandoff(HONORARIO, modeloP2, valorRecaudar - 85)
    expect(p.pendienteTotal).toBe(85)
    expect(p.cubierto).toBe(true)
  })

  it('faltante de $3.000 → NO cubierto (excede la tolerancia)', () => {
    const p = calcularPendienteHandoff(HONORARIO, modeloP2, valorRecaudar - 3_000)
    expect(p.pendienteTotal).toBe(3_000)
    expect(p.cubierto).toBe(false)
  })

  it('faltante de exactamente $1.000 (TOLERANCIA_SALDO_COP) → cubierto (límite inclusivo)', () => {
    const p = calcularPendienteHandoff(HONORARIO, modeloP2, valorRecaudar - TOLERANCIA_SALDO_COP)
    expect(p.pendienteTotal).toBe(TOLERANCIA_SALDO_COP)
    expect(p.cubierto).toBe(true)
  })

  it('faltante de $1.001 (un peso sobre la tolerancia) → NO cubierto', () => {
    const p = calcularPendienteHandoff(HONORARIO, modeloP2, valorRecaudar - (TOLERANCIA_SALDO_COP + 1))
    expect(p.pendienteTotal).toBe(TOLERANCIA_SALDO_COP + 1)
    expect(p.cubierto).toBe(false)
  })
})

describe('esCeroDeliberado — cero deliberado vs sin cotizar', () => {
  const aprobadaEn = (honorario: number | null): PropuestaBloqueData => ({
    data: { aprobado_at: '2026-07-06T17:35:46.428Z', aprobado_plan: 2, aprobado_honorario: honorario },
  })
  const sinAprobar = (valorFinal: number): PropuestaBloqueData => ({
    data: { aprobado_at: null, aprobado_plan: null, aprobado_honorario: null, valor_final_plan1: valorFinal },
  })

  it('propuesta APROBADA con honorario 0 → cero deliberado (V0022)', () => {
    expect(esCeroDeliberado([aprobadaEn(0)], 0)).toBe(true)
  })

  it('propuesta APROBADA sin aprobado_honorario pero precio_aprobado 0 → cero deliberado', () => {
    // caso real V0022: aprobado_honorario ausente, se cae a precio_aprobado del negocio
    const prop: PropuestaBloqueData = { data: { aprobado_at: '2026-07-06T00:00:00Z', aprobado_plan: 2 } }
    expect(esCeroDeliberado([prop], 0)).toBe(true)
  })

  it('propuesta SIN aprobar (aún sin cotizar) → NO es cero deliberado (V0066)', () => {
    // V0066: propuesta v1 generada con honorario 850k pero nunca aprobada; precio null
    expect(esCeroDeliberado([sinAprobar(850_000)], null)).toBe(false)
  })

  it('propuesta APROBADA con honorario > 0 → NO es cero deliberado', () => {
    expect(esCeroDeliberado([aprobadaEn(3_000_000)], 3_000_000)).toBe(false)
  })

  it('sin ninguna propuesta → NO es cero deliberado', () => {
    expect(esCeroDeliberado([], null)).toBe(false)
    expect(esCeroDeliberado([{ data: null }], null)).toBe(false)
  })

  it('honorario aprobado desconocido y sin precio_aprobado → NO asume cero (no abre fail-open)', () => {
    const prop: PropuestaBloqueData = { data: { aprobado_at: '2026-07-06T00:00:00Z' } }
    expect(esCeroDeliberado([prop], null)).toBe(false)
  })

  it('con varias propuestas, basta una aprobada en 0 (heredadas readonly no rompen)', () => {
    const heredadaVacia: PropuestaBloqueData = { data: {} }
    expect(esCeroDeliberado([heredadaVacia, aprobadaEn(0)], 0)).toBe(true)
  })
})
