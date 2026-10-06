/**
 * Las dos formas de pagar en la pestaña Pagos de `/suscripcion` (Plan Anual, 2026-10-06), renderizadas.
 * Se queda en `.ts`: `vitest.config.ts` solo recoge `*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }))
vi.mock('./acciones', () => ({ pagarElMes: async () => ({ ok: false, error: 'x' }), elegirPlanAnual: async () => ({ ok: false, error: 'x' }) }))
vi.mock('@/lib/valida-api/acciones', () => ({ aprobarEntradaValidaApi: async () => ({ ok: true }) }))
vi.mock('@/lib/valida-cda/acciones', () => ({ aprobarEntradaValidaCda: async () => ({ ok: true }) }))
vi.mock('@/lib/radar/acciones', () => ({ aprobarEntradaRadar: async () => ({ ok: true }) }))

const { OpcionesPago } = await import('./opciones-pago')

const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const MES = { cuotaId: 'q2', numero: 2, saldo: 150000, enlace: null }
const DATOS = { razonSocial: 'CDA X S.A.S.', nit: '901234567-1', versionTerminos: '1.3', plazo: { desde: '2026-10-23', hasta: '2027-10-22' } }

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
    const t = texto(pintar({ estado: 'activo', desde: '2026-10-23', hasta: '2027-10-22' }, null))
    expect(t).toContain('Plan anual pagado: 12 períodos del 23 de octubre de 2026 al 22 de octubre de 2027')
    expect(t).not.toContain('Pagar 12 meses')
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
