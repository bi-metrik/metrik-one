/**
 * «Pago automático con tarjeta» en la pestaña Pagos de `/suscripcion` (Términos v1.5, 2.4), renderizado.
 * Se queda en `.ts`: `vitest.config.ts` solo recoge `*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }))
vi.mock('./acciones', () => ({
  quitarTarjetaPagoAutomatico: async () => ({ ok: false, error: 'x' }),
  pagarPendienteConTarjeta: async () => ({ ok: false, error: 'x' }),
}))
vi.mock('@/hooks/use-intencion', () => ({ useIntencion: () => ({ clave: () => 'k', cerrar: () => {} }) }))

const { PagoAutomatico, Pendiente } = await import('./pago-automatico')

const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const pintar = (vista: Parameters<typeof PagoAutomatico>[0]['vista'], soloLectura = false) =>
  renderToStaticMarkup(React.createElement(PagoAutomatico, { vista, soloLectura }))

const PENDIENTE = {
  cobrable: true as const,
  texto: 'Tienes pendiente $300.000 (períodos 23-sep al 22-oct de 2026 y 23-oct al 22-nov de 2026).',
  pregunta: '¿Pagarlo ahora con esta tarjeta?',
  confirmacion: 'Se cobrarán $300.000 a tu tarjeta terminada en 1234, en 2 cobros, uno por período. Solo esta vez: los próximos períodos se cobran en su fecha de renovación.',
  huella: 'a'.repeat(64),
}

describe('el bloque de pago automático', () => {
  it('sin la v1.5 aceptada: lleva a aceptarla, sin formulario ni botón de tarjeta (D2)', () => {
    const html = pintar({ tipo: 'acepta_v15' })
    expect(texto(html)).toContain(
      'Para cobrar cada período a tu tarjeta necesitas aceptar la versión 1.5 de los Términos, que autoriza el pago automático (cláusula 2.4).',
    )
    expect(html).toContain('href="/valida?modificacion=1"')
    expect(texto(html)).toContain('Revisar y aceptar la versión 1.5')
    expect(html).not.toContain('data-registrar-tarjeta')
  })

  it('sin tarjeta: «Registrar tarjeta» lleva a la página con la política de ePayco', () => {
    const html = pintar({ tipo: 'sin_tarjeta' })
    expect(texto(html)).toContain('Pago automático con tarjeta')
    expect(texto(html)).toContain(
      'Registra una tarjeta y cada período se cobra solo en tu fecha de renovación. Lo que ya debes no se cobra solo: te preguntamos antes.',
    )
    expect(html).toContain('href="/suscripcion/tarjeta"')
  })

  it('con tarjeta: el resumen, el aviso del rechazo, cambiar y quitar; lo atrasado con su pregunta y su botón', () => {
    const html = pintar({
      tipo: 'activa',
      resumen: 'Pago automático activo · tarjeta terminada en 1234 · próximo cobro 23 de noviembre: $150.000',
      fallo: 'No pudimos cobrar a tu tarjeta terminada en 1234. Puedes pagar con el enlace de pago. Reintentamos el 26 de noviembre. Si no se paga, las consultas nuevas se pausan desde el 6 de diciembre.',
      pendiente: PENDIENTE,
    })
    const t = texto(html)
    expect(t).toContain('Pago automático activo · tarjeta terminada en 1234 · próximo cobro 23 de noviembre: $150.000')
    expect(t).toContain('No pudimos cobrar a tu tarjeta terminada en 1234.')
    expect(t).toContain('Cambiar tarjeta')
    expect(t).toContain('Quitar tarjeta')
    expect(t).toContain(`${PENDIENTE.texto} ¿Pagarlo ahora con esta tarjeta?`)
    expect(t).toContain('Pagarlo ahora con esta tarjeta')
    // La confirmación no está a la vista hasta el clic: nada se cobra con un solo toque.
    expect(t).not.toContain('Confirmar y cobrar')
  })

  it('la confirmación dice qué se cobra y a qué tarjeta, con su propio botón', () => {
    const html = renderToStaticMarkup(React.createElement(Pendiente, { pendiente: PENDIENTE, soloLectura: false, abiertoInicial: true }))
    expect(texto(html)).toContain(PENDIENTE.confirmacion)
    expect(texto(html)).toContain('Confirmar y cobrar')
    expect(texto(html)).toContain('Ahora no')
  })

  it('con un abono parcial no se ofrece la tarjeta: se paga con el enlace', () => {
    const html = renderToStaticMarkup(
      React.createElement(Pendiente, { pendiente: { cobrable: false, texto: 'Tienes pendiente $100.000 (período 23-oct al 22-nov de 2026).' }, soloLectura: false }),
    )
    expect(texto(html)).toContain('Págalo con el enlace de pago de cada cuota, abajo.')
    expect(html).not.toContain('data-pagar-pendiente')
  })

  it('en solo lectura («Ver como») los botones no operan', () => {
    const html = pintar({ tipo: 'activa', resumen: 'x', fallo: null, pendiente: PENDIENTE }, true)
    expect(html).toMatch(/data-quitar-tarjeta="true" disabled=""|disabled=""[^>]*data-quitar-tarjeta/)
    expect(html).toMatch(/data-pagar-pendiente="true" disabled=""|disabled=""[^>]*data-pagar-pendiente/)
  })
})
