/**
 * El aviso de `/valida` del plan suspendido por la reversión del pago (2026-10-27): la misma frase del
 * correo, que el historial sigue disponible y cómo reactivarlo; el botón solo para quien paga.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('./reactivar-acciones', () => ({ pagarPeriodoReactivacion: async () => ({ ok: true, url: 'x' }) }))

import { PlanSuspendidoPorReverso } from './plan-suspendido-reverso'
import { frasesSuspension } from '@/lib/valida-registro/corte-reverso'

const frases = frasesSuspension({
  monto: 150000,
  desde: '2026-10-22',
  hasta: '2026-11-21',
  anuladoEn: '2026-10-27T15:42:05.000Z',
  razonSocial: 'ACME S.A.S.',
})

const textoDe = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

describe('el aviso del plan suspendido por reverso', () => {
  it('con quien paga: la frase del correo, el historial disponible y el botón para pagar el período', () => {
    const html = renderToStaticMarkup(React.createElement(PlanSuspendidoPorReverso, { frases, puedePagar: true }))
    expect(textoDe(html)).toBe(
      'Tu plan de Valida está suspendido por la reversión del pago El pago de $150.000 del período 22 de octubre de 2026–21 de noviembre de 2026 fue reversado. Desde el 27 de octubre de 2026 a las 10:42 a. m., Valida no permite consultas nuevas para ACME S.A.S. Tus reportes y tu historial siguen disponibles en la pestaña Historial. Para reactivar el plan, paga el período. Pagar el período',
    )
    expect(html).toContain('data-pagar-periodo')
  })

  it('sin permiso de pago: sin botón, y dice quién puede pagar', () => {
    const html = renderToStaticMarkup(React.createElement(PlanSuspendidoPorReverso, { frases, puedePagar: false }))
    expect(html).not.toContain('data-pagar-periodo')
    expect(textoDe(html)).toContain('la persona designada por tu empresa puede pagar el período desde esta pantalla')
  })
})
