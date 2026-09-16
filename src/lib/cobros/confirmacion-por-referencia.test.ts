import { describe, it, expect } from 'vitest'
import {
  porcionesPorConfirmar,
  referenciaEsperaConfirmacion,
  type PorcionDeReferencia,
} from './confirmacion-por-referencia'

/*
 * MUTACIONES MEDIDAS el 2026-09-16 (30 verdes en la línea base de las dos suites del
 * frente: esta y `negocios/recaudo-confirmado.test.ts`):
 *
 *   1. `esPorcionPendienteDeConfirmar` ignora la marca de la porción (el criterio viejo,
 *      solo el flag por negocio) ....................... 4 rojas (3 aquí y en la hermana)
 *   2. `porcionesPorConfirmar` vuelve al criterio por referencia ("si algún negocio está
 *      conciliado, no queda nada pendiente") .................................. 1 roja
 *   3. `referenciaEsperaConfirmacion` compara `>= 0` en vez de `> 0` ........... 1 roja
 *
 * Las tres se aplicaron y se revirtieron.
 */

// ── El caso que lo originó: referencia 385563083, SOENA, 15-sep-2026 ──────────
//
// El comercial repartió $637.500 entre V0497 ($425.000) y V0498 ($212.500). El 12-sep la
// financiera aceptó el reparto: los DOS negocios quedaron conciliados. El 15-sep entraron
// pagos nuevos a V0498 y su flag por negocio volvió a `false`.
//
// Con el criterio viejo (`propuesto_por_comercial && !algun_conciliado`), la referencia
// desaparecía de "Por confirmar" porque V0497 seguía conciliado: nadie podía volver a
// aceptar la porción de V0498. Hubo que restituir el check por SQL a mano.

const comercial = (monto: number, confirmadoAt?: string) => ({
  monto,
  split_json: { origen: 'comercial', ...(confirmadoAt ? { confirmado_at: confirmadoAt } : {}) },
})

const ACEPTADO = '2026-09-12T01:34:47.722Z'

describe('cuántas porciones de la referencia siguen esperando a la financiera', () => {
  it('un reparto recién propuesto: todas', () => {
    const porciones: PorcionDeReferencia[] = [
      { cobro: comercial(425000), negocioConciliado: false },
      { cobro: comercial(212500), negocioConciliado: false },
    ]
    expect(porcionesPorConfirmar(porciones)).toBe(2)
    expect(referenciaEsperaConfirmacion({ porciones_por_confirmar: 2 })).toBe(true)
  })

  it('aceptado entero: ninguna, y la referencia sale de la bandeja', () => {
    const porciones: PorcionDeReferencia[] = [
      { cobro: comercial(425000, ACEPTADO), negocioConciliado: true },
      { cobro: comercial(212500, ACEPTADO), negocioConciliado: true },
    ]
    expect(porcionesPorConfirmar(porciones)).toBe(0)
    expect(referenciaEsperaConfirmacion({ porciones_por_confirmar: 0 })).toBe(false)
  })

  // ⚠️ EL DEFECTO. Sin marca en la porción y con V0497 conciliado, el criterio por negocio
  // daba la referencia por resuelta y escondía la porción de V0498.
  it('una porción sin confirmar mantiene la referencia accionable, aunque el otro negocio esté conciliado', () => {
    const porciones: PorcionDeReferencia[] = [
      { cobro: comercial(425000), negocioConciliado: true },   // V0497, conciliado
      { cobro: comercial(212500), negocioConciliado: false },  // V0498, sin confirmar
    ]
    expect(porcionesPorConfirmar(porciones)).toBe(1)
    expect(referenciaEsperaConfirmacion({ porciones_por_confirmar: 1 })).toBe(true)
  })

  // Después del arreglo, la porción aceptada lleva su propia marca: el pago nuevo en
  // V0498 le baja el flag al negocio y aun así no reabre nada que ya estuviera decidido.
  it('la marca en la porción sobrevive a que el negocio deje de estar conciliado', () => {
    const porciones: PorcionDeReferencia[] = [
      { cobro: comercial(425000, ACEPTADO), negocioConciliado: true },
      { cobro: comercial(212500, ACEPTADO), negocioConciliado: false },
    ]
    expect(porcionesPorConfirmar(porciones)).toBe(0)
  })

  it('un cobro normal de la referencia no espera confirmación de nadie', () => {
    const porciones: PorcionDeReferencia[] = [
      { cobro: { monto: 769898, split_json: null }, negocioConciliado: false },
    ]
    expect(porcionesPorConfirmar(porciones)).toBe(0)
  })

  it('un reparto hecho por la financiera tampoco', () => {
    const porciones: PorcionDeReferencia[] = [
      { cobro: { monto: 605625, split_json: {} }, negocioConciliado: false },
    ]
    expect(porcionesPorConfirmar(porciones)).toBe(0)
  })

  // Una porción anulada tiene `monto` en 0: no hay plata que confirmar, y dejarla contando
  // mantendría la referencia en la bandeja para siempre, sin nada que decidir.
  it('una porción anulada no cuenta', () => {
    const porciones: PorcionDeReferencia[] = [
      { cobro: comercial(212500), negocioConciliado: false, anulada: true },
    ]
    expect(porcionesPorConfirmar(porciones)).toBe(0)
  })

  it('lista vacía o ausente devuelve cero', () => {
    expect(porcionesPorConfirmar([])).toBe(0)
    expect(porcionesPorConfirmar(null)).toBe(0)
    expect(porcionesPorConfirmar(undefined)).toBe(0)
  })
})
