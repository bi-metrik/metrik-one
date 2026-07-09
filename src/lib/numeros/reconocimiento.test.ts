import { describe, it, expect } from 'vitest'
import {
  ingresoReconocidoDelMes,
  recaudoCajaDelMes,
  usaReconocimientoCompletitud,
  type CobroLite,
  type NegocioLite,
  type WorkspaceReconocimientoConfig,
} from './reconocimiento'

const OFF: WorkspaceReconocimientoConfig = { optInFlag: false, cutover: null }
const ON: WorkspaceReconocimientoConfig = { optInFlag: true, cutover: '2026-07-01' }

// Helpers de fixtures
const cobro = (o: Partial<CobroLite>): CobroLite => ({
  monto: 0,
  fecha: '2026-07-15',
  tipo_cobro: 'regular',
  negocioId: null,
  ...o,
})
const negocio = (o: Partial<NegocioLite>): NegocioLite => ({
  id: 'n1',
  created_at: '2026-07-10',
  estado: 'abierto',
  closed_at: null,
  ...o,
})

describe('usaReconocimientoCompletitud', () => {
  it('OFF sin flag → false', () => {
    expect(usaReconocimientoCompletitud(OFF)).toBe(false)
  })
  it('flag true pero SIN cutover → false (fail-safe, no reescribe históricos)', () => {
    expect(usaReconocimientoCompletitud({ optInFlag: true, cutover: null })).toBe(false)
  })
  it('flag true + cutover malformado → false', () => {
    expect(usaReconocimientoCompletitud({ optInFlag: true, cutover: 'julio' })).toBe(false)
  })
  it('flag true + cutover válido → true', () => {
    expect(usaReconocimientoCompletitud(ON)).toBe(true)
  })
})

describe('recaudo de caja (tesorería) — SIEMPRE por fecha, excluye pasante', () => {
  it('suma cobros no-pasante del mes; el pasante no cuenta', () => {
    const cobros = [
      cobro({ monto: 6_000_000, fecha: '2026-07-15', negocioId: 'n1' }),
      cobro({ monto: 850_000, fecha: '2026-07-15', tipo_cobro: 'pasante', negocioId: 'n1' }),
      cobro({ monto: 1_000_000, fecha: '2026-06-30' }), // otro mes
    ]
    expect(recaudoCajaDelMes(cobros, '2026-07')).toBe(6_000_000)
  })
})

describe('opt-in OFF → base CAJA (comportamiento actual, backward-compatible)', () => {
  it('ingreso reconocido == recaudo de caja del mes', () => {
    const cobros = [
      cobro({ monto: 6_000_000, fecha: '2026-07-15', negocioId: 'n1' }),
      cobro({ monto: 3_000_000, fecha: '2026-07-20', negocioId: 'n2' }),
    ]
    const negocios = [negocio({ id: 'n1' }), negocio({ id: 'n2' })]
    expect(ingresoReconocidoDelMes(OFF, cobros, negocios, '2026-07')).toBe(9_000_000)
    // Idéntico al recaudo → cero cambio para ws no opt-in.
    expect(ingresoReconocidoDelMes(OFF, cobros, negocios, '2026-07')).toBe(
      recaudoCajaDelMes(cobros, '2026-07'),
    )
  })
})

describe('opt-in ON, PROSPECTIVO — negocio post-cutover', () => {
  it('anticipo recaudado pero negocio ABIERTO → NO reconocido (recaudado, no reconocido)', () => {
    const cobros = [cobro({ monto: 6_000_000, fecha: '2026-07-15', negocioId: 'n1' })]
    const negocios = [negocio({ id: 'n1', created_at: '2026-07-10', estado: 'abierto' })]
    // El dinero entró a caja...
    expect(recaudoCajaDelMes(cobros, '2026-07')).toBe(6_000_000)
    // ...pero NO se reconoce como venta (negocio no cerrado).
    expect(ingresoReconocidoDelMes(ON, cobros, negocios, '2026-07')).toBe(0)
  })

  it('negocio COMPLETADO → honorario reconocido en el mes de closed_at', () => {
    const cobros = [
      cobro({ monto: 3_000_000, fecha: '2026-07-15', negocioId: 'n1' }),
      cobro({ monto: 3_000_000, fecha: '2026-08-05', negocioId: 'n1' }),
    ]
    const negocios = [
      negocio({ id: 'n1', created_at: '2026-07-10', estado: 'completado', closed_at: '2026-08-20' }),
    ]
    // Julio: recaudó 3M en caja, pero NO reconoce (aún abierto en julio).
    expect(recaudoCajaDelMes(cobros, '2026-07')).toBe(3_000_000)
    expect(ingresoReconocidoDelMes(ON, cobros, negocios, '2026-07')).toBe(0)
    // Agosto: se completa → reconoce el HONORARIO ÍNTEGRO (6M), no solo el cobro de agosto.
    expect(ingresoReconocidoDelMes(ON, cobros, negocios, '2026-08')).toBe(6_000_000)
  })

  it('honorario excluye la tarifa pasante (UPME) aun al reconocer al cierre', () => {
    const cobros = [
      cobro({ monto: 6_000_000, fecha: '2026-07-15', negocioId: 'n1' }),
      cobro({ monto: 850_000, fecha: '2026-07-15', tipo_cobro: 'pasante', negocioId: 'n1' }),
    ]
    const negocios = [
      negocio({ id: 'n1', created_at: '2026-07-10', estado: 'completado', closed_at: '2026-07-30' }),
    ]
    // Reconoce solo el honorario (6M), no el pasante (850K).
    expect(ingresoReconocidoDelMes(ON, cobros, negocios, '2026-07')).toBe(6_000_000)
  })

  it('varios negocios completados en el mismo mes suman sus honorarios', () => {
    const cobros = [
      cobro({ monto: 6_000_000, fecha: '2026-08-01', negocioId: 'n1' }),
      cobro({ monto: 4_000_000, fecha: '2026-08-02', negocioId: 'n2' }),
    ]
    const negocios = [
      negocio({ id: 'n1', created_at: '2026-07-10', estado: 'completado', closed_at: '2026-08-10' }),
      negocio({ id: 'n2', created_at: '2026-07-12', estado: 'completado', closed_at: '2026-08-11' }),
    ]
    expect(ingresoReconocidoDelMes(ON, cobros, negocios, '2026-08')).toBe(10_000_000)
  })
})

describe('opt-in ON, CUTOVER — no reescribe el pasado', () => {
  it('negocio LEGACY (created_at < cutover) → base caja por fecha, aunque siga abierto', () => {
    const cobros = [cobro({ monto: 2_000_000, fecha: '2026-06-15', negocioId: 'nLeg' })]
    const negocios = [
      negocio({ id: 'nLeg', created_at: '2026-05-20', estado: 'abierto', closed_at: null }),
    ]
    // Junio (antes del cutover 2026-07-01): se reconoce por caja → 2M (histórico intacto).
    expect(ingresoReconocidoDelMes(ON, cobros, negocios, '2026-06')).toBe(2_000_000)
  })

  it('mezcla legacy (caja) + post-cutover completado (completitud) en el mismo mes', () => {
    const cobros = [
      // legacy: cuenta por caja en agosto
      cobro({ monto: 2_000_000, fecha: '2026-08-03', negocioId: 'nLeg' }),
      // post-cutover: honorario, cuenta al cerrar en agosto
      cobro({ monto: 5_000_000, fecha: '2026-07-20', negocioId: 'nNew' }),
    ]
    const negocios = [
      negocio({ id: 'nLeg', created_at: '2026-05-20', estado: 'abierto', closed_at: null }),
      negocio({ id: 'nNew', created_at: '2026-07-15', estado: 'completado', closed_at: '2026-08-25' }),
    ]
    // Agosto = 2M (legacy caja) + 5M (nNew honorario al cierre) = 7M.
    expect(ingresoReconocidoDelMes(ON, cobros, negocios, '2026-08')).toBe(7_000_000)
  })

  it('cobro SIN negocio → siempre caja por fecha (no hay completitud a la cual anclar)', () => {
    const cobros = [cobro({ monto: 500_000, fecha: '2026-08-04', negocioId: null })]
    expect(ingresoReconocidoDelMes(ON, cobros, [], '2026-08')).toBe(500_000)
  })

  it('negocio EN EL cutover exacto (created_at == cutover) es POST-cutover', () => {
    const cobros = [cobro({ monto: 1_000_000, fecha: '2026-07-01', negocioId: 'nBorde' })]
    const negocios = [
      negocio({ id: 'nBorde', created_at: '2026-07-01', estado: 'abierto', closed_at: null }),
    ]
    // En el cutover y abierto → NO reconocido (post-cutover, base completitud).
    expect(ingresoReconocidoDelMes(ON, cobros, negocios, '2026-07')).toBe(0)
  })
})
