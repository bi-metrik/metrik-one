/**
 * El RC-3 es UNO por negocio y sale del comprobante UPME (SOE-029).
 *
 * LOS CASOS QUE IMPORTAN, medidos en SOENA (brief de Mauricio, 2026-10-26):
 *   - V0572: comprobante $978.707 contra tarifa confirmada $978.870. El recibo acusaba la
 *     confirmada; tiene que acusar lo que se pagó a la UPME.
 *   - V0633: el cliente pagó en dos partes y la tarifa salió en un RC-3 de $45 y otro de
 *     $701.767. Tiene que salir UN recibo por el comprobante.
 *   - V0294: la extracción del comprobante falló (403 de Gemini) y no hay `valor_pagado`.
 *     No se cae a la tarifa confirmada: se bloquea.
 */
import { describe, it, expect } from 'vitest'
import {
  leerComprobanteUpme,
  MENSAJE_SIN_COMPROBANTE_UPME,
  motivoSinRc3,
  planRc3DelNegocio,
  type PagoParaRc3,
} from './rc3-negocio'

const pago = (id: string, fecha: string, aTarifa: number, extra: Partial<PagoParaRc3> = {}): PagoParaRc3 =>
  ({ id, fecha, aTarifa, marca: null, noAplica: false, ...extra })
const rc3 = (numero: string, valor: number) => [{ numero, siigo_id: 's', valor, componente: 'pasante' }]
const ok = (valor: number) => ({ estado: 'ok' as const, valor })

describe('el valor sale del comprobante, no de la tarifa confirmada', () => {
  it('V0572: comprobante $978.707 con tarifa $978.870 → el RC-3 es por $978.707', () => {
    const plan = planRc3DelNegocio({
      comprobante: ok(978_707),
      techoTarifa: 978_870,
      pagos: [pago('c1', '2026-10-01', 978_870)],
    })
    expect(plan.estado).toBe('emitir')
    expect(plan.titularId).toBe('c1')
    expect(plan.valor).toBe(978_707)
  })

  it('V0593 al revés: comprobante unos pesos MAYOR que la tarifa también se completa', () => {
    // La franja UPME del reparto nunca pasa de `techo_tarifa`: sin tomar el techo como
    // meta, este negocio no completaría nunca.
    const plan = planRc3DelNegocio({
      comprobante: ok(817_100),
      techoTarifa: 816_895,
      pagos: [pago('c1', '2026-10-01', 816_895)],
    })
    expect(plan.estado).toBe('emitir')
    expect(plan.valor).toBe(817_100)
  })

  it('nunca por encima del comprobante, aunque el pago traiga más tarifa', () => {
    const plan = planRc3DelNegocio({
      comprobante: ok(700_000),
      techoTarifa: 701_812,
      pagos: [pago('c1', '2026-10-01', 701_812)],
    })
    expect(plan.valor).toBe(700_000)
  })
})

describe('dos pagos: un solo recibo, no pedazos', () => {
  const V0633 = [pago('a', '2026-09-10', 45), pago('b', '2026-09-20', 701_767)]

  it('V0633: el RC-3 va en el pago que completa la tarifa, por el comprobante entero', () => {
    const plan = planRc3DelNegocio({ comprobante: ok(701_812), techoTarifa: 701_812, pagos: V0633 })
    expect(plan.estado).toBe('emitir')
    expect(plan.titularId).toBe('b')
    expect(plan.valor).toBe(701_812)
    expect(plan.roles.get('a')).toBe('en_el_del_negocio')
    expect(plan.roles.get('b')).toBe('titular')
  })

  it('el pago anterior no emite: dice que va en el del negocio', () => {
    const plan = planRc3DelNegocio({ comprobante: ok(701_812), techoTarifa: 701_812, pagos: V0633 })
    expect(motivoSinRc3(plan, 'a')?.mensaje).toContain('va en el recibo del negocio')
    expect(motivoSinRc3(plan, 'b')).toBeNull()
  })

  it('el orden es el del reparto (fecha, id), no el de la lista', () => {
    const plan = planRc3DelNegocio({
      comprobante: ok(701_812), techoTarifa: 701_812, pagos: [...V0633].reverse(),
    })
    expect(plan.titularId).toBe('b')
  })

  it('con solo el primer pago, el RC-3 todavía no se ofrece: no se acusa plata que no entró', () => {
    const plan = planRc3DelNegocio({ comprobante: ok(701_812), techoTarifa: 701_812, pagos: [V0633[0]] })
    expect(plan.estado).toBe('esperando_pagos')
    expect(plan.titularId).toBeNull()
    expect(motivoSinRc3(plan, 'a')?.mensaje).toContain('van $')
  })

  it('una diferencia menor que el piso de materialidad cuenta como completa', () => {
    const plan = planRc3DelNegocio({
      comprobante: ok(701_812), techoTarifa: 701_812, pagos: [pago('a', '2026-09-10', 701_300)],
    })
    expect(plan.estado).toBe('emitir')
    expect(plan.valor).toBe(701_812)
  })
})

describe('lo ya emitido se descuenta', () => {
  it('un RC-3 viejo por pedazo se resta y el resto sale en el pago siguiente', () => {
    const plan = planRc3DelNegocio({
      comprobante: ok(701_812),
      techoTarifa: 701_812,
      pagos: [pago('a', '2026-09-10', 45, { marca: rc3('RC-3-20', 45) }), pago('b', '2026-09-20', 701_767)],
    })
    expect(plan.estado).toBe('emitir')
    expect(plan.titularId).toBe('b')
    expect(plan.valor).toBe(701_767)
    expect(plan.resuelto).toBe(45)
  })

  it('si lo emitido ya cubre el comprobante, no se ofrece otro', () => {
    // Los 27 RC-3 ya emitidos (por `a_tarifa`) se quedan como están: V0572 salió por
    // $978.870, más que su comprobante, y no se emite nada encima.
    const plan = planRc3DelNegocio({
      comprobante: ok(978_707),
      techoTarifa: 978_870,
      pagos: [pago('c1', '2026-10-01', 978_870, { marca: rc3('RC-3-9', 978_870) }), pago('c2', '2026-10-05', 5)],
    })
    expect(plan.estado).toBe('cubierto')
    expect(plan.valor).toBeNull()
    expect(motivoSinRc3(plan, 'c2')?.mensaje).toContain('ya tiene su recibo')
    expect(motivoSinRc3(plan, 'c1')?.mensaje).toContain('ya tiene su recibo de caja')
  })

  it('un recibo viejo por el TOTAL acusó la porción UPME de su pago', () => {
    const plan = planRc3DelNegocio({
      comprobante: ok(1_339_312),
      techoTarifa: null,
      pagos: [
        pago('c2', '2026-08-31', 637_500),
        pago('c1', '2026-09-02', 701_812, { marca: { numero: 'RC-1-65', siigo_id: 's', valor: 701_812 } }),
      ],
    })
    // El pago que completa (c1) ya tiene recibo: va en el anterior sin recibo.
    expect(plan.titularId).toBe('c2')
    expect(plan.valor).toBe(637_500)
  })

  it('un pago marcado «no aplica» (corte histórico) cuenta como resuelto, y no es titular', () => {
    const plan = planRc3DelNegocio({
      comprobante: ok(701_900),
      techoTarifa: 701_812,
      pagos: [pago('a', '2026-08-01', 701_812, { noAplica: true }), pago('b', '2026-09-01', 0)],
    })
    // La tarifa entró completa y no queda un pago libre donde colgar los $88: no se ofrece.
    expect(plan.estado).toBe('cubierto')
    expect(plan.roles.get('a')).toBe('fuera')
  })
})

describe('sin comprobante bloquea; no cae a la tarifa confirmada', () => {
  it('V0294: sin valor_pagado el plan no tiene valor y dice qué falta', () => {
    const plan = planRc3DelNegocio({
      comprobante: { estado: 'falta' },
      techoTarifa: 701_812,
      pagos: [pago('c1', '2026-10-01', 701_812)],
    })
    expect(plan.estado).toBe('sin_comprobante')
    expect(plan.valor).toBeNull()
    expect(plan.titularId).toBe('c1')
    expect(motivoSinRc3(plan, 'c1')).toEqual({ mensaje: MENSAJE_SIN_COMPROBANTE_UPME, bloqueo: true })
  })

  it('el bloqueo se muestra aunque los pagos no completen la tarifa', () => {
    const plan = planRc3DelNegocio({
      comprobante: { estado: 'falta' }, techoTarifa: 701_812, pagos: [pago('a', '2026-09-10', 45)],
    })
    expect(plan.titularId).toBe('a')
    expect(motivoSinRc3(plan, 'a')?.bloqueo).toBe(true)
  })

  it('dos comprobantes con valores distintos también bloquean', () => {
    const plan = planRc3DelNegocio({
      comprobante: { estado: 'ambiguo', valores: [700_000, 701_812] },
      techoTarifa: 701_812,
      pagos: [pago('c1', '2026-10-01', 701_812)],
    })
    expect(plan.estado).toBe('comprobante_ambiguo')
    expect(motivoSinRc3(plan, 'c1')?.bloqueo).toBe(true)
  })

  it('un pago sin porción UPME no habla del comprobante', () => {
    const plan = planRc3DelNegocio({
      comprobante: { estado: 'falta' }, techoTarifa: 701_812,
      pagos: [pago('h', '2026-09-01', 0), pago('c1', '2026-10-01', 701_812)],
    })
    expect(motivoSinRc3(plan, 'h')?.mensaje).toContain('no trae tarifa UPME')
  })
})

describe('leerComprobanteUpme', () => {
  it('lee el número colombiano del comprobante', () => {
    expect(leerComprobanteUpme([{ campos: { valor_pagado: { value: '978.707' } } }])).toEqual(ok(978_707))
  })
  it('sin bloque, sin campo o en cero es «falta»', () => {
    expect(leerComprobanteUpme([])).toEqual({ estado: 'falta' })
    expect(leerComprobanteUpme([{ campos: {} }, null])).toEqual({ estado: 'falta' })
    expect(leerComprobanteUpme([{ campos: { valor_pagado: { value: 0 } } }])).toEqual({ estado: 'falta' })
  })
  it('dos instancias con el mismo valor no son ambiguas; con valores distintos sí', () => {
    const v = (x: unknown) => ({ campos: { valor_pagado: { value: x } } })
    expect(leerComprobanteUpme([v(701_812), v('701.812')])).toEqual(ok(701_812))
    expect(leerComprobanteUpme([v(701_812), v(700_000)]).estado).toBe('ambiguo')
  })
})
