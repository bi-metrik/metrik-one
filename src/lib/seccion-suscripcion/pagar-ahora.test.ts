/**
 * Después de un rechazo de la tarjeta (cda-pruebas-futuras, 2026-10-19), la suscripción dice que el banco
 * rechazó y deja «Pagar ahora» (el enlace YA, con la misma generación del cron). Los CDA, igual que antes.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { crearDoble } from '../../../test/tablas-doble'
import { enlaceDeCuotaPendiente, ofrecePagarAhora, rechazoDeLaTarjeta } from './pagar-ahora'

vi.mock('@/app/(app)/suscripcion/acciones', () => ({ pagarCuotaPendiente: async () => ({ ok: false, error: 'x' }) }))

const METRIK = 'ws-metrik'
const vencida = { estado: 'ok' as const, pago: { estado: 'pendiente', numero: 1, enlacePago: null } }
const deSuscripcion = { contrato: { suscripcionId: 'sus-1', cobradorId: METRIK }, pago: vencida }

function tablas() {
  return {
    planes_cobro: [{ id: 'p1', workspace_id: METRIK, negocio_id: null, suscripcion_id: 'sus-1', pasarela: 'bold' }],
    plan_cobro_cuotas: [
      { id: 'q1', plan_cobro_id: 'p1', numero: 1 },
      { id: 'q2', plan_cobro_id: 'p1', numero: 2 },
    ],
    cobro_intentos_tarjeta: [
      { plan_cobro_id: 'p1', numero_cuota: 1, intento: 0, resultado: 'rechazado', mensaje: 'epayco_error: Some fields are required', updated_at: '2026-10-16T16:35:40Z' },
      { plan_cobro_id: 'p1', numero_cuota: 1, intento: 1, resultado: 'rechazado', mensaje: '2: Tarjeta restringida por el centro de autorizaciones', updated_at: '2026-10-19T10:04:00Z' },
    ],
  }
}

describe('«Pagar ahora» de una suscripción', () => {
  it('se ofrece a una suscripción con cuota pendiente sin enlace; no a un CDA (negocio) ni con enlace vigente', () => {
    expect(ofrecePagarAhora(deSuscripcion)).toBe(true)
    expect(ofrecePagarAhora({ ...deSuscripcion, contrato: { suscripcionId: null, cobradorId: METRIK } })).toBe(false)
    expect(ofrecePagarAhora({ ...deSuscripcion, pago: { estado: 'ok', pago: { ...vencida.pago, enlacePago: 'https://checkout.bold.co/x' } } })).toBe(false)
    expect(ofrecePagarAhora({ ...deSuscripcion, pago: { estado: 'ok', pago: { estado: 'al_dia' } } })).toBe(false)
  })

  it('genera el enlace de ESA cuota (la de la suscripción, por su plan) con la función del cron', async () => {
    const generar = vi.fn(async () => ({ ok: true as const, url: 'https://checkout.bold.co/payment/LNK_1' }))
    const r = await enlaceDeCuotaPendiente(deSuscripcion, { db: crearDoble(tablas()).db, generar })
    expect(r).toEqual({ ok: true, url: 'https://checkout.bold.co/payment/LNK_1' })
    expect(generar).toHaveBeenCalledWith({ workspaceId: METRIK, cuotaId: 'q1' })
  })

  it('un CDA no llega a generar nada por aquí', async () => {
    const generar = vi.fn()
    const r = await enlaceDeCuotaPendiente({ ...deSuscripcion, contrato: { suscripcionId: null, cobradorId: METRIK } }, { db: crearDoble(tablas()).db, generar })
    expect(r.ok).toBe(false)
    expect(generar).not.toHaveBeenCalled()
  })

  it('el rechazo que se muestra es la respuesta del banco más reciente, sin el código', async () => {
    expect(await rechazoDeLaTarjeta(deSuscripcion, crearDoble(tablas()).db)).toBe('Tarjeta restringida por el centro de autorizaciones')
    const sinRechazo = tablas()
    sinRechazo.cobro_intentos_tarjeta = []
    expect(await rechazoDeLaTarjeta(deSuscripcion, crearDoble(sinRechazo).db)).toBeNull()
  })
})

describe('lo que se pinta', () => {
  const lectura = {
    estado: 'ok' as const,
    pago: { estado: 'pendiente' as const, numero: 1, concepto: null, fechaVencimiento: '2026-10-16', monto: 150000, abonado: 0, saldo: 150000, vencida: true, enlacePago: null, enlaceVencido: false },
  }

  it('suscripción con rechazo: dice que el banco rechazó y muestra «Pagar ahora» en vez de «MéTRIK te enviará…»', async () => {
    const { TarjetaPago } = await import('@/app/(app)/suscripcion/tarjeta-pago')
    const html = renderToStaticMarkup(
      React.createElement(TarjetaPago, { lectura, pagarAhora: true, rechazoTarjeta: 'Tarjeta restringida por el centro de autorizaciones' }),
    )
    expect(html).toContain('El banco rechazó el cobro a tu tarjeta: Tarjeta restringida por el centro de autorizaciones')
    expect(html).toContain('data-pagar-ahora')
    expect(html).not.toContain('MéTRIK te enviará')
  })

  it('un CDA (sin las dos props) ve lo de siempre', async () => {
    const { TarjetaPago } = await import('@/app/(app)/suscripcion/tarjeta-pago')
    const html = renderToStaticMarkup(React.createElement(TarjetaPago, { lectura }))
    expect(html).toContain('MéTRIK te enviará el enlace de pago de esta cuota.')
    expect(html).not.toContain('data-pagar-ahora')
    expect(html).not.toContain('data-rechazo-tarjeta')
  })

  it('el aviso de mora de /valida lleva «Pagar ahora» solo si se pide (cuenta autogestionada)', async () => {
    const { AvisoMora } = await import('@/app/(app)/valida/avisos-cda')
    const mora = { estado: 'en_mora' as const, cuota: { numero: 1, fechaVencimiento: '2026-10-16' }, restringeDesde: '2026-10-26', diasMora: 3 }
    const con = renderToStaticMarkup(React.createElement(AvisoMora, { mora: mora as never, pagar: true }))
    const sin = renderToStaticMarkup(React.createElement(AvisoMora, { mora: mora as never }))
    expect(con).toContain('data-pagar-mora')
    expect(con).toContain('href="/suscripcion"')
    expect(sin).not.toContain('data-pagar-mora')
  })
})
