import { describe, expect, it } from 'vitest'
import { cuotasConEstado, enlaceDePagoValido, fechaCorta, proximoPago, type CobroRecibido, type CuotaDeServicio } from './pago-pendiente'

/**
 * El próximo pago de un CDA. Las cuotas son las reales de C1 26 1 (CDA del Caquetá), medidas en
 * producción el 2026-09-23: $150.000 cada una, ciclo del 23 al 22, la primera vence el 30-sep y las
 * siguientes el 27 de cada mes.
 */

const LINK = 'https://checkout.bold.co/payment/LNK_TXRRP7Q95ZJ'

function cuota(numero: number, fechaVencimiento: string, extra: Partial<CuotaDeServicio> = {}): CuotaDeServicio {
  return {
    numero,
    tipo: 'cuota',
    monto: 150000,
    fechaVencimiento,
    concepto: `Licencia VALIDA · Starter — periodo del cuota ${numero}`,
    enlacePagoUrl: null,
    enlacePagoExpira: null,
    ...extra,
  }
}
const CUOTAS = [
  cuota(1, '2026-09-30', {
    concepto: 'Licencia VALIDA · Starter — periodo del 23/09/2026 al 22/10/2026',
    enlacePagoUrl: LINK,
    enlacePagoExpira: '2026-09-30T23:59:00-05:00',
  }),
  cuota(2, '2026-10-27'),
  cuota(3, '2026-11-27'),
  cuota(4, '2026-12-27'),
]
const pagado = (monto: number): CobroRecibido => ({ monto, estado: 'pagado' })

describe('cuál es el próximo pago', () => {
  it('sin pagos, la primera cuota: $150.000, su período, su vencimiento y su enlace', () => {
    expect(proximoPago({ cuotas: CUOTAS, cobros: [], hoy: '2026-09-23', ahoraISO: '2026-09-23T15:00:00Z' })).toEqual({
      estado: 'pendiente',
      numero: 1,
      concepto: 'Licencia VALIDA · Starter — periodo del 23/09/2026 al 22/10/2026',
      fechaVencimiento: '2026-09-30',
      monto: 150000,
      abonado: 0,
      saldo: 150000,
      vencida: false,
      enlacePago: LINK,
      enlaceVencido: false,
    })
  })

  it('un enlace vencido no sale como botón: se dice que venció', () => {
    const r = proximoPago({ cuotas: CUOTAS, cobros: [], hoy: '2026-10-01', ahoraISO: '2026-10-01T15:00:00Z' })
    expect(r.estado === 'pendiente' && [r.enlacePago, r.enlaceVencido]).toEqual([null, true])
  })

  it('un vencimiento ilegible tampoco deja salir el enlace', () => {
    const cuotas = [cuota(1, '2026-09-30', { enlacePagoUrl: LINK, enlacePagoExpira: 'el 27' })]
    const r = proximoPago({ cuotas, cobros: [], hoy: '2026-09-23', ahoraISO: '2026-09-23T15:00:00Z' })
    expect(r.estado === 'pendiente' && [r.enlacePago, r.enlaceVencido]).toEqual([null, true])
  })

  it('un enlace sin vencimiento declarado sale mientras la cuota esté pendiente', () => {
    const cuotas = [cuota(1, '2026-09-30', { enlacePagoUrl: LINK })]
    const r = proximoPago({ cuotas, cobros: [], hoy: '2026-10-05', ahoraISO: '2026-10-05T15:00:00Z' })
    expect(r.estado === 'pendiente' && [r.enlacePago, r.enlaceVencido]).toEqual([LINK, false])
  })

  it('pagada la primera, sigue la segunda, aunque el pago no se haya atado a la cuota', () => {
    const r = proximoPago({ cuotas: CUOTAS, cobros: [pagado(150000)], hoy: '2026-10-20', ahoraISO: '2026-10-20T15:00:00Z' })
    expect(r.estado === 'pendiente' && [r.numero, r.saldo]).toEqual([2, 150000])
  })

  it('el excedente se descuenta de la cuota siguiente', () => {
    const r = proximoPago({ cuotas: CUOTAS, cobros: [pagado(200000)], hoy: '2026-10-20', ahoraISO: '2026-10-20T15:00:00Z' })
    expect(r.estado === 'pendiente' && [r.numero, r.abonado, r.saldo]).toEqual([2, 50000, 100000])
  })

  it('un abono parcial deja la misma cuota pendiente, con lo que falta', () => {
    const r = proximoPago({ cuotas: CUOTAS, cobros: [pagado(100000)], hoy: '2026-09-25', ahoraISO: '2026-09-25T15:00:00Z' })
    expect(r.estado === 'pendiente' && [r.numero, r.abonado, r.saldo]).toEqual([1, 100000, 50000])
  })

  it('unos pesos de redondeo no dejan una cuota pendiente', () => {
    const r = proximoPago({ cuotas: CUOTAS, cobros: [pagado(149500)], hoy: '2026-10-20', ahoraISO: '2026-10-20T15:00:00Z' })
    expect(r.estado === 'pendiente' && r.numero).toBe(2)
  })

  it('lo programado y lo anulado no es plata recibida', () => {
    const cobros: CobroRecibido[] = [
      { monto: 150000, estado: 'programado' },
      { monto: 150000, estado: 'anulado' },
    ]
    const r = proximoPago({ cuotas: CUOTAS, cobros, hoy: '2026-09-25', ahoraISO: '2026-09-25T15:00:00Z' })
    expect(r.estado === 'pendiente' && [r.numero, r.abonado]).toEqual([1, 0])
  })

  it('el orden lo da el vencimiento, no el orden en que llegan las filas', () => {
    const r = proximoPago({ cuotas: [...CUOTAS].reverse(), cobros: [], hoy: '2026-09-23', ahoraISO: '2026-09-23T15:00:00Z' })
    expect(r.estado === 'pendiente' && r.numero).toBe(1)
  })

  it('vencida cuando ya pasó su fecha', () => {
    const r = proximoPago({ cuotas: CUOTAS, cobros: [], hoy: '2026-10-01', ahoraISO: '2026-10-01T15:00:00Z' })
    expect(r.estado === 'pendiente' && r.vencida).toBe(true)
  })

  it('todo pagado: al día; sin cuotas: lo dice, no inventa una', () => {
    expect(proximoPago({ cuotas: CUOTAS, cobros: [pagado(600000)], hoy: '2026-12-30', ahoraISO: '2026-12-30T15:00:00Z' })).toEqual({
      estado: 'al_dia',
      cuotasPagadas: 4,
    })
    expect(proximoPago({ cuotas: [], cobros: [pagado(1)], hoy: '2026-09-23', ahoraISO: '2026-09-23T15:00:00Z' })).toEqual({ estado: 'sin_cuotas' })
  })

  it('una cuota sin enlace sale sin botón', () => {
    const r = proximoPago({ cuotas: CUOTAS, cobros: [pagado(150000)], hoy: '2026-10-20', ahoraISO: '2026-10-20T15:00:00Z' })
    expect(r.estado === 'pendiente' && r.enlacePago).toBeNull()
  })
})

describe('qué enlace puede salir en el botón «Pagar»', () => {
  it('uno de Bold, https', () => {
    expect(enlaceDePagoValido(LINK)).toBe(LINK)
    expect(enlaceDePagoValido('https://bold.co/pagos/abc')).toBe('https://bold.co/pagos/abc')
  })

  it('ni http, ni otro dominio que se le parezca, ni otro esquema', () => {
    for (const malo of [
      'http://checkout.bold.co/payment/LNK_1',
      'https://checkout.bold.co.estafa.com/payment/LNK_1',
      'https://notbold.co/payment',
      'https://bold.co@estafa.com/payment',
      'javascript:alert(1)',
      'checkout.bold.co/payment/LNK_1',
      '',
      null,
    ]) {
      expect(enlaceDePagoValido(malo)).toBeNull()
    }
  })
})

describe('las fechas se leen como en el período de la cuota', () => {
  it('dd/mm/aaaa, sin correrse de día', () => {
    expect(fechaCorta('2026-09-30')).toBe('30/09/2026')
    expect(fechaCorta('2027-01-01')).toBe('01/01/2027')
  })
})

describe('las cuotas de la pestaña Pagos', () => {
  const ahora = '2026-10-05T15:00:00Z'
  const estados = (cobros: CobroRecibido[], hoy: string) =>
    cuotasConEstado({ cuotas: CUOTAS, cobros, hoy, ahoraISO: ahora }).map((c) => [c.numero, c.estado, c.abonado, c.saldo])

  it('reparte lo pagado de la más vieja a la más nueva, igual que el próximo pago', () => {
    expect(estados([pagado(150000), pagado(50000)], '2026-10-05')).toEqual([
      [1, 'pagada', 150000, 0],
      [2, 'abonada', 50000, 100000],
      [3, 'pendiente', 0, 150000],
      [4, 'pendiente', 0, 150000],
    ])
  })

  it('una cuota impaga cuyo vencimiento pasó queda vencida, aunque tenga abono', () => {
    expect(estados([pagado(100000)], '2026-10-01')[0]).toEqual([1, 'vencida', 100000, 50000])
  })

  it('unos pesos de redondeo no dejan una cuota abierta', () => {
    expect(estados([pagado(149990)], '2026-10-01')[0]).toEqual([1, 'pagada', 150000, 0])
  })

  it('el botón de pago solo en una cuota con saldo, y la factura viaja con su cuota', () => {
    const cuotas = [
      { ...CUOTAS[0], enlacePagoExpira: '2026-12-31T23:59:00-05:00', cuotaId: 'c1', factura: { numero: 'FE-1', pdf: true, xml: true } },
      { ...CUOTAS[1], enlacePagoUrl: LINK, enlacePagoExpira: '2026-12-31T23:59:00-05:00' },
    ]
    const r = cuotasConEstado({ cuotas, cobros: [pagado(150000)], hoy: '2026-10-05', ahoraISO: ahora })
    expect(r[0]).toMatchObject({ estado: 'pagada', enlacePago: null, cuotaId: 'c1', factura: { numero: 'FE-1', pdf: true, xml: true } })
    expect(r[1]).toMatchObject({ estado: 'pendiente', enlacePago: LINK, factura: null })
  })
})
