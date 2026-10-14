/**
 * Riel de cobro (F2-7, C17, X1, Noor §7.2-7.3). Casos sintéticos.
 */
import { describe, expect, it } from 'vitest'
import { TERMINOS_BASE_TRAPPVEL } from '@/lib/cotizaciones/__fixtures__/terminos-base-trappvel'
import { REGLA_POR_DEFECTO, type CuotaPlan } from './plan-pagos'
import {
  cuentaPorDigitos,
  cuotasConEstadoViaje,
  cuentasDeRecaudo,
  linkDePagoPropio,
  mensajeRecibo,
  mensajeRecordatorioCuota,
  pagoRepetido,
  propuestaDesdeLectura,
  rielDeCobro,
  textosDelRiel,
} from './riel-cobro'

const CUOTAS: CuotaPlan[] = [
  { numero: 0, monto: 2_000_000, fecha: '2026-10-13', concepto: null },
  { numero: 1, monto: 2_666_000, fecha: '2026-10-30', concepto: null },
  { numero: 2, monto: 2_666_000, fecha: '2026-11-18', concepto: null },
  { numero: 3, monto: 1_833_000, fecha: '2026-12-03', concepto: null },
]
const TOTAL = 9_165_000
const pago = (monto: number, fecha = '2026-10-13') => ({ monto, fecha })

describe('estado de cada cuota por FIFO (F2-7)', () => {
  it('pagada, pagada en parte, por pagar, vence hoy y vencida hace N días', () => {
    const { cuotas } = cuotasConEstadoViaje(CUOTAS, [pago(2_000_000), pago(1_000_000, '2026-10-20')], '2026-10-30')
    expect(cuotas.map((c) => c.etiqueta)).toEqual(['Pagada', 'Pagada en parte (falta $1.666.000)', 'Por pagar', 'Por pagar'])
    const hoy = cuotasConEstadoViaje(CUOTAS, [pago(2_000_000)], '2026-10-30').cuotas[1]
    expect(hoy.etiqueta).toBe('Vence hoy')
    const tarde = cuotasConEstadoViaje(CUOTAS, [pago(2_000_000)], '2026-11-02').cuotas[1]
    expect(tarde.etiqueta).toBe('Vencida hace 3 días')
  })

  it('un sobrepago pasa a la siguiente; si supera el total queda saldo a favor', () => {
    const { cuotas } = cuotasConEstadoViaje(CUOTAS, [pago(3_000_000)], '2026-10-14')
    expect(cuotas[0].estado).toBe('pagada')
    expect(cuotas[1]).toMatchObject({ estado: 'parcial', saldo: 1_666_000 })
    const r = cuotasConEstadoViaje(CUOTAS, [pago(TOTAL + 50_000)], '2026-10-14')
    expect(r.saldoAFavor).toBe(50_000)
    expect(r.cuotas.every((c) => c.estado === 'pagada')).toBe(true)
  })

  it('un pago sin fecha (programado) o anulado no cuenta', () => {
    const { cuotas } = cuotasConEstadoViaje(CUOTAS, [{ monto: 2_000_000, fecha: null }, { monto: 2_000_000, fecha: '2026-10-13', anulado_at: '2026-10-14' }], '2026-10-14')
    expect(cuotas[0].estado).toBe('vencida')
  })
})

describe('la franja de la cabecera (Noor riel A)', () => {
  const base = { total: TOTAL, cuotas: CUOTAS, fechaSalida: '2026-12-04', regla: REGLA_POR_DEFECTO }
  it('textos: pagado, próxima cuota y marca del 80 % en camino', () => {
    const r = rielDeCobro({ ...base, pagos: [pago(2_000_000)], hoy: '2026-10-14' })
    expect(textosDelRiel(r)).toEqual({
      pagado: 'Pagado $2.000.000 de $9.165.000 (21 %)',
      proxima: 'Próxima cuota $2.666.000 el viernes 30 oct',
      marca: '80 % al 19 nov: en camino',
      aFavor: null,
    })
  })
  it('en riesgo con una cuota vencida; cumplido con el 80 % pagado', () => {
    expect(rielDeCobro({ ...base, pagos: [pago(2_000_000)], hoy: '2026-11-02' }).marca?.estado).toBe('en_riesgo')
    expect(rielDeCobro({ ...base, pagos: [pago(7_332_000)], hoy: '2026-11-02' }).marca?.estado).toBe('cumplido')
  })
})

describe('cuentas que reciben la plata', () => {
  it('sin configuración, las de los términos de la línea', () => {
    const c = cuentasDeRecaudo({}, TERMINOS_BASE_TRAPPVEL)
    expect(c.map((x) => x.nombre)).toEqual([
      'Banco de Bogotá ahorros 708030895',
      'Bancolombia ahorros 32800003241',
      'Davivienda ahorros 469500014383',
    ])
    expect(cuentaPorDigitos(c, '****3241')?.nombre).toBe('Bancolombia ahorros 32800003241')
    expect(cuentaPorDigitos(c, '41')).toBeNull()
    expect(linkDePagoPropio(c)).toBeNull()
  })
  it('con configuración del espacio manda la configuración; el link solo si es https', () => {
    const c = cuentasDeRecaudo({ cuentas_recaudo: [
      { id: 'bc', nombre: 'Bancolombia', tipo: 'banco', numero: '32800003241', siigo_payment_id: 5638 },
      { id: 'link', nombre: 'Link', tipo: 'link', url: 'https://pagos.agencia.test/x' },
      { id: 'mal', nombre: 'Link raro', tipo: 'link', url: 'javascript:alert(1)' },
    ] }, TERMINOS_BASE_TRAPPVEL)
    expect(c.map((x) => x.id)).toEqual(['bc', 'link', 'mal'])
    expect(c[0].siigo_payment_id).toBe(5638)
    expect(linkDePagoPropio(c)).toBe('https://pagos.agencia.test/x')
    expect(c[2].url).toBeNull()
  })
})

describe('lectura del comprobante (F2-4, C17)', () => {
  const cuentas = cuentasDeRecaudo({}, TERMINOS_BASE_TRAPPVEL)
  it('propone monto, fecha, banco, referencia y la cuenta por sus últimos dígitos', () => {
    const p = propuestaDesdeLectura({
      monto: { value: '2000000' }, fecha: { value: '2026-10-13' }, banco_origen: { value: 'Nequi' },
      cuenta_destino: { value: '3241' }, destinatario: { value: 'TRAPPVEL ENTERPRISE SAS' }, referencia: { value: 'M4471023' },
    }, cuentas, 'Trappvel')
    expect(p).toEqual({ monto: 2_000_000, fecha: '2026-10-13', banco: 'Nequi', referencia: 'M4471023', cuentaId: cuentas[1].id, pareceProveedor: false })
  })
  it('si la plata fue a otro (un proveedor), lo dice', () => {
    const p = propuestaDesdeLectura({ monto: { value: '850000' }, destinatario: { value: 'Hotel Arena Blanca' }, cuenta_destino: { value: '9999' } }, cuentas, 'Trappvel')
    expect(p.pareceProveedor).toBe(true)
  })
  it('referencia y monto repetidos se detectan; otra referencia no', () => {
    const pagos = [{ monto: 2_000_000, fecha: '2026-10-13', external_ref: 'M447 1023' }]
    expect(pagoRepetido(pagos, 'm4471023', 2_000_000)).toBe(true)
    expect(pagoRepetido(pagos, 'm4471023', 1_000_000)).toBe(false)
    expect(pagoRepetido(pagos, null, 2_000_000)).toBe(false)
  })
})

describe('mensajes al viajero (Noor §7.2-7.3, X1)', () => {
  const riel = rielDeCobro({ total: TOTAL, cuotas: CUOTAS, pagos: [pago(2_000_000)], hoy: '2026-10-14', fechaSalida: '2026-12-04', regla: REGLA_POR_DEFECTO })
  it('recibo: lo que entró, lo que queda y la próxima cuota', () => {
    expect(mensajeRecibo({ nombreCliente: 'Carolina Duarte', monto: 2_000_000, riel, numeroRecibo: 'RC-0142', agencia: 'Trappvel' })).toBe(
      'Carolina, recibimos tu pago de $2.000.000. ¡Gracias!\nTe quedan $7.165.000. Tu próxima cuota es de $2.666.000 el viernes 30 oct.\nAdjunto tu recibo de caja RC-0142.\n\nTrappvel',
    )
  })
  it('pago en parte: pide lo que falta', () => {
    const r = rielDeCobro({ total: TOTAL, cuotas: CUOTAS, pagos: [pago(2_000_000), pago(2_000_000, '2026-10-20')], hoy: '2026-10-20', fechaSalida: '2026-12-04', regla: REGLA_POR_DEFECTO })
    expect(mensajeRecibo({ nombreCliente: 'Carolina', monto: 2_000_000, riel: r, numeroRecibo: null, agencia: 'Trappvel' }))
      .toContain('recibimos $2.000.000 de tu cuota de $2.666.000. ¿Nos envías los $666.000 que faltan antes del 30 oct?')
  })
  it('recordatorio a 3 días y el día; sin link propio no hay link', () => {
    const t3 = mensajeRecordatorioCuota({ nombreCliente: 'Carolina', cuota: { monto: 2_666_000, fecha: '2026-10-30' }, hoy: '2026-10-27', link: null, comercial: 'Daniela', agencia: 'Trappvel' })
    expect(t3).toBe('Carolina, ¿te queda bien pagar el viernes 30 oct tu cuota de $2.666.000?\nPuedes transferir a las cuentas de siempre.\nCuando pagues, mándame el comprobante por aquí.\n\nDaniela · Trappvel')
    const dia = mensajeRecordatorioCuota({ nombreCliente: 'Carolina', cuota: { monto: 2_666_000, fecha: '2026-10-30' }, hoy: '2026-10-30', link: 'https://pagos.agencia.test/x', comercial: null, agencia: 'Trappvel' })
    expect(dia).toContain('hoy vence tu cuota de $2.666.000')
    expect(dia).toContain('https://pagos.agencia.test/x')
    expect(t3 + dia).not.toMatch(/\[link/)
  })
})
