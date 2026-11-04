/**
 * La pantalla de `/valida` con la suscripción Cancelada (Términos v1.5, 11.3) y la cartera de la pestaña
 * Pagos (11.7): lo que ve cada quien, tal cual.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('./reactivar-acciones', () => ({ pagarPeriodoReactivacionCda: async () => ({ ok: true, url: 'x' }) }))

import { SuscripcionCancelada } from './suscripcion-cancelada'
import { PestanaPagos } from '../suscripcion/pestana-pagos'
import type { CuotaConEstado } from '@/lib/valida-cda/pago-pendiente'

const textoDe = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

describe('la pantalla de la Cancelada', () => {
  it('la persona designada: el estado, la información guardada, cómo volver y el botón', () => {
    const html = renderToStaticMarkup(React.createElement(SuscripcionCancelada, { canceladaDesde: '2026-12-31', puedeReactivar: true }))
    expect(textoDe(html)).toBe(
      'La suscripción de Valida está Cancelada ' +
        'La suscripción está Cancelada desde el 31 de diciembre por falta de pago (cláusula 11.3 de los Términos). Mientras esté Cancelada no se pueden hacer consultas ni ver el historial ni los reportes en la plataforma. ' +
        'Para reactivarla, paga un período: corre desde el día del pago, que pasa a ser tu nueva fecha de renovación, y con el pago vuelven las consultas, el historial y los reportes (cláusula 11.4). ' +
        'Reactivar la suscripción ' +
        'Tu información está guardada íntegra. Durante 10 años puedes pedir, sin costo, la exportación de tu bitácora y de tus reportes escribiendo desde un correo registrado a mauricio.moreno@metrik.com.co (cláusula 9.3).',
    )
    expect(html).toContain('data-reactivar-cda')
    expect(html).not.toMatch(/\$\d/)
  })

  it('los demás usuarios: sin botón ni montos, y quién puede reactivarla', () => {
    const html = renderToStaticMarkup(React.createElement(SuscripcionCancelada, { canceladaDesde: '2027-01-23', puedeReactivar: false }))
    expect(html).not.toContain('data-reactivar-cda')
    expect(textoDe(html)).toContain('Cancelada desde el 23 de enero')
    expect(textoDe(html)).toContain('Para volver a usarla, avísale a la persona designada de tu empresa: ella puede reactivarla pagando un período desde la sección Suscripción.')
  })
})

describe('la cartera en la pestaña Pagos (11.7)', () => {
  const cuota = (numero: number, desde: string, hasta: string, enlace: string | null): CuotaConEstado => ({
    cuotaId: `q${numero}`,
    numero,
    concepto: `Suscripción VALIDA · Plan CDA — servicio de computación en la nube (SaaS) · periodo del ${desde} al ${hasta}`,
    fechaVencimiento: numero === 2 ? '2026-10-27' : '2026-11-27',
    monto: 150000,
    abonado: 0,
    saldo: 150000,
    estado: 'vencida',
    enlacePago: enlace,
    factura: null,
  })

  it('cada período con su saldo, sin intereses y sin condicionar nada; el enlace si está vigente', () => {
    const html = renderToStaticMarkup(
      React.createElement(PestanaPagos, {
        carga: { estado: 'ok', cuotas: [], pagos: [], cartera: [cuota(2, '23-oct', '22-nov', 'https://checkout.bold.co/payment/LNK_1'), cuota(3, '23-nov', '22-dic', null)] },
      }),
    )
    const t = textoDe(html)
    expect(t).toContain(
      'Saldo pendiente de períodos anteriores Son períodos que empezaron antes del 1 de diciembre de 2026 y no se pagaron (cláusula 11.7). No generan intereses ni recargos, y pagarlos no es condición para reactivar la suscripción ni para hacer consultas.',
    )
    expect(t).toContain('Período del 23 de octubre al 22 de noviembre de 2026 · $150.000 Pagar en línea')
    expect(t).toContain('Período del 23 de noviembre al 22 de diciembre de 2026 · $150.000 Para pagarlo, escríbenos a mauricio.moreno@metrik.com.co y te enviamos el enlace de pago.')
  })

  it('sin cartera no aparece la sección', () => {
    const html = renderToStaticMarkup(React.createElement(PestanaPagos, { carga: { estado: 'ok', cuotas: [], pagos: [], cartera: [] } }))
    expect(html).not.toContain('data-cartera-cda')
  })
})
