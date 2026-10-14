/**
 * El bot como segunda puerta del pago a proveedor (F3-8, Vera C12): qué servicios ofrece, cuál
 * propone y qué dice. Las reglas del pago son las de la pantalla (`reglas-pago.ts`, con su guarda
 * de copia), así que aquí se prueba que el bot las nombra igual.
 */
import { describe, expect, it } from 'vitest'
import {
  ID_NINGUNO,
  botonesPropuesta,
  opcionesDeServicio,
  servicioPropuesto,
  serviciosPendientes,
  textoConfirmacionPago,
  textoPagoRegistrado,
  textoPropuesta,
} from './servicio-viaje-reglas'
import { configReglasPago, reglasQueRompe } from '../../reglas-pago'

const servicios = [
  { id: 'vuelo', nombre: 'Vuelo San Andrés ⇄ Providencia', estado: 'reservado', costo_cotizado: 1_180_000, valor_por_pagar: null },
  { id: 'hotel', nombre: 'Hotel Arena Blanca', estado: 'por_reservar', costo_cotizado: '2410000', valor_por_pagar: null },
  { id: 'kayak', nombre: 'Kayak', estado: 'cancelado', costo_cotizado: 100_000, valor_por_pagar: null },
  { id: 'traslado', nombre: 'Traslado', estado: 'reservado', costo_cotizado: 200_000, valor_por_pagar: 250_000 },
]

describe('serviciosPendientes', () => {
  it('solo los que van y a los que les falta pago, con lo que falta', () => {
    const p = serviciosPendientes(servicios, { vuelo: 1_180_000, traslado: 100_000 })
    expect(p).toEqual([
      { id: 'hotel', nombre: 'Hotel Arena Blanca', falta: 2_410_000 },
      { id: 'traslado', nombre: 'Traslado', falta: 150_000 },
    ])
  })
})

describe('propuesta por monto', () => {
  const p = serviciosPendientes(servicios, {})
  it('propone el único al que le falta exactamente ese monto', () => {
    expect(servicioPropuesto(p, 2_410_000)?.id).toBe('hotel')
    expect(textoPropuesta(servicioPropuesto(p, 2_410_000)!, 2_410_000)).toBe('¿Es el pago de Hotel Arena Blanca por $2.410.000?')
  })
  it('sin coincidencia exacta o con dos iguales, no adivina', () => {
    expect(servicioPropuesto(p, 2_000_000)).toBeNull()
    const dobles = [{ id: 'a', nombre: 'A', falta: 100 }, { id: 'b', nombre: 'B', falta: 100 }]
    expect(servicioPropuesto(dobles, 100)).toBeNull()
  })
  it('botones de 20 caracteres o menos', () => {
    for (const b of botonesPropuesta(p[0])) expect(b.label.length).toBeLessThanOrEqual(20)
  })
})

describe('lista «¿De qué servicio?»', () => {
  it('cada pendiente con lo que falta y la salida «no es de un servicio»', () => {
    const ops = opcionesDeServicio(serviciosPendientes(servicios, {}))
    expect(ops.map(o => o.label)).toEqual([
      'Vuelo San Andrés ⇄ Providencia · falta $1.180.000',
      'Hotel Arena Blanca · falta $2.410.000',
      'Traslado · falta $250.000',
      'Ninguno: es otro gasto del viaje',
    ])
    expect(ops.at(-1)?.id).toBe(ID_NINGUNO)
  })
})

describe('textos con las reglas de la pantalla', () => {
  it('tarjeta personal: el bot dice que queda esperando a Edgar, nunca «pagado» a secas', () => {
    const rotas = reglasQueRompe({
      monto: 2_410_000, pagadoAntes: 0, costoCotizado: 2_410_000,
      medio: { id: 'tc-edgar', label: 'Tarjeta personal Edgar ••0932', titular: 'personal' },
      cobradoCliente: 2_000_000, precioAprobado: 9_000_000, config: configReglasPago(null),
    })
    const esperando = rotas.map(r => r.texto)
    expect(textoConfirmacionPago({ negocio: 'San Andrés · Carolina', servicio: 'Hotel Arena Blanca', monto: 2_410_000, medio: 'Tarjeta personal Edgar ••0932', esperando }))
      .toContain('⏳ Quedará esperando a Edgar: Este medio es personal (Tarjeta personal Edgar ••0932).')
    expect(textoPagoRegistrado({ servicio: 'Hotel Arena Blanca', monto: 2_410_000, esperando }))
      .toBe('✅ Pago de $2.410.000 registrado en Hotel Arena Blanca.\n⏳ Quedó esperando a Edgar: Este medio es personal (Tarjeta personal Edgar ••0932).')
    expect(textoPagoRegistrado({ servicio: 'Hotel', monto: 1, esperando: [] })).not.toContain('Edgar')
  })
})
