/**
 * Las dos formas de pagar en la pestaña Pagos de `/suscripcion` (Plan Anual, 2026-10-06), renderizadas.
 * Se queda en `.ts`: `vitest.config.ts` solo recoge `*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }))
vi.mock('./acciones', () => ({
  pagarElMes: async () => ({ ok: false, error: 'x' }),
  elegirPlanAnual: async () => ({ ok: false, error: 'x' }),
  cambiarMencionPlanAnual: async () => ({ ok: false, error: 'x' }),
}))
vi.mock('@/hooks/use-intencion', () => ({ useIntencion: () => ({ clave: () => 'k', cerrar: () => {} }) }))
vi.mock('@/lib/valida-api/acciones', () => ({ aprobarEntradaValidaApi: async () => ({ ok: true }) }))
vi.mock('@/lib/valida-cda/acciones', () => ({ aprobarEntradaValidaCda: async () => ({ ok: true }) }))
vi.mock('@/lib/radar/acciones', () => ({ aprobarEntradaRadar: async () => ({ ok: true }) }))

const { OfertaAnual, OpcionesPago } = await import('./opciones-pago')

const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const MES = { cuotaId: 'q2', numero: 2, saldo: 150000, enlace: null }
const DATOS = {
  razonSocial: 'CDA X S.A.S.',
  nit: '901234567-1',
  versionTerminos: '1.3',
  ordenNumero: null,
  precioUsuarioAdicional: null,
  plazo: { desde: '2026-10-23', hasta: '2027-10-22' },
}

function pintar(anual: Parameters<typeof OpcionesPago>[0]['opciones']['anual'], mes: typeof MES | null = MES, soloLectura = false) {
  return renderToStaticMarkup(
    React.createElement(OpcionesPago, { opciones: { tipo: 'ok', mes, anual }, soloLectura, nombreSugerido: 'Ana Pérez' }),
  )
}

describe('pagar el mes o 12 meses', () => {
  it('con la oferta: los dos botones con sus montos y el ahorro', () => {
    const t = texto(pintar({ estado: 'oferta', datos: DATOS }))
    expect(t).toContain('Pagar el mes · $150.000')
    expect(t).toContain('Pagar 12 meses · $1.650.000 (ahorras $150.000)')
    expect(t).toContain('del 23 de octubre de 2026 al 22 de octubre de 2027')
    expect(t).toContain('Oferta hasta el 31 de marzo de 2027')
  })

  it('con la elección hecha: el enlace del anual, sin volver a ofrecerlo', () => {
    const html = pintar({ estado: 'elegido', desde: '2026-10-23', hasta: '2027-10-22', enlace: 'https://checkout.bold.co/LNK_X' })
    expect(html).toContain('href="https://checkout.bold.co/LNK_X"')
    expect(texto(html)).toContain('Se activa cuando el pago quede aprobado')
    expect(texto(html)).not.toContain('ahorras')
  })

  it('con el plan activo: lo dice y no ofrece otro', () => {
    const t = texto(pintar({ estado: 'activo', desde: '2026-10-23', hasta: '2027-10-22', razonSocial: 'CDA X S.A.S.', mencion: null }, null))
    expect(t).toContain('Plan anual pagado: 12 períodos del 23 de octubre de 2026 al 22 de octubre de 2027')
    expect(t).not.toContain('Pagar 12 meses')
  })

  it('con el plan activo, la mención autorizada se puede revocar; sin autorizar, se puede dar', () => {
    const dada = texto(
      pintar({ estado: 'activo', desde: '2026-10-23', hasta: '2027-10-22', razonSocial: 'CDA X S.A.S.', mencion: { autoriza: true, desde: '2026-10-10T15:00:00Z' } }, null),
    )
    expect(dada).toContain('Autorizaste a METRIK a decir que CDA X S.A.S. usa VALIDA')
    expect(dada).toContain('Revocar la autorización')
    const sinDar = texto(pintar({ estado: 'activo', desde: '2026-10-23', hasta: '2027-10-22', razonSocial: 'CDA X S.A.S.', mencion: null }, null))
    expect(sinDar).toContain('No has autorizado a METRIK')
    expect(sinDar).toContain('Autorizar la mención')
  })

  it('con cuotas vencidas: el motivo, sin el botón del anual', () => {
    const t = texto(pintar({ estado: 'no_disponible', motivo: 'cuotas_vencidas', texto: 'Para elegir el plan anual primero hay que pagar las cuotas vencidas.' }))
    expect(t).toContain('primero hay que pagar las cuotas vencidas')
    expect(t).not.toContain('Pagar 12 meses')
  })

  it('apagado y sin cuota pendiente: no se pinta nada', () => {
    expect(pintar({ estado: 'no_disponible', motivo: 'apagado', texto: '' }, null)).toBe('')
  })

  it('en «Ver como» (solo lectura) los botones no operan', () => {
    const html = pintar({ estado: 'oferta', datos: DATOS }, MES, true)
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})

describe('el anexo abierto: la casilla de mención (numeral 11) va aparte', () => {
  const html = renderToStaticMarkup(React.createElement(OfertaAnual, { datos: DATOS, soloLectura: false, nombreSugerido: 'Ana Pérez', abiertoInicial: true }))

  it('muestra el anexo v1 final, con sus 13 numerales', () => {
    const t = texto(html)
    expect(t).toContain('Autorización de mención (voluntaria)')
    expect(t).toContain('Cambio de dueño o venta del establecimiento')
  })

  it('la casilla de mención está desmarcada, fuera del botón de pago, y el botón no depende de ella', () => {
    const casilla = /<input[^>]*data-casilla-mencion[^>]*>/.exec(html)?.[0] ?? ''
    expect(casilla).not.toBe('')
    expect(casilla).not.toContain('checked')
    expect(casilla).not.toContain('disabled')
    // Después del botón «Acepto y voy a pagar», no dentro de él.
    expect(html.indexOf('data-casilla-mencion')).toBeGreaterThan(html.indexOf('data-aceptar-anual'))
    expect(texto(html)).toContain('Opcional. Autorizo a METRIK a decir que CDA X S.A.S. usa VALIDA')
    // La de aceptación no la incluye.
    const aceptacion = /<input[^>]*data-casilla-anual[^>]*>\s*<span>([^<]*)<\/span>/.exec(html)?.[1] ?? ''
    expect(aceptacion).toContain('Elijo el Plan Anual de VALIDA')
    expect(aceptacion).not.toContain('Autorizo a METRIK')
  })
})
