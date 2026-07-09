import { describe, it, expect } from 'vitest'
import {
  componerDosBolsas,
  tienePlataPorLiquidar,
  sugerirDestinoPasante,
  type CobroLiquidacion,
} from './liquidacion-cancelados'

const cobro = (monto: number, tipo_cobro: string | null, id = crypto.randomUUID()): CobroLiquidacion => ({
  id,
  monto,
  tipo_cobro,
})

describe('componerDosBolsas — separa honorario recaudado vs pasante en custodia', () => {
  it('reparto SOENA típico: anticipo honorario + tarifa pasante en UN pago', () => {
    // 50/50: pasante 1.2M + 50% honorario 1.5M (anticipo). Negocio se cancela aquí.
    const b = componerDosBolsas([
      cobro(1_200_000, 'pasante'),
      cobro(1_500_000, 'anticipo'),
    ])
    expect(b.pasante_recaudado).toBe(1_200_000)
    expect(b.honorario_recaudado).toBe(1_500_000)
    expect(b.honorario_por_liquidar).toBe(1_500_000)
    expect(b.ya_por_devolver).toBe(0)
    expect(b.ya_penalidad).toBe(0)
  })

  it('el pasante NUNCA se mezcla con el honorario (bolsas separadas)', () => {
    const b = componerDosBolsas([cobro(2_000_000, 'pasante'), cobro(3_000_000, 'pago')])
    expect(b.pasante_recaudado).toBe(2_000_000)
    expect(b.honorario_recaudado).toBe(3_000_000)
  })

  it('cobros de honorario legacy (tipo NULL) cuentan como honorario', () => {
    const b = componerDosBolsas([cobro(1_000_000, null)])
    expect(b.honorario_recaudado).toBe(1_000_000)
    expect(b.pasante_recaudado).toBe(0)
  })

  it('una devolución ya marcada descuenta del honorario por liquidar', () => {
    const b = componerDosBolsas([
      cobro(3_000_000, 'pago'),
      cobro(-1_000_000, 'devolucion_pendiente'),
    ])
    expect(b.honorario_recaudado).toBe(3_000_000)
    expect(b.ya_por_devolver).toBe(1_000_000)
    expect(b.honorario_por_liquidar).toBe(2_000_000)
  })

  it('una penalidad ya retenida descuenta del honorario por liquidar y va aparte', () => {
    const b = componerDosBolsas([
      cobro(3_000_000, 'pago'),
      cobro(3_000_000, 'penalidad'),
    ])
    // la penalidad positiva NO suma al honorario recaudado (ya salió de esa bolsa)
    expect(b.honorario_recaudado).toBe(3_000_000)
    expect(b.ya_penalidad).toBe(3_000_000)
    expect(b.honorario_por_liquidar).toBe(0)
  })

  it('mixto: parte devuelta + parte penalidad = liquidado por completo', () => {
    const b = componerDosBolsas([
      cobro(4_000_000, 'pago'),
      cobro(-1_500_000, 'devolucion_pendiente'),
      cobro(2_500_000, 'penalidad'),
    ])
    expect(b.honorario_por_liquidar).toBe(0)
    expect(b.ya_por_devolver).toBe(1_500_000)
    expect(b.ya_penalidad).toBe(2_500_000)
  })

  it('sin cobros → todo en 0 (no aplica Regla 2)', () => {
    const b = componerDosBolsas([])
    expect(b.honorario_recaudado).toBe(0)
    expect(b.pasante_recaudado).toBe(0)
    expect(b.honorario_por_liquidar).toBe(0)
  })

  it('honorario_por_liquidar nunca es negativo (sobre-liquidado se satura en 0)', () => {
    const b = componerDosBolsas([
      cobro(1_000_000, 'pago'),
      cobro(-2_000_000, 'devolucion_pendiente'),
    ])
    expect(b.honorario_por_liquidar).toBe(0)
  })
})

describe('tienePlataPorLiquidar — detección', () => {
  it('honorario pendiente → aplica', () => {
    const b = componerDosBolsas([cobro(1_500_000, 'anticipo')])
    expect(tienePlataPorLiquidar(b, false)).toBe(true)
  })

  it('solo pasante en custodia sin resolver → aplica', () => {
    const b = componerDosBolsas([cobro(1_200_000, 'pasante')])
    expect(tienePlataPorLiquidar(b, false)).toBe(true)
  })

  it('solo pasante pero YA resuelto (desembolsado/devuelto) → no aplica', () => {
    const b = componerDosBolsas([cobro(1_200_000, 'pasante')])
    expect(tienePlataPorLiquidar(b, true)).toBe(false)
  })

  it('honorario ya liquidado del todo y sin pasante → no aplica', () => {
    const b = componerDosBolsas([
      cobro(2_000_000, 'pago'),
      cobro(-2_000_000, 'devolucion_pendiente'),
    ])
    expect(tienePlataPorLiquidar(b, false)).toBe(false)
  })
})

describe('sugerirDestinoPasante — según si se desembolsó a la UPME', () => {
  it('desembolsado → cerrar contra el desembolso (no se devuelve)', () => {
    expect(sugerirDestinoPasante(true)).toBe('cerrar_contra_desembolso')
  })
  it('NO desembolsado → devolver al cliente', () => {
    expect(sugerirDestinoPasante(false)).toBe('devolver')
  })
})
