import { describe, expect, it } from 'vitest'
import {
  motivoCorteDeError,
  pruebaDeConfig,
  saldoDePruebaVencida,
  saldoDesdeCuentaConsumo,
  textoCorte,
  textoSaldo,
} from './corte-bolsa'

const AHORA = new Date('2026-10-09T15:00:00Z')
const prueba = { cliente_id: 'c1', consultas: 10, vence_en: '2026-10-16T15:00:00Z' }

function cuerpoBolsa(bolsa: Record<string, unknown>) {
  return {
    modalidad: 'bolsa',
    bolsa: {
      estado: 'activa',
      bloqueada: false,
      vence_en: '2026-10-16T15:00:00Z',
      consultas_compradas: 10,
      consumidas: 3,
      saldo: 7,
      precio_total: 0,
      pago_referencia: 'prueba-c1',
      ...bolsa,
    },
  }
}

describe('motivoCorteDeError', () => {
  it('los dos 402 de la bolsa son corte', () => {
    expect(motivoCorteDeError('bolsa_agotada', null, AHORA)).toBe('bolsa_agotada')
    expect(motivoCorteDeError('bolsa_vencida', null, AHORA)).toBe('bolsa_vencida')
  })

  it('un 401 es prueba vencida SOLO si hay prueba y ya pasó su fecha', () => {
    const vencida = { ...prueba, vence_en: '2026-10-09T14:59:59Z' }
    expect(motivoCorteDeError('invalid_api_key', vencida, AHORA)).toBe('bolsa_vencida')
    expect(motivoCorteDeError('invalid_api_key', prueba, AHORA)).toBeNull()
    expect(motivoCorteDeError('invalid_api_key', null, AHORA)).toBeNull()
  })

  it('cualquier otro error sigue siendo un error', () => {
    expect(motivoCorteDeError('valida_tiempo_agotado', prueba, AHORA)).toBeNull()
    expect(motivoCorteDeError(undefined, prueba, AHORA)).toBeNull()
  })
})

describe('pruebaDeConfig', () => {
  it('lee la prueba que deja el registro', () => {
    expect(pruebaDeConfig({ valida_prueba: prueba })).toEqual(prueba)
  })
  it('sin prueba, o con una fecha que no es fecha, no hay prueba', () => {
    expect(pruebaDeConfig(null)).toBeNull()
    expect(pruebaDeConfig({ modo_vitrina: true })).toBeNull()
    expect(pruebaDeConfig({ valida_prueba: { ...prueba, vence_en: 'mañana' } })).toBeNull()
  })
})

describe('saldoDesdeCuentaConsumo', () => {
  it('una prueba vigente da su saldo', () => {
    expect(saldoDesdeCuentaConsumo(cuerpoBolsa({}), AHORA)).toEqual({
      saldo: 7,
      compradas: 10,
      venceEn: '2026-10-16T15:00:00Z',
      bloqueada: false,
      motivo: null,
      esPrueba: true,
    })
  })

  it('agotada y vencida quedan bloqueadas con su motivo', () => {
    expect(saldoDesdeCuentaConsumo(cuerpoBolsa({ saldo: 0, consumidas: 10, estado: 'agotada', bloqueada: true }), AHORA)?.motivo).toBe('bolsa_agotada')
    expect(saldoDesdeCuentaConsumo(cuerpoBolsa({ estado: 'vencida', bloqueada: true }), AHORA)?.motivo).toBe('bolsa_vencida')
    // Vencida por fecha aunque Valida todavía no haya cambiado el estado.
    const porFecha = saldoDesdeCuentaConsumo(cuerpoBolsa({ vence_en: '2026-10-09T14:00:00Z' }), AHORA)
    expect(porFecha).toMatchObject({ bloqueada: true, motivo: 'bolsa_vencida' })
  })

  it('una bolsa pagada no es prueba', () => {
    expect(saldoDesdeCuentaConsumo(cuerpoBolsa({ precio_total: 1400000, pago_referencia: 'CC-12' }), AHORA)?.esPrueba).toBe(false)
    expect(saldoDesdeCuentaConsumo(cuerpoBolsa({ precio_total: 0, pago_referencia: 'cortesia-1' }), AHORA)?.esPrueba).toBe(false)
  })

  it('un plan mensual o un cuerpo raro no muestra contador', () => {
    expect(saldoDesdeCuentaConsumo({ modalidad: 'mensual', plan: {} }, AHORA)).toBeNull()
    expect(saldoDesdeCuentaConsumo({ modalidad: 'bolsa', bolsa: { saldo: 'x' } }, AHORA)).toBeNull()
    expect(saldoDesdeCuentaConsumo(null, AHORA)).toBeNull()
  })
})

describe('textos', () => {
  it('el saldo dice cuántas quedan y cuándo vence', () => {
    const s = saldoDesdeCuentaConsumo(cuerpoBolsa({}), AHORA)!
    expect(textoSaldo(s)).toBe('Te quedan 7 consultas de prueba. Vence el 16 de octubre.')
    expect(textoSaldo({ ...s, saldo: 1 })).toBe('Te queda 1 consulta de prueba. Vence el 16 de octubre.')
  })

  it('la prueba vencida sin llave se pinta como corte', () => {
    expect(saldoDePruebaVencida(prueba)).toMatchObject({ bloqueada: true, motivo: 'bolsa_vencida', esPrueba: true })
    expect(textoCorte('bolsa_vencida', true).titulo).toBe('Tu prueba terminó')
    expect(textoCorte('bolsa_agotada', true).titulo).toBe('Usaste todas tus consultas de prueba')
  })
})
