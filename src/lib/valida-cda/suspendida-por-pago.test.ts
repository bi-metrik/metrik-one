import { describe, expect, it } from 'vitest'
import { proximoPago, type CuotaDeServicio } from './pago-pendiente'
import {
  estadoMora,
  fechaDiaMesLargo,
  fechasDePagoV15,
  mensajeSuspendidaPorPago,
  periodoEnPalabras,
  REGLA_MORA_CDA,
  textoAvisoGraciaV15,
  textoAvisoSuspendida,
  textoPagaHasta,
  textosPagoCuotaV15,
  type EstadoMora,
} from './plazos'
import { resumenEstado, franjaValida } from '@/lib/seccion-suscripcion/estado'

/**
 * Suspendida por pago con la v1.5 (diseño del 4-nov-2026, PR A): las fechas de entrada (D+6 sobre la
 * fecha de renovación, no sobre el vencimiento guardado del 27) y los textos de la cláusula 11.
 *
 * Datos de los 4 CDA: la v1.4 rige el 6-nov, la v1.5 el 1-dic, las cuotas vencen el 27 y su concepto trae
 * el período («periodo del 23-nov al 22-dic»).
 */

const V14 = '2026-11-06'
const V15 = '2026-12-01'

const cuota = (numero: number, periodo: string, fechaVencimiento: string): CuotaDeServicio => ({
  numero,
  tipo: 'cuota',
  monto: 150000,
  fechaVencimiento,
  concepto: `Suscripción VALIDA · Plan CDA — Persona jurídica · periodo del ${periodo}`,
  enlacePagoUrl: null,
  enlacePagoExpira: null,
})

const mora = (cuotas: CuotaDeServicio[], hoy: string, pagado = 0): EstadoMora =>
  estadoMora(
    proximoPago({ cuotas, cobros: pagado > 0 ? [{ monto: pagado, estado: 'pagado' }] : [], hoy, ahoraISO: `${hoy}T15:00:00Z` }),
    hoy,
    V14,
    REGLA_MORA_CDA,
    V15,
  )

describe('período v1.5 del 23-dic al 22-ene (vence el 27-dic): la renovación es el 23', () => {
  const cuotas = [cuota(4, '23-dic al 22-ene', '2026-12-27')]
  it('23-dic: al día (es la fecha de renovación)', () => expect(mora(cuotas, '2026-12-23')).toEqual({ estado: 'al_dia' }))
  it('24-dic: aviso con la fecha de Suspendida (29-dic), se consulta', () =>
    expect(mora(cuotas, '2026-12-24')).toEqual({ estado: 'en_mora', vencio: '2026-12-23', restringeDesde: '2026-12-29', corteDesde: '2027-01-23' }))
  it('28-dic: todavía gracia', () => expect(mora(cuotas, '2026-12-28').estado).toBe('en_mora'))
  it('29-dic: entra en Suspendida por pago (no el 2-ene, que sería D+6 sobre el 27)', () =>
    expect(mora(cuotas, '2026-12-29')).toEqual({ estado: 'restringido', vencio: '2026-12-23', restringeDesde: '2026-12-29', corteDesde: '2027-01-23' }))
  it('22-ene: sigue Suspendida; 23-ene: Cancelada (el cálculo `suspendido`)', () => {
    expect(mora(cuotas, '2027-01-22').estado).toBe('restringido')
    expect(mora(cuotas, '2027-01-23').estado).toBe('suspendido')
  })
  it('pagar en Suspendida levanta todo en la petición siguiente', () => expect(mora(cuotas, '2026-12-30', 150000)).toEqual({ estado: 'al_dia' }))
})

describe('transición 11.7: Caquetá debe el 23-oct–22-nov (vence el 27-oct) y el 23-nov–22-dic', () => {
  const cuotas = [cuota(2, '23-oct al 22-nov', '2026-10-27'), cuota(3, '23-nov al 22-dic', '2026-11-27')]
  it('hoy (4-nov): al día, la v1.4 ya no restringe el 6-nov', () => {
    expect(mora(cuotas, '2026-11-04')).toEqual({ estado: 'al_dia' })
    expect(mora(cuotas, '2026-11-06')).toEqual({ estado: 'al_dia' })
  })
  it('30-nov: al día; 1-dic: aviso con Suspendida desde el 6-dic', () => {
    expect(mora(cuotas, '2026-11-30')).toEqual({ estado: 'al_dia' })
    expect(mora(cuotas, '2026-12-01')).toEqual({ estado: 'en_mora', vencio: '2026-11-30', restringeDesde: '2026-12-06', corteDesde: '2026-12-31' })
  })
  it('5-dic: gracia; 6-dic: Suspendida por pago; 30-dic: sigue; 31-dic: Cancelada', () => {
    expect(mora(cuotas, '2026-12-05').estado).toBe('en_mora')
    expect(mora(cuotas, '2026-12-06')).toEqual({ estado: 'restringido', vencio: '2026-11-30', restringeDesde: '2026-12-06', corteDesde: '2026-12-31' })
    expect(mora(cuotas, '2026-12-30').estado).toBe('restringido')
    expect(mora(cuotas, '2026-12-31').estado).toBe('suspendido')
  })
  it('pagar solo la cuota 2 no la levanta: la 3 también es de la transición', () =>
    expect(mora(cuotas, '2026-12-10', 150000).estado).toBe('restringido'))
  it('pagar las dos sí', () => expect(mora(cuotas, '2026-12-10', 300000)).toEqual({ estado: 'al_dia' }))
})

describe('la fecha de pago que se muestra (D7): la renovación, no el 27', () => {
  it('período v1.5: «antes del 23-dic», Suspendida el 29-dic, Cancelada el 23-ene', () => {
    const f = fechasDePagoV15(cuota(4, '23-dic al 22-ene', '2026-12-27'), V15)
    expect(f).toEqual({ renovacion: '2026-12-23', forma: 'antes_del', suspendidaDesde: '2026-12-29', canceladaDesde: '2027-01-23' })
    expect(textoPagaHasta(f!)).toBe('Paga antes del 23-dic')
  })
  it('período de la transición: «a más tardar el 30-nov», Suspendida el 6-dic, Cancelada el 31-dic', () => {
    const f = fechasDePagoV15(cuota(3, '23-nov al 22-dic', '2026-11-27'), V15)
    expect(f).toEqual({ renovacion: '2026-11-30', forma: 'a_mas_tardar', suspendidaDesde: '2026-12-06', canceladaDesde: '2026-12-31' })
    expect(textoPagaHasta(f!)).toBe('Paga a más tardar el 30-nov')
  })
  it('sin la v1.5 no hay fecha nueva: se dice el vencimiento de siempre', () =>
    expect(fechasDePagoV15(cuota(3, '23-nov al 22-dic', '2026-11-27'), null)).toBeNull())
  it('lo que dice la tarjeta del pago antes, en la gracia y en Suspendida', () => {
    const f = fechasDePagoV15(cuota(4, '23-dic al 22-ene', '2026-12-27'), V15)!
    expect(textosPagoCuotaV15(f, '2026-12-20')).toEqual({
      fecha: 'Paga antes del 23-dic',
      consecuencia: 'Si no se paga, la suscripción queda Suspendida por pago desde el 29-dic.',
      vencida: false,
    })
    expect(textosPagoCuotaV15(f, '2026-12-25')).toEqual({
      fecha: 'Debía pagarse antes del 23-dic',
      consecuencia: 'Si no se paga, la suscripción queda Suspendida por pago desde el 29-dic.',
      vencida: true,
    })
    expect(textosPagoCuotaV15(f, '2026-12-29').consecuencia).toBe('La suscripción está Suspendida por pago desde el 29-dic.')
    expect(textosPagoCuotaV15(f, '2027-01-23').consecuencia).toBeNull()
  })
})

describe('los textos de la cláusula 11 en pantalla (para todos, sin montos)', () => {
  const cuotas = [cuota(3, '23-nov al 22-dic', '2026-11-27')]
  it('del 1 al 5-dic: el período impago y la fecha de Suspendida', () => {
    const m = mora(cuotas, '2026-12-01') as Extract<EstadoMora, { estado: 'en_mora' }>
    expect(periodoEnPalabras(cuotas[0])).toBe('del 23 de noviembre al 22 de diciembre')
    expect(textoAvisoGraciaV15(m, periodoEnPalabras(cuotas[0]))).toBe(
      'El período del 23 de noviembre al 22 de diciembre no está pagado. Si no se paga, desde el 6 de diciembre la ' +
        'suscripción queda Suspendida por pago: no podrás hacer consultas nuevas, pero sí entrar, ver tu historial y descargar tus reportes.',
    )
  })
  it('desde el 6-dic: la franja de Suspendida y el rechazo de la consulta nueva', () => {
    const m = mora(cuotas, '2026-12-06') as Extract<EstadoMora, { estado: 'restringido' }>
    expect(textoAvisoSuspendida(m)).toBe(
      'Suscripción Suspendida por pago desde el 6 de diciembre. No puedes hacer consultas nuevas. Tu historial, tus ' +
        'reportes y la exportación de tu bitácora siguen disponibles. Si se paga, todo vuelve y tu fecha de renovación no ' +
        'cambia. Si no se paga, desde el 31 de diciembre la suscripción queda Cancelada.',
    )
    expect(mensajeSuspendidaPorPago(m)).toBe(
      'La suscripción está Suspendida por pago desde el 6 de diciembre: no se pueden hacer consultas nuevas. Tu ' +
        'historial, tus reportes y la bitácora siguen disponibles. Las consultas vuelven cuando se registre el pago.',
    )
    for (const t of [textoAvisoSuspendida(m), mensajeSuspendidaPorPago(m)]) expect(t).not.toMatch(/\$|150/)
  })
  it('fecha larga sin año', () => {
    expect(fechaDiaMesLargo('2026-12-06')).toBe('6 de diciembre')
    expect(fechaDiaMesLargo('2027-01-23')).toBe('23 de enero')
  })
})

describe('Suscripción (/suscripcion y la franja de /valida) con la v1.5', () => {
  const c3 = cuota(3, '23-nov al 22-dic', '2026-11-27')
  const pago = (hoy: string) => proximoPago({ cuotas: [c3], cobros: [], hoy, ahoraISO: `${hoy}T15:00:00Z` })
  const r = (hoy: string) => resumenEstado({ terminos: { estado: 'aprobada' }, pago: pago(hoy), mora: mora([c3], hoy), hoy, transicion: V15 })

  it('al día, lejos de la fecha: el período y la fecha de pago, no «vence el 27-nov»', () =>
    expect(r('2026-11-10').mensaje).toBe('Estás al día. Próximo período: del 23-nov al 22-dic · paga a más tardar el 30-nov.'))
  it('a 5 días: próxima, con la fecha de Suspendida; la franja dice la fecha de pago', () => {
    expect(r('2026-11-25')).toMatchObject({
      estado: 'por_vencer',
      mensaje: 'Período del 23-nov al 22-dic · Paga a más tardar el 30-nov · Suspendida por pago desde el 6-dic si no se paga.',
    })
    expect(franjaValida(r('2026-11-25'), pago('2026-11-25'), V15)).toBe('Paga a más tardar el 30-nov')
  })
  it('28-nov (ya pasó el 27 guardado): todavía no es mora ni «vencida»', () => expect(r('2026-11-28').estado).toBe('por_vencer'))
  it('1-dic: período sin pagar; 6-dic: Suspendida por pago', () => {
    expect(r('2026-12-01')).toMatchObject({ chip: 'Período sin pagar' })
    expect(r('2026-12-06')).toMatchObject({
      estado: 'restringido',
      chip: 'Suspendida por pago',
      mensaje:
        'La suscripción está Suspendida por pago desde el 6-dic: no hay consultas nuevas. Al pagar vuelven y tu fecha de ' +
        'renovación no cambia; si no, desde el 31-dic queda Cancelada.',
    })
  })
  it('sin la v1.5, los textos de siempre', () => {
    const viejo = resumenEstado({ terminos: { estado: 'aprobada' }, pago: pago('2026-11-25'), mora: { estado: 'al_dia' }, hoy: '2026-11-25' })
    expect(viejo.mensaje).toBe('Tu cuota vence el 27-nov.')
  })
})
